#!/usr/bin/env node
// Zero-dependency static file server for the production build.
// Usage: node scripts/serve.mjs dist 4173

import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), process.argv[2] || 'dist');
const PORT = Number.parseInt(process.argv[3] || '4173', 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function isFile(filePath) {
  return fs.stat(filePath).then((stat) => stat.isFile(), () => false);
}

// Hash routes live in the fragment and never reach the server, but deep links
// without a file extension still need to be served the SPA shell.
async function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] || '/');
  } catch {
    return null;
  }

  const requested = path.resolve(ROOT, `.${decoded}`);
  if (requested !== ROOT && !requested.startsWith(ROOT + path.sep)) {
    return null;
  }

  if (await isFile(requested)) return requested;

  const hasExtension = path.extname(decoded) !== '';
  if (!hasExtension) {
    const index = path.join(ROOT, 'index.html');
    if (await isFile(index)) return index;
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const filePath = await resolveFile(url.pathname);

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  };

  // The service worker must never be served stale while developing.
  if (path.basename(filePath).startsWith('sw')) {
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    headers['Service-Worker-Allowed'] = '/';
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Serving ${ROOT} at http://127.0.0.1:${PORT}`);
});
