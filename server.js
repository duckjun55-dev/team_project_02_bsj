// 로컬 실행용 서버 — node --env-file=.env server.js
// public/ 화면 파일을 보여 주고, /api/이름 요청은 api/이름.js 를 Vercel 과 같은 방식(req, res)으로 부른다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

// Vercel 의 res.status().json() 을 흉내 낸다
function wrap(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

async function readBody(req) {
  const parts = [];
  for await (const c of req) parts.push(c);
  const raw = Buffer.concat(parts).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return raw; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
      const file = path.join(ROOT, 'api', `${name}.js`);
      if (!name || !fs.existsSync(file)) return wrap(res).status(404).json({ ok: false, error: '없는 API' });
      const mod = await import(pathToFileURL(file).href);
      req.query = Object.fromEntries(url.searchParams);
      req.body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : undefined;
      return await mod.default(req, wrap(res));
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end('금지'); }
    const target = fs.existsSync(file) ? file : (fs.existsSync(file + '.html') ? file + '.html' : null);
    if (!target) { res.statusCode = 404; return res.end('찾을 수 없음'); }
    res.setHeader('Content-Type', TYPES[path.extname(target)] || 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) wrap(res).status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, () => console.log(`홈드랍 데모: http://localhost:${PORT}  (관리자: /admin.html)`));
