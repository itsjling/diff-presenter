#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientRoot = resolve(root, 'dist');
const rawArgs = process.argv.slice(2);

function option(name, fallback) {
  const index = rawArgs.indexOf(name);
  if (index === -1) return fallback;
  const value = rawArgs[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

const output = resolve(option('--output', resolve(root, '.cache/diff-data.json')));
const portValue = option('--port', '2299');
if (!/^\d+$/.test(portValue) || Number(portValue) > 65_535) {
  throw new Error('--port must be a number from 0 to 65535');
}
const incrementPort =
  rawArgs.includes('--increment-port') || !rawArgs.includes('--port');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function notFound() {
  return new Response('Not found', { status: 404 });
}

async function fileResponse(file, { live = false } = {}) {
  try {
    const info = await stat(file);
    if (!info.isFile()) return notFound();
    return new Response(await readFile(file), {
      headers: {
        'content-type':
          contentTypes[extname(file).toLowerCase()] ||
          'application/octet-stream',
        'cache-control': live
          ? 'no-store'
          : 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return notFound();
  }
}

async function fetchAsset(request) {
  const url = new URL(request.url);
  if (url.pathname === '/diff-data.json') {
    return fileResponse(output, { live: true });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return notFound();
  }
  const file = resolve(
    clientRoot,
    pathname === '/' ? 'index.html' : `.${pathname}`,
  );
  if (file !== clientRoot && !file.startsWith(`${clientRoot}${sep}`)) {
    return notFound();
  }
  return fileResponse(file);
}

function nodeRequest(request) {
  const host = request.headers.host || '127.0.0.1';
  const init = {
    method: request.method,
    headers: request.headers,
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = Readable.toWeb(request);
    init.duplex = 'half';
  }
  return new Request(`http://${host}${request.url}`, init);
}

async function send(nodeResponse, response) {
  nodeResponse.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) {
    nodeResponse.end();
    return;
  }
  Readable.fromWeb(response.body).pipe(nodeResponse);
}

const server = createServer(async (request, response) => {
  try {
    const webRequest = nodeRequest(request);
    await send(response, await fetchAsset(webRequest));
  } catch (error) {
    console.error(error);
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Diffsplain could not load this page.');
  }
});

let selectedPort = Number(portValue);

function listen() {
  server.listen(selectedPort, '127.0.0.1', () => {
    const address = server.address();
    const readyPort =
      address && typeof address === 'object' ? address.port : selectedPort;
    console.log(`Diffsplain: http://127.0.0.1:${readyPort}`);
  });
}

server.on('error', (error) => {
  if (
    error.code === 'EADDRINUSE' &&
    incrementPort &&
    selectedPort > 0 &&
    selectedPort < 65_535
  ) {
    selectedPort += 1;
    listen();
    return;
  }
  console.error(`Could not start Diffsplain: ${error.message}`);
  process.exitCode = 1;
});

listen();

let closing = false;
function close() {
  if (closing) return;
  closing = true;
  server.close(() => {
    process.exitCode = 0;
  });
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
