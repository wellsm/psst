// Voice tokens are only issued over the room connection, for the caller's own session.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import type { Server } from 'colyseus';
import type { VoiceToken } from '@psst/shared';

const PORT = 28_000 + Math.floor(Math.random() * 1000);
let server: Server;

beforeAll(async () => {
  // voice.ts reads the LiveKit config at import time.
  process.env.LIVEKIT_URL = 'wss://voice.test';
  process.env.LIVEKIT_API_KEY = 'testkey';
  process.env.LIVEKIT_API_SECRET = 'testsecret-testsecret-testsecret-1234';
  const { startServer } = await import('../src/index');
  server = await startServer(PORT);
});

afterAll(async () => {
  await server?.gracefullyShutdown(false);
});

function claims(jwt: string): { sub: string; name: string; video: Record<string, unknown> } {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
}

function ask(room: Room): Promise<VoiceToken | null> {
  return new Promise((resolve) => {
    room.onMessage('voiceToken', (t: VoiceToken | null) => resolve(t));
    room.send('voiceToken', {});
  });
}

describe('voice tokens', () => {
  it('a member gets a token bound to its own session id and room, audio only', async () => {
    const c = new Client(`ws://localhost:${PORT}`);
    const a = await c.create('game', { name: 'Alice' });
    const tok = await ask(a);
    expect(tok?.url).toBe('wss://voice.test');
    const cl = claims(tok!.token);
    expect(cl.sub).toBe(a.sessionId);
    expect(cl.name).toBe('Alice');
    expect(cl.video.room).toBe(`psst-${a.roomId}`);
    expect(cl.video.canPublishData).toBe(false);
    await a.leave();
  });

  it('the old HTTP endpoint no longer mints tokens for outsiders', async () => {
    const c = new Client(`ws://localhost:${PORT}`);
    const a = await c.create('game', { name: 'Alice' });
    const res = await fetch(`http://localhost:${PORT}/api/voice-token?room=${a.roomId}&identity=${a.sessionId}&name=Mallory`);
    const body = await res.text();
    expect(body).not.toContain('"token"');
    await a.leave();
  });
});
