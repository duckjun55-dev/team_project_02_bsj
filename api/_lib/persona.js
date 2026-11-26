// docs/페르소나.md 를 읽어 시스템 프롬프트 · 첫 인사 · 「모를 때의 답」으로 쓴다.
// 문서가 없거나 읽지 못하면 null — 그때는 페르소나 없이 「AI 답변 규칙」만으로 답한다.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'docs', '페르소나.md');
let cache; // undefined: 아직 안 읽음 · null: 없음/실패 · object: 읽은 결과

/** 「## 제목」 아래 내용을 제목별로 나눈다 */
function sections(md) {
  const out = {};
  let key = null;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { key = h[1]; out[key] = []; continue; }
    if (key) out[key].push(line);
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n').trim();
  return out;
}

export function loadPersona() {
  if (cache !== undefined) return cache;
  try {
    const s = sections(fs.readFileSync(FILE, 'utf8'));
    if (!s['이름']) { cache = null; return cache; }
    const part = (title) => (s[title] ? `[${title}]\n${s[title]}` : '');
    cache = {
      name: s['이름'],
      greeting: s['첫 인사'] || '',
      unknown: s['모를 때의 답'] || '',
      // 시스템 프롬프트에 넣는 부분 — 첫 인사는 화면이 보여 주므로 넣지 않는다
      prompt: ['이용자', '이름', '말투', '역할', '하는 일', '하지 않는 일', '모를 때의 답'].map(part).filter(Boolean).join('\n\n'),
    };
  } catch {
    cache = null;
  }
  return cache;
}
