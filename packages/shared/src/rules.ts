import type { MatchSettings } from './settings';

/** Distance-to-nearest-seeker multiplier shared by survival and boldness scoring. */
export function proximityMultiplier(d: number, s: MatchSettings): number {
  if (d <= s.nearDistance) return s.nearMultiplier;
  if (d <= s.midDistance) return s.midMultiplier;
  return s.farMultiplier;
}

/** Briefing §2: auto = 1 seeker up to 6 players, 2 from 7. Never more than humans or total − 1. */
export function seekerCountFor(totalPlayers: number, humans: number, setting: number): number {
  if (totalPlayers < 2) return 0;
  const wanted = setting > 0 ? setting : totalPlayers <= 6 ? 1 : 2;
  return Math.max(0, Math.min(wanted, humans, totalPlayers - 1));
}
