import { Room, RoomEvent, Track, createLocalAudioTrack, type LocalAudioTrack, type RemoteParticipant } from 'livekit-client';
import type { VoiceToken } from '@psst/shared';

/** RMS above which the local player counts as speaking (voice detection). */
const VAD_THRESHOLD = 0.03;
const VAD_HANGOVER = 0.35;

export type VoiceStatus = 'off' | 'connecting' | 'on' | 'unavailable' | 'micDenied';

/**
 * Proximity voice chat over LiveKit. Any failure leaves the game running without voice
 * (status becomes 'unavailable' and the HUD shows a warning).
 */
export class Voice {
  status: VoiceStatus = 'off';
  speaking = false;
  private room: Room | null = null;
  private track: LocalAudioTrack | null = null;
  private analyser: AnalyserNode | null = null;
  private actx: AudioContext | null = null;
  private buf = new Float32Array(1024);
  private lastLoud = -99;
  private pttHeld = false;
  mode: 'open' | 'ptt' = 'open';
  onSpeakingChange: ((speaking: boolean) => void) | null = null;
  onStatus: ((s: VoiceStatus) => void) | null = null;

  private setStatus(s: VoiceStatus) {
    this.status = s;
    this.onStatus?.(s);
  }

  async connect(getToken: () => Promise<VoiceToken | null>, micId: string, outputId: string) {
    this.disconnect();
    this.setStatus('connecting');
    try {
      const tok = await getToken();
      if (!tok) throw new Error('voice_unavailable');
      const { url, token } = tok;
      const room = new Room({ adaptiveStream: false, dynacast: false });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.dataset.voice = '1';
          document.body.appendChild(el);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));
      room.on(RoomEvent.Disconnected, () => {
        if (this.room === room) this.setStatus('unavailable');
      });
      await room.connect(url, token);
      this.room = room;
      if (outputId) await room.switchActiveDevice('audiooutput', outputId).catch(() => false);
      try {
        this.track = await createLocalAudioTrack({ deviceId: micId || undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      } catch {
        this.setStatus('micDenied');
        return;
      }
      await room.localParticipant.publishTrack(this.track);
      this.setupVad(this.track.mediaStreamTrack);
      this.applyMode();
      this.setStatus('on');
    } catch {
      this.room?.disconnect();
      this.room = null;
      this.setStatus('unavailable');
    }
  }

  private setupVad(mst: MediaStreamTrack) {
    try {
      this.actx = new AudioContext();
      const src = this.actx.createMediaStreamSource(new MediaStream([mst]));
      this.analyser = this.actx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
    } catch {
      this.analyser = null;
    }
  }

  setMode(mode: 'open' | 'ptt') {
    this.mode = mode;
    this.applyMode();
  }

  setPtt(held: boolean) {
    if (this.pttHeld === held) return;
    this.pttHeld = held;
    this.applyMode();
  }

  private applyMode() {
    if (!this.track) return;
    const transmit = this.mode === 'open' || this.pttHeld;
    if (transmit) void this.track.unmute();
    else void this.track.mute();
  }

  async setMic(id: string) {
    await this.room?.switchActiveDevice('audioinput', id).catch(() => false);
  }

  async setOutput(id: string) {
    await this.room?.switchActiveDevice('audiooutput', id).catch(() => false);
  }

  /** Call every frame: updates voice detection. */
  update(now: number) {
    let loud = false;
    const transmitting = this.track && (this.mode === 'open' || this.pttHeld);
    if (this.analyser && transmitting) {
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      loud = Math.sqrt(sum / this.buf.length) > VAD_THRESHOLD;
    }
    if (loud) this.lastLoud = now;
    const speaking = !!transmitting && now - this.lastLoud < VAD_HANGOVER;
    if (speaking !== this.speaking) {
      this.speaking = speaking;
      this.onSpeakingChange?.(speaking);
    }
  }

  /** Set per-participant volume (0..1) by identity (= player id). */
  setVolumes(volumeFor: (identity: string) => number) {
    if (!this.room) return;
    for (const p of this.room.remoteParticipants.values()) (p as RemoteParticipant).setVolume(Math.max(0, Math.min(1, volumeFor(p.identity))));
  }

  disconnect() {
    this.track?.stop();
    this.track = null;
    void this.room?.disconnect();
    this.room = null;
    void this.actx?.close().catch(() => undefined);
    this.actx = null;
    this.analyser = null;
    document.querySelectorAll('audio[data-voice]').forEach((el) => el.remove());
    if (this.speaking) {
      this.speaking = false;
      this.onSpeakingChange?.(false);
    }
    this.setStatus('off');
  }

  static async listDevices(kind: 'audioinput' | 'audiooutput'): Promise<MediaDeviceInfo[]> {
    try {
      return await Room.getLocalDevices(kind, false);
    } catch {
      return [];
    }
  }
}

/** Standalone microphone level meter for the settings screen. */
export class MicTest {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(1024);

  async start(deviceId: string): Promise<boolean> {
    this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 6);
  }

  get threshold() {
    return Math.min(1, VAD_THRESHOLD * 6);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
  }
}
