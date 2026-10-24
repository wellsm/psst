import type { MatchSettings } from './settings';
import type { Role } from './visibility';

// Phase 2 power-ups (briefing §14): one slot, earned by points, used with the usePower key.
export type PowerKind = 'invisible' | 'speed' | 'mute' | 'turbo' | 'camo' | 'megaphone' | 'jam' | 'jump';

export const POWER_KINDS: readonly PowerKind[] = ['invisible', 'speed', 'mute', 'turbo', 'camo', 'megaphone', 'jam', 'jump'];

export const POWERS_BY_ROLE: Record<Role, readonly PowerKind[]> = {
  seeker: ['invisible', 'speed', 'mute', 'turbo', 'camo'],
  hider: ['speed', 'mute', 'megaphone', 'jam', 'jump'],
};

export function powerDuration(kind: PowerKind, s: MatchSettings): number {
  switch (kind) {
    case 'invisible': return s.powerInvisibleDuration;
    case 'speed': return s.powerSpeedDuration;
    case 'mute': return s.powerMuteDuration;
    case 'turbo': return s.powerTurboDuration;
    case 'camo': return s.powerCamoDuration;
    case 'megaphone': return s.powerMegaphoneDuration;
    case 'jam': return s.powerJamDuration;
    case 'jump': return s.powerJumpDuration;
  }
}

/** Powers whose timer lives in MoveState (the client predicts them). */
export const MOVE_POWERS = { speed: 'speedLeft', turbo: 'turboLeft', jump: 'jumpLeft' } as const;
