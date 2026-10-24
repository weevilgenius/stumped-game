import { playSound, type Sound, setMuted } from './sound';

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

  it.each(SOUNDS)('plays %s', (sound) => {
    vi.spyOn(performance, 'now').mockReturnValue(SOUNDS.indexOf(sound) * 1000);
    playSound(sound);
    expect(FakeAudioContext.started).toBeGreaterThan(0);
  });

  it('stays silent while muted', () => {
    setMuted(true);
    playSound('win');
    expect(FakeAudioContext.started).toBe(0);
  });

  it('thins out X ticks during a fast drag', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100_000);
    playSound('x');
    const one = FakeAudioContext.started;
    now.mockReturnValue(100_010);
    playSound('x');
    expect(FakeAudioContext.started).toBe(one);
    now.mockReturnValue(100_100);
    playSound('x');
    expect(FakeAudioContext.started).toBe(2 * one);
  });
});
