import { playSound, type Sound, setMuted, VALLARTA_SOUNDS, WOODS_SOUNDS } from './sound';

/** Counts the audio nodes each sound starts, standing in for Web Audio. */
class FakeAudioContext {
  static started = 0;
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  resume = (): Promise<void> => Promise.resolve();
  private node = (): Record<string, unknown> => {
    const param = { value: 0, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined };
    const node: Record<string, unknown> = {
      gain: param, frequency: param, Q: param, type: '', buffer: null,
      connect: (next: unknown) => next,
      start: () => { FakeAudioContext.started++; },
      stop: () => undefined,
    };
    return node;
  };
  createGain = this.node;
  createOscillator = this.node;
  createBiquadFilter = this.node;
  createBufferSource = this.node;
  createBuffer = (_channels: number, length: number): { getChannelData: () => Float32Array } => ({
    getChannelData: () => new Float32Array(length),
  });
}

const SOUNDS: Sound[] = ['x', 'erase', 'stump', 'wrong', 'win', 'lose', 'woodpecker', 'owl', 'squirrel'];

describe('sound effects', () => {
  beforeAll(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    setMuted(false);
    FakeAudioContext.started = 0;
  });

  const SETS = { woods: WOODS_SOUNDS, vallarta: VALLARTA_SOUNDS };
  const cases = Object.entries(SETS).flatMap(([theme, set]) => SOUNDS.map((sound) => [theme, sound, set] as const));

  it.each(cases)('plays the %s %s', (_theme, sound, set) => {
    vi.spyOn(performance, 'now').mockReturnValue(cases.findIndex((c) => c[1] === sound && c[2] === set) * 1000);
    playSound(set, sound);
    expect(FakeAudioContext.started).toBeGreaterThan(0);
  });

  it('stays silent while muted', () => {
    setMuted(true);
    playSound(WOODS_SOUNDS, 'win');
    expect(FakeAudioContext.started).toBe(0);
  });

  it('thins out X ticks during a fast drag', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100_000);
    playSound(WOODS_SOUNDS, 'x');
    const one = FakeAudioContext.started;
    now.mockReturnValue(100_010);
    playSound(WOODS_SOUNDS, 'x');
    expect(FakeAudioContext.started).toBe(one);
    now.mockReturnValue(100_100);
    playSound(WOODS_SOUNDS, 'x');
    expect(FakeAudioContext.started).toBe(2 * one);
  });
});
