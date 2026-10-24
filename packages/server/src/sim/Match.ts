import {
  Anim,
  INPUT_DT,
  JUMP,
  MAP_EVENT_KINDS,
  MAX_BOTS,
  MOVE_POWERS,
  POWERS_BY_ROLE,
  MAX_PLAYERS,
  PLAYER_COLORS,
  Rng,
  SOUND_DEFS,
  applySettings,
  audioGain,
  forwardYaw,
  listenerPan,
  buildLayout,
  defaultSettings,
  dist,
  findPath,
  isAirborne,
  isNoisySurface,
  isSolid,
  isVisibleTo,
  jumpHeight,
  layoutTraps,
  newMoveState,
  powerDuration,
  proximityMultiplier,
  raycast,
  sanitizeName,
  seekerCountFor,
  segmentCircle,
  spawnCluster,
  stepMove,
  surfaceAt,
  getMapDef,
  type ClientInput,
  type GameEvent,
  type Layout,
  type LifeState,
  type LobbyState,
  type MapEventKind,
  type MapId,
  type MatchResult,
  type MatchSettings,
  type MeState,
  type MoveState,
  type Phase,
  type PlayerTarget,
  type PowerKind,
  type ProjectileKind,
  type Role,
  type Snapshot,
  type SnapEvent,
  type SnapTrap,
  type SoundType,
  type Surface,
  type TrapKind,
  type Vec2,
  type Viewer,
} from '@psst/shared';

/** Max seconds a client may run ahead of the server clock (anti speed-hack). */
const MAX_AHEAD = 0.1;
/** After this much time without input, the server idles the player. */
const MAX_LAG = 0.25;
const MAX_QUEUE = 30;
const HISTORY_SECONDS = 0.5;
const CLAIM_WINDOW = 0.35;
const CLAIM_VISIBLE_GRACE = 0.5;
const THROW_ANIM = 0.3;
const TAUNT_ANIM = 0.6;

export interface PlayerSim {
  id: string;
  name: string;
  isBot: boolean;
  color: number;
  joinOrder: number;
  ready: boolean;
  optIn: boolean;
  coughVariant: number;
  role: Role;
  life: LifeState;
  move: MoveState;
  queue: ClientInput[];
  lastInput: ClientInput;
  budget: number;
  ack: number;
  hold: boolean;
  bottles: number;
  ballCd: number;
  refillCd: number;
  tauntCd: number;
  ghostCd: number;
  boldCd: number;
  revealCd: Map<string, number>;
  reveal: number;
  lastVisibleAt: number;
  stepAccum: number;
  campX: number;
  campY: number;
  campTime: number;
  score: number;
  caughtLeft: number;
  speaking: boolean;
  voiceCd: number;
  throwAnim: number;
  tauntAnim: number;
  lastDashEndAt: number;
  /** Recent positions for lag-tolerant dash claims; `air` = high enough to dodge a dash. */
  history: { t: number; x: number; y: number; air: boolean }[];
  /** Power-up in the slot, points toward the next one, server-only active power timers. */
  power: PowerKind | null;
  powerProgress: number;
  effects: Map<PowerKind, number>;
  bot: { path: Vec2[]; retargetIn: number; running: boolean; stuckT: number; lastX: number; lastY: number; target: Vec2 | null } | null;
}

interface ProjectileSim {
  id: number;
  kind: ProjectileKind;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  travelLeft: number;
}

export interface TrapSim {
  id: number;
  k: TrapKind;
  x: number;
  y: number;
  armed: boolean;
  rearmIn: number;
  ringsLeft: number;
  ringIn: number;
  /** Spawned by the "triple traps" event, removed when it ends. */
  extra: boolean;
}

interface EventSim {
  k: MapEventKind;
  left: number;
  duration: number;
  carrier?: string;
  immunity: number;
  quackIn: number;
  waveDone: boolean;
}

interface Emission {
  type: SoundType;
  x: number;
  y: number;
  intensity: number;
  emitterId: string | null;
  variant?: number;
  surface?: Surface;
  privateTo?: string;
}

const idleInput = (prev: ClientInput): ClientInput => ({ ...prev, mx: 0, my: 0, run: false, dash: false, jump: false, hold: false });

export interface MatchOptions {
  code?: string;
  /** Random source for seeds/room-level randomness (inject for deterministic tests). */
  random?: () => number;
}

export class Match {
  readonly code: string;
  settings: MatchSettings = defaultSettings();
  mapId: MapId = 'kitchen';
  phase: Phase = 'lobby';
  phaseLeft = 0;
  beaconLeft = 0;
  time = 0;
  seed = 0;
  layout: Layout;
  hostId = '';
  voiceAvailable = false;
  result: MatchResult | null = null;
  players = new Map<string, PlayerSim>();
  projectiles: ProjectileSim[] = [];
  bodies: { id: string; x: number; y: number; a: number; color: number }[] = [];
  traps: TrapSim[] = [];
  event: EventSim | null = null;
  /** Set whenever lobby-visible state changes; the transport clears it after broadcasting. */
  lobbyDirty = true;
  private emissions: Emission[] = [];
  private globalEvents: GameEvent[] = [];
  private projectileSeq = 1;
  private joinSeq = 0;
  private botSeq = 0;
  private rng: Rng;
  private random: () => number;
  private startedWithSeekers = false;
  private walkable: Vec2[] = [];
  private trapSeq = 1;
  private eventQueue: MapEventKind[] = [];
  private nextEventAt = 0;

  constructor(opts: MatchOptions = {}) {
    this.code = opts.code ?? 'TEST00';
    this.random = opts.random ?? Math.random;
    this.rng = new Rng(Math.floor(this.random() * 2 ** 32));
    this.layout = buildLayout(this.mapId, 0, this.settings.bottleRefillStations);
  }

  // ------------------------------------------------------------------ roster

  get totalPlayers() {
    return this.players.size;
  }

  get humans(): PlayerSim[] {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  addPlayer(id: string, rawName: string, isBot = false): PlayerSim | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map((p) => p.color));
    let color = 0;
    while (used.has(color) && color < PLAYER_COLORS.length - 1) color++;
    const name = sanitizeName(rawName) || `Player ${this.joinSeq + 1}`;
    const s = this.settings;
    const p: PlayerSim = {
      id, name, isBot, color, joinOrder: this.joinSeq++, ready: false, optIn: true,
      coughVariant: 0,
      role: 'hider', life: 'alive', move: newMoveState(0, 0, s),
      queue: [], lastInput: { seq: 0, mx: 0, my: 0, run: false, ax: 0, ay: 0, dash: false, jump: false, hold: false },
      budget: 0, ack: 0, hold: false,
      bottles: 0, ballCd: 0, refillCd: 0, tauntCd: 0, ghostCd: 0, boldCd: 0, revealCd: new Map(),
      reveal: 0, lastVisibleAt: -99, stepAccum: 0,
      campX: 0, campY: 0, campTime: 0, score: 0, caughtLeft: 0, speaking: false, voiceCd: 0,
      throwAnim: 0, tauntAnim: 0, lastDashEndAt: -99, history: [],
      power: null, powerProgress: 0, effects: new Map(), bot: null,
    };
    this.players.set(id, p);
    if (!isBot && !this.hostId) this.hostId = id;
    if (this.phase === 'countdown' || this.phase === 'hunt' || this.phase === 'end') {
      // Late joiners enter as living hiders with full bottles.
      const pos = spawnCluster(this.layout, this.layout.map.hiderSpawn, 1, this.rng)[0];
      this.spawnAs(p, 'hider', pos);
    }
    this.lobbyDirty = true;
    return p;
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (this.hostId === id) {
      const next = this.humans.sort((a, b) => a.joinOrder - b.joinOrder)[0];
      this.hostId = next?.id ?? '';
    }
    this.lobbyDirty = true;
    if (this.phase === 'countdown' || this.phase === 'hunt') this.checkWin();
  }

  addBot(byId: string): boolean {
    if (byId !== this.hostId || this.phase !== 'lobby') return false;
    const bots = [...this.players.values()].filter((p) => p.isBot).length;
    if (bots >= MAX_BOTS) return false;
    this.botSeq++;
    return this.addPlayer(`bot-${this.botSeq}`, `Bot ${this.botSeq}`, true) !== null;
  }

  removeBot(byId: string): boolean {
    if (byId !== this.hostId || this.phase !== 'lobby') return false;
    const bots = [...this.players.values()].filter((p) => p.isBot).sort((a, b) => b.joinOrder - a.joinOrder);
    if (!bots.length) return false;
    this.removePlayer(bots[0].id);
    return true;
  }

  setReady(id: string, ready: boolean) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'lobby') return;
    p.ready = !!ready;
    this.lobbyDirty = true;
  }

  setOptIn(id: string, value: boolean) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'lobby') return;
    p.optIn = !!value;
    this.lobbyDirty = true;
  }

  setPrefs(id: string, prefs: { name?: unknown; coughVariant?: unknown }, variants: { cough: number }) {
    const p = this.players.get(id);
    if (!p) return;
    if (prefs.name !== undefined) {
      const n = sanitizeName(prefs.name);
      if (n) p.name = n;
    }
    const cv = Number(prefs.coughVariant);
    if (Number.isInteger(cv) && cv >= 0 && cv < variants.cough) p.coughVariant = cv;
    this.lobbyDirty = true;
  }

  setSettings(byId: string, patch: Record<string, unknown>): boolean {
    if (byId !== this.hostId || this.phase !== 'lobby' || !patch || typeof patch !== 'object') return false;
    this.settings = applySettings(this.settings, patch);
    this.lobbyDirty = true;
    return true;
  }

  setMap(byId: string, mapId: string): boolean {
    if (byId !== this.hostId || this.phase !== 'lobby') return false;
    this.mapId = getMapDef(mapId).id;
    this.layout = buildLayout(this.mapId, 0, this.settings.bottleRefillStations);
    this.lobbyDirty = true;
    return true;
  }

  canStart(): boolean {
    if (this.phase !== 'lobby') return false;
    if (this.totalPlayers < this.settings.minPlayers) return false;
    // At least one human must tick "I want to be the seeker"; opted-out players are never drafted.
    if (!this.humans.some((p) => p.optIn)) return false;
    return this.humans.every((p) => p.id === this.hostId || p.ready);
  }

  // ------------------------------------------------------------------ flow

  start(byId: string): boolean {
    if (byId !== this.hostId || !this.canStart()) return false;
    const s = this.settings;
    this.seed = Math.floor(this.random() * 2 ** 31);
    this.rng = new Rng(this.seed ^ 0x5eed);
    this.layout = buildLayout(this.mapId, this.seed, s.bottleRefillStations);
    this.walkable = [];
    const m = this.layout.map;
    for (let y = 1; y < m.height - 1; y++) for (let x = 1; x < m.width - 1; x++) if (!isSolid(this.layout, x, y)) this.walkable.push({ x: x + 0.5, y: y + 0.5 });

    const all = [...this.players.values()];
    const humans = all.filter((p) => !p.isBot);
    const nSeekers = seekerCountFor(all.length, humans.length, s.seekerCount);
    // Opt-out is honored: only volunteers are drawn (canStart guarantees at least one).
    const volunteers = this.rng.shuffle(humans.filter((p) => p.optIn));
    const seekers = new Set(volunteers.slice(0, nSeekers).map((p) => p.id));
    this.startedWithSeekers = seekers.size > 0;

    const hiders = all.filter((p) => !seekers.has(p.id));
    const hSpawns = spawnCluster(this.layout, m.hiderSpawn, hiders.length, this.rng);
    const sSpawns = spawnCluster(this.layout, m.seekerSpawn, seekers.size, this.rng);
    hiders.forEach((p, i) => this.spawnAs(p, 'hider', hSpawns[i]));
    all.filter((p) => seekers.has(p.id)).forEach((p, i) => this.spawnAs(p, 'seeker', sSpawns[i]));
    for (const p of all) p.score = 0;

    this.projectiles = [];
    this.bodies = [];
    this.traps = [];
    this.addTraps({ duck: s.duckCount, banana: s.bananaCount, mousetrap: s.mousetrapCount, alarm: s.alarmCount }, false);
    this.event = null;
    this.eventQueue = this.rng.shuffle([...MAP_EVENT_KINDS]).slice(0, s.mapEventCount);
    this.nextEventAt = s.mapEventFirstAt;
    this.result = null;
    this.phase = 'countdown';
    this.phaseLeft = s.countdownDuration;
    this.beaconLeft = s.beaconInterval;
    this.lobbyDirty = true;
    return true;
  }

  private spawnAs(p: PlayerSim, role: Role, pos: Vec2) {
    const s = this.settings;
    p.role = role;
    p.life = 'alive';
    p.move = newMoveState(pos.x, pos.y, s);
    p.queue = [];
    p.budget = 0;
    p.bottles = role === 'hider' ? s.bottlesPerHider : 0;
    p.ballCd = 0; p.refillCd = 0; p.tauntCd = 0; p.ghostCd = 0; p.boldCd = 0;
    p.revealCd.clear();
    p.reveal = 0;
    p.stepAccum = 0;
    p.campX = pos.x; p.campY = pos.y; p.campTime = 0;
    p.caughtLeft = 0;
    p.throwAnim = 0; p.tauntAnim = 0;
    p.history = [];
    p.power = null;
    p.powerProgress = 0;
    p.effects.clear();
    p.lastInput = { ...p.lastInput, ax: pos.x + 1, ay: pos.y, mx: 0, my: 0, run: false, dash: false, hold: false };
    p.bot = p.isBot ? { path: [], retargetIn: 0, running: false, stuckT: 0, lastX: pos.x, lastY: pos.y, target: null } : null;
  }

  private backToLobby() {
    for (const p of [...this.players.values()]) if (p.isBot) this.players.delete(p.id);
    for (const p of this.players.values()) {
      p.score = 0;
      p.ready = false;
      p.role = 'hider';
      p.life = 'alive';
      p.speaking = false;
    }
    this.projectiles = [];
    this.bodies = [];
    this.traps = [];
    this.event = null;
    this.result = null;
    this.phase = 'lobby';
    this.phaseLeft = 0;
    this.layout = buildLayout(this.mapId, 0, this.settings.bottleRefillStations);
    this.lobbyDirty = true;
  }

  private endMatch(winner: MatchResult['winner'], reason: MatchResult['reason']) {
    const ranked = this.humans.sort((a, b) => b.score - a.score);
    this.result = { winner, reason, mvp: ranked[0]?.id ?? null };
    this.phase = 'end';
    this.phaseLeft = this.settings.matchEndDuration;
    this.projectiles = [];
    this.event = null;
    this.lobbyDirty = true;
  }

  private checkWin() {
    if (this.phase !== 'countdown' && this.phase !== 'hunt') return;
    const all = [...this.players.values()];
    const seekers = all.filter((p) => p.role === 'seeker');
    const hiders = all.filter((p) => p.role === 'hider');
    if (this.startedWithSeekers && seekers.length === 0) return this.endMatch('hiders', 'seekersLeft');
    if (this.startedWithSeekers && hiders.every((p) => p.life !== 'alive')) return this.endMatch('seekers', 'allCaught');
  }

  // ------------------------------------------------------------------ inputs & actions

  pushInputs(id: string, inputs: unknown) {
    const p = this.players.get(id);
    if (!p || p.isBot || !Array.isArray(inputs)) return;
    for (const raw of inputs.slice(0, MAX_QUEUE)) {
      const inp = sanitizeInput(raw);
      if (inp && inp.seq > p.ack && (!p.queue.length || inp.seq > p.queue[p.queue.length - 1].seq)) p.queue.push(inp);
    }
    if (p.queue.length > MAX_QUEUE) p.queue.splice(0, p.queue.length - MAX_QUEUE);
  }

  private active(p: PlayerSim) {
    return this.phase === 'hunt' && p.move.stunLeft <= 0 && p.move.dashLeft <= 0;
  }

  fire(id: string, ax: number, ay: number): boolean {
    const p = this.players.get(id);
    if (!p || !Number.isFinite(ax) || !Number.isFinite(ay) || !this.active(p)) return false;
    const s = this.settings;
    if (p.role === 'seeker') {
      if (p.ballCd > 0) return false;
      p.ballCd = s.ballCooldown;
      p.throwAnim = THROW_ANIM;
      this.spawnProjectile(p, 'ball', ax, ay, s.ballSpeed, s.ballRange);
      return true;
    }
    if (p.life === 'alive') {
      if (p.bottles <= 0) return false;
      p.bottles--;
      p.throwAnim = THROW_ANIM;
      this.spawnProjectile(p, 'bottle', ax, ay, s.bottleSpeed, s.bottleRange);
      this.emitSound(p.move.x, p.move.y, s.throwIntensity, 'throw', p.id);
      return true;
    }
    if (p.life === 'ghost') {
      if (p.ghostCd > 0) return false;
      p.ghostCd = s.ghostBottleCooldown;
      p.throwAnim = THROW_ANIM;
      this.spawnProjectile(p, 'ghostBottle', ax, ay, s.bottleSpeed, s.bottleRange);
      this.emitSound(p.move.x, p.move.y, s.throwIntensity, 'ghostThrow', p.id);
      return true;
    }
    return false;
  }

  private spawnProjectile(p: PlayerSim, kind: ProjectileKind, ax: number, ay: number, speed: number, range: number) {
    const dx = ax - p.move.x, dy = ay - p.move.y;
    const len = Math.hypot(dx, dy);
    const nx = len > 1e-4 ? dx / len : Math.cos(p.move.angle);
    const ny = len > 1e-4 ? dy / len : Math.sin(p.move.angle);
    const travel = Math.min(Math.max(len, 0.5), range);
    this.projectiles.push({
      id: this.projectileSeq++, kind, ownerId: p.id,
      x: p.move.x, y: p.move.y, vx: nx * speed, vy: ny * speed, travelLeft: travel,
    });
  }

  dashClaim(id: string, targetId: string): boolean {
    const p = this.players.get(id);
    const t = this.players.get(targetId);
    if (!p || !t || p.role !== 'seeker' || this.phase !== 'hunt') return false;
    if (t.role !== 'hider' || t.life !== 'alive') return false;
    const dashing = p.move.dashLeft > 0 || this.time - p.lastDashEndAt <= CLAIM_WINDOW;
    if (!dashing) return false;
    if (this.time - t.lastVisibleAt > CLAIM_VISIBLE_GRACE) return false;
    const reach = this.settings.dashHitRadius + this.settings.captureTolerance;
    const seekerPts = [{ x: p.move.x, y: p.move.y }, ...p.history.filter((h) => this.time - h.t <= CLAIM_WINDOW)];
    const targetPts = [{ x: t.move.x, y: t.move.y, air: isAirborne(t.move) }, ...t.history.filter((h) => this.time - h.t <= CLAIM_WINDOW)];
    // Samples from different moments are paired, so a jump in the window could match its own takeoff or landing:
    // a target that jumped is judged only by the server's own hit test.
    if (targetPts.some((h) => h.air)) return false;
    for (const a of seekerPts) for (const b of targetPts) {
      if (dist(a.x, a.y, b.x, b.y) <= reach) {
        this.capture(p, t);
        return true;
      }
    }
    return false;
  }

  taunt(id: string): boolean {
    const p = this.players.get(id);
    if (!p || p.role !== 'hider' || p.life !== 'alive' || !this.active(p) || p.tauntCd > 0) return false;
    const s = this.settings;
    p.tauntCd = s.tauntCooldown;
    p.tauntAnim = TAUNT_ANIM;
    this.emitSound(p.move.x, p.move.y, this.has(p, 'megaphone') ? s.powerMegaphoneIntensity : s.tauntIntensity, 'cough', p.id, { variant: p.coughVariant });
    return true;
  }

  refill(id: string): boolean {
    const p = this.players.get(id);
    if (!p || p.role !== 'hider' || p.life !== 'alive' || !this.active(p)) return false;
    const s = this.settings;
    if (p.refillCd > 0 || p.bottles >= s.bottlesPerHider) return false;
    if (!this.nearCrate(p.move.x, p.move.y)) return false;
    p.bottles = s.bottlesPerHider;
    p.refillCd = s.bottleRefillCooldown;
    this.emitSound(p.move.x, p.move.y, 0.5, 'refill', p.id, { privateTo: p.id });
    this.privateEvents.push({ to: p.id, ev: { e: 'refilled' } });
    return true;
  }

  usePower(id: string): boolean {
    const p = this.players.get(id);
    if (!p || !p.power || p.life !== 'alive' || !this.active(p)) return false;
    const k = p.power;
    const d = powerDuration(k, this.settings);
    if (k in MOVE_POWERS) p.move[MOVE_POWERS[k as keyof typeof MOVE_POWERS]] = d;
    else p.effects.set(k, d);
    p.power = null;
    this.privateEvents.push({ to: p.id, ev: { e: 'power', k, used: true } });
    this.tryGrantPower(p);
    return true;
  }

  /** Active server-only power on `p`. */
  has(p: PlayerSim, k: PowerKind): boolean {
    return (p.effects.get(k) ?? 0) > 0;
  }

  /** Every score gain goes through here: it also fills the power-up meter. */
  private addScore(p: PlayerSim, pts: number) {
    p.score += pts;
    const th = this.settings.powerUpPointThreshold;
    if (pts <= 0 || th <= 0 || p.isBot) return;
    p.powerProgress = Math.min(th, p.powerProgress + pts);
    this.tryGrantPower(p);
  }

  private tryGrantPower(p: PlayerSim) {
    const th = this.settings.powerUpPointThreshold;
    if (th <= 0 || p.power || p.life !== 'alive' || this.phase !== 'hunt' || p.powerProgress < th) return;
    const pool = POWERS_BY_ROLE[p.role];
    p.power = pool[this.rng.int(pool.length)];
    p.powerProgress -= th;
    this.privateEvents.push({ to: p.id, ev: { e: 'power', k: p.power, used: false } });
  }

  /** Seconds of sonar jamming left (any living hider's jam power). */
  get jamLeft(): number {
    let left = 0;
    for (const p of this.players.values()) if (p.role === 'hider' && p.life === 'alive') left = Math.max(left, p.effects.get('jam') ?? 0);
    return left;
  }

  nearCrate(x: number, y: number): boolean {
    return this.layout.crates.some((c) => dist(x, y, c.x + 0.5, c.y + 0.5) <= this.settings.refillRange);
  }

  setSpeaking(id: string, speaking: boolean) {
    const p = this.players.get(id);
    if (!p || p.speaking === !!speaking) return;
    p.speaking = !!speaking;
    this.lobbyDirty = true;
  }

  private capture(seeker: PlayerSim, hider: PlayerSim) {
    const s = this.settings;
    hider.life = 'caught';
    hider.caughtLeft = s.caughtGhostDelay;
    hider.reveal = 0;
    hider.speaking = false;
    hider.move.vx = 0; hider.move.vy = 0; hider.move.dashLeft = 0; hider.move.stunLeft = 0;
    hider.move.speedLeft = 0; hider.move.jumpLeft = 0; hider.move.airLeft = 0;
    hider.power = null;
    hider.effects.clear();
    seeker.move.dashLeft = 0;
    seeker.move.stunLeft = 0;
    this.addScore(seeker, s.captureReward);
    this.globalEvents.push({ e: 'capture', seeker: seeker.id, target: hider.id, x: hider.move.x, y: hider.move.y });
    this.emitSound(hider.move.x, hider.move.y, s.dashMissIntensity, 'capture', seeker.id);
    this.lobbyDirty = true;
    this.checkWin();
  }

  // ------------------------------------------------------------------ sound

  emitSound(x: number, y: number, intensity: number, type: SoundType, emitterId: string | null, extra: { variant?: number; surface?: Surface; privateTo?: string } = {}) {
    const s = this.settings;
    this.emissions.push({ type, x, y, intensity, emitterId, ...extra });
    const live = this.phase === 'countdown' || this.phase === 'hunt';
    if (!SOUND_DEFS[type].reveals || !live || intensity <= 0) return;
    const radius = s.revealRadius * intensity;
    const all = [...this.players.values()];
    const seekers = all.filter((p) => p.role === 'seeker');
    for (const h of all) {
      if (h.role !== 'hider' || h.life !== 'alive') continue;
      const d = dist(x, y, h.move.x, h.move.y);
      if (d >= radius) continue;
      const k = 1 - d / radius;
      h.reveal = Math.max(h.reveal, intensity * k);
      if (this.phase !== 'hunt') continue;
      for (const sk of seekers) {
        if ((sk.revealCd.get(h.id) ?? 0) > 0) continue;
        sk.revealCd.set(h.id, s.revealRewardCooldown);
        this.addScore(sk, s.revealReward * k);
      }
    }
    const e = emitterId ? this.players.get(emitterId) : undefined;
    if (e && !e.isBot && e.role === 'hider' && e.life === 'alive' && this.phase === 'hunt' && e.boldCd <= 0 && seekers.length) {
      const d = Math.min(...seekers.map((sk) => dist(sk.move.x, sk.move.y, e.move.x, e.move.y)));
      this.addScore(e, intensity * proximityMultiplier(d, s) * s.boldnessFactor);
      e.boldCd = s.boldnessCooldown;
    }
  }

  private privateEvents: { to: string; ev: GameEvent }[] = [];

  // ------------------------------------------------------------------ tick

  step(dt: number) {
    if (this.phase === 'lobby') return;
    this.time += dt;
    if (this.phase === 'end') {
      this.phaseLeft -= dt;
      if (this.phaseLeft <= 0) this.backToLobby();
      return;
    }
    const s = this.settings;
    const players = [...this.players.values()];

    for (const p of players) {
      p.ballCd = Math.max(0, p.ballCd - dt);
      p.refillCd = Math.max(0, p.refillCd - dt);
      p.tauntCd = Math.max(0, p.tauntCd - dt);
      p.ghostCd = Math.max(0, p.ghostCd - dt);
      p.boldCd = Math.max(0, p.boldCd - dt);
      p.throwAnim = Math.max(0, p.throwAnim - dt);
      p.tauntAnim = Math.max(0, p.tauntAnim - dt);
      for (const [k, v] of p.revealCd) p.revealCd.set(k, v - dt);
      for (const [k, v] of p.effects) if (v - dt > 0) p.effects.set(k, v - dt); else p.effects.delete(k);
    }

    for (const p of players) {
      if (p.isBot) this.botThink(p, dt);
      p.budget += dt;
      while (p.queue.length && p.budget > -MAX_AHEAD) {
        this.applyInput(p, p.queue.shift()!);
        p.budget -= INPUT_DT;
      }
      while (p.budget > MAX_LAG) {
        this.applyInput(p, idleInput(p.lastInput), true);
        p.budget -= INPUT_DT;
      }
      if (this.phase !== 'countdown' && this.phase !== 'hunt') return;
    }

    this.stepProjectiles(dt);

    for (const p of players) {
      if (p.role === 'hider' && p.life === 'alive') {
        p.reveal = Math.max(0, p.reveal - s.revealDecay * dt);
        if (p.reveal > 0 || p.move.stunLeft > 0) p.lastVisibleAt = this.time;
      }
    }

    this.beaconLeft -= dt;
    if (this.beaconLeft <= 0) {
      this.beaconLeft += s.beaconInterval;
      const b = this.layout.map.beacon;
      this.emitSound(b.x, b.y, s.beaconIntensity, 'beacon', null);
    }

    for (const p of players) {
      if (!this.players.has(p.id)) continue;
      if (p.life === 'alive' && p.speaking) {
        p.voiceCd -= dt;
        if (p.voiceCd <= 0) {
          p.voiceCd = s.voiceInterval;
          this.emitSound(p.move.x, p.move.y, this.has(p, 'megaphone') ? s.powerMegaphoneIntensity : s.voiceIntensity, 'voice', p.id);
        }
      } else {
        p.voiceCd = 0;
      }
    }

    if (this.phase === 'hunt') this.stepHunt(players, dt);

    this.phaseLeft -= dt;
    if (this.phaseLeft <= 0) {
      if (this.phase === 'countdown') {
        this.phase = 'hunt';
        this.phaseLeft = s.huntDuration;
        this.lobbyDirty = true;
      } else if (this.phase === 'hunt') {
        const alive = players.some((p) => p.role === 'hider' && p.life === 'alive');
        this.endMatch(alive ? 'hiders' : 'seekers', alive ? 'timeUp' : 'allCaught');
      }
    }
  }

  private stepHunt(players: PlayerSim[], dt: number) {
    const s = this.settings;
    this.stepTraps(players, dt);
    this.stepEvent(players, dt);
    const seekers = players.filter((p) => p.role === 'seeker');
    for (const p of players) {
      if (p.life === 'caught') {
        p.caughtLeft -= dt;
        if (p.caughtLeft <= 0) {
          p.life = 'ghost';
          this.bodies.push({ id: p.id, x: p.move.x, y: p.move.y, a: p.move.angle, color: p.color });
          p.move.stunLeft = 0;
          this.lobbyDirty = true;
        }
        continue;
      }
      if (p.role !== 'hider' || p.life !== 'alive') continue;

      if (p.isBot || !seekers.length) continue;
      const d = Math.min(...seekers.map((sk) => dist(sk.move.x, sk.move.y, p.move.x, p.move.y)));
      this.addScore(p, s.surviveBasePoints * proximityMultiplier(d, s) * dt);
      if (dist(p.move.x, p.move.y, p.campX, p.campY) > s.campingMoveThreshold) {
        p.campX = p.move.x; p.campY = p.move.y; p.campTime = 0;
      } else {
        p.campTime += dt;
        if (p.campTime > s.campingGrace) p.score = Math.max(0, p.score - s.campingPenalty * dt);
      }
    }
  }

  private applyInput(p: PlayerSim, input: ClientInput, idle = false) {
    if (!idle) p.ack = input.seq;
    p.lastInput = input;
    p.hold = input.hold;
    const s = this.settings;
    const canMove = this.phase === 'hunt' || (this.phase === 'countdown' && p.role === 'hider');
    const px = p.move.x, py = p.move.y;
    const ev = stepMove(p.move, input, INPUT_DT, { role: p.role, life: p.life, settings: s, layout: this.layout, canMove });

    p.history.push({ t: this.time, x: p.move.x, y: p.move.y, air: isAirborne(p.move) });
    while (p.history.length && this.time - p.history[0].t > HISTORY_SECONDS) p.history.shift();

    // Landing: a run step on the surface underneath (takeoff is silent).
    if (ev.landed && p.life === 'alive' && !this.has(p, 'mute')) {
      const surface = surfaceAt(this.layout.map, p.move.x, p.move.y);
      if (isNoisySurface(surface)) this.emitSound(p.move.x, p.move.y, Math.min(1, JUMP.landIntensity * s.noisyZoneMultiplier), 'water', p.id, { surface });
      else this.emitSound(p.move.x, p.move.y, JUMP.landIntensity, 'run', p.id, { surface });
    }

    if (ev.dashStarted) this.emitSound(p.move.x, p.move.y, s.dashLaunchIntensity, 'dashLaunch', p.id);
    if (p.role === 'seeker' && (p.move.dashLeft > 0 || ev.dashEnded)) {
      for (const h of this.players.values()) {
        if (h.role !== 'hider' || h.life !== 'alive') continue;
        if (isAirborne(h.move) && !isAirborne(p.move)) continue; // jumped over the dash
        const hit = dist(p.move.x, p.move.y, h.move.x, h.move.y) <= s.dashHitRadius
          || segmentCircle(px, py, p.move.x, p.move.y, h.move.x, h.move.y, s.dashHitRadius) >= 0;
        if (hit) {
          this.capture(p, h);
          return;
        }
      }
      if (ev.dashEnded) {
        p.lastDashEndAt = this.time;
        this.emitSound(p.move.x, p.move.y, s.dashMissIntensity, 'dashMiss', p.id);
      }
    }

    // Footsteps (living, walking or running).
    const moved = dist(px, py, p.move.x, p.move.y);
    if (p.life === 'alive' && p.move.dashLeft <= 0 && p.move.airLeft <= 0 && moved > 0.02 && canMove && !this.has(p, 'mute')) {
      p.stepAccum += INPUT_DT;
      const interval = p.move.running ? s.runStepInterval : s.footstepInterval;
      if (p.stepAccum >= interval) {
        p.stepAccum = 0;
        const surface = surfaceAt(this.layout.map, p.move.x, p.move.y);
        const base = p.move.running ? s.runIntensity : s.footstepIntensity;
        if (isNoisySurface(surface)) this.emitSound(p.move.x, p.move.y, Math.min(1, base * s.noisyZoneMultiplier), 'water', p.id, { surface });
        else this.emitSound(p.move.x, p.move.y, base, p.move.running ? 'run' : 'footstep', p.id, { surface });
      }
    } else if (moved <= 0.02) {
      p.stepAccum = 0;
    }
  }

  private stepProjectiles(dt: number) {
    const s = this.settings;
    const keep: ProjectileSim[] = [];
    for (const pr of this.projectiles) {
      const speed = Math.hypot(pr.vx, pr.vy);
      const travel = Math.min(speed * dt, pr.travelLeft);
      const nx = pr.vx / speed, ny = pr.vy / speed;
      const x1 = pr.x + nx * travel, y1 = pr.y + ny * travel;
      const tWall = raycast(this.layout, pr.x, pr.y, x1, y1);
      let hitP: PlayerSim | null = null;
      let tHit = tWall;
      for (const p of this.players.values()) {
        if (p.id === pr.ownerId || p.life !== 'alive') continue;
        const t = segmentCircle(pr.x, pr.y, x1, y1, p.move.x, p.move.y, s.playerRadius + 0.1);
        if (t >= 0 && t < tHit) { tHit = t; hitP = p; }
      }
      const hx = pr.x + (x1 - pr.x) * tHit, hy = pr.y + (y1 - pr.y) * tHit;
      const landed = !hitP && tWall >= 1 && pr.travelLeft - travel <= 1e-6;
      if (hitP || tWall < 1 || landed) {
        // Back off slightly from walls so impact effects sit in front of them.
        const ix = tWall < 1 && !hitP ? hx - nx * 0.05 : hx, iy = tWall < 1 && !hitP ? hy - ny * 0.05 : hy;
        this.impact(pr, ix, iy, hitP);
        continue;
      }
      pr.x = x1; pr.y = y1;
      pr.travelLeft -= travel;
      keep.push(pr);
    }
    this.projectiles = keep;
  }

  private impact(pr: ProjectileSim, x: number, y: number, target: PlayerSim | null) {
    const s = this.settings;
    const owner = this.players.get(pr.ownerId);
    if (pr.kind === 'ball') {
      const hiderNear = [...this.players.values()].some((p) => p.role === 'hider' && p.life === 'alive' && dist(x, y, p.move.x, p.move.y) <= s.whistleDetectRadius);
      this.emitSound(x, y, s.whistleIntensity, hiderNear ? 'whistleHit' : 'whistle', null);
      this.globalEvents.push({ e: 'break', x, y, k: 'ball' });
      return;
    }
    if (pr.kind === 'bottle') {
      if (target) {
        this.stun(target, s.bottleStunDuration);
        this.globalEvents.push({ e: 'hit', x, y, target: target.id, k: 'bottle' });
        this.emitSound(x, y, s.bottleHitIntensity, 'bottleHit', null);
      } else {
        this.globalEvents.push({ e: 'break', x, y, k: 'bottle' });
        this.emitSound(x, y, s.bottleImpactIntensity, 'bottleImpact', null);
      }
      return;
    }
    // Ghost bottle: stuns, scores, never reveals.
    if (target) {
      this.stun(target, target.role === 'seeker' ? s.ghostStunSeeker : s.ghostStunHider);
      if (owner && !owner.isBot) this.addScore(owner, s.ghostHitReward);
      this.globalEvents.push({ e: 'hit', x, y, target: target.id, k: 'ghostBottle' });
    } else {
      this.globalEvents.push({ e: 'break', x, y, k: 'ghostBottle' });
    }
    this.emitSound(x, y, s.ghostImpactIntensity, 'ghostImpact', null);
  }

  private stun(p: PlayerSim, duration: number) {
    p.move.stunLeft = Math.max(p.move.stunLeft, duration);
    p.move.dashLeft = 0;
    if (p.role === 'hider') p.lastVisibleAt = this.time;
  }

  // ------------------------------------------------------------------ traps & map events

  private addTraps(counts: Partial<Record<TrapKind, number>>, extra: boolean) {
    const spots = layoutTraps(this.layout, this.seed + this.trapSeq, this.settings, counts, this.traps);
    for (const t of spots) this.traps.push({ id: this.trapSeq++, k: t.k, x: t.x, y: t.y, armed: true, rearmIn: 0, ringsLeft: 0, ringIn: 0, extra });
  }

  private stepTraps(players: PlayerSim[], dt: number) {
    const s = this.settings;
    for (const t of this.traps) {
      if (!t.armed) {
        t.rearmIn -= dt;
        if (t.rearmIn <= 0) t.armed = true;
      }
      if (t.ringsLeft > 0) {
        t.ringIn -= dt;
        if (t.ringIn <= 0) {
          t.ringsLeft--;
          t.ringIn += s.alarmRingInterval;
          this.emitSound(t.x, t.y, s.alarmIntensity, 'alarm', null);
        }
      }
      if (!t.armed) continue;
      // Only feet on the ground set traps off: walking, taking off, landing. Jumping over one is safe.
      const victim = players.find((p) => p.life === 'alive' && this.players.has(p.id) && jumpHeight(p.move) <= 0 && dist(p.move.x, p.move.y, t.x, t.y) <= s.trapRadius);
      if (victim) this.triggerTrap(t, victim);
    }
  }

  private triggerTrap(t: TrapSim, p: PlayerSim) {
    const s = this.settings;
    t.armed = false;
    switch (t.k) {
      case 'duck':
        t.rearmIn = s.duckCooldown;
        this.emitSound(t.x, t.y, s.duckIntensity, 'quack', null);
        break;
      case 'banana': {
        // The victim slips; the peel shoots ahead along the victim's motion (stopped by walls).
        t.rearmIn = s.bananaStun;
        this.stun(p, s.bananaStun);
        this.emitSound(p.move.x, p.move.y, s.slipIntensity, 'slip', null);
        const sp = Math.hypot(p.move.vx, p.move.vy);
        const dx = sp > 0.1 ? p.move.vx / sp : Math.cos(p.move.angle), dy = sp > 0.1 ? p.move.vy / sp : Math.sin(p.move.angle);
        const tx = t.x + dx * s.bananaSlideDistance, ty = t.y + dy * s.bananaSlideDistance;
        const k = Math.max(0, raycast(this.layout, t.x, t.y, tx, ty) * s.bananaSlideDistance - 0.3) / Math.max(1e-6, s.bananaSlideDistance);
        t.x += (tx - t.x) * k;
        t.y += (ty - t.y) * k;
        break;
      }
      case 'mousetrap':
        t.rearmIn = s.mousetrapRearm;
        this.stun(p, s.mousetrapStun);
        this.emitSound(t.x, t.y, s.mousetrapIntensity, 'snap', null);
        break;
      case 'alarm':
        t.rearmIn = s.alarmRearm;
        t.ringsLeft = s.alarmRings;
        t.ringIn = 0;
        break;
    }
  }

  private eventDuration(k: MapEventKind): number {
    const s = this.settings;
    return k === 'hotDuck' ? s.hotDuckDuration : k === 'invisibleTraps' ? s.invisibleTrapsDuration : s.tripleTrapsDuration;
  }

  startEvent(k: MapEventKind) {
    const s = this.settings;
    const d = this.eventDuration(k);
    this.event = { k, left: d, duration: d, immunity: 0, quackIn: 0, waveDone: false };
    if (k === 'hotDuck') {
      const hiders = [...this.players.values()].filter((p) => p.role === 'hider' && p.life === 'alive');
      this.event.carrier = hiders.length ? hiders[this.rng.int(hiders.length)].id : undefined;
    }
    if (k === 'tripleTraps') this.addTraps({ duck: s.duckCount, banana: s.bananaCount }, true);
    this.globalEvents.push({ e: 'mapEvent', k, on: true });
  }

  private stepEvent(players: PlayerSim[], dt: number) {
    const s = this.settings;
    const elapsed = s.huntDuration - this.phaseLeft;
    if (!this.event && this.eventQueue.length && elapsed >= this.nextEventAt) {
      this.nextEventAt += s.mapEventGap;
      this.startEvent(this.eventQueue.shift()!);
    }
    const ev = this.event;
    if (!ev) return;
    ev.left -= dt;
    if (ev.k === 'hotDuck') this.stepHotDuck(ev, players, dt);
    if (ev.k === 'tripleTraps' && !ev.waveDone && ev.left <= ev.duration / 2) {
      ev.waveDone = true;
      this.addTraps({ duck: s.duckCount, banana: s.bananaCount }, true);
    }
    if (ev.left <= 0) {
      if (ev.k === 'tripleTraps') this.traps = this.traps.filter((t) => !t.extra);
      this.globalEvents.push({ e: 'mapEvent', k: ev.k, on: false });
      this.event = null;
    }
  }

  private stepHotDuck(ev: EventSim, players: PlayerSim[], dt: number) {
    const s = this.settings;
    const alive = players.filter((p) => p.life === 'alive' && this.players.has(p.id));
    let c = ev.carrier ? this.players.get(ev.carrier) : undefined;
    if (!c || c.life !== 'alive') {
      // The wearer was caught or left: the hat hops to the nearest living player.
      const from = c ?? alive[0];
      c = from ? alive.sort((a, b) => dist(a.move.x, a.move.y, from.move.x, from.move.y) - dist(b.move.x, b.move.y, from.move.x, from.move.y))[0] : undefined;
      ev.carrier = c?.id;
      if (!c) return;
    }
    ev.immunity -= dt;
    if (ev.immunity <= 0) {
      const next = alive.find((p) => p.id !== c!.id && dist(p.move.x, p.move.y, c!.move.x, c!.move.y) <= s.hotDuckTouchRadius);
      if (next) {
        c = next;
        ev.carrier = next.id;
        ev.immunity = s.hotDuckImmunity;
        ev.quackIn = 0;
      }
    }
    ev.quackIn -= dt;
    if (ev.quackIn <= 0) {
      ev.quackIn += s.hotDuckQuackInterval;
      this.emitSound(c.move.x, c.move.y, s.hotDuckIntensity, 'quack', c.id);
    }
  }

  // ------------------------------------------------------------------ bots

  private botThink(p: PlayerSim, dt: number) {
    const b = p.bot;
    if (!b || this.phase === 'end') return;
    const s = this.settings;
    const seq = p.lastInput.seq + 1;
    const base: ClientInput = { seq, mx: 0, my: 0, run: false, ax: p.move.x + Math.cos(p.move.angle), ay: p.move.y + Math.sin(p.move.angle), dash: false, jump: false, hold: false };
    if (p.life === 'caught' || (this.phase === 'countdown' && p.role !== 'hider')) {
      p.queue.push(base);
      return;
    }
    b.retargetIn -= dt;
    b.stuckT += dt;
    if (b.stuckT > 1) {
      if (dist(p.move.x, p.move.y, b.lastX, b.lastY) < 0.3) b.retargetIn = 0;
      b.stuckT = 0; b.lastX = p.move.x; b.lastY = p.move.y;
    }
    if (b.retargetIn <= 0 || (!b.path.length && !b.target)) {
      const goal = this.walkable[this.rng.int(this.walkable.length)] ?? { x: p.move.x, y: p.move.y };
      b.target = goal;
      b.path = p.life === 'ghost' ? [goal] : findPath(this.layout, p.move, goal);
      b.retargetIn = s.botRetargetInterval * this.rng.range(0.7, 1.3);
      b.running = this.rng.next() < s.botRunChance;
    }
    while (b.path.length && dist(p.move.x, p.move.y, b.path[0].x, b.path[0].y) < 0.35) b.path.shift();
    if (!b.path.length) {
      b.target = null;
      p.queue.push(base);
      return;
    }
    const wp = b.path[0];
    const dx = wp.x - p.move.x, dy = wp.y - p.move.y;
    const len = Math.hypot(dx, dy) || 1;
    p.queue.push({ ...base, mx: dx / len, my: dy / len, run: b.running, ax: wp.x, ay: wp.y });
  }

  // ------------------------------------------------------------------ views

  private target(p: PlayerSim): PlayerTarget {
    return { kind: 'player', id: p.id, role: p.role, life: p.life, reveal: p.reveal, stunned: p.move.stunLeft > 0, cloaked: this.has(p, 'invisible') };
  }

  private anim(p: PlayerSim): number {
    let a = 0;
    const speed = Math.hypot(p.move.vx, p.move.vy);
    if (speed > 0.3) a |= Anim.MOVING;
    if (p.move.running) a |= Anim.RUNNING;
    if (p.move.dashLeft > 0) a |= Anim.DASHING;
    if (p.move.stunLeft > 0) a |= Anim.STUNNED;
    if (p.throwAnim > 0) a |= Anim.THROWING;
    if (p.tauntAnim > 0) a |= Anim.TAUNTING;
    if (p.hold && ((p.life === 'alive' && p.role === 'hider' && p.bottles > 0) || (p.life === 'ghost' && p.ghostCd <= 0))) a |= Anim.HOLDING;
    if (p.speaking) a |= Anim.SPEAKING;
    if (p.move.airLeft > 0 || p.move.perched) a |= Anim.JUMPING;
    if (p.move.speedLeft > 0) a |= Anim.SPEEDING;
    return a;
  }

  private viewer(p: PlayerSim): Viewer {
    return { id: p.id, role: p.role, life: p.life };
  }

  buildSnapshot(viewerId: string): Snapshot | null {
    const me = this.players.get(viewerId);
    if (!me || this.phase === 'lobby') return null;
    const viewer = this.viewer(me);
    const snap: Snapshot = {
      t: this.time,
      phase: this.phase,
      phaseLeft: Math.max(0, this.phaseLeft),
      beaconLeft: Math.max(0, this.beaconLeft),
      seed: this.seed,
      mapId: this.mapId,
      me: this.meState(me),
      players: [],
      held: [],
      proj: [],
      bodies: this.bodies.map((b) => ({ ...b })),
      traps: this.event?.k === 'invisibleTraps' ? [] : this.traps.map((t): SnapTrap => ({ id: t.id, k: t.k, x: Math.round(t.x * 100) / 100, y: Math.round(t.y * 100) / 100, armed: t.armed })),
      event: this.event ? this.snapEvent(this.event) : null,
      scores: [...this.players.values()].map((p) => ({ id: p.id, score: Math.round(p.score), role: p.role, life: p.life })),
      result: this.result,
    };
    for (const p of this.players.values()) {
      const vis = isVisibleTo(viewer, this.target(p), this.phase);
      const anim = this.anim(p);
      if (vis === 'hidden') {
        if (anim & Anim.HOLDING && p.life === 'alive') snap.held.push({ x: p.move.x, y: p.move.y, a: p.move.angle });
        continue;
      }
      // Camo: hiders see the seeker as one of them, without a name tag.
      const camo = p.role === 'seeker' && me.role === 'hider' && this.has(p, 'camo');
      const z = Math.round(jumpHeight(p.move) * 100) / 100;
      snap.players.push({ id: p.id, x: p.move.x, y: p.move.y, a: p.move.angle, role: camo ? 'hider' : p.role, life: p.life, rev: p.reveal, anim, color: p.color, ...(camo ? { anon: true } : {}), ...(z > 0 ? { z } : {}) });
    }
    for (const pr of this.projectiles) {
      const owner = this.players.get(pr.ownerId);
      const ownerT: PlayerTarget = owner ? this.target(owner) : { kind: 'player', id: pr.ownerId, role: 'hider', life: 'ghost', reveal: 0, stunned: false };
      if (isVisibleTo(viewer, { kind: 'projectile', projectile: pr.kind, owner: ownerT }, this.phase) === 'hidden') continue;
      snap.proj.push({ id: pr.id, k: pr.kind, x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy });
    }
    return snap;
  }

  private snapEvent(ev: EventSim): SnapEvent {
    return { k: ev.k, left: Math.max(0, ev.left), ...(ev.carrier ? { carrier: ev.carrier } : {}) };
  }

  private meState(p: PlayerSim): MeState {
    return {
      ...p.move,
      ack: p.ack,
      role: p.role,
      life: p.life,
      bottles: p.bottles,
      ballCd: p.ballCd,
      refillCd: p.refillCd,
      tauntCd: p.tauntCd,
      ghostCd: p.ghostCd,
      caughtLeft: Math.max(0, p.caughtLeft),
      anim: this.anim(p),
      power: p.power,
      powerProgress: p.powerProgress,
      effects: [
        ...[...p.effects].map(([k, left]) => ({ k, left })),
        ...(Object.keys(MOVE_POWERS) as (keyof typeof MOVE_POWERS)[]).filter((k) => p.move[MOVE_POWERS[k]] > 0).map((k) => ({ k, left: p.move[MOVE_POWERS[k]] })),
      ],
      jammed: p.role === 'seeker' ? this.jamLeft : 0,
    };
  }

  /** Events produced since the last flush, filtered for one viewer (anti-cheat). */
  buildEvents(viewerId: string): GameEvent[] {
    const me = this.players.get(viewerId);
    if (!me) return [];
    const viewer = this.viewer(me);
    const out: GameEvent[] = [];
    // Jam power: seekers hear everything but get no positions (no rings).
    const jammed = me.role === 'seeker' && this.jamLeft > 0;
    for (const em of this.emissions) {
      if (em.privateTo && em.privateTo !== viewerId) continue;
      const emitter = em.emitterId ? this.players.get(em.emitterId) : undefined;
      // Sounds made at an emitter's body: if that body is hidden from the viewer, send audio only.
      const hidden = (emitter && isVisibleTo(viewer, this.target(emitter), this.phase) === 'hidden') || (jammed && em.emitterId !== viewerId);
      if (hidden) {
        const d = dist(em.x, em.y, me.move.x, me.move.y);
        const vol = audioGain(d, SOUND_DEFS[em.type].range(this.settings)) * em.intensity;
        if (vol > 0.001) out.push({ e: 'snda', t: em.type, vol, pan: listenerPan(em.x - me.move.x, em.y - me.move.y, forwardYaw(this.settings.cameraMode, me.move.angle)), v: em.variant, s: em.surface });
        continue;
      }
      out.push({ e: 'snd', t: em.type, x: em.x, y: em.y, i: em.intensity, v: em.variant, s: em.surface, id: em.emitterId ?? undefined });
    }
    out.push(...this.globalEvents);
    for (const pe of this.privateEvents) if (pe.to === viewerId) out.push(pe.ev);
    return out;
  }

  flushEvents() {
    this.emissions = [];
    this.globalEvents = [];
    this.privateEvents = [];
  }

  lobbyState(): LobbyState {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      mapId: this.mapId,
      settings: this.settings,
      voiceAvailable: this.voiceAvailable,
      players: [...this.players.values()]
        .sort((a, b) => a.joinOrder - b.joinOrder)
        .map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, ready: p.ready, optIn: p.optIn, color: p.color, speaking: p.speaking })),
    };
  }
}

function sanitizeInput(raw: unknown): ClientInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const seq = num(r.seq);
  if (!Number.isInteger(seq) || seq <= 0) return null;
  const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    seq,
    mx: clamp1(num(r.mx)),
    my: clamp1(num(r.my)),
    run: r.run === true,
    ax: num(r.ax),
    ay: num(r.ay),
    dash: r.dash === true,
    jump: r.jump === true,
    hold: r.hold === true,
  };
}
