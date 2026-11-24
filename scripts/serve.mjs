#!/usr/bin/env node
// Zero-dependency static file server for the production build.
// Usage: node scripts/serve.mjs dist 4173

import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';
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

function shouldCompress(contentType) {
  return /^(text\/|application\/(javascript|json)|image\/svg\+xml)/.test(contentType);
}

function cacheControlFor(relativePath) {
  const name = path.basename(relativePath);
  // Hashed build assets are immutable; the SW and the app shell must stay fresh.
  if (name.startsWith('sw')) return 'no-cache, no-store, must-revalidate';
  if (relativePath.startsWith('assets/') || /^workbox-[\w-]+\.js$/.test(name)) {
    return 'public, max-age=31536000, immutable';
  }
  if (/\.(html|json)$/.test(name)) return 'no-cache';
  return 'public, max-age=3600';
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
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheControlFor(path.relative(ROOT, filePath).split(path.sep).join('/')),
    Vary: 'Accept-Encoding',
  };

  // The service worker must never be served stale while developing.
  if (path.basename(filePath).startsWith('sw')) {
    headers['Service-Worker-Allowed'] = '/';
  }

  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  let body = await fs.readFile(filePath);
  if (acceptsGzip && shouldCompress(contentType)) {
    body = gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Serving ${ROOT} at http://127.0.0.1:${PORT}`);
});
