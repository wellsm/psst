import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME, normalizeRoomCode } from '@psst/shared';
import { GameRoom } from './GameRoom';

const PORT = Number(process.env.PORT ?? 2567);
const here = fileURLToPath(new URL('.', import.meta.url));
const STATIC_DIR = resolve(here, '../../client/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
};

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/room-exists') {
    cors(res);
    const code = normalizeRoomCode(url.searchParams.get('code') ?? '');
    const rooms = await matchMaker.query({ roomId: code });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ exists: rooms.length > 0 }));
    return;
  }
  // Static client build (production). In development Vite serves the client.
  let file = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Client not built. Run `npm run build`.');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

export async function startServer(port: number): Promise<Server> {
  const httpServer = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define(ROOM_NAME, GameRoom);
  await gameServer.listen(port);
  return gameServer;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer(PORT).then(() => console.log(`[psst] server on http://localhost:${PORT}`));
}
