// End-to-end over real WebSockets: server in-process, several colyseus.js clients.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import type { Server } from 'colyseus';
import type { GameEvent, LobbyState, Snapshot } from '@psst/shared';
import { startServer } from '../src/index';

const PORT = 27_000 + Math.floor(Math.random() * 1000);
let server: Server;

interface Conn {
  room: Room;
  id: string;
  lobby: LobbyState | null;
  snaps: Snapshot[];
  events: GameEvent[];
}

function wire(room: Room): Conn {
  const c: Conn = { room, id: room.sessionId, lobby: null, snaps: [], events: [] };
  room.onMessage('welcome', () => undefined);
  room.onMessage('lobby', (l: LobbyState) => { c.lobby = l; });
  room.onMessage('snap', (s: Snapshot) => { c.snaps.push(s); if (c.snaps.length > 900) c.snaps.shift(); });
  room.onMessage('ev', (e: GameEvent[]) => c.events.push(...e));
  return c;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await wait(20);
  }
}

beforeAll(async () => {
  server = await startServer(PORT);
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

describe('end-to-end', () => {
  it('rooms by code, lobby replication, full match with bots, anti-cheat on the wire', async () => {
    const url = `ws://localhost:${PORT}`;
    const host = wire(await new Client(url).create('game', { name: 'Host' }));
    await until(() => !!host.lobby);
    const code = host.lobby!.code;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(host.room.roomId).toBe(code);

    const guest = wire(await new Client(url).joinById(code, { name: 'Guest' }));
    await until(() => host.lobby!.players.length === 2 && !!guest.lobby);

    // Unknown code fails cleanly.
    await expect(new Client(url).joinById('ZZZZZZ', { name: 'X' })).rejects.toBeTruthy();

    // Host-only: guest cannot change rules; host can, and it replicates.
    guest.room.send('setSettings', { patch: { huntDuration: 30 } });
    await wait(150);
    expect(host.lobby!.settings.huntDuration).toBe(150);
    host.room.send('setSettings', { patch: { huntDuration: 30, countdownDuration: 5, matchEndDuration: 5 } });
    host.room.send('setMap', { mapId: 'arena' });
    host.room.send('addBot', {});
    host.room.send('addBot', {});
    guest.room.send('optIn', { value: false });
    await until(() => guest.lobby!.settings.huntDuration === 30 && guest.lobby!.mapId === 'arena' && guest.lobby!.players.length === 4);

    // Start requires the guest ready.
    host.room.send('start', {});
    await wait(150);
    expect(host.lobby!.phase).toBe('lobby');
    guest.room.send('ready', { ready: true });
    await wait(100);
    host.room.send('start', {});
    await until(() => host.lobby!.phase === 'countdown');
    await until(() => host.snaps.some((s) => s.phase === 'countdown') && guest.snaps.some((s) => s.phase === 'countdown'));

    const hostSnap = host.snaps[host.snaps.length - 1];
    expect(hostSnap.me?.role).toBe('seeker');
    const guestSnap = guest.snaps[guest.snaps.length - 1];
    expect(guestSnap.me?.role).toBe('hider');

    // Guest walks around sending inputs for a while.
    let seq = 0;
    const walker = setInterval(() => {
      seq++;
      guest.room.send('input', [{ seq, mx: Math.sin(seq / 20), my: Math.cos(seq / 25), run: false, ax: 0, ay: 0, dash: false, hold: false }]);
      host.room.send('input', [{ seq, mx: 0, my: 0, run: false, ax: 0, ay: 0, dash: false, hold: false }]);
    }, 33);
    await until(() => host.lobby!.phase === 'hunt', 8000);
    await wait(1500);
    clearInterval(walker);

    // Server-authoritative movement + acks reached the client.
    const last = guest.snaps[guest.snaps.length - 1];
    expect(last.me!.ack).toBeGreaterThan(20);

    // Anti-cheat: the seeker never got a hider snapshot entry without reveal/stun.
    for (const s of host.snaps) {
      for (const p of s.players) {
        if (p.role !== 'hider' || p.life !== 'alive' || s.phase === 'end') continue;
        const stunned = (p.anim & 8) !== 0;
        expect(s.phase === 'countdown' ? false : p.rev > 0 || stunned).toBe(true);
      }
    }
    // Seeker footstep events of hidden hiders never carry a position: a positional step from someone else always
    // matches a snapshot entry of that player at that spot (snapshots only carry bodies the seeker can see).
    const seen = host.snaps.flatMap((s) => s.players);
    for (const e of host.events) {
      if (e.e !== 'snd' || e.t !== 'footstep' || !e.id || e.id === host.id) continue;
      expect(seen.some((p) => p.id === e.id && Math.hypot(p.x - e.x, p.y - e.y) < 1)).toBe(true);
    }

    // Let the match end by time and return to the lobby.
    await until(() => host.lobby!.phase === 'end', 40_000);
    expect(host.snaps[host.snaps.length - 1].result?.winner).toBe('hiders');
    await until(() => host.lobby!.phase === 'lobby', 10_000);
    expect(host.lobby!.players.filter((p) => p.isBot)).toHaveLength(0);
    expect(host.lobby!.players.find((p) => p.id === guest.id)?.ready).toBe(false);

    // Host leaves: guest becomes host.
    await host.room.leave();
    await until(() => guest.lobby!.hostId === guest.id);
    await guest.room.leave();
  }, 70_000);

  it('a dropped connection (page reload) gets its seat back with the reconnection token', async () => {
    const url = `ws://localhost:${PORT}`;
    const host = wire(await new Client(url).create('game', { name: 'Host' }));
    await until(() => !!host.lobby);
    const token = host.room.reconnectionToken;

    await host.room.leave(false);
    await wait(100);
    const back = wire(await new Client(url).reconnect(token));
    expect(back.id).toBe(host.id);
    await until(() => !!back.lobby);
    expect(back.lobby!.hostId).toBe(host.id);
    expect(back.lobby!.players).toHaveLength(1);
    await back.room.leave();
  });
});
