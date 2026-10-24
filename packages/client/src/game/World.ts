import {
  INPUT_DT,
  buildLayout,
  defaultSettings,
  lerp,
  lerpAngle,
  stepMove,
  type ClientInput,
  type GameEvent,
  type Layout,
  type LobbyState,
  type MatchSettings,
  type MeState,
  type MoveContext,
  type MoveEvents,
  type MoveState,
  type Snapshot,
  type SnapPlayer,
  type SnapProjectile,
} from '@psst/shared';

/** Others are rendered this far behind the estimated server clock. */
const INTERP_DELAY = 0.1;
const SNAP_BUFFER = 40;
const SNAP_ERROR_LIMIT = 2;

const MOVE_KEYS: (keyof MoveState)[] = ['x', 'y', 'vx', 'vy', 'angle', 'stamina', 'exhausted', 'stunLeft', 'dashLeft', 'dashDx', 'dashDy', 'dashCdLeft', 'running', 'speedLeft', 'turboLeft', 'jumpLeft', 'airLeft', 'airSuper', 'perched', 'jumpCdLeft', 'dashAir'];

export class Predictor {
  state: MoveState | null = null;
  pending: ClientInput[] = [];
  seq = 0;
  offX = 0;
  offY = 0;

  reset() {
    this.state = null;
    this.pending = [];
    this.offX = 0;
    this.offY = 0;
  }

  reconcile(me: MeState, ctx: MoveContext) {
    const before = this.state ? { x: this.state.x, y: this.state.y } : null;
    const s = {} as Record<string, unknown>;
    for (const k of MOVE_KEYS) s[k] = me[k];
    this.state = s as unknown as MoveState;
    this.pending = this.pending.filter((i) => i.seq > me.ack);
    for (const inp of this.pending) stepMove(this.state, inp, INPUT_DT, ctx);
    if (before) {
      const ex = before.x - this.state.x, ey = before.y - this.state.y;
      if (Math.hypot(ex + this.offX, ey + this.offY) < SNAP_ERROR_LIMIT) {
        this.offX += ex;
        this.offY += ey;
      } else {
        this.offX = 0;
        this.offY = 0;
      }
    }
  }

  step(input: ClientInput, ctx: MoveContext): MoveEvents | null {
    if (!this.state) return null;
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    return stepMove(this.state, input, INPUT_DT, ctx);
  }

  decay(dt: number) {
    const k = Math.exp(-dt * 12);
    this.offX *= k;
    this.offY *= k;
  }

  get renderX() {
    return (this.state?.x ?? 0) + this.offX;
  }

  get renderY() {
    return (this.state?.y ?? 0) + this.offY;
  }
}

interface BufferedSnap {
  t: number;
  players: Map<string, SnapPlayer>;
  proj: Map<number, SnapProjectile>;
}

export interface WorldListener {
  onEvents?(events: GameEvent[]): void;
  onLobby?(lobby: LobbyState): void;
  onSnap?(snap: Snapshot): void;
}

export class World {
  myId = '';
  code = '';
  lobby: LobbyState | null = null;
  latest: Snapshot | null = null;
  layout: Layout | null = null;
  predictor = new Predictor();
  /** Local clock (s) of the last snapshot, for sub-snapshot timers. */
  latestAt = 0;
  private buffer: BufferedSnap[] = [];
  private offset = 0;
  private hasOffset = false;
  private listeners = new Set<WorldListener>();
  private layoutKey = '';

  get settings(): MatchSettings {
    return this.lobby?.settings ?? defaultSettings();
  }

  get me(): MeState | null {
    return this.latest?.me ?? null;
  }

  get isHost() {
    return !!this.lobby && this.lobby.hostId === this.myId;
  }

  listen(l: WorldListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  reset() {
    this.myId = '';
    this.code = '';
    this.lobby = null;
    this.latest = null;
    this.layout = null;
    this.layoutKey = '';
    this.buffer = [];
    this.hasOffset = false;
    this.predictor.reset();
  }

  setLobby(l: LobbyState) {
    const wasLobby = this.lobby?.phase;
    this.lobby = l;
    if (l.phase === 'lobby') {
      this.latest = null;
      this.buffer = [];
      this.predictor.reset();
    }
    if (wasLobby !== l.phase || !this.layout) this.ensureLayout(l.mapId, 0);
    for (const x of this.listeners) x.onLobby?.(l);
  }

  private ensureLayout(mapId: string, seed: number) {
    const key = `${mapId}:${seed}:${this.settings.bottleRefillStations}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.layout = buildLayout(mapId, seed, this.settings.bottleRefillStations);
  }

  moveContext(): MoveContext | null {
    const me = this.me;
    if (!me || !this.layout || !this.latest) return null;
    const phase = this.latest.phase;
    return {
      role: me.role,
      life: me.life,
      settings: this.settings,
      layout: this.layout,
      canMove: phase === 'hunt' || (phase === 'countdown' && me.role === 'hider'),
    };
  }

  setSnap(snap: Snapshot, now: number) {
    if (snap.phase === 'lobby') return;
    this.ensureLayout(snap.mapId, snap.seed);
    const sample = snap.t - now;
    if (!this.hasOffset || Math.abs(sample - this.offset) > 1) {
      this.offset = sample;
      this.hasOffset = true;
    } else {
      this.offset += (sample - this.offset) * (sample > this.offset ? 0.5 : 0.05);
    }
    if (this.latest && snap.t < this.latest.t) return;
    this.latest = snap;
    this.latestAt = now;
    this.buffer.push({
      t: snap.t,
      players: new Map(snap.players.map((p) => [p.id, p])),
      proj: new Map(snap.proj.map((p) => [p.id, p])),
    });
    if (this.buffer.length > SNAP_BUFFER) this.buffer.shift();
    const ctx = this.moveContext();
    if (snap.me && ctx) this.predictor.reconcile(snap.me, ctx);
    for (const x of this.listeners) x.onSnap?.(snap);
  }

  pushEvents(events: GameEvent[]) {
    for (const x of this.listeners) x.onEvents?.(events);
  }

  /** Interpolated view of other entities at render time. */
  sample(now: number): { players: Map<string, SnapPlayer>; proj: SnapProjectile[] } {
    const players = new Map<string, SnapPlayer>();
    const proj: SnapProjectile[] = [];
    const n = this.buffer.length;
    if (!n) return { players, proj };
    const rt = now + this.offset - INTERP_DELAY;
    let b = this.buffer[n - 1];
    let a = b;
    for (let i = n - 1; i > 0; i--) {
      if (this.buffer[i - 1].t <= rt) {
        a = this.buffer[i - 1];
        b = this.buffer[i];
        break;
      }
      a = this.buffer[i - 1];
      b = this.buffer[i];
    }
    const span = b.t - a.t;
    const k = span > 1e-6 ? Math.max(0, Math.min(1, (rt - a.t) / span)) : 1;
    // Entities present in the newest snapshot are authoritative for existence.
    const newest = this.buffer[n - 1];
    for (const [id, pb] of newest.players) {
      const p0 = a.players.get(id), p1 = b.players.get(id);
      if (p0 && p1) players.set(id, { ...p1, x: lerp(p0.x, p1.x, k), y: lerp(p0.y, p1.y, k), a: lerpAngle(p0.a, p1.a, k), z: lerp(p0.z ?? 0, p1.z ?? 0, k) });
      else players.set(id, p1 ?? pb);
    }
    for (const [id, pb] of newest.proj) {
      const p0 = a.proj.get(id), p1 = b.proj.get(id);
      if (p0 && p1) proj.push({ ...p1, x: lerp(p0.x, p1.x, k), y: lerp(p0.y, p1.y, k) });
      else proj.push(p1 ?? pb);
    }
    return { players, proj };
  }

  /** Estimated seconds elapsed on the server since the latest snapshot. */
  sinceLatest(now: number) {
    return Math.max(0, now - this.latestAt);
  }
}
