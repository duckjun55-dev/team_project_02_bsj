// GET /api/persona — 화면 첫 인사에 쓸 챗봇 이름과 인사말 (docs/페르소나.md)
import { loadPersona } from './_lib/persona.js';

export default function handler(req, res) {
  const p = loadPersona();
  if (!p || !p.greeting) return res.status(200).json({ ok: false, reason: '페르소나 문서 없음' });
  return res.status(200).json({ ok: true, name: p.name, greeting: p.greeting });
}
