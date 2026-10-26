import type * as SoundModule from './sound';

/** A controllable audio context for browser startup and interruption tests. */
class BrowserAudioContext {
  static instances: BrowserAudioContext[] = [];
  state = 'suspended';
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  createGain = (): unknown => ({ gain: { value: 0 }, connect: vi.fn() });

  constructor() {
    BrowserAudioContext.instances.push(this);
  }
}

describe('browser audio lifecycle', () => {
  let sound: typeof SoundModule;
  let listeners: [string, EventListenerOrEventListenerObject][];

  beforeEach(async () => {
    vi.resetModules();
    BrowserAudioContext.instances = [];
    vi.stubGlobal('AudioContext', BrowserAudioContext);
    vi.stubGlobal('webkitAudioContext', undefined);
    listeners = [];
    const add = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      if (listener) {
        listeners.push([type, listener]);
      }
      add(type, listener, options);
    });
    sound = await import('./sound');
  });

  afterEach(() => {
    for (const [type, listener] of listeners) {
      document.removeEventListener(type, listener, true);
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates audio only after interaction', () => {
    sound.setMuted(false);
    expect(BrowserAudioContext.instances).toHaveLength(0);
    document.dispatchEvent(new Event('touchend'));
    expect(BrowserAudioContext.instances).toHaveLength(1);
    expect(BrowserAudioContext.instances[0].resume).toHaveBeenCalledOnce();
  });

  it('selects playback before creating the context so iOS does not obey the silent switch', () => {
    const session = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession: session });
    const create = vi.fn(function () {
      expect(session.type).toBe('playback');
      return new BrowserAudioContext();
    });
    vi.stubGlobal('AudioContext', create);
    document.dispatchEvent(new Event('touchend'));
    expect(create).toHaveBeenCalledOnce();
  });

  it('works without the Audio Session API', () => {
    document.dispatchEvent(new Event('pointerdown'));
    expect(BrowserAudioContext.instances).toHaveLength(1);
  });

  it('still creates audio when playback session selection is rejected', () => {
    const session = { set type(_value: string) { throw new Error('Unsupported session'); } };
    vi.stubGlobal('navigator', { audioSession: session });
    document.dispatchEvent(new Event('touchend'));
    expect(BrowserAudioContext.instances).toHaveLength(1);
  });

  it('uses the prefixed context on older Safari', () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', BrowserAudioContext);
    document.dispatchEvent(new Event('touchend'));
    expect(BrowserAudioContext.instances).toHaveLength(1);
  });

  it('leaves gameplay working when Web Audio is unavailable', () => {
    vi.stubGlobal('AudioContext', undefined);
    const win = vi.fn();
    sound.playSound({ ...sound.WOODS_SOUNDS, win }, 'win');
    expect(win).not.toHaveBeenCalled();
  });

  it('retries context creation after a failure', () => {
    vi.stubGlobal('AudioContext', vi.fn(function () { throw new Error('Unavailable'); }));
    document.dispatchEvent(new Event('touchend'));
    vi.stubGlobal('AudioContext', BrowserAudioContext);
    document.dispatchEvent(new Event('touchend'));
    expect(BrowserAudioContext.instances).toHaveLength(1);
  });

  it('retries rejected resumes and iOS interruptions on the next gesture', async () => {
    document.dispatchEvent(new Event('touchend'));
    const context = BrowserAudioContext.instances[0];
    context.state = 'interrupted';
    context.resume.mockRejectedValueOnce(new Error('Gesture required'));
    document.dispatchEvent(new Event('touchend'));
    await Promise.resolve();
    document.dispatchEvent(new Event('keydown'));
    expect(context.resume).toHaveBeenCalledTimes(3);
    expect(BrowserAudioContext.instances).toHaveLength(1);
  });

  it('recreates a closed context', () => {
    document.dispatchEvent(new Event('touchend'));
    BrowserAudioContext.instances[0].state = 'closed';
    document.dispatchEvent(new Event('click'));
    expect(BrowserAudioContext.instances).toHaveLength(2);
  });

  it('does not unlock muted audio and unlocks as soon as sound is enabled', () => {
    sound.setMuted(true);
    document.dispatchEvent(new Event('touchend'));
    expect(BrowserAudioContext.instances).toHaveLength(0);
    sound.setMuted(false);
    expect(BrowserAudioContext.instances).toHaveLength(1);
  });
});
