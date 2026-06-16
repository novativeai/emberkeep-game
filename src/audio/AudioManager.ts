import { AUDIO } from '../core/Constants';
import type { EventBus } from '../core/EventBus';

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
  private ambient: GainNode | null = null;

  constructor(bus: EventBus) {
    bus.on('item:merged', ({ resultTier }) => this.popMerge(resultTier));
    bus.on('item:hatched', () => this.hatchChime());
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
      this.ambient = this.actx.createGain();
      this.ambient.gain.value = AUDIO.ambient;
      this.ambient.connect(this.master);
      this.startAmbient();
    }
    if (this.actx.state === 'suspended') {
      void this.actx.resume();
    }
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

  private deny(freq: number, gain: number): void {
    this.tone(freq, 0.09, { type: 'triangle', gain, slideTo: freq * 0.7 });
  }

  private click(): void {
    this.tone(700, 0.03, { type: 'triangle', gain: 0.07, slideTo: 520 });
  }

  /** Soft airy pad + occasional ember crackles, very quiet. */
  private startAmbient(): void {
    if (!this.actx || !this.ambient) return;
    const t0 = this.actx.currentTime;
    for (const [freq, detune] of [
      [108, 0],
      [162.2, 4]
    ] as const) {
      const osc = this.actx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const gain = this.actx.createGain();
      gain.gain.value = 0.5;
      // Slow breathing LFO.
      const lfo = this.actx.createOscillator();
      lfo.frequency.value = 0.06 + freq / 5000;
      const lfoGain = this.actx.createGain();
      lfoGain.gain.value = 0.22;
      lfo.connect(lfoGain).connect(gain.gain);
      osc.connect(gain).connect(this.ambient);
      osc.start(t0);
      lfo.start(t0);
    }
    const scheduleCrackle = (): void => {
      setTimeout(() => {
        if (this.actx && this.actx.state === 'running') {
          const dur = 0.05 + Math.random() * 0.07;
          const freq = 900 + Math.random() * 2200;
          this.crackle(dur, freq);
        }
        scheduleCrackle();
      }, 2800 + Math.random() * 5200);
    };
    scheduleCrackle();
  }

  private crackle(duration: number, freq: number): void {
    if (!this.actx || !this.ambient) return;
    const t0 = this.actx.currentTime;
    const length = Math.ceil(this.actx.sampleRate * duration);
    const buffer = this.actx.createBuffer(1, length, this.actx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const source = this.actx.createBufferSource();
    source.buffer = buffer;
    const filter = this.actx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 3;
    const gain = this.actx.createGain();
    gain.gain.value = 0.5;
    source.connect(filter).connect(gain).connect(this.ambient);
    source.start(t0);
  }
}
