import { type Controller, type ControllerDeps, createController } from './controller';
import { decodeSeedCode, encodeSeedCode, generate, type Puzzle } from './engine';
import { parseBoard } from './engine/testBoards';
import { beginStroke, doubleTap, type Game, newGame } from './game';
import { newSave, parseSave } from './save';
import type { GenerateRequest } from './worker';

const CODE = encodeSeedCode({ size: 5, tier: 'easy', silver: false, sizeMix: 1, shape: 1, freebies: 1 }, 4);
const SOLUTION = [1, 8, 10, 19, 22];
let nextId = 0;
const PUZZLE: Puzzle = {
  ...parseBoard(`
    CAABB
    CBBBB
    CCCCC
    CCCDD
    CCEDD
  `),
  solution: SOLUTION, givens: [], colors: [0, 1, 2, 3, 4], tier: 'easy', silver: false, code: CODE,
};

/** A controller over fake storage, generator, clocks, and prompts the test can steer. */
const setup = (store = new Map<string, string>(), errors: Partial<{ readError: boolean; writeError: boolean; backupError: boolean }> = {}) => {
  const fake = {
    store,
    time: 0,
    readError: false,
    writeError: false,
    backupError: false,
    writes: [] as string[],
    answer: true,
    questions: [] as string[],
    requests: [] as GenerateRequest[],
    signals: [] as (AbortSignal | undefined)[],
    /** When set, generation waits for the test to settle it through `pending`. */
    manual: false,
    pending: [] as { resolve: () => void; reject: () => void }[],
    ...errors,
  };
  const deps: ControllerDeps = {
    storage: {
      getItem: (key) => {
        if (fake.readError) {
          throw new Error('unavailable');
        }
        return store.get(key) ?? null;
      },
      setItem: (key, value) => {
        fake.writes.push(key);
        if (fake.writeError || (fake.backupError && key.startsWith('recovery.'))) {
          throw new Error('full');
        }
        store.set(key, value);
      },
    },
    generate: (request, signal) => {
      fake.requests.push(request);
      fake.signals.push(signal);
      if (!fake.manual) {
        return Promise.resolve(generate(request.settings, request.seed));
      }
      return new Promise((resolve, reject) => fake.pending.push({
        resolve: () => resolve(generate(request.settings, request.seed)),
        reject: () => reject(new Error('worker failed')),
      }));
    },
    now: () => fake.time,
    date: () => 1000,
    createId: () => `play-${++nextId}`,
    random: () => 0.5,
    confirm: (question) => {
      fake.questions.push(question);
      return fake.answer;
    },
  };
  return { fake, controller: createController(deps) };
};

/** Lets pending generation promises settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

const game = (controller: Controller): Game => controller.game!;

const solve = (controller: Controller): void => {
  for (const cell of SOLUTION) {
    doubleTap(game(controller), cell, beginStroke(game(controller), cell) !== null);
    controller.changed();
  }
};

/** A store holding a game in progress, left open or not. */
const savedStore = (open: boolean, overrides: Partial<Game> = {}): Map<string, string> => {
  const current = { ...newGame(PUZZLE, false, 'saved-play'), ...overrides };
  if (current.status === 'won') {
    current.marks = current.marks.map((_, cell) => SOLUTION.includes(cell) ? 3 : 0);
  }
  if (current.status === 'lost') {
    current.marks = current.marks.map((mark, cell) => [0, 2, 3].includes(cell) ? 2 : mark);
    current.acorns = 0;
    current.acornsLost = 3;
  }
  return new Map([['save', JSON.stringify({ ...newSave(), game: current, open })]]);
};

const saved = (store: Map<string, string>) => parseSave(store.get('save')!)!;

describe('navigation', () => {
  it('boots to the menu with nothing saved, and prepares a puzzle', () => {
    const { fake, controller } = setup();
    controller.boot(null);
    expect([controller.screen, controller.game, fake.requests.length]).toEqual(['menu', null, 1]);
  });

  it('returns to a puzzle left open, but not one left from the menu', () => {
    const open = setup(savedStore(true)).controller;
    open.boot(null);
    expect(open.screen).toBe('puzzle');
    const closed = setup(savedStore(false)).controller;
    closed.boot(null);
    expect(closed.screen).toBe('menu');
  });

  it('plays a linked seed code and remembers it was played', async () => {
    const { fake, controller } = setup();
    controller.boot(CODE);
    await flush();
    expect(controller.screen).toBe('puzzle');
    expect(game(controller).puzzle.code).toBe(CODE);
    expect(saved(fake.store).played).toEqual([CODE]);
    expect(saved(fake.store).open).toBe(true);
  });

  it('resumes instead of generating when the code is the puzzle in progress', () => {
    const { fake, controller } = setup(savedStore(false, { puzzle: { ...PUZZLE, code: CODE } }));
    expect(controller.playCode(CODE)).toBe(true);
    expect(controller.screen).toBe('puzzle');
    expect(fake.requests).toEqual([]);
    expect(fake.questions).toEqual([]);
  });

  it('refuses an invalid code', () => {
    expect(setup().controller.playCode('nonsense')).toBe(false);
  });

  it('notifies subscribers until they unsubscribe', () => {
    const { controller } = setup(savedStore(false));
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.resume();
    unsubscribe();
    controller.showMenu();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('replacing a game', () => {
  it('asks before abandoning a game in progress, and keeps it when declined', async () => {
    const { fake, controller } = setup(savedStore(false));
    const before = game(controller);
    fake.answer = false;
    await controller.newPuzzle();
    controller.retry();
    expect(controller.playCode(encodeSeedCode(decodeSeedCode(CODE)!.settings, 5))).toBe(true);
    await flush();
    expect(fake.questions).toHaveLength(3);
    expect(fake.requests).toEqual([]);
    expect(controller.game).toBe(before);
  });

  it('replaces the game when confirmed, taking the prepared puzzle and preparing the next', async () => {
    const { fake, controller } = setup(savedStore(false));
    controller.boot(null);
    await controller.newPuzzle();
    expect(fake.requests).toHaveLength(2);
    expect(game(controller).puzzle.code).toBe(encodeSeedCode(fake.requests[0].settings, fake.requests[0].seed));
    expect(controller.screen).toBe('puzzle');
    expect(controller.busy).toBe(false);
  });

  it('does not ask about a finished game', async () => {
    const { fake, controller } = setup(savedStore(false, { status: 'won' }));
    await controller.newPuzzle();
    expect(fake.questions).toEqual([]);
    expect(game(controller).status).toBe('playing');
  });

  it('retries a finished game from a blank board, as a repeat', () => {
    const store = savedStore(false, { status: 'lost', marks: new Array<number>(25).fill(1) });
    const data = saved(store);
    data.played = [CODE];
    store.set('save', JSON.stringify(data));
    const { fake, controller } = setup(store);
    controller.retry();
    expect(fake.questions).toEqual([]);
    expect(game(controller).repeat).toBe(true);
    expect(game(controller).marks.every((mark) => mark === 0)).toBe(true);
    expect(controller.screen).toBe('puzzle');
  });

  it('prepares a new puzzle when generator settings change, but not for the timer', () => {
    const { fake, controller } = setup();
    controller.boot(null);
    controller.updateSettings({ timer: false, silver: false });
    expect(fake.requests).toHaveLength(1);
    controller.updateSettings({ timer: false, silver: false, size: 6 });
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1].settings.size).toBe(6);
  });
});

describe('generation failures and stale results', () => {
  it('keeps the current game after a failure, reports it, and succeeds on retry', async () => {
    const { fake, controller } = setup(savedStore(false, { status: 'won' }));
    fake.manual = true;
    controller.boot(null);
    const before = game(controller);
    const start = controller.newPuzzle();
    fake.pending[0].reject();
    await start;
    expect(controller.game).toBe(before);
    expect(controller.busy).toBe(false);
    expect(controller.screen).toBe('menu');
    expect(controller.generationError).not.toBeNull();
    // The failed puzzle was dropped; the one prepared after it is used.
    const again = controller.newPuzzle();
    expect(controller.generationError).toBeNull();
    fake.pending[1].resolve();
    await again;
    expect(game(controller).puzzle.code).toBe(encodeSeedCode(fake.requests[1].settings, fake.requests[1].seed));
  });

  it('asks the generator again after a prepared puzzle fails', async () => {
    const { fake, controller } = setup();
    fake.manual = true;
    controller.boot(null);
    fake.pending[0].reject();
    await flush();
    const start = controller.newPuzzle();
    expect(fake.requests).toHaveLength(3);
    fake.pending[1].resolve();
    await start;
    expect(game(controller).puzzle.code).toBe(encodeSeedCode(fake.requests[1].settings, fake.requests[1].seed));
  });

  it('ignores further starts while one is being generated', async () => {
    const { fake, controller } = setup();
    fake.manual = true;
    controller.boot(null);
    const start = controller.newPuzzle();
    void controller.newPuzzle();
    expect(controller.playCode(CODE)).toBe(true);
    expect(fake.requests).toHaveLength(2);
    expect(controller.busy).toBe(true);
    fake.pending[0].resolve();
    await start;
    expect(controller.busy).toBe(false);
    expect(fake.questions).toEqual([]);
  });

  it('asks for a linked puzzle before preparing the next', () => {
    const { fake, controller } = setup();
    fake.manual = true;
    controller.boot(CODE);
    expect(fake.requests.map((request) => encodeSeedCode(request.settings, request.seed))[0]).toBe(CODE);
    expect(fake.requests).toHaveLength(2);
  });

  it('drops a seed-code result that arrives after the player moved on, and stops generating it', async () => {
    const { fake, controller } = setup(savedStore(false));
    fake.manual = true;
    const before = game(controller);
    controller.playCode(encodeSeedCode(decodeSeedCode(CODE)!.settings, 5));
    controller.resume();
    controller.showMenu();
    expect(controller.busy).toBe(false);
    expect(fake.signals[0]!.aborted).toBe(true);
    fake.pending[0].resolve();
    await flush();
    expect(controller.game).toBe(before);
    expect(controller.screen).toBe('menu');
  });

  it('drops a pending start when generator settings change, and prepares for the new ones', async () => {
    const { fake, controller } = setup();
    fake.manual = true;
    controller.boot(null);
    const start = controller.newPuzzle();
    controller.updateSettings({ timer: false, silver: false, size: 6 });
    expect(controller.busy).toBe(false);
    // The taken puzzle and the one prepared under the old settings are both stopped.
    expect(fake.signals.map((signal) => signal!.aborted)).toEqual([true, true, false]);
    fake.pending.forEach(({ resolve }) => resolve());
    await start;
    expect(controller.game).toBeNull();
    expect(fake.requests.at(-1)!.settings.size).toBe(6);
    await controller.newPuzzle();
    expect(game(controller).puzzle.size).toBe(6);
  });
});

describe('play time', () => {
  it('counts only while the puzzle is on screen and the page is visible', () => {
    const { fake, controller } = setup(savedStore(false));
    fake.time = 1000;
    expect(controller.tick()).toBe(0);
    controller.resume();
    fake.time = 1500;
    expect(controller.tick()).toBe(500);

    controller.setHidden(true);
    fake.time = 6500;
    expect(controller.tick()).toBe(500);
    controller.setHidden(false);
    fake.time = 6600;
    expect(controller.tick()).toBe(600);

    controller.showMenu();
    fake.time = 20000;
    expect(controller.tick()).toBe(600);
    controller.resume();
    fake.time = 20100;
    expect(controller.tick()).toBe(700);
  });

  it('saves the time when the page is hidden', () => {
    const { fake, controller } = setup(savedStore(false));
    controller.resume();
    fake.time = 800;
    controller.setHidden(true);
    expect(saved(fake.store).game?.elapsed).toBe(800);
  });

  it('starts a new game from zero', async () => {
    const { fake, controller } = setup(savedStore(false, { status: 'won', elapsed: 5000 }));
    await controller.newPuzzle();
    fake.time = 300;
    expect(controller.tick()).toBe(300);
  });

  it('does not count a game resumed while the page is hidden', () => {
    const { fake, controller } = setup(savedStore(false));
    controller.setHidden(true);
    controller.resume();
    fake.time = 1000;
    expect(controller.tick()).toBe(0);
  });
});

describe('completion', () => {
  it('records a win once, freezes the time, and survives a relaunch', () => {
    const { fake, controller } = setup(savedStore(false));
    controller.resume();
    fake.time = 2000;
    solve(controller);
    expect(game(controller).status).toBe('won');
    expect(controller.results).toHaveLength(1);
    expect(controller.results[0]).toMatchObject({ time: 2000, date: 1000 });

    fake.time = 5000;
    controller.changed();
    controller.showMenu();
    expect(controller.tick()).toBe(2000);
    expect(controller.results).toHaveLength(1);

    const relaunched = setup(fake.store).controller;
    relaunched.boot(null);
    relaunched.changed();
    expect(relaunched.screen).toBe('menu');
    expect(relaunched.results).toHaveLength(1);
    expect(relaunched.game?.elapsed).toBe(2000);
  });

  it('records nothing for a loss', () => {
    const { controller } = setup(savedStore(false, { acorns: 1, acornsLost: 2, marks: PUZZLE.regions.map((_, cell) => [0, 2].includes(cell) ? 2 : 0) }));
    controller.resume();
    const wrong = 3;
    doubleTap(game(controller), wrong, beginStroke(game(controller), wrong) !== null);
    controller.changed();
    expect(game(controller).status).toBe('lost');
    expect(controller.results).toEqual([]);
  });
});

describe('persistence and recovery', () => {
  it('retains the play ID across reloads and gives retries new IDs', () => {
    const { fake, controller } = setup(savedStore(false));
    const before = game(controller).id;
    controller.changed();
    const restored = setup(fake.store).controller;
    expect(game(restored).id).toBe(before);
    restored.retry();
    expect(game(restored).id).not.toBe(before);
  });

  it('writes a completion and the won game atomically, once per change', () => {
    const { fake, controller } = setup(savedStore(false));
    fake.writes.length = 0;
    solve(controller);
    expect(fake.writes).toEqual(SOLUTION.map(() => 'save'));
    const data = saved(fake.store);
    expect(data.game?.status).toBe('won');
    expect(data.results.map((result) => result.id)).toEqual([game(controller).id]);
  });

  it('reconciles an unrecorded restored win and never duplicates it', () => {
    const store = savedStore(false, { status: 'won' });
    const { controller } = setup(store);
    expect(controller.results).toHaveLength(1);
    controller.changed();
    const relaunched = setup(store).controller;
    expect(relaunched.results).toHaveLength(1);
    expect(relaunched.results[0].id).toBe(game(relaunched).id);
  });

  it('keeps the previous consistent save on write failure, then retries without duplicating a win', () => {
    const { fake, controller } = setup(savedStore(false));
    controller.changed();
    const before = fake.store.get('save');
    fake.writeError = true;
    solve(controller);
    expect(fake.store.get('save')).toBe(before);
    expect(saved(fake.store).results).toEqual([]);
    expect(controller.results).toHaveLength(1);
    expect(controller.storageError).toContain('could not be saved');
    fake.writeError = false;
    controller.changed();
    expect(controller.storageError).toBeNull();
    expect(saved(fake.store).game?.status).toBe('won');
    expect(setup(fake.store).controller.results).toHaveLength(1);
  });

  it('notifies subscribers when a storage error appears and clears', () => {
    const { fake, controller } = setup(savedStore(false));
    const listener = vi.fn();
    controller.subscribe(listener);
    fake.writeError = true;
    controller.changed();
    controller.changed();
    expect(listener).toHaveBeenCalledTimes(1);
    fake.writeError = false;
    controller.changed();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not write after a read failure, even when storage becomes readable', () => {
    const store = savedStore(false);
    const original = store.get('save');
    const { fake, controller } = setup(store, { readError: true });
    expect(controller.game).toBeNull();
    expect(controller.storageError).toContain('unavailable');
    fake.readError = false;
    controller.changed();
    expect(fake.writes).toEqual([]);
    expect(store.get('save')).toBe(original);
  });

  it.each(['{', '{"version":2}'])('backs up rejected saves before resetting: %s', (raw) => {
    const store = new Map([['save', raw], ['settings', '{"timer":false,"silver":true}']]);
    const { fake, controller } = setup(store);
    expect(controller.settings).toEqual(newSave().settings);
    expect(controller.recoveryNotice).toContain('recovery copy was kept');
    expect(fake.writes[0]).toMatch(/^recovery\./);
    expect(fake.writes[1]).toBe('save');
    expect(JSON.parse(store.get(fake.writes[0])!) as unknown).toEqual({ date: 1000, entries: { save: raw } });
    const relaunched = setup(store).controller;
    expect(relaunched.settings).toEqual(newSave().settings);
    expect(relaunched.recoveryNotice).toBeNull();
  });

  it('leaves rejected data untouched and disables writes when recovery backup fails', () => {
    const store = new Map([['save', '{']]);
    const { fake, controller } = setup(store, { backupError: true });
    expect(controller.recoveryNotice).toContain('original data was left untouched');
    expect(controller.storageError).toContain('cannot be saved');
    fake.backupError = false;
    controller.changed();
    expect(store.get('save')).toBe('{');
    expect(fake.writes).toHaveLength(1);
  });

  it('migrates all legacy data, leaving old keys intact and preferring the new document on reload', () => {
    const data = saved(savedStore(true));
    const { id: _id, ...legacyGame } = data.game!;
    const store = new Map([
      ['game', JSON.stringify(legacyGame)], ['open', 'true'], ['played', JSON.stringify([CODE])],
      ['settings', '{"timer":false,"silver":true}'], ['results', '[]'], ['stumped.v1', 'astra'],
    ]);
    const { fake, controller } = setup(store);
    controller.boot(null);
    expect(controller.screen).toBe('puzzle');
    expect(controller.settings.timer).toBe(false);
    expect(game(controller).id).toBeTruthy();
    expect(fake.writes.every((key) => key === 'save')).toBe(true);
    expect(store.get('game')).toBe(JSON.stringify(legacyGame));
    expect(store.get('stumped.v1')).toBe('astra');
    store.set('game', '{');
    const relaunched = setup(store).controller;
    expect(game(relaunched).id).toBe(game(controller).id);
    expect(relaunched.recoveryNotice).toBeNull();
  });

  it('preserves valid legacy data if the migration write fails, and migrates on the next launch', () => {
    const store = new Map([['settings', '{"timer":false,"silver":true}']]);
    const { controller } = setup(store, { writeError: true });
    expect(controller.settings.timer).toBe(false);
    expect(controller.storageError).toContain('could not be saved');
    expect(store.has('save')).toBe(false);
    const next = setup(store).controller;
    expect(next.settings.timer).toBe(false);
    expect(saved(store).settings).toEqual(next.settings);
  });

  it('backs up every raw legacy section and resets the whole save if one is invalid', () => {
    const store = new Map([['settings', '{"timer":false,"silver":true}'], ['game', '{']]);
    const { fake, controller } = setup(store);
    expect(controller.settings).toEqual(newSave().settings);
    expect(JSON.parse(store.get(fake.writes[0])!) as unknown).toEqual({
      date: 1000, entries: { settings: store.get('settings'), game: '{', results: null, played: null, open: null },
    });
    expect(store.get('game')).toBe('{');
  });

  it('links a migrated won game to the latest existing result without recording another completion', () => {
    const data = saved(savedStore(false, { status: 'won' }));
    const { id: _id, ...legacyGame } = data.game!;
    const legacyResult = { code: CODE, size: 5, tier: 'easy', silver: false, date: 1000,
      time: 0, hints: [], acornsLost: 0, repeat: false };
    const store = new Map([['game', JSON.stringify(legacyGame)], ['results', JSON.stringify([legacyResult])]]);
    const { controller } = setup(store);
    expect(controller.results).toHaveLength(1);
    expect(controller.results[0].id).toBe(game(controller).id);
    expect(setup(store).controller.results).toHaveLength(1);
  });
});
