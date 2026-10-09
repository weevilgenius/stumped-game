import {
  decodeSeedCode, encodeSeedCode, type GeneratorSettings, type Puzzle, randomSettings,
} from './engine';
import { type Game, newGame, type Result, resultOf } from './game';
import type { GenerateRequest } from './worker';

/* ========================================================= *\
 *  Application controller: storage, puzzle generation,      *
 *  navigation, play time, and completion recording. The     *
 *  DOM screens and the puzzle scene call it; neither saves  *
 *  nor generates on its own.                                *
\* ========================================================= */

/** Player settings. A missing generator setting means random. */
export interface Settings extends Partial<Pick<GeneratorSettings, 'size' | 'tier' | 'sizeMix' | 'shape' | 'freebies'>> {
  /** Show the timer during play. */
  timer: boolean;
  /** Give every puzzle a single acorn. */
  silver: boolean;
}

/** The screen that is up. */
export type Screen = 'menu' | 'puzzle';

/** What the controller reaches the outside world through. Tests pass fakes. */
export interface ControllerDeps {
  /** Where saves live. Keys are unprefixed; the caller adds any prefix. */
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  /** Generates a puzzle, off the main thread in the browser. */
  readonly generate: (request: GenerateRequest) => Promise<Puzzle>;
  /** Monotonic clock for play time, in milliseconds. */
  readonly now: () => number;
  /** Wall clock for result dates, in milliseconds. */
  readonly date: () => number;
  /** Random source for prepared puzzles. */
  readonly random: () => number;
  /** Asks the player a yes or no question. */
  readonly confirm: (question: string) => boolean;
}

/** The application state and the actions that change it. */
export interface Controller {
  /** Current settings. */
  readonly settings: Readonly<Settings>;
  /** The current puzzle: the most recent one, in progress or finished. */
  readonly game: Game | null;
  /** Every completed play. */
  readonly results: readonly Result[];
  /** The screen that is up. */
  readonly screen: Screen;
  /** True while a puzzle is being generated. */
  readonly busy: boolean;
  /** Starts up: plays a linked seed code, or returns to a puzzle left open. */
  readonly boot: (code: string | null) => void;
  /** Starts a new puzzle, after confirming if one is in progress. */
  readonly newPuzzle: () => Promise<void>;
  /** Starts the current puzzle over from a blank board, after confirming if it is in progress. */
  readonly retry: () => void;
  /**
   * Plays the puzzle a seed code stands for. Resumes instead if it is already in progress.
   * @returns false if the code is not valid
   */
  readonly playCode: (text: string) => boolean;
  /** Returns to the puzzle in progress. */
  readonly resume: () => void;
  /** Leaves the puzzle for the main screen. */
  readonly showMenu: () => void;
  /** Replaces the settings and prepares a puzzle to match. */
  readonly updateSettings: (settings: Settings) => void;
  /** Saves after a change to the game, and records a win the first time it happens. */
  readonly changed: () => void;
  /** @returns play time so far, in milliseconds */
  readonly tick: () => number;
  /** Pauses play time while the page is hidden. */
  readonly setHidden: (hidden: boolean) => void;
  /**
   * @param listener called after the screen, game, or busy state changes
   * @returns a function that removes the listener
   */
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * Creates the controller and loads saved state.
 * @param deps storage, generator, clocks, and prompts
 * @returns the controller
 */
export function createController(deps: ControllerDeps): Controller {
  /* ------------------------------------------------------- *\
   *  Storage                                                *
  \* ------------------------------------------------------- */

  const load = <T>(key: string, fallback: T): T => {
    try {
      return (JSON.parse(deps.storage.getItem(key) ?? 'null') as T | null) ?? fallback;
    } catch {
      return fallback;
    }
  };

  const save = (key: string, value: unknown): void => {
    try {
      deps.storage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage is full or blocked. Play goes on, unsaved.
    }
  };

  let settings = load<Settings>('settings', { timer: true, silver: false });
  let game = load<Game | null>('game', null);
  const results = load<Result[]>('results', []);
  /** Seed codes of every puzzle started on this device. */
  const played = load<string[]>('played', []);
  let screen: Screen = 'menu';
  let busy = false;

  const listeners = new Set<() => void>();
  const emit = (): void => listeners.forEach((listener) => listener());

  /* ------------------------------------------------------- *\
   *  Play time: runs only while a game in progress is on    *
   *  screen and the page is visible                         *
  \* ------------------------------------------------------- */

  let hidden = false;
  /** When the clock last started or was folded into game.elapsed, or null while paused. */
  let runningFrom: number | null = null;
  /** Whether the current game's win is already recorded, or it was finished before this launch. */
  let recorded = game?.status !== 'playing';

  /** Adds the running span to the game's time and pauses. */
  const fold = (): void => {
    if (runningFrom !== null && game) {
      game.elapsed += Math.max(0, deps.now() - runningFrom);
    }
    runningFrom = null;
  };

  /** Folds in the running span, then runs the clock if play should be timed. */
  const syncClock = (): void => {
    fold();
    if (screen === 'puzzle' && !hidden && game?.status === 'playing') {
      runningFrom = deps.now();
    }
  };

  /* ------------------------------------------------------- *\
   *  Puzzle generation                                      *
  \* ------------------------------------------------------- */

  /** The next puzzle, generated ahead of time for the settings it was made under. */
  let prepared: { key: string; puzzle: Promise<Puzzle> } | null = null;

  const prepare = (): Promise<Puzzle> => {
    const { timer: _timer, silver, ...fixed } = settings;
    const key = JSON.stringify([silver, fixed]);
    if (prepared?.key !== key) {
      // With the setting off, about one puzzle in five is still silver, unless size and difficulty are both fixed.
      const always = silver || (fixed.size !== undefined && fixed.tier !== undefined ? false : undefined);
      const request = {
        settings: randomSettings(deps.random, { ...fixed, silver: always }),
        seed: Math.floor(deps.random() * 2 ** 32),
      };
      prepared = { key, puzzle: deps.generate(request) };
    }
    return prepared.puzzle;
  };

  const takePrepared = (): Promise<Puzzle> => {
    const puzzle = prepare();
    prepared = null;
    void prepare();
    return puzzle;
  };

  /* ------------------------------------------------------- *\
   *  Navigation                                             *
  \* ------------------------------------------------------- */

  const show = (next: Screen): void => {
    screen = next;
    // Remembered so a relaunch mid-puzzle lands back on the puzzle.
    save('open', next === 'puzzle');
    syncClock();
    emit();
  };

  /** Starts a puzzle from a blank board. Any play after the first on this device is a repeat. */
  const play = (puzzle: Puzzle): void => {
    fold();
    game = newGame(puzzle, played.includes(puzzle.code));
    recorded = false;
    if (!game.repeat) {
      played.push(puzzle.code);
      save('played', played);
    }
    save('game', game);
    show('puzzle');
  };

  const mayAbandon = (question: string): boolean => game?.status !== 'playing' || deps.confirm(question);

  const generating = async (puzzle: Promise<Puzzle>): Promise<void> => {
    busy = true;
    emit();
    try {
      play(await puzzle);
    } finally {
      busy = false;
      emit();
    }
  };

  const resume = (): void => {
    if (game?.status === 'playing') {
      show('puzzle');
    }
  };

  const playCode = (text: string): boolean => {
    const decoded = decodeSeedCode(text);
    if (!decoded) {
      return false;
    }
    if (game?.status === 'playing' && game.puzzle.code === encodeSeedCode(decoded.settings, decoded.seed)) {
      resume();
    } else if (mayAbandon('Abandon the puzzle in progress and play this one?')) {
      void generating(deps.generate(decoded));
    }
    return true;
  };

  return {
    get settings() {
      return settings;
    },
    get game() {
      return game;
    },
    results,
    get screen() {
      return screen;
    },
    get busy() {
      return busy;
    },
    boot: (code) => {
      void prepare();
      if (code) {
        playCode(code);
      } else if (load('open', false)) {
        resume();
      }
    },
    newPuzzle: async () => {
      if (mayAbandon('Abandon the puzzle in progress and start a new one?')) {
        await generating(takePrepared());
      }
    },
    retry: () => {
      if (game && mayAbandon('Start this puzzle over from a blank board?')) {
        play(game.puzzle);
      }
    },
    playCode,
    resume,
    showMenu: () => show('menu'),
    updateSettings: (next) => {
      settings = next;
      save('settings', settings);
      void prepare();
    },
    changed: () => {
      syncClock();
      if (!game) {
        return;
      }
      if (game.status === 'won' && !recorded) {
        recorded = true;
        results.push(resultOf(game, deps.date()));
        save('results', results);
      }
      save('game', game);
    },
    tick: () => {
      syncClock();
      return game?.elapsed ?? 0;
    },
    setHidden: (value) => {
      hidden = value;
      syncClock();
      if (value && game) {
        save('game', game);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
