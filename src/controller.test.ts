import { type Controller, type ControllerDeps, createController } from './controller';
import { encodeSeedCode, type Puzzle } from './engine';
import { parseBoard } from './engine/testBoards';
import { beginStroke, doubleTap, type Game, newGame } from './game';
import type { GenerateRequest } from './worker';

const CODE = '1D580000048';
const SOLUTION = [1, 8, 10, 19, 22];
const PUZZLE: Puzzle = {
  ...parseBoard(`
    CAABB
    CBBBB
    CCCCC
    CCCDD
    CCEDD
  `),
  solution: SOLUTION, givens: [], colors: [0, 1, 2, 3, 4], tier: 'easy', silver: false, code: 'TEST',
};

/** A controller over fake storage, generator, clocks, and prompts the test can steer. */
const setup = (store = new Map<string, string>()) => {
  const fake = {
    store,
    time: 0,
    answer: true,
    questions: [] as string[],
    requests: [] as GenerateRequest[],
  };
  const deps: ControllerDeps = {
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
    generate: (request) => {
      fake.requests.push(request);
      return Promise.resolve({ ...PUZZLE, code: encodeSeedCode(request.settings, request.seed) });
    },
    now: () => fake.time,
    date: () => 1000,
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
const savedStore = (open: boolean, overrides: Partial<Game> = {}): Map<string, string> => new Map([
  ['game', JSON.stringify({ ...newGame(PUZZLE, false), ...overrides })],
  ['open', JSON.stringify(open)],
]);

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
    expect(JSON.parse(fake.store.get('played')!)).toEqual([CODE]);
    expect(JSON.parse(fake.store.get('open')!)).toBe(true);
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
    expect(controller.playCode(CODE)).toBe(true);
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
    store.set('played', JSON.stringify(['TEST']));
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
    expect((JSON.parse(fake.store.get('game')!) as Game).elapsed).toBe(800);
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
    const { controller } = setup(savedStore(false, { acorns: 1 }));
    controller.resume();
    const wrong = PUZZLE.solution[0] + 1;
    doubleTap(game(controller), wrong, beginStroke(game(controller), wrong) !== null);
    controller.changed();
    expect(game(controller).status).toBe('lost');
    expect(controller.results).toEqual([]);
  });
});
