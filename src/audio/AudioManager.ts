import { AUDIO, REVEAL } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import { getMusicMuted, setMusicMuted } from './musicPref';

/** Looping background track (served from the Vite public dir, `assets/`). */
const MUSIC_URL = `${import.meta.env.BASE_URL}background-music/Dragonsland.mp3`;

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  slideTo?: number;
  delay?: number;
  release?: number;
}

/**
 * All SFX are synthesized with WebAudio (jsfxr spirit, zero asset files) and
 * triggered purely by EventBus subscriptions. The context unlocks on the
 * first pointer event (call unlock() from the first scene interaction).
 */
export class AudioManager {
  private actx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicLoading = false;
  private musicMuted = getMusicMuted();

  constructor(bus: EventBus) {
    bus.on('audio:set_music_muted', ({ muted }) => this.applyMusicMuted(muted));
    bus.on('item:merged', ({ resultTier }) => this.popMerge(resultTier));
    bus.on('item:hatched', () => this.hatchChime());
    // The roar is timed to the reveal card's overshoot, not to the event that
    // opened it — REVEAL.roarAtMs is the one place that beat is decided.
    bus.on('dragon:revealed', () =>
      window.setTimeout(() => this.dragonRoar(), REVEAL.roarAtMs)
    );
    bus.on('item:harvested', () => this.harvestTick());
    bus.on('item:produced', () => this.giftChime());
    bus.on('item:sold', () => this.coinBlip());
    bus.on('order:completed', () => this.fanfare());
    bus.on('keeper:leveled', () => this.levelUp());
    bus.on('region:unlocked', () => this.fogWhoosh());
    bus.on('item:move_bounced', () => this.deny(140, 0.05));
    bus.on('item:harvest_failed', () => this.deny(200, 0.07));
    bus.on('ui:ledger_toggled', () => this.click());
    bus.on('tutorial:advance_requested', () => this.click());
    bus.on('economy:changed', () => undefined); // reserved: level-up jingle in L2
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (typeof window === 'undefined') return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!this.actx) {
      this.actx = new Ctor();
      this.master = this.actx.createGain();
      this.master.gain.value = AUDIO.master;
      this.master.connect(this.actx.destination);
      this.sfx = this.actx.createGain();
      this.sfx.gain.value = AUDIO.sfx;
      this.sfx.connect(this.master);
      this.music = this.actx.createGain();
      this.music.gain.value = this.musicMuted ? 0 : AUDIO.music;
      this.music.connect(this.master);
      void this.loadMusic();
    }
    if (this.actx.state === 'suspended') {
      void this.actx.resume();
    }
  }

  /* --------------------- looping background music --------------------- */

  /** Fetch + decode the track once (after the context exists) and loop it. */
  private async loadMusic(): Promise<void> {
    if (this.musicSource || this.musicLoading || !this.actx || !this.music) return;
    this.musicLoading = true;
    try {
      const res = await fetch(MUSIC_URL);
      const data = await res.arrayBuffer();
      const buffer = await this.actx.decodeAudioData(data);
      if (!this.actx || !this.music) return; // torn down mid-load
      const source = this.actx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.music);
      source.start();
      this.musicSource = source;
    } catch (err) {
      console.warn('[audio] background music failed to load:', err);
    } finally {
      this.musicLoading = false;
    }
  }

  /** Mute/unmute the looping background music (SFX stay). Persists too. */
  private applyMusicMuted(muted: boolean): void {
    this.musicMuted = muted;
    setMusicMuted(muted);
    if (!this.actx || !this.music) return;
    const t = this.actx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setValueAtTime(this.music.gain.value, t);
    this.music.gain.linearRampToValueAtTime(muted ? 0 : AUDIO.music, t + 0.25);
  }

  /* ------------------------- tiny synth kit ------------------------- */

  private tone(freq: number, duration: number, options: ToneOptions = {}): void {
    if (!this.actx || !this.sfx) return;
    const t0 = this.actx.currentTime + (options.delay ?? 0);
    const osc = this.actx.createOscillator();
    const gain = this.actx.createGain();
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (options.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.slideTo), t0 + duration);
    }
    const peak = options.gain ?? 0.16;
    const release = options.release ?? duration;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + duration + release);
    osc.connect(gain).connect(this.sfx);
    osc.start(t0);
    osc.stop(t0 + duration + release + 0.05);
  }

  private noiseSweep(
    duration: number,
    fromHz: number,
    toHz: number,
    gainValue: number,
    delay = 0
  ): void {
    if (!this.actx || !this.sfx) return;
    const t0 = this.actx.currentTime + delay;
    const length = Math.ceil(this.actx.sampleRate * duration);
    const buffer = this.actx.createBuffer(1, length, this.actx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = this.actx.createBufferSource();
    source.buffer = buffer;
    const filter = this.actx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(fromHz, t0);
    filter.frequency.exponentialRampToValueAtTime(toHz, t0 + duration);
    const gain = this.actx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainValue, t0 + duration * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + duration);
    source.connect(filter).connect(gain).connect(this.sfx);
    source.start(t0);
    source.stop(t0 + duration + 0.05);
  }

  /* ----------------------------- voices ----------------------------- */

  private popMerge(resultTier: number): void {
    const base = 300 + resultTier * 60;
    this.tone(base, 0.07, { slideTo: base * 1.8, gain: 0.2 });
    this.tone(base * 2.1, 0.05, { gain: 0.07, delay: 0.045, type: 'triangle' });
  }

  private hatchChime(): void {
    const notes = [660, 830, 990, 1320];
    notes.forEach((freq, i) => {
      this.tone(freq, 0.16, { type: 'sine', gain: 0.13, delay: i * 0.085, release: 0.28 });
      this.tone(freq * 2, 0.1, { type: 'sine', gain: 0.035, delay: i * 0.085 });
    });
    this.noiseSweep(0.3, 2400, 5200, 0.04, 0.05);
  }

  private harvestTick(): void {
    this.tone(240, 0.045, { type: 'square', gain: 0.085 });
    this.tone(480, 0.05, { type: 'sine', gain: 0.1, delay: 0.04, slideTo: 700 });
  }

  /** A soft, sparkly two-note rise — a dragon's unbidden gift. */
  private giftChime(): void {
    this.tone(880, 0.1, { type: 'sine', gain: 0.07, delay: 0, release: 0.18 });
    this.tone(1320, 0.12, { type: 'triangle', gain: 0.06, delay: 0.07, release: 0.2 });
    this.noiseSweep(0.18, 3200, 6400, 0.025, 0.02);
  }

  private coinBlip(): void {
    this.tone(760, 0.06, { type: 'triangle', gain: 0.1 });
    this.tone(1140, 0.09, { type: 'triangle', gain: 0.1, delay: 0.06 });
  }

  private levelUp(): void {
    // a bright rising arpeggio that resolves up an octave.
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((freq, i) => {
      this.tone(freq, 0.13, { type: 'triangle', gain: 0.13, delay: i * 0.07, release: 0.2 });
      this.tone(freq / 2, 0.12, { type: 'sine', gain: 0.045, delay: i * 0.07 });
    });
    this.noiseSweep(0.4, 2600, 6000, 0.05, 0.1);
  }

  private fanfare(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((freq, i) => {
      this.tone(freq, 0.14, { type: 'triangle', gain: 0.14, delay: i * 0.095, release: 0.22 });
      this.tone(freq / 2, 0.16, { type: 'sine', gain: 0.05, delay: i * 0.095 });
    });
    this.tone(1568, 0.3, { type: 'sine', gain: 0.07, delay: 0.4, release: 0.45 });
  }

  private fogWhoosh(): void {
    this.noiseSweep(0.75, 260, 1500, 0.16);
    this.tone(180, 0.5, { type: 'sine', gain: 0.06, slideTo: 320, delay: 0.1, release: 0.4 });
  }

  /**
   * The reveal ROAR — the one big sound in the game.
   *
   * SYNTHESISED, like every other effect here, and that is the licence answer
   * as well as the house style: nothing is downloaded, so there is no CC-BY
   * attribution to carry, no sample-pack terms to honour and nothing to prune
   * from `dist`. It is also ~40 lines against a ~200 KB file the player would
   * wait on before the card could open.
   *
   * A roar is three things stacked, none of which is a musical note:
   *   1. a GROWL — two detuned saw oscillators an octave apart, swept DOWN in
   *      pitch through a low-pass that opens and closes with them. The detune
   *      is what stops it reading as a synth bass.
   *   2. a RASP — the same pitch again through a hard-clipping shaper, mixed
   *      low. This is the animal in it: the harmonics a throat adds.
   *   3. BREATH — filtered noise swept from a roar's bright open to its dark
   *      close, plus a short bright burst on the attack.
   * A slow tremolo across the whole thing gives it the ragged lungs.
   */
  private dragonRoar(): void {
    if (!this.actx || !this.sfx) return;
    const t0 = this.actx.currentTime + 0.02;
    const dur = 1.35;
    const out = this.actx.createGain();
    out.gain.setValueAtTime(0, t0);
    out.gain.linearRampToValueAtTime(1, t0 + 0.05); // fast, but not a click
    out.gain.setValueAtTime(1, t0 + dur * 0.55);
    out.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    out.connect(this.sfx);

    // Lungs: a 7 Hz wobble on the whole voice, deep enough to hear as ragged.
    const trem = this.actx.createGain();
    trem.gain.value = 1;
    const lfo = this.actx.createOscillator();
    const lfoGain = this.actx.createGain();
    lfo.frequency.setValueAtTime(6.5, t0);
    lfo.frequency.linearRampToValueAtTime(11, t0 + dur);
    lfoGain.gain.value = 0.16;
    lfo.connect(lfoGain).connect(trem.gain);
    trem.connect(out);
    lfo.start(t0);
    lfo.stop(t0 + dur);

    // The throat: a low-pass that opens on the attack and shuts as it dies.
    const throat = this.actx.createBiquadFilter();
    throat.type = 'lowpass';
    throat.Q.value = 6;
    throat.frequency.setValueAtTime(240, t0);
    throat.frequency.exponentialRampToValueAtTime(1900, t0 + 0.16);
    throat.frequency.exponentialRampToValueAtTime(260, t0 + dur);
    throat.connect(trem);

    // 1 + 2. Growl and rasp, off the same falling pitch.
    const shaper = this.actx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 4.5); // soft clip — grit, not fuzz
    }
    shaper.curve = curve;
    const raspGain = this.actx.createGain();
    raspGain.gain.value = 0.26;
    shaper.connect(raspGain).connect(throat);
    for (const [base, detune, level] of [[62, -9, 0.5], [62, 11, 0.5], [124, 4, 0.3]] as const) {
      const osc = this.actx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.setValueAtTime(detune, t0);
      // Up hard on the attack, then a long fall — the shape of a shout.
      osc.frequency.setValueAtTime(base * 1.55, t0);
      osc.frequency.exponentialRampToValueAtTime(base * 1.9, t0 + 0.1);
      osc.frequency.exponentialRampToValueAtTime(base * 0.72, t0 + dur);
      const g = this.actx.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(throat);
      g.connect(shaper);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }

    // 3. Breath over the top, and a bright crack on the attack.
    this.noiseSweep(dur * 0.9, 1800, 320, 0.075);
    this.noiseSweep(0.16, 5200, 1400, 0.05);
    // A sub thump so it lands in the chest on a device with any low end.
    this.tone(48, 0.5, { type: 'sine', gain: 0.22, slideTo: 30, release: 0.5 });
  }

  private deny(freq: number, gain: number): void {
    this.tone(freq, 0.09, { type: 'triangle', gain, slideTo: freq * 0.7 });
  }

  private click(): void {
    this.tone(700, 0.03, { type: 'triangle', gain: 0.07, slideTo: 520 });
  }

}
