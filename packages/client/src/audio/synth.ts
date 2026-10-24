/**
 * Procedural sound synthesis for "Psst!".
 *
 * Pure TypeScript (no WebAudio / DOM): every clip is rendered into mono
 * Float32Array buffers that the audio layer can wrap in AudioBuffers.
 * All randomness comes from a seeded PRNG so output is deterministic.
 */

export type ClipId =
  | 'step_floor' | 'step_water' | 'step_crumbs' | 'step_rug'
  | 'run_floor' | 'run_water' | 'run_crumbs' | 'run_rug'
  | 'cough'
  | 'throw'
  | 'bottle_break'
  | 'bottle_hit'
  | 'slingshot'
  | 'whistle_low'
  | 'whistle_high'
  | 'dash'
  | 'dash_boom'
  | 'capture'
  | 'ghost_throw'
  | 'ghost_impact'
  | 'beacon'
  | 'refill'
  | 'stun'
  | 'quack' | 'slip' | 'snap' | 'alarm'
  | 'power_get' | 'power_use' | 'event_start'
  | 'countdown_tick' | 'hunt_start' | 'match_win' | 'match_lose' | 'caught_card'
  | 'ui_click' | 'ui_ready' | 'ui_join'
  | 'music_lobby'
  | 'music_hunt';

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

type Rng = () => number;
type Wave = 'sine' | 'saw' | 'square' | 'tri';
type Vowel = readonly [number, number, number];
type Points = readonly (readonly [number, number])[];
type FreqParam = number | ((t: number) => number);

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function buf(sr: number, sec: number): Float32Array {
  return new Float32Array(Math.max(1, Math.round(sr * sec)));
}

/** Add `src * gain` into `dst` starting at `atSec`. */
function mix(dst: Float32Array, src: Float32Array, sr: number, atSec: number, gain = 1): void {
  const at = Math.max(0, Math.round(atSec * sr));
  const n = Math.min(src.length, dst.length - at);
  for (let i = 0; i < n; i++) dst[at + i] += src[i] * gain;
}

function peakOf(b: Float32Array): number {
  let p = 0;
  for (let i = 0; i < b.length; i++) {
    const a = Math.abs(b[i]);
    if (a > p) p = a;
  }
  return p;
}

/** Normalize in place to `peak` (no-op on silence). */
function nz(b: Float32Array, peak = 1): Float32Array {
  const p = peakOf(b);
  if (p > 0) {
    const g = peak / p;
    for (let i = 0; i < b.length; i++) b[i] *= g;
  }
  return b;
}

function wave(w: Wave, ph: number): number {
  switch (w) {
    case 'sine':
      return Math.sin(TAU * ph);
    case 'saw':
      return 2 * ph - 1;
    case 'square':
      return ph < 0.5 ? 1 : -1;
    default:
      return 1 - 4 * Math.abs(ph - 0.5);
  }
}

interface ToneOpts {
  dur: number;
  f0: number;
  /** Exponential sweep target (reached after `sweep` seconds, default = dur). */
  f1?: number;
  sweep?: number;
  /** Custom frequency curve; overrides f0/f1. */
  freq?: (t: number) => number;
  wave?: Wave;
  attack?: number;
  /** Exponential decay time constant (s). 0 = sustain. */
  decay?: number;
  release?: number;
  vibRate?: number;
  /** Vibrato depth in semitones. */
  vibDepth?: number;
}

/** Phase-accumulating oscillator with sweep, vibrato and AD(R) envelope. */
function tone(sr: number, o: ToneOpts): Float32Array {
  const out = buf(sr, o.dur);
  const n = out.length;
  const w = o.wave ?? 'sine';
  const ratio = o.f0 > 0 ? (o.f1 ?? o.f0) / o.f0 : 1;
  const sweep = o.sweep ?? o.dur;
  const atk = Math.max(o.attack ?? 0.002, 1 / sr);
  const relN = Math.max(1, (o.release ?? 0.01) * sr);
  const dec = o.decay ?? 0;
  const decK = dec > 0 ? Math.exp(-1 / (dec * sr)) : 1;
  const vibD = o.vibDepth ?? 0;
  const vibR = o.vibRate ?? 0;
  const freq = o.freq;
  let ph = 0;
  let decEnv = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let f = freq ? freq(t) : ratio === 1 ? o.f0 : o.f0 * Math.pow(ratio, Math.min(1, t / sweep));
    if (vibD !== 0) f *= Math.pow(2, (vibD * Math.sin(TAU * vibR * t)) / 12);
    ph += f / sr;
    ph -= Math.floor(ph);
    let env: number;
    if (t < atk) env = t / atk;
    else {
      env = decEnv;
      decEnv *= decK;
    }
    const left = n - i;
    if (left < relN) env *= left / relN;
    out[i] = wave(w, ph) * env;
  }
  return out;
}

function noise(sr: number, dur: number, rng: Rng): Float32Array {
  const out = buf(sr, dur);
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Multiply by a piecewise-linear envelope; points are [seconds, gain]. */
function shape(b: Float32Array, sr: number, pts: Points): Float32Array {
  let k = 0;
  const last = pts.length - 1;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    while (k < last - 1 && t > pts[k + 1][0]) k++;
    const [t0, v0] = pts[k];
    const [t1, v1] = pts[Math.min(k + 1, last)];
    let v: number;
    if (t <= t0) v = v0;
    else if (t >= t1) v = v1;
    else v = v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    b[i] *= v;
  }
  return b;
}

/** Linear attack then exponential decay (multiplies in place). */
function expEnv(b: Float32Array, sr: number, attack: number, tau: number): Float32Array {
  const atkN = Math.max(1, attack * sr);
  const k = Math.exp(-1 / (tau * sr));
  let e = 1;
  for (let i = 0; i < b.length; i++) {
    if (i < atkN) b[i] *= i / atkN;
    else {
      b[i] *= e;
      e *= k;
    }
  }
  return b;
}

class Biquad {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  set(type: 'bp' | 'lp' | 'hp', sr: number, f: number, q: number): this {
    const fc = Math.min(Math.max(f, 10), sr * 0.45);
    const w = (TAU * fc) / sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * Math.max(q, 0.05));
    const a0 = 1 + al;
    if (type === 'bp') {
      this.b0 = al / a0;
      this.b1 = 0;
      this.b2 = -al / a0;
    } else if (type === 'lp') {
      this.b0 = (1 - cs) / 2 / a0;
      this.b1 = (1 - cs) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = (1 + cs) / 2 / a0;
      this.b1 = -(1 + cs) / a0;
      this.b2 = this.b0;
    }
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - al) / a0;
    return this;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Biquad filter in place; `f` may be a curve over time (coefficients refreshed every 16 samples). */
function filt(b: Float32Array, sr: number, type: 'bp' | 'lp' | 'hp', f: FreqParam, q = 0.707): Float32Array {
  const bq = new Biquad();
  const fn = typeof f === 'function' ? f : null;
  bq.set(type, sr, fn ? fn(0) : (f as number), q);
  for (let i = 0; i < b.length; i++) {
    if (fn && (i & 15) === 0) bq.set(type, sr, fn(i / sr), q);
    b[i] = bq.run(b[i]);
  }
  return b;
}

function lp1(b: Float32Array, sr: number, fc: number): Float32Array {
  const a = 1 - Math.exp((-TAU * fc) / sr);
  let y = 0;
  for (let i = 0; i < b.length; i++) {
    y += a * (b[i] - y);
    b[i] = y;
  }
  return b;
}

function hp1(b: Float32Array, sr: number, fc: number): Float32Array {
  const a = 1 - Math.exp((-TAU * fc) / sr);
  let y = 0;
  for (let i = 0; i < b.length; i++) {
    y += a * (b[i] - y);
    b[i] -= y;
  }
  return b;
}

/** Feedback echo in place (the tail must fit in the buffer). */
function echo(b: Float32Array, sr: number, delay: number, fb: number, wet: number): Float32Array {
  const d = Math.max(1, Math.round(delay * sr));
  const e = new Float32Array(b.length);
  for (let i = d; i < b.length; i++) e[i] = b[i - d] + fb * e[i - d];
  for (let i = 0; i < b.length; i++) b[i] += wet * e[i];
  return b;
}

/** Sum of exponentially decaying sine partials: [ratio, gain, decay]. */
function bell(sr: number, f: number, dur: number, partials: readonly (readonly [number, number, number])[]): Float32Array {
  const out = buf(sr, dur);
  for (const [r, g, d] of partials) {
    mix(out, tone(sr, { dur, f0: f * r, decay: d, attack: 0.001, release: 0.02 }), sr, 0, g);
  }
  return out;
}

/** Karplus-Strong plucked string. */
function ks(sr: number, f: number, dur: number, rng: Rng, decay: number, bright: number): Float32Array {
  const out = buf(sr, dur);
  const N = Math.max(2, Math.round(sr / f));
  const line = new Float32Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) {
    line[i] = rng() * 2 - 1;
    mean += line[i];
  }
  mean /= N;
  let p = 0;
  for (let i = 0; i < N; i++) {
    p += bright * (line[i] - mean - p);
    line[i] = p;
  }
  let idx = 0;
  const half = 0.5 * decay;
  for (let i = 0; i < out.length; i++) {
    const nx = idx + 1 === N ? 0 : idx + 1;
    const cur = line[idx];
    out[i] = cur;
    line[idx] = half * (cur + line[nx]);
    idx = nx;
  }
  shape(out, sr, [[0, 1], [Math.max(0, dur - 0.02), 1], [dur, 0]]);
  return out;
}

// ---------------------------------------------------------------------------
// Formant voice (coughs, sad trombone)
// ---------------------------------------------------------------------------

const V = {
  a: [800, 1200, 2500],
  o: [500, 900, 2400],
  u: [300, 870, 2240],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  uh: [640, 1190, 2390],
} as const satisfies Record<string, Vowel>;

const F_BW = [90, 110, 160] as const;
const F_GAIN = [1, 0.6, 0.28] as const;

interface VoiceOpts {
  dur: number;
  f0: number;
  f1?: number;
  v0: Vowel;
  v1?: Vowel;
  /** Fraction of the duration over which v0 morphs into v1. */
  morph?: readonly [number, number];
  /** 0 = pure voice, 1 = pure breath noise. */
  breath?: number;
  vibRate?: number;
  vibDepth?: number;
  jitter?: number;
  /** Vocal-fry amplitude modulation depth (growl). */
  fry?: number;
  src?: 'saw' | 'square';
  attack?: number;
  release?: number;
}

/** Glottal source (saw/square + breath) through three parallel band-pass formants. */
function voice(sr: number, o: VoiceOpts, rng: Rng): Float32Array {
  const out = buf(sr, o.dur);
  const n = out.length;
  const f1 = o.f1 ?? o.f0;
  const ratio = f1 / o.f0;
  const v0 = o.v0;
  const v1 = o.v1 ?? o.v0;
  const [m0, m1] = o.morph ?? [0, 1];
  const span = Math.max(1e-6, m1 - m0);
  const br = o.breath ?? 0.1;
  const vibR = o.vibRate ?? 5;
  const vibD = o.vibDepth ?? 0;
  const jitAmt = o.jitter ?? 0.02;
  const fry = o.fry ?? 0;
  const square = o.src === 'square';
  const atkN = Math.max(1, (o.attack ?? 0.02) * sr);
  const relN = Math.max(1, (o.release ?? 0.05) * sr);
  const f = [new Biquad(), new Biquad(), new Biquad()];
  let ph = 0;
  let jit = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const p = i / n;
    if ((i & 31) === 0) {
      const m = Math.min(1, Math.max(0, (p - m0) / span));
      for (let k = 0; k < 3; k++) {
        const fc = v0[k] + (v1[k] - v0[k]) * m;
        f[k].set('bp', sr, fc, fc / F_BW[k]);
      }
      jit = jit * 0.85 + (rng() - 0.5) * jitAmt;
    }
    let fr = o.f0 * Math.pow(ratio, p) * (1 + jit);
    if (vibD !== 0) fr *= Math.pow(2, (vibD * Math.sin(TAU * vibR * t)) / 12);
    ph += fr / sr;
    ph -= Math.floor(ph);
    let s = square ? (ph < 0.5 ? 0.8 : -0.8) : 1 - 2 * ph;
    if (fry > 0) s *= 1 - fry * (0.5 + 0.5 * Math.sin(TAU * 31 * t));
    s = s * (1 - br) + (rng() * 2 - 1) * br * 1.5;
    let env = i < atkN ? i / atkN : 1;
    const left = n - i;
    if (left < relN) env *= left / relN;
    out[i] = (f[0].run(s) * F_GAIN[0] + f[1].run(s) * F_GAIN[1] + f[2].run(s) * F_GAIN[2]) * env;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Footsteps
// ---------------------------------------------------------------------------

function stepFloor(sr: number, v: number, rng: Rng, run: boolean): Float32Array {
  const out = buf(sr, run ? 0.1 : 0.15);
  const fRes = [2150, 2450, 1950, 2700][v % 4] * (run ? 0.88 : 1);
  const tap = (at: number, g: number): void => {
    const c = noise(sr, 0.006, rng);
    filt(c, sr, 'hp', 2500, 0.7);
    expEnv(c, sr, 0.0003, 0.0012);
    mix(out, nz(c), sr, at, 0.7 * g);
    mix(out, tone(sr, { dur: 0.06, f0: fRes, decay: run ? 0.007 : 0.011, attack: 0.0005 }), sr, at, 0.45 * g);
    mix(out, tone(sr, { dur: 0.05, f0: fRes * 1.51, decay: 0.005, attack: 0.0005 }), sr, at, 0.22 * g);
    const body = tone(sr, {
      dur: 0.08,
      f0: 0,
      freq: (t) => 85 + 140 * Math.exp(-t / 0.01),
      decay: run ? 0.025 : 0.016,
      attack: 0.001,
    });
    mix(out, body, sr, at, (run ? 1 : 0.5) * g);
  };
  tap(0.002, 1);
  if (!run) tap(0.032 + 0.008 * v, 0.4); // heel-toe "tik-tak"
  return out;
}

function stepWater(sr: number, v: number, rng: Rng, run: boolean): Float32Array {
  const L = run ? 0.28 : 0.36;
  const out = buf(sr, L);
  const s = noise(sr, L, rng);
  filt(s, sr, 'bp', (t) => 450 * Math.pow(5, Math.min(1, t / (L * 0.6))), 2.5);
  shape(s, sr, [[0, 0], [0.006, 1], [0.05, 0.45], [L * 0.9, 0]]);
  mix(out, nz(s), sr, 0, run ? 0.9 : 0.6);
  const f0 = 240 + 45 * v;
  mix(out, nz(tone(sr, { dur: 0.12, f0, f1: f0 * 3.2, sweep: 0.05, decay: 0.035 })), sr, 0.008, 0.8);
  const nb = 3 + Math.floor(rng() * 3) + (run ? 1 : 0);
  for (let b = 0; b < nb; b++) {
    const at = 0.04 + rng() * (L - 0.12);
    const fb = 600 + rng() * 1000;
    mix(out, tone(sr, { dur: 0.05, f0: fb, f1: fb * 1.7, sweep: 0.025, decay: 0.012 }), sr, at, 0.25 + rng() * 0.25);
  }
  return out;
}

function stepCrumbs(sr: number, v: number, rng: Rng, run: boolean): Float32Array {
  const L = run ? 0.16 : 0.22;
  const out = buf(sr, L + 0.02);
  const count = run ? 48 : 34;
  for (let g = 0; g < count; g++) {
    const at = L * 0.85 * Math.pow(rng(), 1.7);
    const amp = (0.3 + 0.7 * rng()) * (1 - at / L);
    const gd = 0.0008 + rng() * 0.0025;
    const gr = noise(sr, gd * 4, rng);
    expEnv(gr, sr, 0.0001, gd);
    mix(out, gr, sr, at, amp);
    if (rng() < 0.3) {
      mix(out, tone(sr, { dur: 0.012, f0: 2500 + rng() * 3500, decay: 0.002, attack: 0.0002 }), sr, at, amp * 0.5);
    }
  }
  filt(out, sr, 'hp', 1200 + 300 * v, 0.7);
  nz(out);
  const body = noise(sr, 0.04, rng);
  lp1(body, sr, 500);
  lp1(body, sr, 500);
  expEnv(body, sr, 0.002, 0.012);
  mix(out, nz(body), sr, 0, run ? 0.55 : 0.3);
  return out;
}

function stepRug(sr: number, v: number, rng: Rng, run: boolean): Float32Array {
  const L = run ? 0.15 : 0.2;
  const out = buf(sr, L);
  const thud = tone(sr, {
    dur: L,
    f0: 0,
    freq: (t) => 60 + 8 * v + 70 * Math.exp(-t / 0.02),
    decay: run ? 0.04 : 0.05,
    attack: run ? 0.003 : 0.007,
  });
  mix(out, thud, sr, 0, 1);
  const n = noise(sr, L, rng);
  lp1(n, sr, 300);
  lp1(n, sr, 300);
  shape(n, sr, [[0, 0], [run ? 0.004 : 0.008, 1], [0.08, 0.2], [L * 0.9, 0]]);
  mix(out, nz(n), sr, 0, 0.6);
  const sw = noise(sr, 0.06, rng);
  filt(sw, sr, 'bp', 1400, 0.8);
  shape(sw, sr, [[0, 0], [0.01, 1], [0.06, 0]]);
  mix(out, nz(sw), sr, 0, 0.05);
  return out;
}

// ---------------------------------------------------------------------------
// Coughs (12) — loud cartoon taunts
// ---------------------------------------------------------------------------

interface CoughP {
  f0: number;
  n: number;
  len: number;
  gap: number;
  vowels: readonly Vowel[];
  voiced: number;
  noiseF: number;
  drop: number;
  fry?: number;
  squeak?: boolean;
  wheeze?: boolean;
  vib?: number;
  src?: 'saw' | 'square';
  climb?: number;
  grow?: number;
}

const COUGHS: readonly CoughP[] = [
  // 0: classic "kuh-kuh"
  { f0: 165, n: 2, len: 0.2, gap: 0.09, vowels: [V.uh], voiced: 0.55, noiseF: 1400, drop: 0.7 },
  // 1: deep grumpy single "HROOF"
  { f0: 82, n: 1, len: 0.42, gap: 0, vowels: [V.o], voiced: 0.65, noiseF: 700, drop: 0.6, fry: 0.6 },
  // 2: little "kef kef kef"
  { f0: 430, n: 3, len: 0.1, gap: 0.06, vowels: [V.e], voiced: 0.6, noiseF: 2600, drop: 0.8 },
  // 3: hacking growl
  { f0: 120, n: 3, len: 0.17, gap: 0.07, vowels: [V.a], voiced: 0.5, noiseF: 1100, drop: 0.65, fry: 0.45 },
  // 4: cough then a silly squeak
  { f0: 250, n: 2, len: 0.16, gap: 0.08, vowels: [V.uh], voiced: 0.55, noiseF: 1800, drop: 0.75, squeak: true },
  // 5: wheezy old-timer with whistling inhale
  { f0: 140, n: 2, len: 0.22, gap: 0.1, vowels: [V.a], voiced: 0.4, noiseF: 1300, drop: 0.7, wheeze: true },
  // 6: smug "a-HEM!"
  { f0: 190, n: 2, len: 0.2, gap: 0.05, vowels: [V.a, V.e], voiced: 0.85, noiseF: 1500, drop: 1.25, climb: 1.2, grow: 1.6 },
  // 7: tiny mouse "kih-kih-kih"
  { f0: 720, n: 3, len: 0.07, gap: 0.045, vowels: [V.i], voiced: 0.7, noiseF: 3500, drop: 0.85, climb: 1.08 },
  // 8: chesty boom
  { f0: 68, n: 2, len: 0.3, gap: 0.12, vowels: [V.o, V.u], voiced: 0.6, noiseF: 500, drop: 0.7, fry: 0.3 },
  // 9: dry raspy hiss
  { f0: 210, n: 3, len: 0.13, gap: 0.05, vowels: [V.a], voiced: 0.12, noiseF: 2800, drop: 0.8 },
  // 10: goose honk
  { f0: 340, n: 2, len: 0.2, gap: 0.08, vowels: [V.a], voiced: 0.8, noiseF: 1700, drop: 0.85, src: 'square', vib: 1.5 },
  // 11: dramatic escalating fit
  { f0: 150, n: 3, len: 0.14, gap: 0.06, vowels: [V.uh, V.a, V.o], voiced: 0.55, noiseF: 1300, drop: 0.6, climb: 1.25, grow: 1.5, vib: 0.8 },
];

function cough(sr: number, v: number, rng: Rng): Float32Array {
  const p = COUGHS[v];
  let total = 0.05;
  for (let i = 0; i < p.n; i++) total += p.len * Math.pow(p.grow ?? 1, i) + p.gap;
  if (p.squeak) total += 0.2;
  if (p.wheeze) total += 0.5;
  const out = buf(sr, total + 0.05);
  let t = 0.005;
  for (let i = 0; i < p.n; i++) {
    const L = p.len * Math.pow(p.grow ?? 1, i);
    const f = p.f0 * Math.pow(p.climb ?? 1, i) * (1 + (rng() - 0.5) * 0.06);
    const vo = voice(sr, {
      dur: L,
      f0: f * 1.25,
      f1: f * p.drop,
      v0: p.vowels[i % p.vowels.length],
      breath: 1 - p.voiced,
      fry: p.fry,
      vibRate: 7,
      vibDepth: p.vib ?? 0,
      jitter: 0.04,
      src: p.src,
      attack: 0.006,
      release: L * 0.3,
    }, rng);
    shape(vo, sr, [[0, 1], [L * 0.3, 0.6], [L, 0.15]]);
    mix(out, nz(vo), sr, t, 1);
    const k = noise(sr, 0.04, rng);
    filt(k, sr, 'bp', p.noiseF, 1.2);
    expEnv(k, sr, 0.001, 0.012);
    mix(out, nz(k), sr, t, 0.7);
    t += L + p.gap;
  }
  if (p.squeak) {
    const sq = tone(sr, { dur: 0.16, f0: 900, f1: 2000, sweep: 0.1, vibRate: 18, vibDepth: 0.7, attack: 0.01, release: 0.04 });
    mix(out, sq, sr, t - p.gap * 0.5, 0.45);
    t += 0.16;
  }
  if (p.wheeze) {
    const wL = 0.45;
    const wn = noise(sr, wL, rng);
    filt(wn, sr, 'bp', (tt) => 1000 + (1800 * tt) / wL, 8);
    shape(wn, sr, [[0, 0], [0.1, 1], [0.38, 0.8], [wL, 0]]);
    mix(out, nz(wn), sr, t + 0.03, 0.4);
    const wh = tone(sr, { dur: wL, f0: 1500, f1: 2600, vibRate: 11, vibDepth: 0.5, attack: 0.08, release: 0.1 });
    mix(out, wh, sr, t + 0.03, 0.18);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bottles, slingshot, whistles, dash, capture, ghost
// ---------------------------------------------------------------------------

function throwClip(sr: number, v: number, rng: Rng): Float32Array {
  const L = 0.45 + 0.07 * v;
  const n = noise(sr, L, rng);
  const lo = 350 + 80 * v;
  const hi = 1800 + 400 * v;
  filt(n, sr, 'bp', (t) => lo + (hi - lo) * Math.sin(Math.PI * Math.min(1, t / L)), 2.2);
  const spin = 8 + 3 * v;
  for (let i = 0; i < n.length; i++) {
    const t = i / sr;
    const env = Math.pow(Math.sin((Math.PI * t) / L), 1.5);
    n[i] *= env * (0.45 + 0.55 * (0.5 + 0.5 * Math.cos(TAU * spin * t)));
  }
  return n;
}

function shatter(sr: number, v: number, rng: Rng, L: number): Float32Array {
  const out = buf(sr, L);
  const c = noise(sr, 0.03, rng);
  filt(c, sr, 'hp', 900, 0.7);
  expEnv(c, sr, 0.0005, 0.006);
  mix(out, nz(c), sr, 0, 1);
  const thump = tone(sr, { dur: 0.12, f0: 0, freq: (t) => 60 + 140 * Math.exp(-t / 0.015), decay: 0.03, attack: 0.001 });
  mix(out, nz(thump), sr, 0, 0.6);
  const sp = noise(sr, L, rng);
  filt(sp, sr, 'hp', 4500, 0.7);
  expEnv(sp, sr, 0.001, L * 0.15);
  mix(out, nz(sp), sr, 0, 0.35);
  const count = 26 + 10 * v;
  for (let g = 0; g < count; g++) {
    const at = 0.004 + L * 0.7 * Math.pow(rng(), 2.2);
    const f = 2200 + rng() * 6500;
    const d = 0.01 + rng() * 0.05;
    const amp = (0.25 + 0.75 * rng()) * (1 - at / L);
    mix(out, tone(sr, { dur: d * 5, f0: f, decay: d, attack: 0.0003 }), sr, at, amp * 0.5);
    mix(out, tone(sr, { dur: d * 3, f0: f * 1.47, decay: d * 0.6, attack: 0.0003 }), sr, at, amp * 0.25);
  }
  if (v === 2) echo(out, sr, 0.07, 0.3, 0.35);
  return out;
}

function bottleHit(sr: number, v: number, rng: Rng): Float32Array {
  const out = buf(sr, 0.8);
  const f0 = v ? 420 : 560;
  const bonk = tone(sr, { dur: 0.25, f0, f1: f0 * 0.32, sweep: 0.09, decay: 0.09, vibRate: 9, vibDepth: v ? 2.5 : 0 });
  mix(bonk, tone(sr, { dur: 0.25, f0: f0 / 2, f1: f0 * 0.2, sweep: 0.1, wave: 'tri', decay: 0.07 }), sr, 0, 0.4);
  mix(out, nz(bonk), sr, 0, 1);
  mix(out, nz(shatter(sr, v, rng, 0.6)), sr, 0.03, 0.6);
  return out;
}

function slingshot(sr: number, rng: Rng): Float32Array {
  const out = buf(sr, 0.65);
  const st = tone(sr, { dur: 0.15, f0: 70, f1: 140, wave: 'saw', attack: 0.1, release: 0.01 });
  lp1(st, sr, 1200);
  mix(out, nz(st), sr, 0, 0.2);
  const tw = tone(sr, { dur: 0.45, f0: 0, freq: (t) => 150 + 120 * Math.exp(-t / 0.03), wave: 'tri', vibRate: 24, vibDepth: 1.2, decay: 0.14, attack: 0.001 });
  mix(out, nz(tw), sr, 0.15, 1);
  const hm = tone(sr, { dur: 0.3, f0: 0, freq: (t) => 300 + 240 * Math.exp(-t / 0.03), decay: 0.05, attack: 0.001 });
  mix(out, nz(hm), sr, 0.15, 0.3);
  const th = noise(sr, 0.12, rng);
  filt(th, sr, 'bp', (t) => 3500 * Math.pow(0.25, t / 0.1), 3);
  shape(th, sr, [[0, 0], [0.005, 1], [0.1, 0]]);
  mix(out, nz(th), sr, 0.15, 0.5);
  return out;
}

function whistleLow(sr: number, rng: Rng): Float32Array {
  const L = 0.9;
  const fr = (t: number): number => 420 + 880 * Math.pow(Math.max(0, 1 - t / L), 1.4);
  const out = tone(sr, { dur: L, f0: 0, freq: fr, vibRate: 6, vibDepth: 0.35, attack: 0.04, release: 0.15 });
  mix(out, tone(sr, { dur: L, f0: 0, freq: (t) => 2 * fr(t), attack: 0.04, release: 0.15 }), sr, 0, 0.08);
  const br = noise(sr, L, rng);
  filt(br, sr, 'bp', fr, 10);
  shape(br, sr, [[0, 0], [0.04, 1], [L - 0.15, 1], [L, 0]]);
  mix(out, nz(br), sr, 0, 0.15);
  return out;
}

function whistleHigh(sr: number, rng: Rng): Float32Array {
  const L = 1.0;
  const fr = (t: number): number => (t < 0.8 ? 900 + 1500 * Math.pow((t % 0.4) / 0.4, 0.7) : 2400);
  const out = tone(sr, { dur: L, f0: 0, freq: fr, vibRate: 14, vibDepth: 0.4, attack: 0.02, release: 0.05 });
  mix(out, tone(sr, { dur: L, f0: 0, freq: (t) => 2 * fr(t), attack: 0.02, release: 0.05 }), sr, 0, 0.1);
  const br = noise(sr, L, rng);
  filt(br, sr, 'bp', fr, 10);
  mix(out, nz(br), sr, 0, 0.12);
  shape(out, sr, [[0, 0], [0.03, 1], [0.38, 1], [0.4, 0.3], [0.42, 1], [0.78, 1], [0.8, 0.5], [0.82, 1], [0.95, 1], [1, 0]]);
  return out;
}

function dash(sr: number, v: number, rng: Rng): Float32Array {
  const L = 0.26;
  const n = noise(sr, L, rng);
  filt(n, sr, 'bp', (t) => (v ? 3200 * Math.pow(0.2, t / L) : 400 * Math.pow(8, t / L)), 1.6);
  shape(n, sr, [[0, 0], [0.05, 1], [L, 0]]);
  nz(n);
  const air = noise(sr, L, rng);
  filt(air, sr, 'hp', 5000, 0.7);
  shape(air, sr, [[0, 0], [0.04, 1], [0.15, 0]]);
  mix(n, nz(air), sr, 0, 0.15);
  return n;
}

const METAL: readonly (readonly [number, number, number])[] = [
  [1, 0.6, 0.5],
  [2.41, 0.4, 0.3],
  [3.86, 0.3, 0.2],
  [5.3, 0.2, 0.12],
];

function dashBoom(sr: number, v: number, rng: Rng): Float32Array {
  const out = buf(sr, 1.1);
  const boom = tone(sr, { dur: 0.9, f0: 0, freq: (t) => 32 + 70 * Math.exp(-t / 0.08), decay: 0.25, attack: 0.002 });
  mix(out, nz(boom), sr, 0, 1);
  const nn = noise(sr, 0.6, rng);
  lp1(nn, sr, 450);
  lp1(nn, sr, 450);
  expEnv(nn, sr, 0.001, 0.12);
  mix(out, nz(nn), sr, 0, 0.7);
  if (v === 0) {
    mix(out, nz(bell(sr, 380, 0.8, METAL)), sr, 0.06, 0.35);
    mix(out, nz(bell(sr, 520, 0.7, METAL)), sr, 0.25, 0.25);
  } else {
    for (let g = 0; g < 14; g++) {
      const at = 0.08 + Math.pow(rng(), 1.5) * 0.6;
      const r = noise(sr, 0.03, rng);
      filt(r, sr, 'bp', 600 + rng() * 1800, 3);
      expEnv(r, sr, 0.0005, 0.006);
      mix(out, nz(r), sr, at, 0.3 * (1 - (at - 0.08) / 0.7));
    }
    const oof = voice(sr, { dur: 0.28, f0: 150, f1: 90, v0: V.uh, v1: V.u, breath: 0.25, attack: 0.01, release: 0.1 }, rng);
    mix(out, nz(oof), sr, 0.08, 0.5);
  }
  return out;
}

function capture(sr: number, rng: Rng): Float32Array {
  const out = buf(sr, 1.5);
  const boing = tone(sr, {
    dur: 0.7,
    f0: 0,
    freq: (t) => 210 * (1 + 0.3 * Math.exp(-t / 0.3) * Math.sin(TAU * 13 * t)) * (1 + 0.5 * t),
    wave: 'tri',
    decay: 0.35,
    attack: 0.003,
  });
  mix(out, nz(boing), sr, 0, 0.8);
  const notes = [1047, 1319, 1568, 2093];
  const BELLP = [[1, 1, 0.35], [2, 0.3, 0.15], [3.01, 0.15, 0.08]] as const;
  notes.forEach((f, i) => {
    mix(out, nz(bell(sr, f, i === 3 ? 0.8 : 0.5, BELLP)), sr, 0.3 + i * 0.085, 0.45);
  });
  for (let s = 0; s < 6; s++) {
    mix(out, tone(sr, { dur: 0.15, f0: 3000 + rng() * 2500, decay: 0.03, attack: 0.001 }), sr, 0.7 + rng() * 0.4, 0.15);
  }
  return out;
}

function ghostThrow(sr: number, rng: Rng): Float32Array {
  const L = 0.9;
  const out = buf(sr, L + 0.4);
  const n = noise(sr, L, rng);
  filt(n, sr, 'bp', (t) => 300 + 1200 * Math.sin(Math.PI * Math.min(1, t / L)), 4);
  shape(n, sr, [[0, 0], [0.3, 1], [L, 0]]);
  mix(out, nz(n), sr, 0, 0.7);
  const pad = buf(sr, L);
  for (const [f, g] of [[660, 1], [663.5, 0.8], [990, 0.5]] as const) {
    mix(pad, tone(sr, { dur: L, f0: f, f1: f * 1.12, vibRate: 5, vibDepth: 0.4, attack: 0.25, release: 0.4 }), sr, 0, g);
  }
  for (let i = 0; i < pad.length; i++) pad[i] *= 0.6 + 0.4 * Math.sin((TAU * 7 * i) / sr);
  mix(out, nz(pad), sr, 0, 0.35);
  echo(out, sr, 0.11, 0.35, 0.4);
  return out;
}

function ghostImpact(sr: number, v: number, rng: Rng): Float32Array {
  const out = buf(sr, 0.85);
  const n = noise(sr, 0.35, rng);
  filt(n, sr, 'bp', (t) => (v ? 2400 : 1800) * Math.pow(0.12, Math.min(1, t / 0.3)), 2);
  expEnv(n, sr, 0.002, 0.08);
  mix(out, nz(n), sr, 0, 1);
  const f0 = v ? 420 : 320;
  const sq = tone(sr, { dur: 0.4, f0, f1: f0 * 0.28, sweep: 0.3, vibRate: 12, vibDepth: 2, decay: 0.2, attack: 0.004 });
  mix(out, nz(sq), sr, 0, 0.6);
  if (v === 1) {
    for (let b = 0; b < 5; b++) {
      const fb = 300 + rng() * 500;
      mix(out, tone(sr, { dur: 0.06, f0: fb, f1: fb * 1.8, sweep: 0.03, decay: 0.015 }), sr, 0.1 + rng() * 0.3, 0.3);
    }
  }
  echo(out, sr, 0.09, 0.3, 0.35);
  return out;
}

// ---------------------------------------------------------------------------
// World / feedback
// ---------------------------------------------------------------------------

function beacon(sr: number, rng: Rng): Float32Array {
  const out = buf(sr, 2.0);
  const c = noise(sr, 0.01, rng);
  filt(c, sr, 'hp', 3000, 0.7);
  expEnv(c, sr, 0.0002, 0.002);
  mix(out, nz(c), sr, 0, 0.3);
  const ding = bell(sr, 1568, 2.0, [
    [1, 1, 1.5],
    [1.0025, 0.4, 1.4],
    [2.03, 0.45, 0.8],
    [2.76, 0.35, 0.55],
    [4.07, 0.22, 0.3],
    [5.43, 0.15, 0.18],
  ]);
  mix(out, nz(ding), sr, 0, 1);
  return out;
}

function refill(sr: number, rng: Rng): Float32Array {
  const out = buf(sr, 0.95);
  const times = [0, 0.1, 0.17, 0.33, 0.42, 0.6];
  const P = [[1, 1, 0.12], [2.32, 0.5, 0.07], [4.1, 0.25, 0.04]] as const;
  for (const t0 of times) {
    const at = t0 + rng() * 0.02;
    const f = 2300 + rng() * 1600;
    const g = 0.6 + rng() * 0.4;
    mix(out, nz(bell(sr, f, 0.3, P)), sr, at, g);
    const c = noise(sr, 0.005, rng);
    filt(c, sr, 'hp', 4000, 0.7);
    expEnv(c, sr, 0.0002, 0.001);
    mix(out, nz(c), sr, at, 0.3 * g);
    mix(out, tone(sr, { dur: 0.05, f0: 300 + rng() * 80, decay: 0.02 }), sr, at, 0.15);
  }
  return out;
}

function stun(sr: number, rng: Rng): Float32Array {
  const L = 1.0;
  const out = buf(sr, L);
  for (let i = 0; i < 8; i++) {
    const base = i % 2 ? 3000 : 2400;
    const at = i * 0.125;
    const tw = tone(sr, { dur: 0.08, f0: 0, freq: (t) => base + 1500 * Math.sin(Math.PI * Math.min(1, t / 0.07)), attack: 0.005, release: 0.02 });
    mix(out, tw, sr, at, 0.7 * (0.6 + 0.4 * Math.sin(TAU * at + i)));
  }
  for (let s = 0; s < 5; s++) {
    mix(out, tone(sr, { dur: 0.12, f0: 4000 + rng() * 2000, decay: 0.04, attack: 0.001 }), sr, 0.05 + rng() * 0.8, 0.2);
  }
  return out;
}

const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

function brass(sr: number, f: number, dur: number, vib = 0): Float32Array {
  const a = tone(sr, { dur, f0: f, wave: 'saw', attack: 0.02, release: 0.08, vibRate: 5.5, vibDepth: vib });
  mix(a, tone(sr, { dur, f0: f * 1.004, wave: 'saw', attack: 0.02, release: 0.08, vibRate: 5.5, vibDepth: vib }), sr, 0, 0.7);
  filt(a, sr, 'lp', (t) => 900 + 3000 * Math.min(1, t / 0.05) * Math.exp(-t / 0.4), 1.2);
  return a;
}

function lead(sr: number, f: number, dur: number, wave: Wave = 'square', vib = 0, f1?: number): Float32Array {
  const a = tone(sr, { dur, f0: f, f1, wave, attack: 0.005, decay: dur * 0.7, release: 0.05, vibRate: 5.5, vibDepth: vib });
  lp1(a, sr, 2500);
  return a;
}

function marimba(sr: number, f: number, dur: number): Float32Array {
  const a = tone(sr, { dur, f0: f, decay: Math.min(0.3, dur * 0.6), attack: 0.001, release: 0.03 });
  mix(a, tone(sr, { dur: Math.min(dur, 0.1), f0: f * 4, decay: 0.03, attack: 0.001 }), sr, 0, 0.2);
  mix(a, tone(sr, { dur: Math.min(dur, 0.05), f0: f * 10, decay: 0.008, attack: 0.0005 }), sr, 0, 0.05);
  return a;
}

function countdownTick(sr: number, rng: Rng): Float32Array {
  const out = tone(sr, { dur: 0.12, f0: 1150, decay: 0.02, attack: 0.0005 });
  mix(out, tone(sr, { dur: 0.05, f0: 2600, decay: 0.006, attack: 0.0005 }), sr, 0, 0.4);
  const c = noise(sr, 0.005, rng);
  filt(c, sr, 'hp', 3000, 0.7);
  expEnv(c, sr, 0.0002, 0.001);
  mix(out, c, sr, 0, 0.3);
  return out;
}

function huntStart(sr: number, rng: Rng): Float32Array {
  const out = buf(sr, 1.6);
  [67, 72, 76].forEach((m, i) => mix(out, nz(brass(sr, midi(m), 0.14)), sr, i * 0.09, 0.55));
  for (const m of [76, 79, 84]) mix(out, nz(brass(sr, midi(m), 1.15, 0.3)), sr, 0.27, 0.4);
  const cr = noise(sr, 1.2, rng);
  filt(cr, sr, 'hp', 5000, 0.7);
  expEnv(cr, sr, 0.001, 0.45);
  mix(out, nz(cr), sr, 0.27, 0.3);
  mix(out, nz(tone(sr, { dur: 0.3, f0: 0, freq: (t) => 45 + 110 * Math.exp(-t / 0.025), decay: 0.1, attack: 0.001 })), sr, 0.27, 0.6);
  return out;
}

function matchWin(sr: number, rng: Rng): Float32Array {
  const out = buf(sr, 2.4);
  const mel: readonly (readonly [number, number, number])[] = [
    [0, 72, 0.12], [0.12, 76, 0.12], [0.24, 79, 0.12], [0.36, 84, 0.22], [0.6, 79, 0.12], [0.72, 84, 1.3],
  ];
  for (const [t, m, d] of mel) {
    mix(out, nz(lead(sr, midi(m), d, 'square', d > 1 ? 0.3 : 0)), sr, t, 0.4);
    mix(out, nz(marimba(sr, midi(m + 12), Math.min(0.6, d + 0.3))), sr, t, 0.25);
  }
  for (const m of [60, 64, 67]) mix(out, nz(brass(sr, midi(m), 1.6, 0.2)), sr, 0.6, 0.22);
  for (let s = 0; s < 8; s++) {
    mix(out, tone(sr, { dur: 0.2, f0: 2500 + rng() * 3000, decay: 0.05, attack: 0.001 }), sr, 0.75 + rng() * 1.0, 0.12);
  }
  return out;
}

function matchLose(sr: number): Float32Array {
  const out = buf(sr, 2.4);
  const mel: readonly (readonly [number, number, number])[] = [[0, 67, 0.3], [0.3, 63, 0.3], [0.6, 60, 0.3], [0.9, 55, 1.4]];
  for (const [t, m, d] of mel) {
    const last = d > 1;
    mix(out, nz(lead(sr, midi(m), d, 'tri', last ? 0.5 : 0, last ? midi(m) * 0.97 : undefined)), sr, t, 0.6);
  }
  mix(out, nz(lead(sr, midi(43), 1.4, 'tri')), sr, 0.9, 0.35);
  return out;
}

function caughtCard(sr: number, rng: Rng): Float32Array {
  const out = buf(sr, 3.1);
  const f = [233.08, 220, 207.65, 196];
  const at = [0, 0.55, 1.1, 1.65];
  const dur = [0.5, 0.5, 0.5, 1.35];
  for (let i = 0; i < 4; i++) {
    const last = i === 3;
    const w = voice(sr, {
      dur: dur[i],
      f0: f[i],
      f1: f[i] * (last ? 0.97 : 0.985),
      v0: V.u,
      v1: V.a,
      morph: [0, 0.35],
      breath: 0.05,
      vibRate: 5,
      vibDepth: last ? 0.6 : 0.1,
      jitter: 0.005,
      attack: 0.03,
      release: last ? 0.4 : 0.08,
    }, rng);
    mix(out, nz(w), sr, at[i], 0.8);
    const body = tone(sr, { dur: dur[i], f0: f[i], f1: f[i] * (last ? 0.97 : 0.985), wave: 'saw', attack: 0.03, release: last ? 0.4 : 0.08, vibRate: 5, vibDepth: last ? 0.6 : 0.1 });
    lp1(body, sr, 700);
    mix(out, nz(body), sr, at[i], 0.25);
  }
  return out;
}

function uiClick(sr: number, rng: Rng): Float32Array {
  const out = tone(sr, { dur: 0.05, f0: 1800, f1: 1200, sweep: 0.02, decay: 0.008, attack: 0.0005 });
  const c = noise(sr, 0.004, rng);
  filt(c, sr, 'hp', 3000, 0.7);
  expEnv(c, sr, 0.0002, 0.0008);
  mix(out, c, sr, 0, 0.3);
  return out;
}

function uiReady(sr: number): Float32Array {
  const out = buf(sr, 0.45);
  mix(out, nz(marimba(sr, 880, 0.3)), sr, 0, 0.8);
  mix(out, nz(marimba(sr, 1318.5, 0.35)), sr, 0.09, 1);
  return out;
}

function uiJoin(sr: number): Float32Array {
  const out = buf(sr, 0.32);
  mix(out, tone(sr, { dur: 0.12, f0: 400, f1: 1000, sweep: 0.08, decay: 0.05, attack: 0.002 }), sr, 0, 0.8);
  mix(out, tone(sr, { dur: 0.18, f0: 600, f1: 1400, sweep: 0.08, decay: 0.06, attack: 0.002 }), sr, 0.1, 1);
  return out;
}

// ---------------------------------------------------------------------------
// Phase 2: traps, power-ups, map events
// ---------------------------------------------------------------------------

/** Rubber duck: two nasal squeaks through an "a"→"e" formant. */
function quack(sr: number, v: number, rng: Rng): Float32Array {
  const out = buf(sr, 0.42);
  const f0 = 520 + v * 60;
  for (let i = 0; i < 2; i++) {
    const q = voice(sr, { dur: 0.16 - i * 0.03, f0: f0 * (1 - i * 0.08), f1: f0 * 0.7, v0: V.a, v1: V.e, breath: 0.15, src: 'square', attack: 0.006, release: 0.04 }, rng);
    mix(out, nz(q), sr, i * 0.17, 1 - i * 0.25);
  }
  return out;
}

/** Banana slip: rising whistle-y swoop and a bump. */
function slip(sr: number, rng: Rng): Float32Array {
  const out = buf(sr, 0.75);
  mix(out, tone(sr, { dur: 0.35, f0: 300, f1: 1800, sweep: 0.3, wave: 'tri', attack: 0.01, release: 0.05, vibRate: 18, vibDepth: 0.6 }), sr, 0, 0.7);
  const thud = tone(sr, { dur: 0.25, f0: 140, f1: 55, sweep: 0.12, decay: 0.08 });
  mix(out, thud, sr, 0.38, 1);
  const n = noise(sr, 0.12, rng);
  filt(n, sr, 'lp', 900, 0.7);
  expEnv(n, sr, 0.001, 0.03);
  mix(out, nz(n), sr, 0.38, 0.4);
  return out;
}

/** Mousetrap snap: sharp click, metal ring, wooden knock. */
function snap(sr: number, rng: Rng): Float32Array {
  const out = buf(sr, 0.45);
  const c = noise(sr, 0.02, rng);
  filt(c, sr, 'hp', 2500, 0.8);
  expEnv(c, sr, 0.0002, 0.004);
  mix(out, nz(c), sr, 0, 1);
  mix(out, nz(bell(sr, 2800, 0.35, [[1, 1, 0.08], [2.7, 0.4, 0.05], [5.2, 0.2, 0.03]])), sr, 0.002, 0.35);
  mix(out, tone(sr, { dur: 0.1, f0: 420, f1: 260, decay: 0.03 }), sr, 0.004, 0.6);
  return out;
}

/** One alarm-clock ring: a fast hammer between two bells. */
function alarm(sr: number): Float32Array {
  const out = buf(sr, 0.8);
  const P = [[1, 1, 0.2], [2.4, 0.5, 0.12], [3.9, 0.3, 0.06]] as const;
  for (let i = 0; i < 16; i++) mix(out, nz(bell(sr, i % 2 ? 2350 : 2650, 0.25, P)), sr, i * 0.04, 0.6);
  shape(out, sr, [[0, 1], [0.6, 1], [0.8, 0]]);
  return out;
}

function powerGet(sr: number): Float32Array {
  const out = buf(sr, 0.6);
  [72, 76, 79, 84].forEach((m, i) => mix(out, nz(marimba(sr, midi(m), 0.3)), sr, i * 0.07, 0.8));
  mix(out, tone(sr, { dur: 0.35, f0: midi(96), wave: 'tri', decay: 0.12, vibRate: 9, vibDepth: 0.3 }), sr, 0.28, 0.3);
  return out;
}

function powerUse(sr: number, rng: Rng): Float32Array {
  const out = buf(sr, 0.45);
  mix(out, tone(sr, { dur: 0.3, f0: 300, f1: 1400, sweep: 0.25, wave: 'saw', attack: 0.005, release: 0.08 }), sr, 0, 0.35);
  const n = noise(sr, 0.3, rng);
  filt(n, sr, 'bp', (t) => 800 + t * 6000, 2);
  shape(n, sr, [[0, 0], [0.05, 1], [0.3, 0]]);
  mix(out, nz(n), sr, 0, 0.5);
  return out;
}

function eventStart(sr: number): Float32Array {
  const out = buf(sr, 1.1);
  [[0, 67], [0.14, 67], [0.28, 72], [0.5, 79]].forEach(([at, m]) => mix(out, nz(brass(sr, midi(m), at === 0.5 ? 0.5 : 0.12, at === 0.5 ? 0.3 : 0)), sr, at, 0.8));
  return out;
}

// ---------------------------------------------------------------------------
// Music loops (seamless: notes are wrap-mixed around the loop point)
// ---------------------------------------------------------------------------

type Put = (b: Float32Array, beat: number, gain: number) => void;

function musicLoop(sr: number, bpm: number, bars: number, write: (put: Put, spb: number) => void): Float32Array {
  const spb = 60 / bpm;
  const L = Math.round(bars * 4 * spb * sr);
  const out = new Float32Array(L);
  const put: Put = (b, beat, gain) => {
    const at = Math.round(beat * spb * sr) % L;
    const n1 = Math.min(b.length, L - at);
    for (let i = 0; i < n1; i++) out[at + i] += b[i] * gain;
    for (let i = n1; i < b.length; i++) out[i - n1] += b[i] * gain;
  };
  write(put, spb);
  return out;
}

function memo(): (key: string, make: () => Float32Array) => Float32Array {
  const cache = new Map<string, Float32Array>();
  return (key, make) => {
    let b = cache.get(key);
    if (!b) {
      b = make();
      cache.set(key, b);
    }
    return b;
  };
}

function kick(sr: number): Float32Array {
  return nz(tone(sr, { dur: 0.3, f0: 0, freq: (t) => 45 + 110 * Math.exp(-t / 0.025), decay: 0.11, attack: 0.001 }));
}

function hat(sr: number, rng: Rng, tau: number): Float32Array {
  const b = noise(sr, tau * 5, rng);
  filt(b, sr, 'hp', 7000, 0.7);
  expEnv(b, sr, 0.0005, tau);
  return nz(b);
}

function rim(sr: number, rng: Rng): Float32Array {
  const b = noise(sr, 0.12, rng);
  filt(b, sr, 'bp', 1900, 2.5);
  expEnv(b, sr, 0.0005, 0.025);
  nz(b);
  mix(b, tone(sr, { dur: 0.06, f0: 820, decay: 0.012, attack: 0.0005 }), sr, 0, 0.5);
  return nz(b);
}

function shaker(sr: number, rng: Rng): Float32Array {
  const b = noise(sr, 0.08, rng);
  filt(b, sr, 'bp', 6500, 1.2);
  shape(b, sr, [[0, 0], [0.012, 1], [0.07, 0]]);
  return nz(b);
}

function bassNote(sr: number, f: number, dur: number): Float32Array {
  const a = tone(sr, { dur, f0: f, wave: 'tri', decay: 0.35, attack: 0.004, release: 0.03 });
  const s = tone(sr, { dur, f0: f, wave: 'saw', decay: 0.06, attack: 0.002, release: 0.03 });
  lp1(s, sr, 900);
  mix(a, s, sr, 0, 0.4);
  return nz(a);
}

function pizz(sr: number, f: number, dur: number, rng: Rng, bright: number, tau: number): Float32Array {
  const b = ks(sr, f, dur, rng, 0.995, bright);
  expEnv(b, sr, 0.001, tau);
  return nz(b);
}

function musicLobby(sr: number, _v: number, rng: Rng): Float32Array {
  const chords = [[60, 64, 67], [57, 60, 64], [57, 60, 65], [55, 59, 62], [60, 64, 67], [57, 60, 64], [57, 62, 65], [55, 59, 62]];
  const roots = [36, 45, 41, 43, 36, 45, 38, 43];
  const bassPat = [[0, 0, 0.9], [1.5, 7, 0.4], [2, 12, 0.9], [3, 7, 0.5], [3.5, 0, 0.4]] as const;
  const rhythms = [[0, 1, 1.5, 2, 3], [0, 0.5, 1, 2.5, 3, 3.5], [0, 1.5, 2, 3], [0.5, 1, 1.5, 2, 2.5]];
  const pent = [67, 69, 72, 74, 76, 79, 81, 84];
  return musicLoop(sr, 110, 8, (put, spb) => {
    const get = memo();
    const K = get('k', () => kick(sr));
    const R = get('r', () => rim(sr, rng));
    const S = get('s', () => shaker(sr, rng));
    let idx = 3;
    for (let bar = 0; bar < 8; bar++) {
      const b0 = bar * 4;
      put(K, b0, 0.8);
      put(K, b0 + 2, 0.7);
      if (bar % 2 === 1) put(K, b0 + 3.5, 0.45);
      put(R, b0 + 1, 0.3);
      put(R, b0 + 3, 0.3);
      for (let e = 0; e < 8; e++) put(S, b0 + e * 0.5, e % 2 ? 0.16 : 0.08);
      for (const [bt, semi, lb] of bassPat) {
        const m = roots[bar] + semi;
        put(get(`b${m}:${lb}`, () => bassNote(sr, midi(m), lb * spb)), b0 + bt, 0.55);
      }
      for (const bt of [1, 2.5, 3]) {
        chords[bar].forEach((m, j) => {
          put(get(`p${m}`, () => pizz(sr, midi(m), 0.5, rng, 0.6, 0.18)), b0 + bt + j * 0.03, 0.16);
        });
      }
      const resolve = bar % 4 === 3;
      const rh = resolve ? [0, 1, 2] : rhythms[Math.floor(rng() * rhythms.length)];
      rh.forEach((bt, j) => {
        idx = Math.min(pent.length - 1, Math.max(0, idx + [-2, -1, 1, 1, 2][Math.floor(rng() * 5)]));
        let m = pent[idx];
        if (Number.isInteger(bt)) {
          // snap strong beats to the nearest chord tone
          let best = m;
          let bd = 99;
          for (const c of chords[bar]) {
            for (const o of [12, 24]) {
              const d = Math.abs(c + o - m);
              if (d < bd) {
                bd = d;
                best = c + o;
              }
            }
          }
          m = best;
        }
        const long = resolve && j === rh.length - 1;
        const d = long ? 1.6 : 0.45;
        put(get(`m${m}:${d}`, () => nz(marimba(sr, midi(m), d))), b0 + bt, 0.3);
      });
    }
  });
}

function musicHunt(sr: number, _v: number, rng: Rng): Float32Array {
  const roots = [45, 45, 50, 52, 45, 45, 41, 52, 50, 52];
  const minor = [true, true, true, false, true, true, false, false, true, false];
  const motifA = [[0, 7], [0.5, 8], [1, 7], [2, 3], [2.5, 2], [3, 0]] as const;
  const motifB = [[0, 0], [0.75, 3], [1.5, 7], [2, 6], [2.25, 5], [3, 3]] as const;
  return musicLoop(sr, 128, 10, (put, spb) => {
    const get = memo();
    const K = get('k', () => kick(sr));
    const R = get('r', () => rim(sr, rng));
    const H = get('h', () => hat(sr, rng, 0.015));
    const W = get('w', () => nz(marimba(sr, 1250, 0.08)));
    for (let bar = 0; bar < 10; bar++) {
      const b0 = bar * 4;
      const root = roots[bar];
      const next = roots[(bar + 1) % roots.length];
      const third = minor[bar] ? 3 : 4;
      put(K, b0, 0.5);
      put(K, b0 + 2.5, 0.35);
      put(R, b0 + 1, 0.18);
      put(R, b0 + 3, 0.18);
      for (let e = 0; e < 8; e++) put(H, b0 + e * 0.5, e % 2 ? 0.14 : 0.07);
      if (bar % 2 === 1) put(W, b0 + 3.75, 0.2);
      // tiptoe staccato bass with chromatic approach note
      const bass = [[0, root], [1, root + 12], [2, root + 7], [3, root + 12], [3.5, next - 1]] as const;
      for (const [bt, m] of bass) {
        put(get(`bp${m}`, () => pizz(sr, midi(m), 0.35, rng, 0.5, 0.1)), b0 + bt, 0.5);
      }
      // off-beat pizz stabs
      for (const bt of [0.5, 2.5]) {
        [12, 12 + third, 19].forEach((s, j) => {
          const m = root + s;
          put(get(`cp${m}`, () => pizz(sr, midi(m), 0.3, rng, 0.7, 0.07)), b0 + bt + j * 0.02, 0.13);
        });
      }
      // sneaky melody
      const motif = bar % 2 === 0 ? motifA : motifB;
      for (const [bt, s] of motif) {
        const m = root + 24 + s;
        put(get(`mp${m}`, () => pizz(sr, midi(m), 0.4, rng, 0.8, 0.12)), b0 + bt, 0.3);
        put(get(`mm${m}`, () => nz(marimba(sr, midi(m), 0.3))), b0 + bt, 0.08);
      }
      // tense tremolo pad
      for (const s of [12, 19]) {
        const m = root + s;
        put(get(`pad${m}`, () => {
          const d = 4 * spb + 0.3;
          const p = tone(sr, { dur: d, f0: midi(m), wave: 'tri', attack: 0.3, release: 0.35 });
          for (let i = 0; i < p.length; i++) p[i] *= 0.65 + 0.35 * Math.sin((TAU * 6 * i) / sr);
          return nz(p);
        }), b0, 0.1);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Clip registry
// ---------------------------------------------------------------------------

type Gen = (sr: number, v: number, rng: Rng) => Float32Array;

interface ClipDef {
  variants: number;
  gen: Gen;
  /** Target normalization peak (default 0.9). */
  peak?: number;
  music?: boolean;
  /** Keep exact length (no trailing-silence trim), e.g. loopable one-shots. */
  keepLength?: boolean;
}

const STEP_PEAK = 0.6; // walking is quieter than running

const DEFS: Record<ClipId, ClipDef> = {
  step_floor: { variants: 4, gen: (sr, v, r) => stepFloor(sr, v, r, false), peak: STEP_PEAK },
  step_water: { variants: 4, gen: (sr, v, r) => stepWater(sr, v, r, false), peak: STEP_PEAK },
  step_crumbs: { variants: 4, gen: (sr, v, r) => stepCrumbs(sr, v, r, false), peak: STEP_PEAK },
  step_rug: { variants: 4, gen: (sr, v, r) => stepRug(sr, v, r, false), peak: STEP_PEAK },
  run_floor: { variants: 3, gen: (sr, v, r) => stepFloor(sr, v, r, true) },
  run_water: { variants: 3, gen: (sr, v, r) => stepWater(sr, v, r, true) },
  run_crumbs: { variants: 3, gen: (sr, v, r) => stepCrumbs(sr, v, r, true) },
  run_rug: { variants: 3, gen: (sr, v, r) => stepRug(sr, v, r, true) },
  cough: { variants: COUGHS.length, gen: cough },
  throw: { variants: 3, gen: throwClip },
  bottle_break: { variants: 3, gen: (sr, v, r) => shatter(sr, v, r, 0.9) },
  bottle_hit: { variants: 2, gen: bottleHit },
  slingshot: { variants: 1, gen: (sr, _v, r) => slingshot(sr, r) },
  whistle_low: { variants: 1, gen: (sr, _v, r) => whistleLow(sr, r) },
  whistle_high: { variants: 1, gen: (sr, _v, r) => whistleHigh(sr, r) },
  dash: { variants: 2, gen: dash },
  dash_boom: { variants: 2, gen: dashBoom },
  capture: { variants: 1, gen: (sr, _v, r) => capture(sr, r) },
  ghost_throw: { variants: 1, gen: (sr, _v, r) => ghostThrow(sr, r) },
  ghost_impact: { variants: 2, gen: ghostImpact },
  beacon: { variants: 1, gen: (sr, _v, r) => beacon(sr, r) },
  refill: { variants: 1, gen: (sr, _v, r) => refill(sr, r) },
  stun: { variants: 1, gen: (sr, _v, r) => stun(sr, r), keepLength: true },
  quack: { variants: 2, gen: quack },
  slip: { variants: 1, gen: (sr, _v, r) => slip(sr, r) },
  snap: { variants: 1, gen: (sr, _v, r) => snap(sr, r) },
  alarm: { variants: 1, gen: (sr) => alarm(sr) },
  power_get: { variants: 1, gen: (sr) => powerGet(sr) },
  power_use: { variants: 1, gen: (sr, _v, r) => powerUse(sr, r) },
  event_start: { variants: 1, gen: (sr) => eventStart(sr) },
  countdown_tick: { variants: 1, gen: (sr, _v, r) => countdownTick(sr, r) },
  hunt_start: { variants: 1, gen: (sr, _v, r) => huntStart(sr, r) },
  match_win: { variants: 1, gen: (sr, _v, r) => matchWin(sr, r) },
  match_lose: { variants: 1, gen: (sr) => matchLose(sr) },
  caught_card: { variants: 1, gen: (sr, _v, r) => caughtCard(sr, r) },
  ui_click: { variants: 1, gen: (sr, _v, r) => uiClick(sr, r) },
  ui_ready: { variants: 1, gen: (sr) => uiReady(sr) },
  ui_join: { variants: 1, gen: (sr) => uiJoin(sr) },
  music_lobby: { variants: 1, gen: musicLobby, peak: 0.5, music: true },
  music_hunt: { variants: 1, gen: musicHunt, peak: 0.5, music: true },
};

export const CLIP_IDS: readonly ClipId[] = Object.freeze(Object.keys(DEFS) as ClipId[]);

export const CLIP_VARIANTS: Record<ClipId, number> = Object.freeze(
  Object.fromEntries(CLIP_IDS.map((id) => [id, DEFS[id].variants])) as Record<ClipId, number>,
);

/** Drop trailing near-silence (keeps a 10 ms tail). */
function trimTail(b: Float32Array, sr: number): Float32Array {
  const th = peakOf(b) * 0.0015;
  let end = b.length;
  while (end > 1 && Math.abs(b[end - 1]) <= th) end--;
  end = Math.min(b.length, end + Math.round(0.01 * sr));
  return end < b.length ? b.slice(0, end) : b;
}

function fade(b: Float32Array, sr: number, inSec: number, outSec: number): void {
  const nIn = Math.min(b.length, Math.max(1, Math.round(inSec * sr)));
  const nOut = Math.min(b.length, Math.max(1, Math.round(outSec * sr)));
  for (let i = 0; i < nIn; i++) b[i] *= i / nIn;
  for (let i = 0; i < nOut; i++) b[b.length - 1 - i] *= i / nOut;
}

/** Deterministic: same (id, sampleRate) → identical samples every call, on every machine. Mono, values within [-1, 1]. */
export function buildClip(id: ClipId, sampleRate: number): Float32Array[] {
  const def = DEFS[id];
  if (!def) throw new Error(`Unknown clip id: ${String(id)}`);
  const sr = sampleRate;
  const out: Float32Array[] = [];
  for (let v = 0; v < def.variants; v++) {
    const rng = mulberry32((hashString(id) ^ Math.imul(v + 1, 0x9e3779b1)) >>> 0);
    let b = def.gen(sr, v, rng);
    if (!def.music) {
      hp1(b, sr, 20); // remove DC / sub-sonic drift
      if (!def.keepLength) b = trimTail(b, sr);
      fade(b, sr, 0.002, 0.006);
    } else {
      // gentle tanh saturation tames drum peaks so the loop sits louder (pointwise → still seamless)
      nz(b, 1);
      for (let i = 0; i < b.length; i++) b[i] = Math.tanh(2 * b[i]);
    }
    nz(b, def.peak ?? 0.9);
    for (let i = 0; i < b.length; i++) {
      const x = b[i];
      b[i] = Number.isFinite(x) ? (x > 1 ? 1 : x < -1 ? -1 : x) : 0;
    }
    out.push(b);
  }
  return out;
}
