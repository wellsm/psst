import { Client, type Room } from 'colyseus.js';
import {
  ROOM_NAME,
  type ClientMessages,
  type GameEvent,
  type LobbyState,
  type Snapshot,
  type VoiceToken,
} from '@psst/shared';

export type JoinError = 'noRoom' | 'full' | 'connect';

export function serverUrl(): string {
  // Dev-only override: in production a crafted link could otherwise send players (and their mic) to another server.
  const override = import.meta.env.DEV ? new URLSearchParams(location.search).get('server') : null;
  if (override) return override;
  // Packaged builds (desktop app) are not served by the game server: the URL is fixed at build time.
  const fixed = import.meta.env.VITE_SERVER_URL;
  if (fixed) return fixed;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In development Vite serves the client on another port; the game server listens on 2567.
  if (import.meta.env.DEV) return `${proto}//${location.hostname}:2567`;
  return `${proto}//${location.host}`;
}

export interface NetHandlers {
  onWelcome(id: string, code: string): void;
  onLobby(state: LobbyState): void;
  onSnap(snap: Snapshot): void;
  onEvents(events: GameEvent[]): void;
  onLeave(): void;
}

export class Net {
  private client = new Client(serverUrl());
  private room: Room | null = null;
  private intentionalLeave = false;

  get connected() {
    return !!this.room;
  }

  async create(name: string, h: NetHandlers): Promise<JoinError | null> {
    try {
      this.attach(await this.client.create(ROOM_NAME, { name }), h);
      return null;
    } catch (e) {
      return mapError(e);
    }
  }

  async join(code: string, name: string, h: NetHandlers): Promise<JoinError | null> {
    try {
      this.attach(await this.client.joinById(code, { name }), h);
      return null;
    } catch (e) {
      return mapError(e);
    }
  }

  private attach(room: Room, h: NetHandlers) {
    this.room = room;
    this.intentionalLeave = false;
    room.onMessage('welcome', (m: { id: string; code: string }) => h.onWelcome(m.id, m.code));
    room.onMessage('lobby', (m: LobbyState) => h.onLobby(m));
    room.onMessage('snap', (m: Snapshot) => h.onSnap(m));
    room.onMessage('ev', (m: GameEvent[]) => h.onEvents(m));
    room.onLeave(() => {
      this.room = null;
      if (!this.intentionalLeave) h.onLeave();
    });
  }

  /** LiveKit token for this connection (null: voice not configured, not connected or no answer in time). */
  voiceToken(timeoutMs = 8000): Promise<VoiceToken | null> {
    const room = this.room;
    if (!room) return Promise.resolve(null);
    return new Promise((resolve) => {
      const done = (tok: VoiceToken | null) => { clearTimeout(timer); off(); resolve(tok); };
      const off = room.onMessage('voiceToken', (tok: VoiceToken | null) => done(tok));
      const timer = setTimeout(() => done(null), timeoutMs);
      room.send('voiceToken', {});
    });
  }

  send<K extends keyof ClientMessages>(type: K, msg: ClientMessages[K]) {
    this.room?.send(type, msg);
  }

  leave() {
    this.intentionalLeave = true;
    this.room?.leave();
    this.room = null;
  }
}

function mapError(e: unknown): JoinError {
  const msg = String((e as { message?: string })?.message ?? e).toLowerCase();
  const code = (e as { code?: number })?.code;
  if (msg.includes('full') || msg.includes('locked')) return 'full';
  if (code === 4212 || msg.includes('not found') || msg.includes('invalid')) return 'noRoom';
  return 'connect';
}
