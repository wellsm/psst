import {
  SOUND_DEFS,
  VOLUME_GROUPS,
  audioGain,
  listenerPan,
  hashPos,
  type GameEvent,
  type MatchSettings,
  type SoundType,
  type Surface,
  type VolumeGroup,
} from '@psst/shared';
import { CLIP_IDS, buildClip, type ClipId } from './synth';

const MUSIC_GAIN = 0.6;
/** Mix trims for clips that are much louder than the rest (near-pure tones). */
const CLIP_TRIM: Partial<Record<ClipId, number>> = { whistle_low: 0.45, whistle_high: 0.45 };
/** Clips replaced by a recording (`packages/client/public/sfx/`); the synth version plays until it loads or if it fails. */
export const RECORDED: Partial<Record<ClipId, string>> = { quack: 'sfx/quack.wav', slip: 'sfx/slip.wav' };
/** Same normalization peak as synth clips. */
const RECORDED_PEAK = 0.9;

/** Which clip plays for a gameplay sound event. */
export function clipFor(type: SoundType, surface: Surface | undefined): ClipId | null {
  const s = surface ?? 'floor';
  switch (type) {
    case 'footstep': return `step_${s}` as ClipId;
    case 'run': return `run_${s}` as ClipId;
    case 'water': return `run_${s === 'floor' || s === 'rug' ? 'water' : s}` as ClipId;
    case 'cough': return 'cough';
    case 'voice': return null; // the real voice comes through voice chat
    case 'throw': return 'throw';
    case 'bottleImpact': return 'bottle_break';
    case 'bottleHit': return 'bottle_hit';
    case 'dashLaunch': return 'dash';
    case 'dashMiss': return 'dash_boom';
    case 'capture': return 'capture';
    case 'whistle': return 'whistle_low';
    case 'whistleHit': return 'whistle_high';
    case 'beacon': return 'beacon';
    case 'ghostThrow': return 'ghost_throw';
    case 'ghostImpact': return 'ghost_impact';
    case 'refill': return 'refill';
    case 'quack': return 'quack';
    case 'slip': return 'slip';
    case 'snap': return 'snap';
    case 'alarm': return 'alarm';
  }
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private groups = new Map<VolumeGroup, GainNode>();
  private buffers = new Map<ClipId, AudioBuffer[]>();
  private volumes: Record<VolumeGroup, number>;
  private music: { id: ClipId; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantedMusic: ClipId | null = null;
  private building = false;

  constructor(volumes: Record<VolumeGroup, number>) {
    this.volumes = { ...volumes };
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      for (const g of VOLUME_GROUPS) {
        const node = ctx.createGain();
        node.gain.value = this.volumes[g];
        node.connect(this.master);
        this.groups.set(g, node);
      }
      void this.buildAll();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private async buildAll() {
    if (!this.ctx || this.building) return;
    this.building = true;
    const ctx = this.ctx;
    // Short clips first so the UI is responsive, music last; yield between clips.
    const order = [...CLIP_IDS].sort((a, b) => Number(a.startsWith('music')) - Number(b.startsWith('music')));
    for (const id of order) {
      const variants = buildClip(id, ctx.sampleRate);
      this.buffers.set(id, variants.map((data) => {
        const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
        buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
        return buf;
      }));
      const url = RECORDED[id];
      if (url) void this.loadRecorded(id, url);
      await new Promise((r) => setTimeout(r, 0));
      if (id === this.wantedMusic) this.playMusic(id);
    }
  }

  private async loadRecorded(id: ClipId, url: string) {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      const data = buf.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= RECORDED_PEAK / peak;
      this.buffers.set(id, [buf]);
    } catch {
      // Keep the synth clip.
    }
  }

  setVolume(group: VolumeGroup, v: number) {
    this.volumes[group] = v;
    const node = this.groups.get(group);
    if (node && this.ctx) node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  async setOutputDevice(id: string) {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    try {
      await ctx?.setSinkId?.(id);
    } catch {
      // Not supported in this browser: keep the default output.
    }
  }

  /** Play a clip. `variant` picks a specific variant; otherwise `seed` hashes into the variants. */
  play(id: ClipId, group: VolumeGroup, opts: { volume?: number; pan?: number; variant?: number; seed?: number; rate?: number } = {}) {
    const ctx = this.ctx;
    const out = this.groups.get(group);
    const variants = this.buffers.get(id);
    if (!ctx || !out || !variants?.length) return;
    const vol = (opts.volume ?? 1) * (CLIP_TRIM[id] ?? 1);
    if (vol <= 0.001) return;
    const idx = opts.variant !== undefined ? opts.variant % variants.length : (opts.seed ?? 0) % variants.length;
    const src = ctx.createBufferSource();
    src.buffer = variants[idx];
    src.playbackRate.value = opts.rate ?? 1;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    const pan = ctx.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    src.connect(gain).connect(pan).connect(out);
    src.start();
  }

  ui(id: ClipId) {
    this.play(id, 'ui');
  }

  /** Handle gameplay sound events relative to the local listener. */
  /** `listener.yaw`: world angle the view faces (pan follows the view); defaults to the top-down screen. */
  playEvents(events: GameEvent[], listener: { x: number; y: number; yaw?: number }, settings: MatchSettings) {
    for (const e of events) {
      if (e.e === 'snd') {
        const clip = clipFor(e.t, e.s);
        if (!clip) continue;
        const def = SOUND_DEFS[e.t];
        const d = Math.hypot(e.x - listener.x, e.y - listener.y);
        const vol = audioGain(d, def.range(settings)) * (0.35 + 0.65 * e.i);
        this.play(clip, def.group, { volume: vol, pan: listenerPan(e.x - listener.x, e.y - listener.y, listener.yaw ?? -Math.PI / 2), variant: e.v, seed: hashPos(e.x, e.y) });
      } else if (e.e === 'snda') {
        const clip = clipFor(e.t, e.s);
        if (!clip) continue;
        this.play(clip, SOUND_DEFS[e.t].group, { volume: e.vol, pan: e.pan, variant: e.v, seed: Math.floor(e.vol * 1000) });
      }
    }
  }

  playMusic(id: ClipId | null) {
    this.wantedMusic = id;
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.music?.id === id) return;
    if (this.music) {
      const old = this.music;
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      old.src.stop(ctx.currentTime + 2);
      this.music = null;
    }
    if (!id) return;
    const buf = this.buffers.get(id)?.[0];
    const out = this.groups.get('music');
    if (!buf || !out) return; // will start when built
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(MUSIC_GAIN, ctx.currentTime, 0.5);
    src.connect(gain).connect(out);
    src.start();
    this.music = { id, src, gain };
  }
}
