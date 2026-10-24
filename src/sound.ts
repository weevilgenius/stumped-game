/* ========================================================= *\
 *  Sound effects                                            *
 *                                                           *
 *  Short sounds synthesized with Web Audio, so there are    *
 *  no files to download or cache for offline play. Mobile   *
 *  browsers keep audio silent until a user gesture, so the  *
 *  audio context is created and resumed on the first tap.   *
\* ========================================================= */

/** A sound effect, named for what it marks. */
export type Sound =
  | 'x' | 'erase' | 'stump' | 'wrong' | 'win' | 'lose'
  | 'woodpecker' | 'owl' | 'squirrel';

/** Overall loudness. Every sound is kept quiet: the game is often played in shared rooms. */
const MASTER_GAIN = 0.5;
/** Shortest gap between two X sounds, so a fast drag ticks instead of buzzing. */
const X_GAP_MS = 45;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let lastX = -Infinity;

/** Creates the audio context on first use, or resumes it after the browser suspended it. */
const unlock = (): void => {
  if (muted || typeof AudioContext === 'undefined') {
    return;
  }
  if (!context) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(context.destination);
  }
  if (context.state !== 'running') {
    void context.resume().catch(() => undefined);
  }
};

if (typeof document !== 'undefined') {
  // Safari only unlocks audio from some gesture events, so listen for each of them.
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    document.addEventListener(type, unlock, { capture: true, passive: true });
  }
}

/**
 * Turns all sound effects off or on.
 * @param value true to silence every sound
 */
export function setMuted(value: boolean): void {
  muted = value;
}

/* ------------------------------------------------------- *\
 *  Building blocks                                        *
\* ------------------------------------------------------- */

interface ToneOptions {
  /** Oscillator shape. */
  readonly wave?: OscillatorType;
  /** Start frequency in hertz. */
  readonly from: number;
  /** End frequency in hertz; defaults to the start frequency. */
  readonly to?: number;
  /** Seconds from now to start. */
  readonly at?: number;
  /** Length in seconds. */
  readonly length: number;
  /** Peak loudness, 0 to 1. */
  readonly gain: number;
  /** Optional vibrato depth in hertz, at 7 Hz. */
  readonly vibrato?: number;
}

/** Plays one tone with a quick attack and an exponential fade. */
const tone = (ctx: AudioContext, out: AudioNode, options: ToneOptions): void => {
  const { wave = 'sine', from, to = from, at = 0, length, gain, vibrato } = options;
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + length);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.012, length / 4));
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(env).connect(out);
  if (vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 7;
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + length);
  }
  osc.start(start);
  osc.stop(start + length + 0.02);
};

/** Plays a short burst of noise through a band-pass filter: a knock or a tap. */
const knock = (ctx: AudioContext, out: AudioNode, at: number, frequency: number, gain: number, length = 0.05): void => {
  const start = ctx.currentTime + at;
  const samples = Math.ceil(ctx.sampleRate * length);
  const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / samples) ** 3;
  }
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.value = frequency;
  filter.Q.value = 4;
  env.gain.value = gain;
  source.connect(filter).connect(env).connect(out);
  source.start(start);
};

/* ------------------------------------------------------- *\
 *  The sounds                                             *
\* ------------------------------------------------------- */

const SOUNDS: Record<Sound, (ctx: AudioContext, out: AudioNode) => void> = {
  // A soft pencil tick.
  x: (ctx, out) => knock(ctx, out, 0, 3200, 0.5, 0.03),
  // The same tick, lower.
  erase: (ctx, out) => knock(ctx, out, 0, 1600, 0.45, 0.03),
  // A hollow wooden tok.
  stump: (ctx, out) => {
    tone(ctx, out, { from: 330, to: 180, length: 0.16, gain: 0.35 });
    knock(ctx, out, 0, 900, 0.5, 0.04);
  },
  // A low, muffled buzz.
  wrong: (ctx, out) => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.connect(out);
    tone(ctx, filter, { wave: 'sawtooth', from: 150, to: 95, length: 0.32, gain: 0.3 });
  },
  // A rising major arpeggio.
  win: (ctx, out) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((from, i) => {
      tone(ctx, out, { wave: 'triangle', from, at: i * 0.11, length: i === 3 ? 0.6 : 0.22, gain: 0.25 });
    });
  },
  // A falling minor line that droops at the end.
  lose: (ctx, out) => {
    [392, 311.13, 261.63].forEach((from, i) => {
      tone(ctx, out, {
        wave: 'triangle', from, to: i === 2 ? 220 : from, at: i * 0.18, length: i === 2 ? 0.6 : 0.2, gain: 0.25,
      });
    });
  },
  // Five quick knocks on wood.
  woodpecker: (ctx, out) => {
    for (let i = 0; i < 5; i++) {
      knock(ctx, out, i * 0.065, 1400, 0.8, 0.045);
    }
  },
  // Hoo-hoo.
  owl: (ctx, out) => {
    tone(ctx, out, { from: 440, to: 400, length: 0.22, gain: 0.3, vibrato: 6 });
    tone(ctx, out, { from: 400, to: 350, at: 0.3, length: 0.38, gain: 0.3, vibrato: 6 });
  },
  // A quick chitter of rising chirps.
  squirrel: (ctx, out) => {
    for (let i = 0; i < 4; i++) {
      tone(ctx, out, { from: 2200, to: 3400, at: i * 0.07, length: 0.04, gain: 0.12 });
    }
  },
};

/**
 * Plays a sound effect, unless sound is muted or audio is not yet unlocked.
 * @param sound the sound to play
 * @param delay seconds to wait before it starts
 */
export function playSound(sound: Sound, delay = 0): void {
  if (muted) {
    return;
  }
  unlock();
  if (!context || !master || context.state === 'closed') {
    return;
  }
  if (sound === 'x' || sound === 'erase') {
    const now = performance.now();
    if (now - lastX < X_GAP_MS) {
      return;
    }
    lastX = now;
  }
  const ctx = context;
  const out = master;
  if (delay > 0) {
    window.setTimeout(() => SOUNDS[sound](ctx, out), delay * 1000);
  } else {
    SOUNDS[sound](ctx, out);
  }
}
