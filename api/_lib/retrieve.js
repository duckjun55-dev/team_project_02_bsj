// docs/답변참고문서/청킹 의 조각에서 질문과 가까운 것을 찾는다.
// 조각 형식: 1줄 「출처: …」, 2줄 「키워드: …」, 그다음 본문.
// 한국어는 조사가 붙어 단어가 잘 안 맞으므로 「두 글자 묶음(bigram)」으로 겹치는 정도를 센다.
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'docs', '답변참고문서', '청킹');
let chunks = null;

function bigrams(text) {
  const s = text.toLowerCase().replace(/[^0-9a-z가-힣]+/g, ' ');
  const out = new Set();
  for (const w of s.split(' ')) {
    if (w.length === 1) continue;
    for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2));
  }
  return out;
}

function load() {
  if (chunks) return chunks;
  chunks = [];
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md')); } catch { return chunks; }
  for (const f of files) {
    const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
    const lines = raw.split(/\r?\n/);
    const keywords = (lines.find((l) => l.startsWith('키워드:')) || '').replace('키워드:', '');
    const body = lines.filter((l) => !l.startsWith('출처:') && !l.startsWith('키워드:')).join('\n').trim();
    const base = f.replace(/\.md$/, '');
    const doc = base.replace(/_\d{2}_.*$/, ''); // 문서 이름 = 파일 이름에서 「_번호_소제목」 뗀 것
    const section = (base.match(/_\d{2}_(.*)$/) || [, ''])[1];
    // 문서 이름도 점수에 넣는다 — 「이지드랍 요금」처럼 문서 이름에만 있는 말로 묻는 경우가 있다
    chunks.push({ file: f, doc, section, keywords, body, kw: bigrams(keywords), bg: bigrams(body + ' ' + section), dn: bigrams(doc), sc: bigrams(section) });
  }
  return chunks;
}

// 여러 조각에 흔한 말(예: 「이지드랍」)은 덜 치고, 드문 말(예: 「요금」)은 더 친다 — IDF
let idf = null;
function idfOf(g) {
  if (!idf) {
    const df = new Map();
    for (const c of load()) for (const x of new Set([...c.kw, ...c.bg, ...c.dn])) df.set(x, (df.get(x) || 0) + 1);
    idf = { df, n: chunks.length };
  }
  const d = idf.df.get(g) || 0;
  return d ? Math.log(1 + idf.n / d) : 0;
}

// 질문 꼬리말·조사 — 「문서에 있는 말인가」를 볼 때 뺀다
const FILLER = /(얼마예요|얼마인가요|얼마나|얼마|어떻게|어때요|되나요|될까요|돼요|되요|있나요|있어요|없나요|가능한가요|가능해요|가능|인가요|뭐예요|무엇|알려\s*주세요|궁금해요|맡겨도|맡길|맡기|넣어도|넣으면|넣을|넣어|보내도|보낼|가져가도|가져갈|챙겨|부쳐도|부칠|해요|하나요|할까요|수\s|주세요|있죠|없죠|되죠|돼죠|맞죠|하죠|이죠|무조건|혹시|반드시|꼭)/g;
const PARTICLE = /(은|는|이|가|을|를|도|에|의|로|으로|까지|에서|부터|하고|이랑|랑|만)$/;

/**
 * 질문의 낱말 가운데 문서 어디에도 나오지 않는 것 — 규칙 모드에서 「모른다」를 가를 때 쓴다
 * (낱말의 앞 두 글자가 어느 조각에도 없으면 문서에 없는 주제로 본다. 예: 「보험」 「강아지」 「날씨」)
 */
export function unknownWords(query) {
  idfOf('');
  const words = query.replace(/[?？!.,]/g, ' ').replace(FILLER, ' ').split(/\s+/)
    .map((w) => w.replace(PARTICLE, '')).filter((w) => /^[가-힣a-z0-9]{2,}$/i.test(w));
  return words.filter((w) => !idf.df.has(w.slice(0, 2).toLowerCase()));
}

/** 질문과 가까운 조각 상위 n개 */
export function retrieve(query, n = 5) {
  const q = [...bigrams(query)];
  if (!q.length) return [];
  const total = q.reduce((a, g) => a + idfOf(g), 0) || 1;
  const scored = load().map((c) => {
    let s = 0;
    for (const g of q) {
      const w = idfOf(g);
      s += w * ((c.kw.has(g) ? 2 : 0) + (c.bg.has(g) ? 1 : 0) + (c.dn.has(g) ? 1 : 0) + (c.sc.has(g) ? 1 : 0));
    }
    if (/문서정보/.test(c.section)) s *= 0.5; // 「문서 정보」 조각은 덜 앞세운다
    return { ...c, score: s / total };
  });
  return scored.filter((c) => c.score >= 0.6).sort((a, b) => b.score - a.score).slice(0, n)
    .map(({ doc, section, body, score, file }) => ({ doc, section, body, file, score: Math.round(score * 100) / 100 }));
}
