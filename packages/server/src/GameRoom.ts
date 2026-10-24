import { Room, type Client } from 'colyseus';
import {
  COUGH_VARIANTS,
  MAX_PLAYERS,
  TICK_RATE,
  generateRoomCode,
} from '@psst/shared';
import { Match } from './sim/Match';
import { createVoiceToken, voiceConfigured } from './voice';

const usedCodes = new Set<string>();

function uniqueCode(): string {
  for (;;) {
    const c = generateRoomCode();
    if (!usedCodes.has(c)) return c;
  }
}

export class GameRoom extends Room {
  override maxClients = MAX_PLAYERS;
  private match!: Match;

  override onCreate() {
    const code = uniqueCode();
    usedCodes.add(code);
    this.roomId = code;
    this.match = new Match({ code });
    this.match.voiceAvailable = voiceConfigured();
    this.autoDispose = true;

    const m = this.match;
    this.onMessage('input', (c, msg) => m.pushInputs(c.sessionId, msg));
    this.onMessage('fire', (c, msg) => m.fire(c.sessionId, Number(msg?.ax), Number(msg?.ay)));
    this.onMessage('dashClaim', (c, msg) => m.dashClaim(c.sessionId, String(msg?.targetId ?? '')));
    this.onMessage('taunt', (c) => m.taunt(c.sessionId));
    this.onMessage('refill', (c) => m.refill(c.sessionId));
    this.onMessage('usePower', (c) => m.usePower(c.sessionId));
    this.onMessage('voice', (c, msg) => m.setSpeaking(c.sessionId, msg?.speaking === true));
    this.onMessage('ready', (c, msg) => m.setReady(c.sessionId, msg?.ready === true));
    this.onMessage('optIn', (c, msg) => m.setOptIn(c.sessionId, msg?.value === true));
    this.onMessage('prefs', (c, msg) => m.setPrefs(c.sessionId, msg ?? {}, { cough: COUGH_VARIANTS }));
    this.onMessage('setSettings', (c, msg) => m.setSettings(c.sessionId, msg?.patch ?? {}));
    this.onMessage('setMap', (c, msg) => m.setMap(c.sessionId, String(msg?.mapId ?? '')));
    this.onMessage('addBot', (c) => m.addBot(c.sessionId));
    this.onMessage('removeBot', (c) => m.removeBot(c.sessionId));
    this.onMessage('start', (c) => m.start(c.sessionId));
    // Voice tokens only go to connected players, for their own session id (no impersonation, no outsiders).
    this.onMessage('voiceToken', (c) => {
      const p = m.players.get(c.sessionId);
      if (!p) return;
      void createVoiceToken(this.roomId, c.sessionId, p.name).then((tok) => c.send('voiceToken', tok), () => c.send('voiceToken', null));
    });
    this.onMessage('*', () => undefined);

    this.setSimulationInterval((ms) => this.tick(ms / 1000), 1000 / TICK_RATE);
  }

  override onAuth(): boolean {
    // Bots occupy seats too: the room holds 12 players in total.
    if (this.match.totalPlayers >= MAX_PLAYERS) throw new Error('room_full');
    return true;
  }

  override onJoin(client: Client, options: { name?: string }) {
    this.match.addPlayer(client.sessionId, String(options?.name ?? ''));
    client.send('welcome', { id: client.sessionId, code: this.roomId });
  }

  override onLeave(client: Client) {
    this.match.removePlayer(client.sessionId);
  }

  override onDispose() {
    usedCodes.delete(this.roomId);
  }

  private tick(dt: number) {
    const m = this.match;
    // Guard against long event-loop stalls.
    m.step(Math.min(dt, 0.1));
    for (const client of this.clients) {
      const snap = m.buildSnapshot(client.sessionId);
      if (snap) client.send('snap', snap);
      const events = m.buildEvents(client.sessionId);
      if (events.length) client.send('ev', events);
    }
    m.flushEvents();
    if (m.lobbyDirty) {
      m.lobbyDirty = false;
      this.broadcast('lobby', m.lobbyState());
    }
  }
}
