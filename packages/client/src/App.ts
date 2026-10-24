import {
  COUGH_VARIANTS,
  MAPS,
  MAX_BOTS,
  MAX_PLAYERS,
  NAME_MAX,
  CODE_LENGTH,
  SETTING_CATEGORIES,
  SETTING_DEFS,
  VOLUME_GROUPS,
  defaultSettings,
  dist,
  normalizeRoomCode,
  seekerCountFor,
  voiceVolume,
  PLAYER_COLORS,
  type GameEvent,
  type LobbyState,
  type Snapshot,
} from '@psst/shared';
import { AudioEngine } from './audio/AudioEngine';
import { GameView, type FrameInfo } from './game/GameView';
import { World } from './game/World';
import { LANG_NAMES, LANGS, getLang, onLangChange, setLang, t, type Lang } from './i18n/i18n';
import { GamepadInput, PAD_BINDS, PAD_LABELS } from './input/gamepad';
import { InputState } from './input/InputState';
import { ACTIONS, DEFAULT_BINDS, codeLabel, rebind } from './input/keybinds';
import { actionLabel, inputDevice, setInputDevice, type InputDevice } from './input/labels';
import { TouchControls, isTouchDevice, lockLandscape } from './input/TouchControls';
import { Net, type JoinError } from './net/Net';
import { prefs, savePrefs } from './prefs';
import { clear, h, hex } from './ui/dom';
import { Hud } from './ui/Hud';
import { computeHud } from './ui/hudModel';
import { LOGO_SVG, LOGO_SVG_PT } from './ui/logo';
import { drawMapPreview } from './ui/mapPreview';
import { MicTest, Voice } from './voice/Voice';

type Screen = 'home' | 'play' | 'lobby' | 'game' | 'quit';
type Overlay = 'settings' | 'pause' | null;

export class App {
  private ui = document.getElementById('ui')!;
  private gameEl = document.getElementById('game')!;
  private world = new World();
  private net = new Net();
  private audio = new AudioEngine(prefs.volumes);
  private input = new InputState(this.gameEl);
  private pad = new GamepadInput(this.input, this.ui);
  private touch = new TouchControls(this.input);
  private lastTickMs = 0;
  private voice = new Voice();
  private micTest = new MicTest();
  private view: GameView | null = null;
  private hud: Hud | null = null;
  private screen: Screen = 'home';
  private overlay: Overlay = null;
  private settingsTab: 'audio' | 'controls' | 'general' = 'audio';
  private playError = '';
  private busy = false;
  private lastKnown = new Map<string, { x: number; y: number; t: number }>();
  private prevPhase = '';
  private prevLife = '';
  private prevTick = -1;
  private lastHudAt = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private lobbyEls: { players: HTMLElement; mapBox: HTMLElement; rules: HTMLElement; foot: HTMLElement; optIn: HTMLInputElement; bots: HTMLElement } | null = null;

  constructor() {
    setLang(prefs.lang);
    onLangChange(() => this.render());
    this.input.onPauseKey = () => this.onPauseKey();
    this.pad.onBack = () => this.onPauseKey();
    this.touch.onPause = () => this.onPauseKey();
    this.setDevice(isTouchDevice() ? 'touch' : 'keyboard');
    // Controls and hints follow the last device used (touch screens on laptops, a pad picked up mid-match...).
    addEventListener('pointerdown', (e) => {
      document.body.classList.remove('pad-nav');
      if (e.pointerType === 'touch') this.setDevice('touch');
      else if (e.pointerType === 'mouse') this.setDevice('keyboard');
    });
    // Touch pointerdown is not a user activation for fullscreen; pointerup is.
    addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch' && isTouchDevice()) lockLandscape();
    });
    addEventListener('keydown', () => this.setDevice('keyboard'));
    this.pad.onActivity = () => this.setDevice('pad');
    this.input.onLockLost = () => {
      if (this.screen === 'game' && !this.overlay) this.openOverlay('pause');
    };
    this.voice.mode = prefs.voiceMode;
    this.voice.onSpeakingChange = (s) => this.net.send('voice', { speaking: s });
    this.voice.onStatus = () => this.screen === 'lobby' && this.updateLobby();
    // Any first interaction unlocks audio (autoplay policy).
    addEventListener('pointerdown', () => this.audio.unlock(), { once: false });
    addEventListener('keydown', () => this.audio.unlock(), { once: false });
    requestAnimationFrame(this.tick);
    this.render();
  }

  // ------------------------------------------------------------------ frame loop (non-game screens)

  private tick = (ms: number) => {
    const now = performance.now() / 1000;
    const dt = this.lastTickMs ? Math.min((ms - this.lastTickMs) / 1000, 0.1) : 1 / 60;
    this.lastTickMs = ms;
    this.pad.poll(dt);
    this.touch.sync();
    this.voice.setPtt(this.input.isDown('pushToTalk') || (this.screen === 'lobby' && this.pttHeldInLobby));
    this.voice.update(now);
    if (this.screen === 'lobby') this.voice.setVolumes(() => 1);
    requestAnimationFrame(this.tick);
  };

  private pttHeldInLobby = false;

  // ------------------------------------------------------------------ rendering

  private render() {
    this.micTest.stop();
    clear(this.ui);
    this.lobbyEls = null;
    switch (this.screen) {
      case 'home': this.ui.append(this.homeScreen()); break;
      case 'play': this.ui.append(this.playScreen()); break;
      case 'lobby': this.ui.append(this.lobbyScreen()); this.updateLobby(); break;
      case 'game':
        this.hud = new Hud();
        this.ui.append(this.hud.el);
        if (this.touchMode) this.ui.append(this.touch.el);
        break;
      case 'quit': this.ui.append(this.quitScreen()); break;
    }
    if (this.overlay === 'settings') this.ui.append(this.settingsScreen());
    if (this.overlay === 'pause') this.ui.append(this.pauseScreen());
    // Shown by CSS only on touch screens held in portrait.
    this.ui.append(h('div.rotate', null, h('div.rotate-phone'), h('p', null, t('touch.rotate'))));
    this.gameEl.style.visibility = this.screen === 'game' ? 'visible' : 'hidden';
    this.gameEl.classList.toggle('hidden-cursor', this.screen === 'game' && !this.overlay);
    this.input.enabled = this.screen === 'game' && !this.overlay;
    if (!this.input.enabled) this.touch.reset();
    this.audio.playMusic(this.screen === 'game' ? 'music_hunt' : this.screen === 'quit' ? null : 'music_lobby');
  }

  private get touchMode() {
    return inputDevice() === 'touch';
  }

  private setDevice(d: InputDevice) {
    if (d === inputDevice() && document.body.dataset.device === d) return;
    setInputDevice(d);
    document.body.dataset.device = d;
    document.body.classList.toggle('touch-ui', d === 'touch');
    // Rebuild the in-game HUD (button hints, touch overlay); menus keep their focus and update on next render.
    if (this.screen === 'game' && !this.overlay) this.render();
  }

  private go(screen: Screen) {
    this.screen = screen;
    this.render();
  }

  private openOverlay(o: Overlay) {
    this.overlay = o;
    if (o) this.input.unlock();
    this.render();
  }

  private onPauseKey() {
    if (this.overlay === 'settings') this.openOverlay(this.screen === 'game' ? 'pause' : null);
    else if (this.overlay === 'pause') this.resume();
    else if (this.screen === 'game') this.openOverlay('pause');
  }

  private resume() {
    this.overlay = null;
    this.render();
    // Resuming from a gamepad/touch is not a mouse gesture: the lock may be refused, the mouse click re-locks.
    if (!this.touchMode) void Promise.resolve(this.gameEl.requestPointerLock?.()).catch(() => undefined);
  }

  private btn(label: string, onclick: () => void, cls = '') {
    return h(`button.btn${cls ? '.' + cls.split(' ').join('.') : ''}`, {
      onclick: () => {
        this.audio.ui('ui_click');
        onclick();
      },
    }, label);
  }

  private logo() {
    const wrap = h('div.logo');
    wrap.innerHTML = getLang() === 'pt' ? LOGO_SVG_PT : LOGO_SVG;
    return wrap;
  }

  private toast(text: string) {
    const el = h('div.toast', null, text);
    this.ui.append(el);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.remove(), 3500);
  }

  // ------------------------------------------------------------------ home / play / quit

  private homeScreen() {
    return h('div.screen', null,
      this.logo(),
      h('p.tagline', null, t('game.tagline')),
      h('div.stack', null,
        this.btn(t('menu.play'), () => this.go('play'), 'big primary'),
        this.btn(t('menu.settings'), () => this.openOverlay('settings'), 'big'),
        this.btn(t('menu.quit'), () => this.go('quit'), 'big'),
      ),
    );
  }

  private quitScreen() {
    return h('div.screen', null, this.logo(), h('h2', null, t('quit.message')), this.btn(t('quit.back'), () => this.go('home')));
  }

  private playScreen() {
    const name = h('input.input', { value: prefs.name, maxLength: NAME_MAX, placeholder: t('play.namePlaceholder') });
    const code = h('input.input.code', { maxLength: CODE_LENGTH, placeholder: t('play.codePlaceholder') });
    const err = h('div.error', null, this.playError);
    const fromUrl = new URLSearchParams(location.search).get('room');
    if (fromUrl) code.value = normalizeRoomCode(fromUrl);
    code.addEventListener('input', () => { code.value = normalizeRoomCode(code.value); });
    const getName = () => {
      const n = name.value.trim().slice(0, NAME_MAX);
      if (!n) { err.textContent = t('play.errorName'); return null; }
      savePrefs({ name: n });
      return n;
    };
    const create = async () => {
      const n = getName();
      if (!n || this.busy) return;
      await this.connect(() => this.net.create(n, this.handlers()), err);
    };
    const join = async () => {
      const n = getName();
      if (!n || this.busy) return;
      const c = normalizeRoomCode(code.value);
      if (c.length !== CODE_LENGTH) { err.textContent = t('play.errorCode'); return; }
      await this.connect(() => this.net.join(c, n, this.handlers()), err);
    };
    code.addEventListener('keydown', (e) => e.key === 'Enter' && void join());
    return h('div.screen', null,
      h('h1', null, t('play.title')),
      h('div.card.stack', { style: { width: 'min(460px, 100%)' } },
        h('div.field', null, h('label', null, t('play.name')), name),
        this.btn(t('play.create'), () => void create(), 'primary big'),
        h('div.field', null, h('label', null, t('play.joinCode')), h('div.row', null, code, this.btn(t('play.join'), () => void join(), 'go'))),
        err,
      ),
      this.btn(t('play.back'), () => { this.playError = ''; this.go('home'); }),
    );
  }

  private async connect(fn: () => Promise<JoinError | null>, err: HTMLElement) {
    this.busy = true;
    err.textContent = t('play.connecting');
    const e = await fn();
    this.busy = false;
    if (e) {
      err.textContent = t(e === 'noRoom' ? 'play.errorNoRoom' : e === 'full' ? 'play.errorFull' : 'play.errorConnect');
      return;
    }
    this.audio.ui('ui_join');
    this.net.send('prefs', { coughVariant: prefs.coughVariant });
    this.net.send('optIn', { value: prefs.seekerOptIn });
  }

  // ------------------------------------------------------------------ net handlers

  private handlers() {
    return {
      onWelcome: (id: string, code: string) => {
        this.world.myId = id;
        this.world.code = code;
        history.replaceState(null, '', `?room=${code}`);
      },
      onLobby: (l: LobbyState) => this.onLobby(l),
      onSnap: (s: Snapshot) => this.onSnap(s),
      onEvents: (e: GameEvent[]) => { this.world.pushEvents(e); this.onGameEvents(e); },
      onLeave: () => {
        this.leaveRoom();
        this.toast(t('err.disconnected'));
      },
    };
  }

  private onLobby(l: LobbyState) {
    const first = !this.world.lobby;
    this.world.setLobby(l);
    if (first && l.voiceAvailable && this.voice.status === 'off') {
      void this.voice.connect(() => this.net.voiceToken(), prefs.micId, prefs.outputId);
    } else if (first && !l.voiceAvailable) {
      this.voice.status = 'unavailable';
    }
    const inGame = l.phase !== 'lobby';
    if (inGame && this.screen !== 'game') {
      this.ensureView();
      this.overlay = null;
      this.go('game');
    } else if (!inGame && this.screen !== 'lobby') {
      this.input.unlock();
      this.overlay = this.overlay === 'settings' ? 'settings' : null;
      this.go('lobby');
    } else if (this.screen === 'lobby') {
      this.updateLobby();
    }
  }

  private onSnap(s: Snapshot) {
    const now = performance.now() / 1000;
    this.world.setSnap(s, now);
    for (const p of s.players) this.lastKnown.set(p.id, { x: p.x, y: p.y, t: now });
    const me = s.me;
    // Phase transition feedback.
    if (s.phase !== this.prevPhase) {
      if (s.phase === 'countdown' && me) this.hud?.flash(t(`hud.role.${me.role}`), now, 5);
      if (s.phase === 'hunt') { this.audio.ui('hunt_start'); this.hud?.flash(t('hud.huntStart'), now, 2.5); }
      if (s.phase === 'end' && s.result && me) this.audio.ui(s.result.winner === (me.role === 'seeker' ? 'seekers' : 'hiders') ? 'match_win' : 'match_lose');
      this.prevPhase = s.phase;
    }
    if (s.phase === 'countdown') {
      const n = Math.ceil(s.phaseLeft);
      if (n !== this.prevTick && n <= 5) this.audio.ui('countdown_tick');
      this.prevTick = n;
    }
    if (me && me.life !== this.prevLife) {
      if (me.life === 'caught') this.audio.ui('caught_card');
      if (me.life === 'ghost') this.hud?.flash(t('hud.role.ghost'), now, 4);
      this.prevLife = me.life;
    }
  }

  /** Power-up and map-event announcements. */
  private onGameEvents(events: GameEvent[]) {
    const now = performance.now() / 1000;
    for (const e of events) {
      if (e.e === 'power') {
        const name = t(`power.${e.k}`);
        this.audio.ui(e.used ? 'power_use' : 'power_get');
        this.hud?.flash(e.used ? t('hud.powerUsed', { name }) : t('hud.powerGot', { name, key: actionLabel('usePower') }), now, e.used ? 1.5 : 3);
      } else if (e.e === 'mapEvent') {
        this.audio.ui(e.on ? 'event_start' : 'ui_click');
        this.hud?.flash(e.on ? `${t(`mapEvent.${e.k}`)} — ${t(`mapEvent.${e.k}.desc`)}` : t('mapEvent.over'), now, e.on ? 4 : 2);
      }
    }
  }

  private nameOf = (id: string) => this.world.lobby?.players.find((p) => p.id === id)?.name ?? '?';

  private ensureView() {
    if (this.view) return;
    this.view = new GameView({
      world: this.world,
      input: this.input,
      net: this.net,
      audio: this.audio,
      nameOf: this.nameOf,
      onFrame: (f) => this.onFrame(f),
    }, this.gameEl);
  }

  private onFrame(f: FrameInfo) {
    const w = this.world;
    const snap = w.latest;
    if (!snap || this.screen !== 'game') return;
    const me = snap.me;

    // Proximity voice: ghosts only talk to ghosts; living players hear by distance.
    const meGhost = me?.life === 'ghost';
    const lifeOf = new Map(snap.scores.map((r) => [r.id, r.life]));
    this.voice.setVolumes((id) => {
      if (snap.phase === 'end') return 1;
      const otherGhost = lifeOf.get(id) === 'ghost';
      if (otherGhost) return meGhost ? 1 : 0;
      const k = this.lastKnown.get(id);
      if (!k || f.now - k.t > 3) return 0;
      return voiceVolume(dist(k.x, k.y, f.listener.x, f.listener.y), w.settings);
    });

    if (me) this.touch.setContext({ role: me.role, life: me.life, hunt: snap.phase === 'hunt', power: !!me.power, nearCrate: f.nearCrate });

    if (!this.hud || f.now - this.lastHudAt < 1 / 20) return;
    this.lastHudAt = f.now;
    const lobbyPlayers = new Map((w.lobby?.players ?? []).map((p) => [p.id, p]));
    const model = computeHud({
      phase: snap.phase,
      phaseLeft: snap.phaseLeft,
      beaconLeft: snap.beaconLeft,
      me,
      settings: w.settings,
      // Bots never score but are listed so captures show up as CAUGHT.
      scores: snap.scores.map((r) => ({ ...r, name: this.nameOf(r.id), color: lobbyPlayers.get(r.id)?.color ?? 0 })),
      myId: w.myId,
      nearCrate: f.nearCrate,
      fireHeld: f.fireHeld,
      voiceProblem: this.voice.status === 'unavailable' || this.voice.status === 'micDenied',
      since: w.sinceLatest(f.now),
      event: snap.event,
    });
    const rows = snap.scores
      .filter((r) => !lobbyPlayers.get(r.id)?.isBot)
      .sort((a, b) => b.score - a.score)
      .map((r) => ({ id: r.id, name: this.nameOf(r.id), score: r.score, color: lobbyPlayers.get(r.id)?.color ?? 0 }));
    this.hud.update(model, {
      now: f.now,
      myRole: me?.role ?? 'hider',
      speaking: this.voice.speaking,
      voiceText: t(this.voice.status === 'micDenied' ? 'hud.micDenied' : 'hud.voiceUnavailable'),
      end: { result: snap.result, myRole: me?.role ?? 'hider', rows, myId: w.myId },
    });
  }

  private leaveRoom() {
    this.net.leave();
    this.voice.disconnect();
    this.input.unlock();
    this.world.reset();
    this.lastKnown.clear();
    this.prevPhase = '';
    this.prevLife = '';
    this.view?.destroy();
    this.view = null;
    this.hud = null;
    this.overlay = null;
    history.replaceState(null, '', location.pathname);
    this.go('home');
  }

  // ------------------------------------------------------------------ lobby

  private lobbyScreen() {
    const players = h('div.players');
    const mapBox = h('div.stack');
    const rules = h('div.rules');
    const foot = h('div.lobby-foot');
    const bots = h('div.row');
    const optIn = h('input', { type: 'checkbox', onchange: () => { savePrefs({ seekerOptIn: optIn.checked }); this.net.send('optIn', { value: optIn.checked }); } });
    this.lobbyEls = { players, mapBox, rules, foot, optIn, bots };
    const codeBtn = this.btn(t('lobby.copy'), () => {
      void navigator.clipboard?.writeText(this.world.code).catch(() => undefined);
      codeBtn.textContent = t('lobby.copied');
      setTimeout(() => { codeBtn.textContent = t('lobby.copy'); }, 1500);
    }, 'small');
    const ptt = h('button.btn.small', {
      // Pointer events: mouse and touch (touch only emits mouse events after the finger lifts).
      onpointerdown: () => { this.pttHeldInLobby = true; },
      onpointerup: () => { this.pttHeldInLobby = false; },
      onpointerleave: () => { this.pttHeldInLobby = false; },
      onpointercancel: () => { this.pttHeldInLobby = false; },
    }, `🎙 ${actionLabel('pushToTalk')}`);
    this.buildRules(rules);
    return h('div.screen.lobby-screen', null,
      h('div.lobby-head', null,
        h('div.row', null, h('h3', null, t('lobby.code')), h('div.code-box', null, this.world.code), codeBtn),
        h('div.row', null,
          prefs.voiceMode === 'ptt' ? ptt : null,
          this.btn(t('menu.settings'), () => this.openOverlay('settings'), 'small'),
          this.btn(t('lobby.leave'), () => this.leaveRoom(), 'small danger'),
        ),
      ),
      h('div.lobby', null,
        h('div.card.stack', null, players),
        h('div.card.stack', null,
          h('h2', null, t('lobby.map')), mapBox,
          h('label.check', null, optIn, t('lobby.optIn')),
          bots,
        ),
        h('div.card.stack', null, h('h2', null, t('lobby.rules')), rules),
      ),
      foot,
    );
  }

  private updateLobby() {
    const l = this.world.lobby;
    const els = this.lobbyEls;
    if (!l || !els) return;
    const host = this.world.isHost;
    const me = l.players.find((p) => p.id === this.world.myId);

    clear(els.players);
    els.players.append(h('h2', null, t('lobby.players', { n: l.players.length, max: MAX_PLAYERS })));
    for (const p of l.players) {
      els.players.append(h('div.player', null,
        h('span.dot', { style: { background: hex(PLAYER_COLORS[p.color] ?? 0xffffff) } }),
        h('span.name', null, p.name),
        p.speaking ? h('span.speaking') : null,
        p.id === this.world.myId ? h('span.tag.you', null, t('tag.you')) : null,
        p.id === l.hostId ? h('span.tag.host', null, t('tag.host')) : null,
        p.isBot ? h('span.tag.bot', null, t('tag.bot')) : null,
        !p.isBot && p.optIn ? h('span.tag.seek', null, t('tag.seekerOptIn')) : null,
        !p.isBot && p.ready && p.id !== l.hostId ? h('span.tag.ready', null, t('tag.ready')) : null,
      ));
    }
    for (let i = l.players.length; i < MAX_PLAYERS; i++) els.players.append(h('div.player.empty', null, h('span.name', null, t('lobby.emptySlot'))));

    // Map selector.
    clear(els.mapBox);
    // Every map visible as a same-size tile; the info block has a reserved height so picking never moves the layout.
    const grid = h('div.map-grid');
    for (const m of MAPS) {
      const canvas = h('canvas');
      drawMapPreview(canvas, m.id, l.settings.bottleRefillStations);
      grid.append(h(`button.map-tile${m.id === l.mapId ? '.on' : ''}`, {
        disabled: !host,
        title: host ? undefined : t('lobby.hostOnly'),
        onclick: () => this.net.send('setMap', { mapId: m.id }),
      }, canvas, h('span', null, t(`map.${m.id}.name`))));
    }
    els.mapBox.append(
      grid,
      h('div.map-info', null,
        h('h3', { style: { color: '#ffd23f' } }, t(`map.${l.mapId}.name`)),
        h('div.hint', null, t(`map.${l.mapId}.desc`)),
      ),
    );

    els.optIn.checked = !!me?.optIn;
    clear(els.bots);
    if (host) {
      const nBots = l.players.filter((p) => p.isBot).length;
      const add = this.btn(t('lobby.addBot'), () => this.net.send('addBot', {}), 'small');
      const rem = this.btn(t('lobby.removeBot'), () => this.net.send('removeBot', {}), 'small');
      add.disabled = nBots >= MAX_BOTS || l.players.length >= MAX_PLAYERS;
      rem.disabled = nBots === 0;
      els.bots.append(add, rem);
    }

    this.updateRules();

    // Footer: ready/start + counter.
    clear(els.foot);
    const humans = l.players.filter((p) => !p.isBot && p.id !== l.hostId);
    const ready = humans.filter((p) => p.ready).length;
    const enough = l.players.length >= l.settings.minPlayers;
    const allHumans = l.players.filter((p) => !p.isBot);
    const volunteers = allHumans.filter((p) => p.optIn).length;
    const seekersWanted = seekerCountFor(l.players.length, allHumans.length, l.settings.seekerCount);
    if (l.phase !== 'lobby') {
      els.foot.append(h('div.hint', null, t('lobby.inMatch')));
    } else if (host) {
      const start = this.btn(t('lobby.start'), () => this.net.send('start', {}), 'big go');
      start.disabled = ready < humans.length || !enough || volunteers === 0;
      els.foot.append(start);
    } else {
      const isReady = !!me?.ready;
      els.foot.append(this.btn(t(isReady ? 'lobby.unready' : 'lobby.ready'), () => {
        this.audio.ui('ui_ready');
        this.net.send('ready', { ready: !isReady });
      }, `big ${isReady ? '' : 'primary'}`));
    }
    els.foot.append(h('div.stack', null,
      h('div', null, t('lobby.readyCount', { ready, total: humans.length })),
      !enough ? h('div.error', null, t('lobby.needPlayers', { n: l.settings.minPlayers })) : ready < humans.length ? h('div.hint', null, t('lobby.waitReady')) : null,
      enough && volunteers === 0 ? h('div.error', null, t('lobby.noVolunteers')) : enough && volunteers < seekersWanted ? h('div.hint', null, t('lobby.fewVolunteers')) : null,
    ));
  }

  private ruleInputs = new Map<string, { range: HTMLInputElement; val: HTMLElement; row: HTMLElement; reset: HTMLButtonElement }>();
  private ruleTimer: ReturnType<typeof setTimeout> | null = null;
  private rulePatch: Record<string, number> = {};

  private buildRules(container: HTMLElement) {
    this.ruleInputs.clear();
    const defs = defaultSettings();
    for (const cat of SETTING_CATEGORIES) {
      const det = h('details', { open: cat === 'match' || cat === 'view' }, h('summary', null, t(`settingCategory.${cat}`)));
      for (const d of SETTING_DEFS.filter((x) => x.category === cat)) {
        const range = h('input', { type: 'range', min: d.min, max: d.max, step: d.step });
        const val = h('span.val');
        const reset = h('button.btn.small', null, t('lobby.default'));
        const row = h('div.rule', null, h('span.label', null, t(`setting.${d.key}`)), range, val, reset);
        range.addEventListener('input', () => {
          val.textContent = fmtSetting(d.key, Number(range.value));
          this.queueRule(d.key, Number(range.value));
        });
        reset.addEventListener('click', () => this.queueRule(d.key, defs[d.key]));
        det.append(row);
        this.ruleInputs.set(d.key, { range, val, row, reset });
      }
      container.append(det);
    }
  }

  private queueRule(key: string, value: number) {
    this.rulePatch[key] = value;
    if (this.ruleTimer) return;
    this.ruleTimer = setTimeout(() => {
      this.net.send('setSettings', { patch: this.rulePatch });
      this.rulePatch = {};
      this.ruleTimer = null;
    }, 80);
  }

  private updateRules() {
    const l = this.world.lobby;
    if (!l) return;
    const host = this.world.isHost && l.phase === 'lobby';
    const defs = defaultSettings();
    for (const d of SETTING_DEFS) {
      const r = this.ruleInputs.get(d.key);
      if (!r) continue;
      const v = l.settings[d.key];
      if (document.activeElement !== r.range) r.range.value = String(v);
      r.val.textContent = fmtSetting(d.key, v);
      r.range.disabled = !host;
      r.reset.disabled = !host || v === defs[d.key];
      r.row.classList.toggle('changed', v !== defs[d.key]);
      r.row.title = host ? '' : t('lobby.hostOnly');
    }
  }

  // ------------------------------------------------------------------ pause / settings

  private pauseScreen() {
    const sens = h('input', { type: 'range', min: 0.2, max: 3, step: 0.05, value: prefs.sensitivity });
    const sensVal = h('span.val', null, prefs.sensitivity.toFixed(2));
    sens.addEventListener('input', () => {
      savePrefs({ sensitivity: Number(sens.value) });
      sensVal.textContent = Number(sens.value).toFixed(2);
    });
    return h('div.screen.overlay', null,
      h('h1', null, t('pause.title')),
      h('div.hint', null, t('pause.note')),
      h('div.card.stack', { style: { width: 'min(420px, 100%)' } },
        this.btn(t('pause.resume'), () => this.resume(), 'big primary'),
        h('div.setting-row', null, h('span', null, t('pause.sensitivity')), h('div.row', null, sens, sensVal)),
        this.btn(t('pause.settings'), () => this.openOverlay('settings'), 'big'),
        this.btn(t('pause.leave'), () => this.leaveRoom(), 'big danger'),
      ),
    );
  }

  private settingsScreen() {
    const body = h('div.card.settings-body');
    const tab = (id: typeof this.settingsTab, label: string) => this.btn(label, () => { this.settingsTab = id; this.render(); }, this.settingsTab === id ? 'on' : '');
    if (this.settingsTab === 'audio') this.audioSettings(body);
    else if (this.settingsTab === 'controls') this.controlSettings(body);
    else this.generalSettings(body);
    const back = () => this.openOverlay(this.screen === 'game' ? 'pause' : null);
    return h('div.screen.overlay', null,
      h('h1', null, t('settings.title')),
      h('div.tabs', null, tab('audio', t('settings.audio')), tab('controls', t('settings.controls')), tab('general', t('settings.general'))),
      body,
      this.btn(t('settings.back'), back),
    );
  }

  private row(label: string, ...control: (Node | string | null)[]) {
    return h('div.setting-row', null, h('span', null, label), h('div.row', null, ...control));
  }

  private audioSettings(body: HTMLElement) {
    for (const g of VOLUME_GROUPS) {
      const r = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: prefs.volumes[g] });
      r.addEventListener('input', () => {
        const v = Number(r.value);
        this.audio.setVolume(g, v);
        savePrefs({ volumes: { ...prefs.volumes, [g]: v } });
      });
      body.append(this.row(t(`settings.volume.${g}`), r));
    }
    const variantSel = (count: number, current: number, onPick: (v: number) => void) => {
      const sel = h('select.select', null, ...Array.from({ length: count }, (_, i) => h('option', { value: i, selected: i === current }, t('settings.variant', { n: i + 1 }))));
      sel.addEventListener('change', () => onPick(Number(sel.value)));
      return sel;
    };
    body.append(this.row(t('settings.coughVariant'),
      variantSel(COUGH_VARIANTS, prefs.coughVariant, (v) => { savePrefs({ coughVariant: v }); this.net.send('prefs', { coughVariant: v }); this.audio.play('cough', 'body', { variant: v }); }),
      this.btn(t('settings.preview'), () => this.audio.play('cough', 'body', { variant: prefs.coughVariant }), 'small'),
    ));
  }

  private controlSettings(body: HTMLElement) {
    const note = h('div.hint');
    for (const a of ACTIONS) {
      const b = h('button.btn.small', null, h('span.keycap', null, codeLabel(prefs.binds[a], t)));
      b.addEventListener('click', () => {
        b.textContent = t('settings.rebindPrompt');
        this.input.capture((code) => {
          const r = rebind(prefs.binds, a, code);
          savePrefs({ binds: r.binds });
          this.render();
          if (r.swapped) this.toast(t('settings.swapped', { action: t(`action.${r.swapped}`) }));
        });
      });
      const padBtns = a.startsWith('move') ? ['LS'] : (PAD_BINDS[a] ?? []).map((i) => PAD_LABELS[i]);
      body.append(this.row(t(`action.${a}`), b, h('span.padcap', null, padBtns.map((l) => t(`pad.${l}`)).join(' / '))));
    }
    body.append(h('div.hint', null, t('settings.padSticks')), h('div.hint', null, t('settings.padMenus')));
    body.append(h('div.row', { style: { marginTop: '10px' } }, this.btn(t('settings.resetControls'), () => { savePrefs({ binds: { ...DEFAULT_BINDS } }); this.render(); }, 'small'), note));
  }

  private generalSettings(body: HTMLElement) {
    const lang = h('select.select', null, ...LANGS.map((l) => h('option', { value: l, selected: l === getLang() }, LANG_NAMES[l])));
    lang.addEventListener('change', () => { savePrefs({ lang: lang.value as Lang }); setLang(lang.value as Lang); });
    body.append(this.row(t('settings.language'), lang));

    const mic = h('select.select', null, h('option', { value: '' }, t('settings.defaultDevice')));
    const out = h('select.select', null, h('option', { value: '' }, t('settings.defaultDevice')));
    void Voice.listDevices('audioinput').then((ds) => ds.forEach((d) => d.deviceId && mic.append(h('option', { value: d.deviceId, selected: d.deviceId === prefs.micId }, d.label || d.deviceId.slice(0, 8)))));
    void Voice.listDevices('audiooutput').then((ds) => ds.forEach((d) => d.deviceId && out.append(h('option', { value: d.deviceId, selected: d.deviceId === prefs.outputId }, d.label || d.deviceId.slice(0, 8)))));
    mic.addEventListener('change', () => { savePrefs({ micId: mic.value }); void this.voice.setMic(mic.value); });
    out.addEventListener('change', () => { savePrefs({ outputId: out.value }); void this.voice.setOutput(out.value); void this.audio.setOutputDevice(out.value); });
    body.append(this.row(t('settings.micDevice'), mic), this.row(t('settings.outputDevice'), out));

    const meter = h('div.meter', { style: { width: '160px' } }, h('div'));
    let raf = 0;
    const testBtn = this.btn(t('settings.micTest'), async () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        this.micTest.stop();
        testBtn.textContent = t('settings.micTest');
        return;
      }
      if (!(await this.micTest.start(prefs.micId))) { this.toast(t('hud.micDenied')); return; }
      testBtn.textContent = t('settings.micTestStop');
      const loop = () => {
        const lv = this.micTest.level();
        const bar = meter.firstChild as HTMLElement;
        bar.style.width = `${lv * 100}%`;
        bar.style.background = lv > this.micTest.threshold ? '#ffd23f' : '#59ff99';
        raf = requestAnimationFrame(loop);
      };
      loop();
    }, 'small');
    body.append(this.row(t('settings.micTest'), testBtn, meter));

    const mode = h('select.select', null,
      h('option', { value: 'open', selected: prefs.voiceMode === 'open' }, t('settings.voiceOpen')),
      h('option', { value: 'ptt', selected: prefs.voiceMode === 'ptt' }, `${t('settings.voicePtt')} (${codeLabel(prefs.binds.pushToTalk, t)})`),
    );
    mode.addEventListener('change', () => { savePrefs({ voiceMode: mode.value as 'open' | 'ptt' }); this.voice.setMode(prefs.voiceMode); });
    body.append(this.row(t('settings.voiceMode'), mode));

    const sens = h('input', { type: 'range', min: 0.2, max: 3, step: 0.05, value: prefs.sensitivity });
    sens.addEventListener('input', () => savePrefs({ sensitivity: Number(sens.value) }));
    body.append(this.row(t('settings.sensitivity'), sens));
  }
}

function fmtSetting(key: string, v: number): string {
  return key === 'cameraMode' ? t(`cameraMode.${v}`) : fmtNum(v);
}

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '');
}

