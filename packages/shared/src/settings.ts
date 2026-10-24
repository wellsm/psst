// Single source of truth for every tunable gameplay number.
// Units: meters, seconds, points. The lobby rules panel is generated from SETTING_DEFS.

export type SettingCategory =
  | 'match'
  | 'movement'
  | 'sonar'
  | 'sounds'
  | 'seeker'
  | 'hider'
  | 'ghost'
  | 'scoring'
  | 'map'
  | 'bots'
  | 'audio'
  | 'view'
  | 'powerups'
  | 'traps'
  | 'events';

export interface SettingDef {
  key: string;
  category: SettingCategory;
  default: number;
  min: number;
  max: number;
  step: number;
}

const def = (key: string, category: SettingCategory, d: number, min: number, max: number, step: number) =>
  ({ key, category, default: d, min, max, step }) as const;

export const SETTING_DEFS = [
  // match flow
  def('countdownDuration', 'match', 10, 5, 60, 1),
  def('huntDuration', 'match', 150, 30, 600, 5),
  def('matchEndDuration', 'match', 15, 5, 60, 1),
  def('minPlayers', 'match', 2, 1, 8, 1),
  def('seekerCount', 'match', 0, 0, 3, 1),
  def('caughtGhostDelay', 'match', 5, 1, 15, 0.5),

  // movement
  def('walkSpeed', 'movement', 3, 1, 8, 0.1),
  def('runSpeed', 'movement', 6, 3, 14, 0.1),
  def('accelTime', 'movement', 0.09, 0.01, 0.5, 0.01),
  def('playerRadius', 'movement', 0.4, 0.25, 0.6, 0.05),
  def('seekerStamina', 'movement', 6, 0, 20, 0.5),
  def('staminaRecoverThreshold', 'movement', 0.3, 0, 1, 0.05),
  def('ghostSpeed', 'movement', 8, 2, 16, 0.5),
  def('ghostBoostMultiplier', 'movement', 2, 1, 4, 0.1),

  // sonar
  def('revealRadius', 'sonar', 14, 4, 30, 0.5),
  def('revealDecay', 'sonar', 0.5, 0.1, 3, 0.05),
  def('revealAlphaRate', 'sonar', 4, 0.5, 20, 0.5),
  def('ringOpacity', 'sonar', 0.35, 0, 1, 0.05),
  def('ringDuration', 'sonar', 1.2, 0.3, 3, 0.1),
  def('ringScale', 'sonar', 1.2, 0.5, 2, 0.05),

  // sound emission
  def('footstepInterval', 'sounds', 0.5, 0.2, 2, 0.05),
  def('footstepIntensity', 'sounds', 0.4, 0, 1, 0.05),
  def('runStepInterval', 'sounds', 0.35, 0.1, 2, 0.05),
  def('runIntensity', 'sounds', 1, 0, 1, 0.05),
  def('noisyZoneMultiplier', 'sounds', 2.5, 1, 5, 0.1),
  def('voiceInterval', 'sounds', 0.8, 0.2, 3, 0.1),
  def('voiceIntensity', 'sounds', 0.35, 0, 1, 0.05),
  def('throwIntensity', 'sounds', 0.4, 0, 1, 0.05),
  def('bottleImpactIntensity', 'sounds', 0.8, 0, 1, 0.05),
  def('bottleHitIntensity', 'sounds', 1, 0, 1, 0.05),
  def('dashLaunchIntensity', 'sounds', 0.6, 0, 1, 0.05),
  def('dashMissIntensity', 'sounds', 1, 0, 1, 0.05),
  def('whistleIntensity', 'sounds', 1, 0, 1, 0.05),
  def('whistleDetectRadius', 'sounds', 14, 2, 30, 0.5),
  def('tauntIntensity', 'sounds', 0.6, 0, 1, 0.05),
  def('ghostImpactIntensity', 'sounds', 0.8, 0, 1, 0.05),

  // seeker kit
  def('ballSpeed', 'seeker', 30, 5, 60, 1),
  def('ballRange', 'seeker', 25, 5, 50, 1),
  def('ballCooldown', 'seeker', 2, 0.5, 15, 0.1),
  def('dashDistance', 'seeker', 5, 1, 12, 0.25),
  def('dashDuration', 'seeker', 0.45, 0.1, 1.5, 0.05),
  def('dashCooldown', 'seeker', 3, 0.5, 15, 0.25),
  def('dashHitRadius', 'seeker', 0.8, 0.2, 2, 0.05),
  def('captureTolerance', 'seeker', 1.5, 0, 3, 0.1),
  def('dashMissStun', 'seeker', 2, 0, 6, 0.25),

  // hider kit
  def('bottlesPerHider', 'hider', 2, 0, 5, 1),
  def('bottleSpeed', 'hider', 20, 5, 40, 1),
  def('bottleRange', 'hider', 15, 3, 30, 0.5),
  def('bottleStunDuration', 'hider', 2, 0.5, 5, 0.1),
  def('bottleRefillCooldown', 'hider', 20, 5, 120, 1),
  def('refillRange', 'hider', 3, 1, 6, 0.25),
  def('tauntCooldown', 'hider', 3, 0.5, 15, 0.25),

  // ghost
  def('ghostBottleCooldown', 'ghost', 10, 3, 60, 0.5),
  def('ghostStunSeeker', 'ghost', 2, 0.25, 5, 0.25),
  def('ghostStunHider', 'ghost', 1, 0.25, 5, 0.25),

  // scoring
  def('surviveBasePoints', 'scoring', 1, 0, 10, 0.1),
  def('nearDistance', 'scoring', 5, 1, 15, 0.5),
  def('nearMultiplier', 'scoring', 4, 0, 10, 0.25),
  def('midDistance', 'scoring', 10, 2, 30, 0.5),
  def('midMultiplier', 'scoring', 2, 0, 10, 0.25),
  def('farMultiplier', 'scoring', 0.25, 0, 5, 0.05),
  def('campingGrace', 'scoring', 15, 3, 60, 1),
  def('campingPenalty', 'scoring', 2, 0, 20, 0.5),
  def('campingMoveThreshold', 'scoring', 0.15, 0.05, 2, 0.05),
  def('boldnessFactor', 'scoring', 5, 0, 30, 0.5),
  def('boldnessCooldown', 'scoring', 1, 0.1, 10, 0.1),
  def('revealReward', 'scoring', 25, 0, 100, 1),
  def('revealRewardCooldown', 'scoring', 2, 0.1, 10, 0.1),
  def('captureReward', 'scoring', 150, 0, 500, 5),
  def('ghostHitReward', 'scoring', 25, 0, 100, 1),

  // map
  def('beaconInterval', 'map', 25, 10, 60, 1),
  def('beaconIntensity', 'map', 0.8, 0, 1, 0.05),
  def('bottleRefillStations', 'map', 3, 1, 10, 1),

  // bots
  def('botRetargetInterval', 'bots', 9, 2, 30, 0.5),
  def('botRunChance', 'bots', 0.25, 0, 1, 0.05),

  // audio (what the ears get = gameplay information)
  def('audioMaxRange', 'audio', 40, 10, 80, 1),
  def('footstepAudioRange', 'audio', 14, 3, 40, 1),
  def('runAudioRange', 'audio', 22, 5, 60, 1),
  def('voiceRange', 'audio', 30, 5, 80, 1),

  // view (how much of the world a player can see is gameplay information, so the host picks it)
  def('cameraMode', 'view', 2, 1, 2, 1),

  // power-ups (phase 2): earned every N points of gain, 1 slot
  def('powerUpPointThreshold', 'powerups', 150, 0, 1000, 10),
  def('powerInvisibleDuration', 'powerups', 10, 1, 30, 0.5),
  def('powerSpeedDuration', 'powerups', 5, 1, 30, 0.5),
  def('powerSpeedMultiplier', 'powerups', 2, 1, 4, 0.1),
  def('powerMuteDuration', 'powerups', 10, 1, 30, 0.5),
  def('powerTurboDuration', 'powerups', 20, 1, 60, 1),
  def('powerTurboDashMultiplier', 'powerups', 1.6, 1, 3, 0.1),
  def('powerCamoDuration', 'powerups', 10, 1, 30, 0.5),
  def('powerMegaphoneDuration', 'powerups', 5, 1, 30, 0.5),
  def('powerMegaphoneIntensity', 'powerups', 1, 0, 1, 0.05),
  def('powerJamDuration', 'powerups', 6, 1, 30, 0.5),
  def('powerJumpDuration', 'powerups', 10, 1, 30, 0.5),

  // traps (phase 2): seeded layout
  def('duckCount', 'traps', 12, 0, 30, 1),
  def('bananaCount', 'traps', 8, 0, 20, 1),
  def('mousetrapCount', 'traps', 6, 0, 20, 1),
  def('alarmCount', 'traps', 4, 0, 10, 1),
  def('trapGridSize', 'traps', 2.5, 1, 5, 0.5),
  def('trapMinSpacing', 'traps', 4, 1, 10, 0.5),
  def('trapRadius', 'traps', 0.6, 0.2, 1.5, 0.05),
  def('duckIntensity', 'traps', 0.7, 0, 1, 0.05),
  def('duckCooldown', 'traps', 1.5, 0.2, 10, 0.1),
  def('bananaStun', 'traps', 1.5, 0.25, 5, 0.25),
  def('slipIntensity', 'traps', 1, 0, 1, 0.05),
  def('bananaSlideDistance', 'traps', 3, 0, 8, 0.5),
  def('mousetrapStun', 'traps', 0.8, 0.25, 5, 0.05),
  def('mousetrapIntensity', 'traps', 0.9, 0, 1, 0.05),
  def('mousetrapRearm', 'traps', 6, 1, 30, 0.5),
  def('alarmRings', 'traps', 3, 1, 10, 1),
  def('alarmIntensity', 'traps', 0.7, 0, 1, 0.05),
  def('alarmRingInterval', 'traps', 1.1, 0.2, 5, 0.1),
  def('alarmRearm', 'traps', 10, 1, 60, 1),

  // map events (phase 2): at most mapEventCount per match, no repeats
  def('mapEventCount', 'events', 2, 0, 3, 1),
  def('mapEventFirstAt', 'events', 60, 5, 300, 5),
  def('mapEventGap', 'events', 60, 5, 300, 5),
  def('hotDuckDuration', 'events', 30, 5, 120, 1),
  def('hotDuckQuackInterval', 'events', 3, 0.5, 10, 0.5),
  def('hotDuckIntensity', 'events', 0.7, 0, 1, 0.05),
  def('hotDuckTouchRadius', 'events', 1.4, 0.5, 4, 0.1),
  def('hotDuckImmunity', 'events', 5, 0, 20, 0.5),
  def('invisibleTrapsDuration', 'events', 20, 5, 120, 1),
  def('tripleTrapsDuration', 'events', 20, 5, 120, 1),
] as const satisfies readonly SettingDef[];

export type SettingKey = (typeof SETTING_DEFS)[number]['key'];
export type MatchSettings = Record<SettingKey, number>;

export const SETTING_CATEGORIES: readonly SettingCategory[] = [
  'match', 'view', 'movement', 'sonar', 'sounds', 'seeker', 'hider', 'ghost', 'scoring', 'map', 'powerups', 'traps', 'events', 'bots', 'audio',
];

const DEF_BY_KEY = new Map<string, SettingDef>(SETTING_DEFS.map((d) => [d.key, d]));

export function getSettingDef(key: string): SettingDef | undefined {
  return DEF_BY_KEY.get(key);
}

export function defaultSettings(): MatchSettings {
  const s = {} as MatchSettings;
  for (const d of SETTING_DEFS) s[d.key] = d.default;
  return s;
}

/** Snap to step and clamp into [min, max]. Returns undefined for unknown keys or non-numbers. */
export function sanitizeSetting(key: string, value: unknown): number | undefined {
  const d = DEF_BY_KEY.get(key);
  if (!d || typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const stepped = Math.round((value - d.min) / d.step) * d.step + d.min;
  const clamped = Math.min(d.max, Math.max(d.min, stepped));
  return Math.round(clamped * 1e6) / 1e6;
}

/** Apply a partial update; ignores unknown keys; keeps derived invariants (min ≤ max pairs). */
export function applySettings(base: MatchSettings, patch: Record<string, unknown>): MatchSettings {
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const clean = sanitizeSetting(k, v);
    if (clean !== undefined) next[k as SettingKey] = clean;
  }
  if (next.runSpeed < next.walkSpeed) next.runSpeed = next.walkSpeed;
  if (next.midDistance < next.nearDistance) next.midDistance = next.nearDistance;
  return next;
}
