import type { MatchSettings } from './settings';

export type SoundType =
  | 'footstep'
  | 'run'
  | 'water'
  | 'cough'
  | 'voice'
  | 'throw'
  | 'bottleImpact'
  | 'bottleHit'
  | 'dashLaunch'
  | 'dashMiss'
  | 'capture'
  | 'whistle'
  | 'whistleHit'
  | 'beacon'
  | 'ghostThrow'
  | 'ghostImpact'
  | 'refill'
  | 'quack'
  | 'slip'
  | 'snap'
  | 'alarm';

export type VolumeGroup = 'steps' | 'body' | 'objects' | 'seeker' | 'world' | 'voice' | 'music' | 'ui';
export const VOLUME_GROUPS: readonly VolumeGroup[] = ['steps', 'body', 'objects', 'seeker', 'world', 'voice', 'music', 'ui'];

export interface SoundDef {
  reveals: boolean;
  group: VolumeGroup;
  range: (s: MatchSettings) => number;
}

const maxRange = (s: MatchSettings) => s.audioMaxRange;

export const SOUND_DEFS: Record<SoundType, SoundDef> = {
  footstep: { reveals: false, group: 'steps', range: (s) => s.footstepAudioRange },
  run: { reveals: true, group: 'steps', range: (s) => s.runAudioRange },
  water: { reveals: true, group: 'steps', range: (s) => s.runAudioRange },
  cough: { reveals: true, group: 'body', range: maxRange },
  voice: { reveals: true, group: 'voice', range: maxRange },
  throw: { reveals: false, group: 'objects', range: maxRange },
  bottleImpact: { reveals: true, group: 'objects', range: maxRange },
  bottleHit: { reveals: true, group: 'objects', range: maxRange },
  dashLaunch: { reveals: true, group: 'seeker', range: maxRange },
  dashMiss: { reveals: true, group: 'seeker', range: maxRange },
  capture: { reveals: true, group: 'seeker', range: maxRange },
  whistle: { reveals: true, group: 'seeker', range: maxRange },
  whistleHit: { reveals: true, group: 'seeker', range: maxRange },
  beacon: { reveals: true, group: 'world', range: maxRange },
  ghostThrow: { reveals: false, group: 'objects', range: maxRange },
  ghostImpact: { reveals: false, group: 'objects', range: maxRange },
  refill: { reveals: false, group: 'world', range: maxRange },
  quack: { reveals: true, group: 'world', range: maxRange },
  slip: { reveals: true, group: 'body', range: maxRange },
  snap: { reveals: true, group: 'objects', range: maxRange },
  alarm: { reveals: true, group: 'world', range: maxRange },
};

export const MAX_RINGS = 16;

/** Positional gain: inverse-distance (log-like in dB) falloff with a linear cut over the last 25% of range. */
export function audioGain(d: number, range: number): number {
  if (d >= range) return 0;
  const ref = 2;
  const base = ref / (ref + Math.max(0, d - ref * 0.5));
  const fadeStart = range * 0.75;
  const fade = d <= fadeStart ? 1 : 1 - (d - fadeStart) / (range - fadeStart);
  return Math.max(0, Math.min(1, base)) * fade;
}

/** Proximity voice chat volume. */
export function voiceVolume(d: number, s: MatchSettings): number {
  return audioGain(d, s.voiceRange);
}

export function audioPan(dx: number): number {
  return Math.max(-1, Math.min(1, dx / 12));
}

/** Visual ring state for a sound of `intensity` at `age` seconds; null when finished. */
export function ringAt(s: MatchSettings, intensity: number, age: number): { radius: number; alpha: number; width: number } | null {
  if (age < 0 || age >= s.ringDuration) return null;
  const k = age / s.ringDuration;
  const maxR = s.revealRadius * intensity * s.ringScale;
  const ease = 1 - (1 - k) * (1 - k);
  return { radius: maxR * ease, alpha: s.ringOpacity * (1 - k), width: 0.08 + 0.3 * intensity };
}

/** Displayed silhouette alpha follows the reveal at no more than `rate` per second. */
export function stepDisplayAlpha(current: number, target: number, dt: number, rate: number): number {
  const maxStep = rate * dt;
  const d = target - current;
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
}

export const REVEAL_VISIBLE_THRESHOLD = 0.02;
