// The visibility matrix (briefing §4). Every render path and the server interest
// management go through isVisibleTo — never re-implement these rules elsewhere.

export type Role = 'seeker' | 'hider';
export type LifeState = 'alive' | 'caught' | 'ghost';
export type Phase = 'lobby' | 'countdown' | 'hunt' | 'end';
export type Visibility = 'full' | 'translucent' | 'silhouette' | 'hidden';

export interface Viewer {
  id: string;
  role: Role;
  life: LifeState;
}

export interface PlayerTarget {
  kind: 'player';
  id: string;
  role: Role;
  life: LifeState;
  reveal: number;
  stunned: boolean;
  /** Seeker under the invisibility power-up: hidden from hiders. */
  cloaked?: boolean;
}

export type ProjectileKind = 'bottle' | 'ball' | 'ghostBottle';

export type VisTarget =
  | PlayerTarget
  | { kind: 'body' }
  | { kind: 'projectile'; projectile: ProjectileKind; owner: PlayerTarget }
  /** Effects derived from a player (dust, stars, held bottle...). */
  | { kind: 'effect'; owner: PlayerTarget; heldBottle?: boolean };

function playerVisibility(viewer: Viewer, t: PlayerTarget, phase: Phase): Visibility {
  if (phase === 'end' || phase === 'lobby') return 'full';
  if (t.id === viewer.id) return t.life === 'ghost' ? 'translucent' : 'full';
  if (t.role === 'seeker' && t.cloaked && viewer.role === 'hider') return 'hidden';
  if (viewer.role === 'seeker') {
    if (t.role === 'seeker') return 'full';
    if (t.life === 'ghost') return 'hidden';
    if (t.life === 'caught') return 'full';
    if (phase === 'countdown') return 'hidden';
    if (t.stunned) return 'full';
    return t.reveal > 0 ? 'silhouette' : 'hidden';
  }
  // Viewer is a hider (alive, caught or ghost): sees everyone; ghosts look translucent.
  return t.life === 'ghost' ? 'translucent' : 'full';
}

export function isVisibleTo(viewer: Viewer, target: VisTarget, phase: Phase): Visibility {
  switch (target.kind) {
    case 'player':
      return playerVisibility(viewer, target, phase);
    case 'body':
      return 'full';
    case 'projectile': {
      // A living hider's bottle betrays its invisible owner: visible to everyone.
      if (target.projectile === 'bottle' || target.projectile === 'ball') return 'full';
      const v = playerVisibility(viewer, target.owner, phase);
      return v === 'hidden' ? 'hidden' : 'full';
    }
    case 'effect': {
      if (target.heldBottle && target.owner.life === 'alive') return 'full';
      const v = playerVisibility(viewer, target.owner, phase);
      return v === 'silhouette' ? 'full' : v;
    }
  }
}

export const isShown = (v: Visibility) => v !== 'hidden';
