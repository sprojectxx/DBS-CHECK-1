/**
 * Local development server.
 *
 * Serves `public/` as static files and delegates `/api/*` to the shared Web
 * Fetch handler used by the Vercel Functions in `api/`, so local behaviour
 * matches production. Not used by Vercel (which serves `public/` from its CDN).
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { handleApi } from '../lib/api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 4173);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

function toFetchRequest(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${port}`}`);
  const init = { method: req.method, headers: req.headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req);
    init.duplex = 'half';
  }
  return new Request(url, init);
}

const server = http.createServer(async (req, res) => {
  try {
    if ((req.url || '').startsWith('/api/')) {
      const response = await handleApi(toFetchRequest(req));
      const headers = {};
      response.headers.forEach((value, key) => { headers[key] = value; });
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';

    const target = path.resolve(publicDir, `.${pathname}`);
    if (!target.startsWith(publicDir + path.sep)) return sendJson(res, 403, { message: 'Forbidden.' });

    const fileStat = await stat(target).catch(() => null);
    if (!fileStat || !fileStat.isFile()) return sendJson(res, 404, { message: 'Not found.' });

    const data = await readFile(target);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Cache-Control': pathname.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { message: 'An unexpected server error occurred.' });
    else res.end();
  }
});

server.listen(port, '0.0.0.0', () => console.log(`DBS Express dev server running on http://localhost:${port}`));
