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

/**
 * Plays a brassy note: a sawtooth through a low-pass filter that opens on
 * the attack, like a trumpet or a muted trombone.
 */
const brass = (ctx: AudioContext, out: AudioNode, options: ToneOptions & { readonly bright?: number }): void => {
  const { at = 0, length, bright = 2400 } = options;
  const start = ctx.currentTime + at;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(bright / 4, start);
  filter.frequency.exponentialRampToValueAtTime(bright, start + 0.04);
  filter.frequency.exponentialRampToValueAtTime(bright / 3, start + length);
  filter.connect(out);
  tone(ctx, filter, { ...options, wave: 'sawtooth' });
};

/* ------------------------------------------------------- *\
 *  The sounds                                             *
\* ------------------------------------------------------- */

/** How to make each sound: one set per theme. */
export type SoundSet = Readonly<Record<Sound, (ctx: AudioContext, out: AudioNode) => void>>;

/** Woodland: pencil ticks, wooden knocks, and forest animals. */
export const WOODS_SOUNDS: SoundSet = {
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

/** Puerto Vallarta: maracas, marimba, a mariachi trumpet, and beach animals. The woodpecker is the parrot and the squirrel is the gecko. */
export const VALLARTA_SOUNDS: SoundSet = {
  // One shake of a maraca.
  x: (ctx, out) => knock(ctx, out, 0, 6500, 0.55, 0.04),
  // A shorter, duller shake.
  erase: (ctx, out) => knock(ctx, out, 0, 3800, 0.45, 0.03),
  // A marimba note: a quick-fading tone with a bright overtone.
  stump: (ctx, out) => {
    tone(ctx, out, { from: 523.25, length: 0.35, gain: 0.32 });
    tone(ctx, out, { from: 2093, length: 0.06, gain: 0.08 });
  },
  // A muted trumpet's "wah-wah".
  wrong: (ctx, out) => {
    brass(ctx, out, { from: 233, length: 0.16, gain: 0.22, bright: 1200 });
    brass(ctx, out, { from: 220, to: 196, at: 0.18, length: 0.26, gain: 0.22, bright: 1000 });
  },
  // A mariachi trumpet fanfare: ta-da-da-DAAA.
  win: (ctx, out) => {
    const notes: [number, number, number][] = [[392, 0, 0.12], [523.25, 0.13, 0.12], [659.25, 0.26, 0.12], [783.99, 0.42, 0.7]];
    for (const [from, at, length] of notes) {
      brass(ctx, out, { from, at, length, gain: 0.2, vibrato: length > 0.5 ? 8 : 0 });
    }
  },
  // A sad trombone: wah, wah, wahhh.
  lose: (ctx, out) => {
    [311.13, 293.66, 277.18].forEach((from, i) => {
      brass(ctx, out, {
        from, to: i === 2 ? 233 : from, at: i * 0.28, length: i === 2 ? 0.75 : 0.24, gain: 0.22,
        bright: 900, vibrato: i === 2 ? 6 : 0,
      });
    });
  },
  // A parrot's two-part squawk.
  woodpecker: (ctx, out) => {
    brass(ctx, out, { from: 900, to: 1500, length: 0.09, gain: 0.14, bright: 3500, vibrato: 60 });
    brass(ctx, out, { from: 1400, to: 800, at: 0.11, length: 0.14, gain: 0.14, bright: 3500, vibrato: 60 });
  },
  // A tecolote: three soft, low hoots.
  owl: (ctx, out) => {
    [0, 0.2, 0.4].forEach((at, i) => {
      tone(ctx, out, { from: 360, to: 330, at, length: i === 2 ? 0.34 : 0.14, gain: 0.3, vibrato: 4 });
    });
  },
  // A gecko's clicks, speeding up.
  squirrel: (ctx, out) => {
    [0, 0.09, 0.16, 0.21, 0.25].forEach((at) => knock(ctx, out, at, 2400, 0.7, 0.025));
  },
};

/**
 * Plays a sound effect, unless sound is muted or audio is not yet unlocked.
 * @param sounds the current theme's sounds
 * @param sound the sound to play
 * @param delay seconds to wait before it starts
 */
export function playSound(sounds: SoundSet, sound: Sound, delay = 0): void {
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
    window.setTimeout(() => sounds[sound](ctx, out), delay * 1000);
  } else {
    sounds[sound](ctx, out);
  }
}
