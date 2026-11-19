// AI 부르기 — CLAUDE_API_KEY → GROQ_API_KEY → GEMINI_API_KEY 순서.
// 앞이 실패하면(키 비어 있음 · 오류 · 시간 초과) 다음으로 넘어가고, 누가 답했는지와 시도 기록을 돌려준다.
// 모델 이름은 코드에 고정하지 않고, 키로 모델 목록을 조회해 고른다(404 가 나면 모델 이름부터 의심).
import Anthropic from '@anthropic-ai/sdk';

const TIMEOUT = { claude: 12000, groq: 10000, gemini: 10000 }; // 목록 조회(6초)까지 더해도 셋 합이 Vercel 제한(60초) 안에 든다
const modelCache = {}; // provider → 고른 모델 이름 (서버가 켜져 있는 동안 기억)

class AIError extends Error {
  constructor(reason, status) { super(reason); this.reason = reason; this.status = status; }
}

function reasonOf(e) {
  if (e instanceof AIError) return e.reason;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timed? ?out/i.test(e?.message || '')) return '시간 초과';
  if (e?.status === 404) return '404 — 모델 이름 의심';
  if (e?.status === 401 || e?.status === 403) return `키 거부(${e.status})`;
  if (e?.status === 429) return '사용량 한도(429)';
  if (e?.status === 503) return '서비스 붐빔(503)';
  if (e?.status) return `오류(${e.status})`;
  return '오류: ' + (e?.message || String(e)).slice(0, 80);
}

// ---------- 모델 고르기 ----------
// 목록에서 「선호 순서」대로 후보를 줄 세운다. 404 가 나면 다음 후보로 넘어간다.
function rank(ids, prefer, allow = () => true) {
  const out = [];
  for (const p of prefer) {
    for (const id of ids) if ((p instanceof RegExp ? p.test(id) : id === p) && !out.includes(id)) out.push(id);
  }
  for (const id of ids) if (allow(id) && !out.includes(id)) out.push(id);
  return out;
}
const verDesc = (a, b) => parseFloat(b.match(/[\d.]+/)?.[0] || 0) - parseFloat(a.match(/[\d.]+/)?.[0] || 0);

async function listCandidates(provider, key) {
  if (provider === 'claude') {
    const client = new Anthropic({ apiKey: key, timeout: 6000, maxRetries: 0 });
    const ids = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return rank(ids, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', /^claude-sonnet/, /^claude-opus/]);
  }
  if (provider === 'groq') {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw Object.assign(new Error('models'), { status: r.status });
    const ids = (await r.json()).data.map((m) => m.id);
    const chat = (id) => !/whisper|guard|safeguard|tts|orpheus|playai/i.test(id);
    return rank(ids, ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', /llama.*70b/, /qwen/, /gpt-oss/], chat);
  }
  if (provider === 'gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw Object.assign(new Error('models'), { status: r.status });
    const ids = (await r.json()).models
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
    const plain = (id) => /^gemini/.test(id) && !/image|tts|audio|live|embedding|preview|exp|transcribe|robotics|computer|omni/i.test(id);
    const flashes = ids.filter((id) => plain(id) && /^gemini-[\d.]+-flash$/.test(id)).sort(verDesc);
    return rank(ids, ['gemini-flash-latest', ...flashes, /flash-lite/], plain);
  }
  return [];
}

async function getCandidates(provider, key, refresh = false) {
  if (!refresh && modelCache[provider]) return modelCache[provider];
  const list = await listCandidates(provider, key);
  if (!list.length) throw new AIError('쓸 수 있는 모델 없음');
  modelCache[provider] = list;
  return list;
}

// ---------- 제공자별 호출 ----------
async function callClaude(key, model, { system, messages, maxTokens }) {
  const client = new Anthropic({ apiKey: key, timeout: TIMEOUT.claude, maxRetries: 0 });
  const params = { model, max_tokens: maxTokens, system, messages };
  // 최신 모델은 effort 로 생각 깊이를 정한다 — 챗봇은 빠른 답이 중요해서 low
  if (/opus-5|sonnet-5|haiku-5/.test(model)) params.output_config = { effort: 'low' };
  const res = await client.messages.create(params);
  if (res.stop_reason === 'refusal') throw new AIError('답변 거절(refusal)');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text.trim()) throw new AIError('빈 답변');
  return text;
}

async function callGroq(key, model, { system, messages, maxTokens, json }) {
  const body = {
    model, max_tokens: Math.max(maxTokens, 800), temperature: 0.2,
    messages: [{ role: 'system', content: system }, ...messages],
  };
  // gpt-oss · qwen 같은 「생각하는」 모델은 생각에 토큰을 다 쓰면 빈 답이 온다 → 생각을 짧게
  if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
  if (/qwen/.test(model)) body.reasoning_effort = 'none';
  if (json) body.response_format = { type: 'json_object' };
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT.groq),
  });
  if (!r.ok) throw Object.assign(new Error('groq'), { status: r.status });
  const text = (await r.json()).choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new AIError('빈 답변');
  return text;
}

async function callGemini(key, model, { system, messages, maxTokens, json }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: {
      maxOutputTokens: Math.max(maxTokens, 800), temperature: 0.2,
      ...(json ? { responseMimeType: 'application/json' } : {}),
      // Gemini 3 이후·flash-latest 는 생각하는 모델 — 챗봇은 빠른 답이 중요해서 생각을 짧게
      ...(/gemini-(flash-latest|[3-9])/.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
    },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT.gemini),
  });
  if (!r.ok) throw Object.assign(new Error('gemini'), { status: r.status });
  const text = ((await r.json()).candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text.trim()) throw new AIError('빈 답변');
  return text;
}

const PROVIDERS = [
  { name: 'claude', label: 'Claude', env: 'CLAUDE_API_KEY', call: callClaude },
  { name: 'groq', label: 'Groq', env: 'GROQ_API_KEY', call: callGroq },
  { name: 'gemini', label: 'Gemini', env: 'GEMINI_API_KEY', call: callGemini },
];

/**
 * @param {{system:string, messages:{role:'user'|'assistant',content:string}[], maxTokens?:number, json?:boolean}} req
 * @returns {Promise<{ok:true,text:string,provider:string,model:string,tried:object[]} | {ok:false,tried:object[]}>}
 */
export async function callAI(req) {
  const opts = { maxTokens: 1200, ...req };
  const tried = [];
  for (const p of PROVIDERS) {
    const key = (process.env[p.env] || '').trim();
    if (!key) { tried.push({ provider: p.label, reason: '키 비어 있음' }); continue; }
    let candidates;
    try { candidates = await getCandidates(p.name, key); } catch (e) {
      tried.push({ provider: p.label, reason: '모델 목록 조회 실패 — ' + reasonOf(e) });
      continue;
    }
    // 404(모델 이름 문제)면 다음 후보 모델로, 그 밖의 실패면 다음 AI 로 넘어간다. 후보는 최대 3개까지.
    for (const model of candidates.slice(0, 3)) {
      try {
        const text = await p.call(key, model, opts);
        if (candidates[0] !== model) modelCache[p.name] = [model, ...candidates.filter((m) => m !== model)];
        return { ok: true, text, provider: p.label, model, tried };
      } catch (e) {
        tried.push({ provider: p.label, model, reason: reasonOf(e) });
        if (e?.status !== 404 && e?.status !== 503) break; // 404 모델 이름 · 503 그 모델만 붐빔 → 다음 후보
      }
    }
  }
  return { ok: false, tried };
}
