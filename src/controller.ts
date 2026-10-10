import {
  decodeSeedCode, encodeSeedCode, type GeneratorSettings, type Puzzle, randomSettings,
} from './engine';
import { type Game, newGame, type Result, resultOf } from './game';
import { LEGACY_KEYS, migrateSave, newSave, parseSave } from './save';
import type { Generate } from './generator';

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
  /** Generates a puzzle, off the main thread in the browser. Aborted when no longer wanted. */
  readonly generate: Generate;
  /** Monotonic clock for play time, in milliseconds. */
  readonly now: () => number;
  /** Wall clock for result dates, in milliseconds. */
  readonly date: () => number;
  /** Creates unique play and recovery identifiers. */
  readonly createId: () => string;
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
  /** Recovery notice for this launch, or null. */
  readonly recoveryNotice: string | null;
  /** Current storage failure, or null after a successful write. */
  readonly storageError: string | null;
  /** Why the last puzzle could not be generated, or null. Cleared by the next start. */
  readonly generationError: string | null;
  /** Starts up: plays a linked seed code, or returns to a puzzle left open. */
  readonly boot: (code: string | null) => void;
  /** Starts a new puzzle, after confirming if one is in progress. Ignored while one is being generated. */
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
  /** Replaces the settings and prepares a puzzle to match. Drops a pending start made under the old settings. */
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

  let data = newSave();
  let recoveryNotice: string | null = null;
  let storageError: string | null = null;
  let writable = true;
  let needsSave = false;
  let rejected: Record<string, string | null> | null = null;
  try {
    const raw = deps.storage.getItem('save');
    if (raw !== null) {
      const parsed = parseSave(raw);
      if (parsed) {
        data = parsed;
      } else {
        rejected = { save: raw };
      }
    } else {
      const legacy = Object.fromEntries(LEGACY_KEYS.map((key) => [key, deps.storage.getItem(key)])) as Record<typeof LEGACY_KEYS[number], string | null>;
      if (LEGACY_KEYS.some((key) => legacy[key] !== null)) {
        const migrated = migrateSave(legacy, deps.createId);
        if (migrated) {
          data = migrated;
          needsSave = true;
        } else {
          rejected = legacy;
        }
      }
    }
  } catch {
    writable = false;
    storageError = 'Device storage is unavailable. Keep this page open to keep your progress.';
  }
  if (rejected) {
    try {
      deps.storage.setItem(`recovery.${deps.createId()}`, JSON.stringify({ date: deps.date(), entries: rejected }));
      recoveryNotice = 'Your save could not be opened. A recovery copy was kept on this device; starting fresh.';
      needsSave = true;
    } catch {
      writable = false;
      recoveryNotice = 'Your save could not be opened. The original data was left untouched because a recovery copy could not be saved.';
      storageError = 'Progress cannot be saved. Device storage may be full or unavailable; keep this page open.';
    }
  }

  let { settings, game } = data;
  const { results, played } = data;
  let screen: Screen = 'menu';
  /** The start being generated; a result arriving after it changes is stale. Null when idle. */
  let starting: AbortController | null = null;
  let generationError: string | null = null;

  const listeners = new Set<() => void>();
  const emit = (): void => listeners.forEach((listener) => listener());

  /* ------------------------------------------------------- *\
   *  Play time: runs only while a game in progress is on    *
   *  screen and the page is visible                         *
  \* ------------------------------------------------------- */

  let hidden = false;
  /** When the clock last started or was folded into game.elapsed, or null while paused. */
  let runningFrom: number | null = null;

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

  /** Records a finished play and writes all player data together. */
  const persist = (): void => {
    syncClock();
    if (game?.status === 'won' && !results.some((result) => result.id === game?.id)) {
      results.push(resultOf(game, deps.date()));
    }
    if (!writable) {
      return;
    }
    const before = storageError;
    try {
      deps.storage.setItem('save', JSON.stringify({ version: 1, settings, game, results, played, open: data.open }));
      storageError = null;
    } catch {
      storageError = 'Progress could not be saved. Device storage may be full or unavailable; keep this page open.';
    }
    if (before !== storageError) {
      emit();
    }
  };

  if (needsSave || (game?.status === 'won' && !results.some((result) => result.id === game?.id))) {
    persist();
  }

  /* ------------------------------------------------------- *\
   *  Puzzle generation                                      *
  \* ------------------------------------------------------- */

  /** The next puzzle, generated ahead of time for the settings it was made under. */
  let prepared: { key: string; puzzle: Promise<Puzzle>; abort: AbortController } | null = null;

  /** Abandons the start being generated, if any, so its result is ignored and the worker stops on it. */
  const cancelStart = (): void => {
    starting?.abort();
    starting = null;
  };

  const prepare = (): Promise<Puzzle> => {
    const { timer: _timer, silver, ...fixed } = settings;
    const key = JSON.stringify([silver, fixed]);
    if (prepared?.key !== key) {
      prepared?.abort.abort();
      // With the setting off, about one puzzle in five is still silver, unless size and difficulty are both fixed.
      const always = silver || (fixed.size !== undefined && fixed.tier !== undefined ? false : undefined);
      const request = {
        settings: randomSettings(deps.random, { ...fixed, silver: always }),
        seed: Math.floor(deps.random() * 2 ** 32),
      };
      const abort = new AbortController();
      const puzzle = deps.generate(request, abort.signal);
      prepared = { key, puzzle, abort };
      // A failed puzzle is not kept, so the next start asks again.
      puzzle.catch(() => {
        if (prepared?.puzzle === puzzle) {
          prepared = null;
        }
      });
    }
    return prepared.puzzle;
  };

  const takePrepared = (): { puzzle: Promise<Puzzle>; abort: AbortController } => {
    void prepare();
    const taken = prepared!;
    prepared = null;
    void prepare();
    return taken;
  };

  /* ------------------------------------------------------- *\
   *  Navigation                                             *
  \* ------------------------------------------------------- */

  const show = (next: Screen): void => {
    // Any navigation abandons a start still being generated.
    cancelStart();
    screen = next;
    // Remembered so a relaunch mid-puzzle lands back on the puzzle.
    data.open = next === 'puzzle';
    persist();
    emit();
  };

  /** Starts a puzzle from a blank board. Any play after the first on this device is a repeat. */
  const play = (puzzle: Puzzle): void => {
    fold();
    game = newGame(puzzle, played.includes(puzzle.code), deps.createId());
    if (!game.repeat) {
      played.push(puzzle.code);
    }
    show('puzzle');
  };

  const mayAbandon = (question: string): boolean => game?.status !== 'playing' || deps.confirm(question);

  /** Plays a puzzle once generated, unless the player has moved on. A failure leaves the current game as it was. */
  const generating = async ({ puzzle, abort }: { puzzle: Promise<Puzzle>; abort: AbortController }): Promise<void> => {
    starting = abort;
    generationError = null;
    emit();
    let result: Puzzle | null = null;
    try {
      result = await puzzle;
    } catch {
      // Nothing to report if the player has moved on.
    }
    if (starting !== abort) {
      return;
    }
    if (!result) {
      generationError = 'A puzzle could not be generated. Please try again.';
    }
    starting = null;
    if (result) {
      play(result);
    } else {
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
    if (starting) {
      return true;
    }
    if (game?.status === 'playing' && game.puzzle.code === encodeSeedCode(decoded.settings, decoded.seed)) {
      resume();
    } else if (mayAbandon('Abandon the puzzle in progress and play this one?')) {
      const abort = new AbortController();
      void generating({ puzzle: deps.generate(decoded, abort.signal), abort });
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
    get recoveryNotice() {
      return recoveryNotice;
    },
    get storageError() {
      return storageError;
    },
    get generationError() {
      return generationError;
    },
    get screen() {
      return screen;
    },
    get busy() {
      return starting !== null;
    },
    boot: (code) => {
      // A linked puzzle is asked for first, so it is not queued behind the prepared one.
      if (code) {
        playCode(code);
      } else if (data.open) {
        resume();
      }
      void prepare();
    },
    newPuzzle: async () => {
      if (!starting && mayAbandon('Abandon the puzzle in progress and start a new one?')) {
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
      if (starting) {
        cancelStart();
        emit();
      }
      persist();
      void prepare();
    },
    changed: persist,
    tick: () => {
      syncClock();
      return game?.elapsed ?? 0;
    },
    setHidden: (value) => {
      hidden = value;
      syncClock();
      if (value) {
        persist();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
