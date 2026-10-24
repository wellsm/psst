import { describe, expect, it } from 'vitest';
import { buildClip, CLIP_IDS, CLIP_VARIANTS, type ClipId } from './synth';

const SR = 44100;
const MUSIC: readonly ClipId[] = ['music_lobby', 'music_hunt'];

const built = new Map<ClipId, Float32Array[]>();
function clips(id: ClipId): Float32Array[] {
  let c = built.get(id);
  if (!c) {
    c = buildClip(id, SR);
    built.set(id, c);
  }
  return c;
}

function rms(b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < b.length; i++) s += b[i] * b[i];
  return Math.sqrt(s / b.length);
}

describe('synth', () => {
  it('exposes a variant count for every clip id', () => {
    expect(CLIP_IDS.length).toBeGreaterThan(0);
    expect(new Set(CLIP_IDS).size).toBe(CLIP_IDS.length);
    for (const id of CLIP_IDS) expect(CLIP_VARIANTS[id]).toBeGreaterThanOrEqual(1);
    expect(Object.keys(CLIP_VARIANTS).sort()).toEqual([...CLIP_IDS].sort());
    expect(CLIP_VARIANTS.cough).toBe(12);
  });

  it.each(CLIP_IDS)('%s builds with the declared number of variants', (id) => {
    const c = clips(id);
    expect(c.length).toBe(CLIP_VARIANTS[id]);
    for (const b of c) {
      expect(b).toBeInstanceOf(Float32Array);
      expect(b.length).toBeGreaterThan(0);
    }
  });

  it.each(CLIP_IDS)('%s samples are finite, within [-1, 1] and non-silent', (id) => {
    for (const b of clips(id)) {
      let bad = 0;
      for (let i = 0; i < b.length; i++) {
        const x = b[i];
        if (!Number.isFinite(x) || x < -1 || x > 1) bad++;
      }
      expect(bad).toBe(0);
      expect(rms(b)).toBeGreaterThan(0.005);
    }
  });

  it.each(CLIP_IDS)('%s has the expected duration', (id) => {
    for (const b of clips(id)) {
      const sec = b.length / SR;
      if (MUSIC.includes(id)) {
        expect(sec).toBeGreaterThanOrEqual(16);
        expect(sec).toBeLessThanOrEqual(24);
      } else {
        expect(sec).toBeLessThan(4);
      }
    }
  });

  it('is deterministic', () => {
    for (const id of CLIP_IDS) {
      const a = clips(id);
      const b = buildClip(id, SR);
      expect(b.length).toBe(a.length);
      for (let v = 0; v < a.length; v++) {
        expect(b[v].length).toBe(a[v].length);
        let diff = 0;
        for (let i = 0; i < a[v].length; i++) if (a[v][i] !== b[v][i]) diff++;
        expect(diff, `${id}[${v}]`).toBe(0);
      }
    }
  });

  it('cough variants differ from each other', () => {
    const sigs = clips('cough').map((b) => `${b.length}:${rms(b).toFixed(4)}`);
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});
