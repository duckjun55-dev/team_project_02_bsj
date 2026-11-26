// POST /api/chat
//  { mode:'extract', text, today, step } → 예약 항목 뽑기 (실패하면 화면이 규칙 모드로 뽑는다)
//  { mode:'answer', question }           → docs/답변참고문서 근거로만 답하기
import { callAI } from './_lib/ai.js';
import { retrieve, unknownWords } from './_lib/retrieve.js';
import { kstToday } from './_lib/datago.js';
import { loadPersona } from './_lib/persona.js';

// 「모를 때의 답」 — docs/페르소나.md 에서 읽고, 읽지 못하면 이 문장을 쓴다(문의처는 빠지면 안 된다)
const DEFAULT_CONTACT = '안내 문서에서는 확인하지 못했어요. 이지드랍 고객센터(02-6010-1220)나 인천국제공항 고객센터(1577-2600)에 문의해 주세요.';
const CONTACT = loadPersona()?.unknown || DEFAULT_CONTACT;
const EASYDROP_NOTE = '이지드랍 기준이며 홈드랍은 확인 필요';

function parseJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const EXTRACT_SYSTEM = `너는 홈드랍(집에서 캐리어를 수거해 인천공항으로 옮기는 서비스) 예약 챗봇의 「항목 추출기」다.
사용자 문장에서 아래 항목만 뽑아 JSON 하나로만 답한다. 문장에 없는 항목은 넣지 않는다. 추측하지 않는다.
{
 "name": "성함",
 "phone": "휴대폰 번호(010-0000-0000 형식)",
 "address": "수거 주소 원문",
 "district": "주소의 구·시 이름(예: 강남구, 성남시)",
 "flight": "항공편 편명(대문자, 예: KE123)",
 "departDate": "출발 날짜 YYYY-MM-DD",
 "departTime": "출발 시각 HH:MM (24시간)",
 "terminal": "T1 또는 T2",
 "bags": 캐리어 총 개수(숫자),
 "large": 28인치 이상 대형 개수(숫자),
 "pickupDate": "수거 희망 날짜 YYYY-MM-DD",
 "pickupTime": "수거 희망 시각 HH:MM (24시간)",
 "confirm": 사용자가 동의·확인했으면 true, 거절이면 false,
 "isQuestion": 예약 정보가 아니라 질문(요금·금지물품·이용방법 등)이면 true
}
날짜에 연도가 없으면 오늘 기준 가장 가까운 미래 날짜로 한다. 「내일」「모레」도 오늘 기준으로 계산한다.
「오전/오후」를 24시간으로 바꾼다. 「대형 없음」이면 large 는 0.
지금 묻고 있는 단계가 주어지면, 숫자만 말한 경우 그 단계의 항목으로 본다.`;

// 「AI 답변 규칙」 — 페르소나보다 앞에 두고, 페르소나와 부딪치면 규칙이 이긴다
const ANSWER_RULES = `너는 인천공항 홈드랍 예약 챗봇의 안내원이다. 반드시 아래 규칙을 지킨다.
1. 아래 <문서> 안의 내용으로만 답한다. 문서에 없는 내용은 지어내지 않는다.
2. 문서에서 답을 찾을 수 없으면 unknown 을 true 로 한다.
3. 문서끼리 값이 다르면 문서별 값과 문서 이름을 모두 보여 준다. 어느 쪽이 맞는지 단정하지 않는다.
4. 이용 가능 여부·보상 여부 같은 판정은 단정하지 않고 「문서 기준으로는 ~로 안내되어 있습니다」처럼 말한다.
5. 홈드랍 요금·규칙은 「데모 규칙」 문서 값이며 실제 서비스 값이 아니라고 밝힌다.
6. 쉬운 한국어로 3~6문장. 목록이 필요하면 「- 」로 시작하는 줄을 쓴다. 마크다운 굵게(**)는 쓰지 않는다.
JSON 하나로만 답한다: {"answer":"답변", "sources":["근거로 쓴 문서 이름", ...], "unknown":false}
sources 에는 <문서 이름="…"> 의 이름을 그대로 쓴다.`;

// 시스템 프롬프트 = 규칙 → 페르소나(docs/페르소나.md). 문서가 없으면 규칙만
const persona = loadPersona();
const ANSWER_SYSTEM = persona
  ? `${ANSWER_RULES}\n\n<페르소나>\n아래는 말투와 역할이다. 위 규칙과 부딪치면 위 규칙을 따른다.\n${persona.prompt}\n</페르소나>`
  : ANSWER_RULES;

async function extract({ text, today, step }) {
  const user = `오늘: ${today}\n지금 묻는 단계: ${step || '없음'}\n사용자 문장: ${text}`;
  const r = await callAI({ system: EXTRACT_SYSTEM, messages: [{ role: 'user', content: user }], maxTokens: 600, json: true });
  if (!r.ok) return { ok: false, mode: 'rule', tried: r.tried };
  const fields = parseJSON(r.text);
  if (!fields) return { ok: false, mode: 'rule', tried: [...r.tried, { provider: r.provider, reason: 'JSON 해석 실패' }] };
  return { ok: true, mode: 'ai', fields, provider: r.provider, model: r.model, tried: r.tried };
}

async function answer({ question, rule }) {
  const found = retrieve(question, 8); // 조각이 짧아 8개를 넘겨도 부담이 적고, 흔한 말에 밀린 조각도 들어간다
  if (!found.length) {
    return { ok: true, mode: 'none', answer: CONTACT, sources: [], unknown: true };
  }
  const docs = found.map((c) => `<문서 이름="${c.doc}" 소제목="${c.section}">\n${c.body}\n</문서>`).join('\n\n');
  // rule: true → 화면에서 「규칙 모드」를 골랐다. AI 를 부르지 않는다
  const r = rule ? { ok: false, tried: [{ provider: '-', reason: '규칙 모드 선택' }] } : await callAI({
    system: ANSWER_SYSTEM,
    messages: [{ role: 'user', content: `${docs}\n\n질문: ${question}` }],
    maxTokens: 900, json: true,
  });

  // AI 가 모두 실패 → 규칙 모드: 문서 원문을 그대로 보여 준다
  if (!r.ok) {
    // 질문의 핵심 낱말이 문서 어디에도 없으면 엉뚱한 조각 대신 「모른다 + 문의처」
    const missing = unknownWords(question);
    if (missing.length) {
      return { ok: true, mode: 'rule', tried: r.tried, sources: [], unknown: true, answer: `「${missing.join(', ')}」에 대한 내용은 ${CONTACT}` };
    }
    // 가장 가까운 조각 + 점수가 비슷한 「다른 문서」 조각까지 최대 3개 — 문서끼리 값이 다르면 함께 보이도록
    const picked = [found[0]];
    for (const c of found.slice(1)) {
      if (picked.length >= 3) break;
      if (c.score >= found[0].score * 0.75 && !picked.some((p) => p.doc === c.doc)) picked.push(c);
    }
    const sources = picked.map((c) => c.doc);
    const text = picked.map((c) => (picked.length > 1 ? `[${c.doc}]\n` : '') + c.body.replace(/^##\s*/gm, '')).join('\n\n');
    return {
      ok: true, mode: 'rule', tried: r.tried, sources,
      answer: (picked.length > 1 ? '문서마다 내용이 다를 수 있어 찾은 문서를 함께 보여 드려요.\n\n' : '문서에서 찾은 내용을 그대로 보여 드려요.\n') + text,
      note: easydrop(question, text, sources) ? EASYDROP_NOTE : null,
    };
  }

  const j = parseJSON(r.text) || { answer: r.text, sources: [], unknown: false };
  const known = new Set(found.map((c) => c.doc));
  let sources = (j.sources || []).filter((s) => known.has(s));
  if (!sources.length && !j.unknown) sources = [found[0].doc];
  const unknown = !!j.unknown;
  return {
    ok: true, mode: 'ai', provider: r.provider, model: r.model, tried: r.tried,
    answer: unknown ? CONTACT : String(j.answer || '').trim(),
    sources: unknown ? [] : sources,
    unknown,
    // 이지드랍을 근거로(또는 이지드랍에 대해) 답했으면 코드가 문구를 붙인다
    note: !unknown && easydrop(question, j.answer, sources) ? EASYDROP_NOTE : null,
  };
}

// 근거 문서 이름뿐 아니라 질문·답변에 「이지드랍」이 있어도 문구를 붙인다
function easydrop(question, answerText, sources) {
  return sources.some((s) => /이지드랍/.test(s)) || /이지드랍/.test(String(question)) || /이지드랍/.test(String(answerText || ''));
}

// ---------- 입력 검사 (화면의 300자 제한은 화면에서만 걸리므로 서버에서도 막는다) ----------
const MAX_LEN = 300;
const maskPhone = (t) => t.replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[전화번호]');
const STEPS = ['start', 'customer', 'flight', 'bags', 'pickup', 'confirm', 'done'];
function checkInput(body) {
  const field = body.mode === 'extract' ? 'text' : 'question';
  const v = body[field];
  if (typeof v !== 'string' || !v.trim()) return `${field} 가 비어 있어요`;
  if (v.length > MAX_LEN) return `${field} 는 ${MAX_LEN}자까지 받아요`;
  if (body.mode === 'extract') {
    if (body.step && !STEPS.includes(body.step)) return 'step 값이 올바르지 않아요';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.today || ''))) body.today = kstToday();
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST 만 됩니다' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch {
    return res.status(400).json({ ok: false, error: 'JSON 형식이 아니에요' });
  }
  try {
    if (!['extract', 'answer'].includes(body.mode)) return res.status(400).json({ ok: false, error: 'mode 는 extract 또는 answer' });
    const bad = checkInput(body);
    if (bad) return res.status(400).json({ ok: false, error: bad });
    // 휴대폰 번호는 AI 에 보내지 않는다(화면이 이미 가리지만, 다른 경로로 들어온 요청까지 막는다)
    for (const k of ['text', 'question']) if (typeof body[k] === 'string') body[k] = maskPhone(body[k]);
    if (body.mode === 'extract') return res.status(200).json(await extract(body));
    return res.status(200).json(await answer({ question: body.question, rule: body.rule === true }));
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
