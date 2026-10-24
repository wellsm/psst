import { JUMP, type LifeState, type MapEventKind, type MatchSettings, type MeState, type Phase, type PowerKind, type Role, type SnapEvent } from '@psst/shared';

export interface HudInput {
  phase: Phase;
  phaseLeft: number;
  beaconLeft: number;
  me: MeState | null;
  settings: MatchSettings;
  scores: { id: string; name: string; score: number; role: Role; life: LifeState; color: number }[];
  myId: string;
  nearCrate: boolean;
  fireHeld: boolean;
  voiceProblem: boolean;
  /** Seconds since the latest snapshot (advances local timers between snapshots). */
  since: number;
  event: SnapEvent | null;
}

export interface Cooldown {
  ready: boolean;
  /** Remaining fraction in [0,1] (0 = ready). */
  frac: number;
  left: number;
}

export interface HudModel {
  timer: { visible: boolean; seconds: number };
  scoreboard: { visible: boolean; rows: { id: string; name: string; score: number; caught: boolean; ghost: boolean; me: boolean; seeker: boolean; color: number }[] };
  ownScore: { visible: boolean; value: number };
  beacon: { visible: boolean; seconds: number };
  seekerActions: { visible: boolean; ball: Cooldown; dash: Cooldown; jump: Cooldown; stamina: { frac: number; exhausted: boolean; infinite: boolean } };
  hiderActions: { visible: boolean; bottles: number; maxBottles: number; taunt: Cooldown; jump: Cooldown; refill: { visible: boolean; cd: Cooldown } };
  ghostActions: { visible: boolean; bottle: Cooldown };
  caughtCard: { visible: boolean; seconds: number };
  countdownCover: { visible: boolean; n: number };
  hiderCountdown: { visible: boolean; n: number };
  reticle: { visible: boolean };
  bottleRange: { visible: boolean; radius: number };
  voiceWarning: { visible: boolean };
  endScreen: { visible: boolean; seconds: number };
  powerSlot: { visible: boolean; power: PowerKind | null; frac: number };
  effects: { visible: boolean; list: { k: PowerKind; left: number }[] };
  jammed: { visible: boolean; seconds: number };
  mapEvent: { visible: boolean; k: MapEventKind | null; seconds: number; onMe: boolean };
}

export type HudElement = Exclude<keyof HudModel, never>;

const cd = (left: number, total: number): Cooldown => {
  const l = Math.max(0, left);
  return { ready: l <= 0, frac: total > 0 ? Math.min(1, l / total) : 0, left: l };
};

export function computeHud(i: HudInput): HudModel {
  const s = i.settings;
  const me = i.me;
  const live = i.phase === 'countdown' || i.phase === 'hunt';
  const role = me?.role ?? 'hider';
  const life = me?.life ?? 'alive';
  const seeker = role === 'seeker';
  const aliveHider = role === 'hider' && life === 'alive';
  const ghost = life === 'ghost';
  const adv = (v: number) => v - i.since;

  const ball = cd(adv(me?.ballCd ?? 0), s.ballCooldown);
  const dash = cd(adv(me?.dashCdLeft ?? 0), s.dashCooldown);
  const taunt = cd(adv(me?.tauntCd ?? 0), s.tauntCooldown);
  // In the air counts as not ready; the cooldown starts on landing.
  const jump = me && me.airLeft > 0 ? cd(1, 1) : cd(adv(me?.jumpCdLeft ?? 0), JUMP.cooldown);
  const refill = cd(adv(me?.refillCd ?? 0), s.bottleRefillCooldown);
  const ghostBottle = cd(adv(me?.ghostCd ?? 0), s.ghostBottleCooldown);
  const bottles = me?.bottles ?? 0;

  const canAim = life !== 'caught' && !(seeker && i.phase === 'countdown');
  const holdingBottle = i.fireHeld && i.phase === 'hunt' && ((aliveHider && bottles > 0) || (ghost && ghostBottle.ready));

  return {
    timer: { visible: live, seconds: Math.max(0, adv(i.phaseLeft)) },
    scoreboard: {
      visible: live,
      rows: [...i.scores]
        .sort((a, b) => b.score - a.score)
        .map((r) => ({ id: r.id, name: r.name, score: r.score, caught: r.role === 'hider' && r.life !== 'alive', ghost: r.life === 'ghost', me: r.id === i.myId, seeker: r.role === 'seeker', color: r.color })),
    },
    ownScore: { visible: live, value: i.scores.find((r) => r.id === i.myId)?.score ?? 0 },
    beacon: { visible: live, seconds: Math.max(0, adv(i.beaconLeft)) },
    seekerActions: {
      visible: live && seeker,
      ball,
      dash,
      jump,
      stamina: { frac: s.seekerStamina > 0 ? (me?.stamina ?? 0) / s.seekerStamina : 1, exhausted: !!me?.exhausted, infinite: s.seekerStamina <= 0 },
    },
    hiderActions: {
      visible: live && aliveHider,
      bottles,
      maxBottles: s.bottlesPerHider,
      taunt,
      jump,
      refill: { visible: live && aliveHider && i.nearCrate && bottles < s.bottlesPerHider, cd: refill },
    },
    ghostActions: { visible: i.phase === 'hunt' && ghost, bottle: ghostBottle },
    caughtCard: { visible: live && life === 'caught', seconds: Math.max(0, adv(me?.caughtLeft ?? 0)) },
    countdownCover: { visible: i.phase === 'countdown' && seeker, n: Math.ceil(Math.max(0, adv(i.phaseLeft))) },
    hiderCountdown: { visible: i.phase === 'countdown' && !seeker, n: Math.ceil(Math.max(0, adv(i.phaseLeft))) },
    reticle: { visible: live && canAim },
    bottleRange: { visible: holdingBottle, radius: s.bottleRange },
    voiceWarning: { visible: i.voiceProblem && i.phase !== 'lobby' },
    endScreen: { visible: i.phase === 'end', seconds: Math.max(0, adv(i.phaseLeft)) },
    powerSlot: {
      visible: i.phase === 'hunt' && life === 'alive' && s.powerUpPointThreshold > 0,
      power: me?.power ?? null,
      frac: me?.power ? 1 : s.powerUpPointThreshold > 0 ? Math.min(1, (me?.powerProgress ?? 0) / s.powerUpPointThreshold) : 0,
    },
    effects: (() => {
      const list = i.phase === 'hunt' ? (me?.effects ?? []).map((e) => ({ k: e.k, left: Math.max(0, adv(e.left)) })).filter((e) => e.left > 0) : [];
      return { visible: list.length > 0, list };
    })(),
    jammed: { visible: i.phase === 'hunt' && seeker && adv(me?.jammed ?? 0) > 0, seconds: Math.max(0, adv(me?.jammed ?? 0)) },
    mapEvent: {
      visible: i.phase === 'hunt' && !!i.event,
      k: i.event?.k ?? null,
      seconds: Math.max(0, adv(i.event?.left ?? 0)),
      onMe: i.event?.k === 'hotDuck' && i.event.carrier === i.myId,
    },
  };
}
