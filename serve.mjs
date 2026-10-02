import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const publicFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/style.css', 'style.css'],
  ['/app.mjs', 'app.mjs'],
  ['/core.mjs', 'core.mjs'],
]);
http.createServer(async (req, res) => {
  try {
    const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const publicFile = publicFiles.get(requestPath);
    if (!publicFile || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404).end('Not found'); return;
    }
    const target = path.join(root, publicFile);
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': types[path.extname(target)],
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    }).end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(4178, '127.0.0.1', () => console.log('Runproof at http://127.0.0.1:4178'));
