import { generate, type Puzzle } from '../engine';
import type { PuzzleSource } from '../game/source';
import { SAVE_KEY } from '../game/storage';
import { Controller, codeFromHref, shareUrl } from './controller';

const puzzle = generate(
  { size: 5, tier: 'easy', silver: false, sizeMix: 1, shape: 1, freebies: 0 },
  11,
);

/**
 * @returns an in-memory Storage
 */
function memory(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

/**
 * @param grown the puzzle `take` returns
 * @returns a source that generates real boards for codes and a fixed board otherwise
 */
function sourceOf(grown: Puzzle = puzzle): PuzzleSource {
  return {
    warm() {
      return undefined;
    },
    invalidate() {
      return undefined;
    },
    take: () => Promise.resolve(grown),
    fromCode: (code) => {
      if (code.replace(/[\s-]/g, '').toUpperCase() === grown.code) {
        return Promise.resolve(grown);
      }
      return Promise.resolve(null);
    },
  };
}

/**
 * @param storage backing store
 * @param now clock
 * @returns a controller wired for tests
 */
function makeController(storage = memory(), now = () => 0): Controller {
  return new Controller({ storage, source: sourceOf(), now, at: () => 1_000 });
}

describe('Controller', () => {
  it('boots to the main screen', async () => {
    const controller = makeController();
    await controller.boot('http://local/');
    expect(controller.screen).toBe('main');
    expect(controller.session).toBeNull();
  });

  it('starts a puzzle and asks before replacing one that is in progress', async () => {
    const controller = makeController();
    await controller.boot('http://local/');
    await start(controller);
    expect(controller.screen).toBe('puzzle');
    expect(controller.session?.puzzle.code).toBe(puzzle.code);
    await controller.requestNewPuzzle();
    expect(controller.panel).toBe('confirm-new');
    expect(controller.screen).toBe('puzzle');
  });

  it('confirms a new puzzle', async () => {
    const controller = makeController();
    await controller.boot('http://local/');
    await start(controller);
    await controller.requestNewPuzzle();
    await controller.confirmNewPuzzle();
    expect(controller.panel).toBe('none');
    expect(controller.session?.status).toBe('playing');
  });

  it('marks a retry as a repeat and refuses it a clean star', async () => {
    const controller = makeController();
    await controller.boot('http://local/');
    await start(controller);
    controller.revealSolution();
    expect(controller.records).toHaveLength(1);
    expect(controller.records[0]?.clean).toBe(true);
    controller.showMain();
    controller.requestRetry();
    await flush();
    expect(controller.session?.isRepeat).toBe(true);
    controller.revealSolution();
    expect(controller.records).toHaveLength(2);
    expect(controller.records[1]?.repeat).toBe(true);
    expect(controller.records[1]?.clean).toBe(false);
  });

  it('does not record a loss', async () => {
    const controller = makeController();
    await controller.boot('http://local/');
    await start(controller);
    const session = controller.session;
    if (!session) {
      throw new Error('expected a session');
    }
    const wrongs: number[] = [];
    for (let cell = 0; cell < session.marks.length && wrongs.length < 3; cell++) {
      if (!puzzle.solution.includes(cell)) {
        wrongs.push(cell);
      }
    }
    for (const cell of wrongs) {
      session.doubleTap(cell);
    }
    controller.persist();
    expect(session.status).toBe('lost');
    expect(controller.records).toEqual([]);
  });

  it('pauses the timer in the background and while the main screen is up', async () => {
    let now = 0;
    const controller = makeController(memory(), () => now);
    await controller.boot('http://local/');
    await start(controller);
    now = 5_000;
    expect(controller.elapsed()).toBe(5_000);
    controller.onHide();
    now = 9_000;
    expect(controller.elapsed()).toBe(5_000);
    controller.onShow();
    now = 11_000;
    expect(controller.elapsed()).toBe(7_000);
    controller.showMain();
    now = 20_000;
    expect(controller.elapsed()).toBe(7_000);
    controller.resume();
    now = 21_000;
    expect(controller.elapsed()).toBe(8_000);
  });

  it('restores an in-progress puzzle', async () => {
    const storage = memory();
    const first = makeController(storage);
    await first.boot('http://local/');
    await start(first);
    first.session?.tap(0);
    first.persist();
    const second = makeController(storage);
    await second.boot('http://local/');
    expect(second.screen).toBe('puzzle');
    expect(second.session?.marks[0]).toBe(1);
    expect(storage.getItem(SAVE_KEY)).toBeTruthy();
  });

  it('opens a seed link and rejects a bad code', async () => {
    const controller = makeController();
    await controller.boot(`http://local/?code=${puzzle.code}`);
    expect(controller.screen).toBe('puzzle');
    expect(controller.session?.puzzle.code).toBe(puzzle.code);
    await controller.submitSeed('not-a-code');
    expect(controller.seedError).toMatch(/not valid/);
  });

  it('resumes the saved puzzle when the link names it', async () => {
    const storage = memory();
    const first = makeController(storage);
    await first.boot('http://local/');
    await start(first);
    first.session?.tap(4);
    first.persist();
    const second = makeController(storage);
    await second.boot(`http://local/#${puzzle.code}`);
    expect(second.session?.marks[4]).toBe(1);
    expect(second.session?.isRepeat).toBe(false);
  });

  it('reads codes from links', () => {
    expect(codeFromHref('http://local/?code=abc')).toBe('abc');
    expect(codeFromHref('http://local/#abc')).toBe('abc');
    expect(codeFromHref('http://local/')).toBeNull();
    expect(shareUrl('abc', 'http://local/play')).toBe('http://local/play?code=abc');
  });
});

/** Starts a puzzle when none is in progress, and lets the generator promise settle. */
async function start(controller: Controller): Promise<void> {
  await controller.requestNewPuzzle();
}

/** Lets a started promise settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
