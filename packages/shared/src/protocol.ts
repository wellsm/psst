import type { MoveInput, MoveState } from './movement';
import type { MapId, Surface } from './maps';
import type { PowerKind } from './powerups';
import type { MatchSettings } from './settings';
import type { SoundType } from './sound';
import type { TrapKind } from './traps';
import type { LifeState, Phase, ProjectileKind, Role } from './visibility';

export const MAX_PLAYERS = 12;
export const MAX_BOTS = 9;
export const NAME_MAX = 16;
export const CODE_LENGTH = 6;
export const TICK_RATE = 30;
export const ROOM_NAME = 'game';

export const COUGH_VARIANTS = 12;

export const Anim = {
  MOVING: 1,
  RUNNING: 2,
  DASHING: 4,
  STUNNED: 8,
  THROWING: 16,
  TAUNTING: 128,
  HOLDING: 256,
  SPEAKING: 512,
  /** In the air, or standing on top of a low solid. */
  JUMPING: 1024,
  /** Speed power-up active. */
  SPEEDING: 2048,
} as const;

export interface ClientInput extends MoveInput {
  /** Hider/ghost is holding the fire button (aiming a bottle). */
  hold: boolean;
}

// ---------- client → server ----------
export interface ClientMessages {
  input: ClientInput[];
  fire: { ax: number; ay: number };
  dashClaim: { targetId: string };
  taunt: Record<string, never>;
  refill: Record<string, never>;
  usePower: Record<string, never>;
  voice: { speaking: boolean };
  ready: { ready: boolean };
  optIn: { value: boolean };
  prefs: { name?: string; coughVariant?: number };
  setSettings: { patch: Record<string, number> };
  setMap: { mapId: MapId };
  addBot: Record<string, never>;
  removeBot: Record<string, never>;
  start: Record<string, never>;
  /** Ask for a LiveKit token (answered with `voiceToken`); identity = the connection's own session. */
  voiceToken: Record<string, never>;
}

// ---------- server → client ----------
export interface LobbyPlayer {
  id: string;
  name: string;
  isBot: boolean;
  ready: boolean;
  optIn: boolean;
  color: number;
  speaking: boolean;
}

export interface LobbyState {
  code: string;
  hostId: string;
  phase: Phase;
  mapId: MapId;
  settings: MatchSettings;
  players: LobbyPlayer[];
  voiceAvailable: boolean;
}

export interface SnapPlayer {
  id: string;
  x: number;
  y: number;
  a: number;
  role: Role;
  life: LifeState;
  rev: number;
  anim: number;
  color: number;
  /** Disguised (camo power-up): drawn without a name tag. */
  anon?: boolean;
  /** Jump height in meters (omitted on the ground). */
  z?: number;
}

export interface SnapTrap {
  id: number;
  k: TrapKind;
  x: number;
  y: number;
  armed: boolean;
}

export type MapEventKind = 'hotDuck' | 'invisibleTraps' | 'tripleTraps';
export const MAP_EVENT_KINDS: readonly MapEventKind[] = ['hotDuck', 'invisibleTraps', 'tripleTraps'];

export interface SnapEvent {
  k: MapEventKind;
  left: number;
  /** Hot duck: who wears the hat. */
  carrier?: string;
}

export interface SnapProjectile {
  id: number;
  k: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SnapBody {
  id: string;
  x: number;
  y: number;
  a: number;
  color: number;
}

export interface MeState extends MoveState {
  ack: number;
  role: Role;
  life: LifeState;
  bottles: number;
  ballCd: number;
  refillCd: number;
  tauntCd: number;
  ghostCd: number;
  caughtLeft: number;
  anim: number;
  /** Power-up waiting in the slot. */
  power: PowerKind | null;
  /** Points gained toward the next power-up. */
  powerProgress: number;
  /** Active power-ups with seconds left. */
  effects: { k: PowerKind; left: number }[];
  /** Seconds of sonar jamming left (seekers only). */
  jammed: number;
}

export interface ScoreRow {
  id: string;
  score: number;
  role: Role;
  life: LifeState;
}

export type Winner = 'seekers' | 'hiders';
export type EndReason = 'allCaught' | 'timeUp' | 'seekersLeft';

export interface MatchResult {
  winner: Winner;
  reason: EndReason;
  mvp: string | null;
}

export interface Snapshot {
  t: number;
  phase: Phase;
  phaseLeft: number;
  beaconLeft: number;
  seed: number;
  mapId: MapId;
  /** Map side the layout was stretched to (0 = as drawn). */
  mapSide: number;
  me: MeState | null;
  players: SnapPlayer[];
  /** Bottles held by hiders that are otherwise hidden from this viewer. */
  held: { x: number; y: number; a: number }[];
  proj: SnapProjectile[];
  bodies: SnapBody[];
  /** Empty while the "invisible traps" event runs. */
  traps: SnapTrap[];
  event: SnapEvent | null;
  scores: ScoreRow[];
  result: MatchResult | null;
}

export type GameEvent =
  | { e: 'snd'; t: SoundType; x: number; y: number; i: number; v?: number; s?: Surface; id?: string }
  /** Audio-only (emitter hidden from this viewer): server-computed volume and pan. */
  | { e: 'snda'; t: SoundType; vol: number; pan: number; v?: number; s?: Surface }
  | { e: 'hit'; x: number; y: number; target: string; k: ProjectileKind }
  | { e: 'break'; x: number; y: number; k: ProjectileKind }
  | { e: 'capture'; seeker: string; target: string; x: number; y: number }
  | { e: 'refilled' }
  /** Private: a power-up landed in the slot / was used. */
  | { e: 'power'; k: PowerKind; used: boolean }
  | { e: 'mapEvent'; k: MapEventKind; on: boolean };

export interface ServerMessages {
  welcome: { id: string; code: string };
  lobby: LobbyState;
  snap: Snapshot;
  ev: GameEvent[];
  /** null when voice is not configured on the server. */
  voiceToken: VoiceToken | null;
}

export interface VoiceToken {
  url: string;
  token: string;
}

export const PLAYER_COLORS: readonly number[] = [
  0x7ed957, 0xffb020, 0xffe14d, 0xff6fb5, 0xa86bff, 0x2fd4c4,
  0xc08a4a, 0xf2f2f2, 0xff4fd8, 0x55c8ff, 0x9bab3a, 0xff7f6b,
];

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateRoomCode(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return s;
}

export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export function sanitizeName(raw: unknown): string {
  // eslint-disable-next-line no-control-regex -- strip control characters from player names
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f]/g, '').trim() : '';
  return s.slice(0, NAME_MAX);
}
