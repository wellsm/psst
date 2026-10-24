import type { Action } from '../input/keybinds';
import { actionLabel } from '../input/labels';
import { t } from '../i18n/i18n';
import { clear, fmtTime, h, hex, show } from './dom';
import type { Cooldown, HudModel } from './hudModel';
import type { MatchResult, PowerKind, Role } from '@psst/shared';
import { PLAYER_COLORS } from '@psst/shared';

export const POWER_ICON: Record<PowerKind, string> = {
  invisible: '🫥', speed: '⚡', mute: '🤫', turbo: '🚀', camo: '🦎', megaphone: '📣', jam: '📵', jump: '🦘',
};

const key = (a: Action) => h('span.keycap', null, actionLabel(a));

function actionTile(icon: string, label: string, action: Action) {
  const cd = h('div.cd');
  const count = h('div.count');
  const el = h('div.action', null, h('div.key', null, key(action)), count, h('div.icon', null, icon), h('div', null, label), cd);
  return {
    el,
    set(c: Cooldown, countText?: string) {
      cd.style.height = `${Math.round(c.frac * 100)}%`;
      el.classList.toggle('ready', c.ready);
      count.textContent = countText ?? '';
    },
  };
}

export interface EndInfo {
  result: MatchResult | null;
  myRole: Role;
  rows: { id: string; name: string; score: number; color: number }[];
  myId: string;
}

/** DOM HUD. Pure view: what to show comes from computeHud(). */
export class Hud {
  readonly el: HTMLElement;
  private timer = h('div.timer');
  private board = h('div.scoreboard');
  private own = h('div.own');
  private ownPts = h('div.pts');
  private ownRole = h('div.role');
  private beacon = h('div.beacon');
  private actions = h('div.actions');
  private seeker = h('div.row');
  private hider = h('div.row');
  private ghost = h('div.row');
  private ball = actionTile('🟡', t('hud.ball'), 'fire');
  private dash = actionTile('💨', t('hud.dash'), 'dash');
  private seekerJump = actionTile('⤴️', t('hud.jump'), 'jump');
  private stamina = h('div.stamina', null, h('div'));
  private bottles = actionTile('🍾', t('hud.bottles'), 'fire');
  private taunt = actionTile('😤', t('hud.taunt'), 'taunt');
  private hiderJump = actionTile('⤴️', t('hud.jump'), 'jump');
  private refill = actionTile('📦', t('hud.refill'), 'refill');
  private ghostBottle = actionTile('👻', t('hud.ghostBottle'), 'fire');
  private powerIcon = h('div.icon');
  private powerName = h('div');
  private powerFill = h('div.cd');
  private power = h('div.action.power', null, h('div.key', null, key('usePower')), this.powerIcon, this.powerName, this.powerFill);
  private effects = h('div.effects');
  private jam = h('div.jam', null, t('hud.jammed'));
  private eventBar = h('div.event-bar');
  private lastEffects = '';
  private caught = h('div.center-card');
  private caughtSub = h('div');
  private cover = h('div.cover');
  private coverN = h('div.big');
  private hiderCd = h('div.banner');
  private banner = h('div.banner');
  private warn = h('div.warn');
  private speak = h('div.speak', null, t('hud.speaking'));
  private end = h('div.screen.overlay.end');
  private lastBoard = '';
  private lastEnd = '';
  private bannerUntil = 0;

  constructor() {
    this.own.append(h('div', { class: 'hint' }, t('hud.yourScore')), this.ownPts, this.ownRole);
    this.seeker.append(this.stamina, this.ball.el, this.dash.el, this.seekerJump.el);
    this.hider.append(this.bottles.el, this.taunt.el, this.hiderJump.el, this.refill.el);
    this.ghost.append(this.ghostBottle.el);
    this.actions.append(this.power, this.seeker, this.hider, this.ghost);
    this.caught.append(h('div.big', null, t('hud.caughtCard')), this.caughtSub);
    this.cover.append(this.coverN, h('div', null, t('hud.countdownSub')));
    this.el = h('div.hud', null, this.timer, this.board, this.own, this.beacon, this.actions, this.caught, this.hiderCd, this.banner, this.warn, this.speak, this.effects, this.jam, this.eventBar, this.cover, this.end);
    show(this.banner, false);
  }

  flash(text: string, now: number, seconds = 3) {
    this.banner.textContent = text;
    this.bannerUntil = now + seconds;
  }

  update(m: HudModel, extra: { now: number; myRole: Role; speaking: boolean; voiceText: string; end: EndInfo }) {
    show(this.timer, m.timer.visible);
    this.timer.textContent = fmtTime(m.timer.seconds);
    this.timer.classList.toggle('low', m.timer.seconds <= 10 && !m.countdownCover.visible);

    show(this.board, m.scoreboard.visible);
    const boardKey = JSON.stringify(m.scoreboard.rows);
    if (m.scoreboard.visible && boardKey !== this.lastBoard) {
      this.lastBoard = boardKey;
      clear(this.board);
      this.board.append(h('h3', null, t('hud.scoreboard')));
      for (const r of m.scoreboard.rows) {
        this.board.append(h(`div.score-row${r.me ? '.me' : ''}${r.caught ? '.caught' : ''}`, null,
          h('span.dot', { style: { background: hex(PLAYER_COLORS[r.color] ?? 0xffffff) } }),
          h('span.nm', null, r.name),
          r.seeker ? h('span.tag.seek', null, t('role.seeker')) : null,
          r.caught ? h('span.tag', { style: { background: '#ff4d5e', color: '#fff' } }, t('hud.caught')) : null,
          h('span', null, String(r.score)),
        ));
      }
    }

    show(this.own, m.ownScore.visible);
    this.ownPts.textContent = String(m.ownScore.value);
    this.ownRole.textContent = t(`role.${extra.myRole}`);
    this.ownRole.style.color = extra.myRole === 'seeker' ? '#ff4d5e' : '#4d8dff';

    show(this.beacon, m.beacon.visible);
    this.beacon.textContent = `📡 ${t('hud.beacon', { s: Math.ceil(m.beacon.seconds) })}`;
    this.beacon.classList.toggle('soon', m.beacon.seconds <= 3);

    show(this.seeker, m.seekerActions.visible);
    this.ball.set(m.seekerActions.ball);
    this.dash.set(m.seekerActions.dash);
    this.seekerJump.set(m.seekerActions.jump);
    const st = m.seekerActions.stamina;
    show(this.stamina, !st.infinite);
    (this.stamina.firstChild as HTMLElement).style.height = `${Math.round(st.frac * 100)}%`;
    this.stamina.classList.toggle('exhausted', st.exhausted);

    show(this.hider, m.hiderActions.visible);
    this.bottles.set({ ready: m.hiderActions.bottles > 0, frac: m.hiderActions.bottles > 0 ? 0 : 1, left: 0 }, `${m.hiderActions.bottles}/${m.hiderActions.maxBottles}`);
    this.taunt.set(m.hiderActions.taunt);
    this.hiderJump.set(m.hiderActions.jump);
    show(this.refill.el, m.hiderActions.refill.visible);
    this.refill.set(m.hiderActions.refill.cd);

    show(this.ghost, m.ghostActions.visible);
    this.ghostBottle.set(m.ghostActions.bottle);

    // Power-up slot: fills with points, lights up when a power is waiting.
    show(this.power, m.powerSlot.visible);
    const pw = m.powerSlot.power;
    this.powerIcon.textContent = pw ? POWER_ICON[pw] : '❔';
    this.powerName.textContent = pw ? t(`power.${pw}`) : t('hud.power');
    this.powerFill.style.height = `${Math.round((1 - m.powerSlot.frac) * 100)}%`;
    this.power.classList.toggle('ready', !!pw);
    this.power.title = pw ? t(`power.${pw}.desc`) : '';

    show(this.effects, m.effects.visible);
    const fx = m.effects.list.map((e) => `${POWER_ICON[e.k]} ${t(`power.${e.k}`)} ${Math.ceil(e.left)}s`).join('|');
    if (fx !== this.lastEffects) {
      this.lastEffects = fx;
      clear(this.effects);
      for (const line of fx ? fx.split('|') : []) this.effects.append(h('div.chip', null, line));
    }
    show(this.jam, m.jammed.visible);

    show(this.eventBar, m.mapEvent.visible);
    if (m.mapEvent.visible && m.mapEvent.k) {
      this.eventBar.textContent = t('hud.eventLeft', { name: t(`mapEvent.${m.mapEvent.k}`), s: Math.ceil(m.mapEvent.seconds) });
      if (m.mapEvent.onMe) this.eventBar.append(h('div.sub', null, `🦆 ${t('hud.duckOnYou')}`));
    }
    this.eventBar.classList.toggle('on-me', m.mapEvent.onMe);

    show(this.caught, m.caughtCard.visible);
    this.caughtSub.textContent = t('hud.caughtSub', { s: Math.ceil(m.caughtCard.seconds) });

    show(this.cover, m.countdownCover.visible);
    this.coverN.textContent = t('hud.countdown', { n: m.countdownCover.n });
    show(this.hiderCd, m.hiderCountdown.visible);
    this.hiderCd.textContent = t('hud.hiderCountdown', { n: m.hiderCountdown.n });

    show(this.banner, extra.now < this.bannerUntil && !m.hiderCountdown.visible);
    show(this.warn, m.voiceWarning.visible);
    this.warn.textContent = extra.voiceText;
    show(this.speak, extra.speaking && m.timer.visible);

    show(this.end, m.endScreen.visible);
    if (m.endScreen.visible) this.renderEnd(extra.end, m.endScreen.seconds);
  }

  private renderEnd(e: EndInfo, seconds: number) {
    const k = JSON.stringify([e.result, e.rows, Math.ceil(seconds)]);
    if (k === this.lastEnd) return;
    this.lastEnd = k;
    clear(this.end);
    if (!e.result) return;
    const myTeam = e.myRole === 'seeker' ? 'seekers' : 'hiders';
    const win = e.result.winner === myTeam;
    this.end.append(
      h(`div.result.${win ? 'win' : 'lose'}`, null, t(win ? 'end.victory' : 'end.defeat')),
      h('h2', null, t(e.result.winner === 'seekers' ? 'end.winnerSeekers' : 'end.winnerHiders')),
      h('div', { class: 'hint' }, t(`end.reason.${e.result.reason}`)),
      h('div', { class: 'hint' }, t('end.iWasHere')),
      h('div.card', null, h('table', null, ...e.rows.map((r, i) => h(`tr${r.id === e.result!.mvp ? '.mvp' : ''}${r.id === e.myId ? '.me' : ''}`, null,
        h('td', null, `${i + 1}. `, h('span.dot', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: hex(PLAYER_COLORS[r.color] ?? 0xffffff), marginRight: '6px' } }), r.name),
        h('td', null, r.id === e.result!.mvp ? h('span.tag.host', null, t('end.mvp')) : ''),
        h('td', { style: { textAlign: 'right' } }, `${r.score} ${t('end.points')}`),
      )))),
      h('div', null, t('end.backIn', { s: Math.ceil(seconds) })),
    );
  }
}
