import { describe, expect, it } from 'vitest';
import { isVisibleTo, type PlayerTarget, type Viewer } from '../src/visibility';

const seeker: Viewer = { id: 's', role: 'seeker', life: 'alive' };
const hider: Viewer = { id: 'h', role: 'hider', life: 'alive' };
const ghost: Viewer = { id: 'g', role: 'hider', life: 'ghost' };

const aliveHider = (reveal = 0, stunned = false): PlayerTarget => ({ kind: 'player', id: 't', role: 'hider', life: 'alive', reveal, stunned });
const ghostT: PlayerTarget = { kind: 'player', id: 't', role: 'hider', life: 'ghost', reveal: 0, stunned: false };
const caughtT: PlayerTarget = { kind: 'player', id: 't', role: 'hider', life: 'caught', reveal: 0, stunned: false };
const seekerT: PlayerTarget = { kind: 'player', id: 't2', role: 'seeker', life: 'alive', reveal: 0, stunned: false };
const body = { kind: 'body' } as const;

describe('isVisibleTo — briefing §4 matrix (hunt phase)', () => {
  // Row: seeker
  it('seeker: living hider is invisible without reveal', () => expect(isVisibleTo(seeker, aliveHider(0), 'hunt')).toBe('hidden'));
  it('seeker: living hider shows as silhouette while revealed', () => expect(isVisibleTo(seeker, aliveHider(0.4), 'hunt')).toBe('silhouette'));
  it('seeker: stunned hider is fully visible', () => expect(isVisibleTo(seeker, aliveHider(0, true), 'hunt')).toBe('full'));
  it('seeker: never sees ghosts', () => expect(isVisibleTo(seeker, ghostT, 'hunt')).toBe('hidden'));
  it('seeker: sees bodies', () => expect(isVisibleTo(seeker, body, 'hunt')).toBe('full'));
  it('seeker: sees the caught player lying down', () => expect(isVisibleTo(seeker, caughtT, 'hunt')).toBe('full'));
  it('seeker: sees other seekers', () => expect(isVisibleTo(seeker, seekerT, 'hunt')).toBe('full'));

  // Row: living hider
  it('hider: sees living hiders normally', () => expect(isVisibleTo(hider, aliveHider(0), 'hunt')).toBe('full'));
  it('hider: sees stunned hiders', () => expect(isVisibleTo(hider, aliveHider(0, true), 'hunt')).toBe('full'));
  it('hider: sees ghosts translucent', () => expect(isVisibleTo(hider, ghostT, 'hunt')).toBe('translucent'));
  it('hider: sees bodies', () => expect(isVisibleTo(hider, body, 'hunt')).toBe('full'));
  it('hider: sees seekers', () => expect(isVisibleTo(hider, seekerT, 'hunt')).toBe('full'));

  // Row: ghost
  it('ghost: sees living hiders', () => expect(isVisibleTo(ghost, aliveHider(0), 'hunt')).toBe('full'));
  it('ghost: sees stunned hiders', () => expect(isVisibleTo(ghost, aliveHider(0, true), 'hunt')).toBe('full'));
  it('ghost: sees ghosts', () => expect(isVisibleTo(ghost, ghostT, 'hunt')).not.toBe('hidden'));
  it('ghost: sees bodies', () => expect(isVisibleTo(ghost, body, 'hunt')).toBe('full'));
  it('ghost: sees seekers', () => expect(isVisibleTo(ghost, seekerT, 'hunt')).toBe('full'));
});

describe('isVisibleTo — derived objects and phases', () => {
  it('a hider bottle in flight is visible to the seeker even when the owner is hidden', () => {
    expect(isVisibleTo(seeker, { kind: 'projectile', projectile: 'bottle', owner: aliveHider(0) }, 'hunt')).toBe('full');
  });
  it('a held bottle is visible to the seeker', () => {
    expect(isVisibleTo(seeker, { kind: 'effect', owner: aliveHider(0), heldBottle: true }, 'hunt')).toBe('full');
  });
  it('a ghost bottle follows the ghost rule (hidden from seekers)', () => {
    expect(isVisibleTo(seeker, { kind: 'projectile', projectile: 'ghostBottle', owner: ghostT }, 'hunt')).toBe('hidden');
    expect(isVisibleTo(hider, { kind: 'projectile', projectile: 'ghostBottle', owner: ghostT }, 'hunt')).toBe('full');
  });
  it('effects of a hidden hider stay hidden', () => {
    expect(isVisibleTo(seeker, { kind: 'effect', owner: aliveHider(0) }, 'hunt')).toBe('hidden');
  });
  it('the seeker is blind to hiders during the countdown, even if revealed', () => {
    expect(isVisibleTo(seeker, aliveHider(1), 'countdown')).toBe('hidden');
  });
  it('everyone is visible to everyone at match end', () => {
    expect(isVisibleTo(seeker, aliveHider(0), 'end')).toBe('full');
    expect(isVisibleTo(seeker, ghostT, 'end')).toBe('full');
  });
  it('a viewer always sees itself (ghost self is translucent)', () => {
    expect(isVisibleTo(ghost, { ...ghostT, id: 'g' }, 'hunt')).toBe('translucent');
    expect(isVisibleTo(hider, { ...aliveHider(0), id: 'h' }, 'hunt')).toBe('full');
  });
});
