import html from './index.html';
import css from './style.css';
import app from './app.mjs.txt';
import core from './core.mjs.txt';

const files = new Map([
  ['/', [html, 'text/html; charset=utf-8']],
  ['/index.html', [html, 'text/html; charset=utf-8']],
  ['/style.css', [css, 'text/css; charset=utf-8']],
  ['/app.mjs', [app, 'text/javascript; charset=utf-8']],
  ['/core.mjs', [core, 'text/javascript; charset=utf-8']],
]);

export default {
  fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const asset = files.get(new URL(request.url).pathname);
    if (!asset) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset[0], { headers: {
      'Content-Type': asset[1],
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    } });
  },
};
