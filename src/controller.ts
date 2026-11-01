import {
  decodeSeedCode, encodeSeedCode, type GeneratorSettings, type Puzzle, randomSettings,
} from './engine';
import { type Game, isClean, newGame, type Result, resultOf, topResults } from './game';
import { type GameStats, initialStats, LEGACY_KEYS, migrateSave, newSave, parseSave } from './save';
import type { Generate } from './generator';
import type { Choices, SilverMode } from './settings';
import { MAX_SOLVES, parseSolves, type Solve, solveOf } from './solves';
import type { AdventureEvent, AdventureState } from './adventure/engine';
import { type AdventureSave, beginRound, command, newAdventure, parseAdventure, sync } from './adventurePlay';

/* ========================================================= *\
 *  Application controller: storage, puzzle generation,      *
 *  navigation, play time, and completion recording. The     *
 *  DOM screens and the puzzle scene call it; neither saves  *
 *  nor generates on its own.                                *
\* ========================================================= */

/** Player settings. A missing generator setting means random. */
export interface Settings extends Choices, Partial<Pick<GeneratorSettings, 'sizeMix' | 'shape' | 'freebies'>> {
  /** Show the timer during play. */
  timer: boolean;
  /** How often new puzzles use a single acorn. */
  silver: SilverMode;
  /** Silence sound effects. Missing in saves from before there was sound. */
  muted?: boolean;
}

/** The screen that is up: the main screen, an ordinary puzzle, or the adventure's puzzle. */
export type Screen = 'menu' | 'puzzle' | 'adventure';

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
  /** Name of the theme being played, recorded with each solve. */
  readonly theme?: () => string;
  /** Receives what happened in the adventure, in order. */
  readonly onAdventure?: (events: readonly AdventureEvent[]) => void;
}

/** The adventure as the screens see it. */
export interface Adventure {
  /** The run. */
  readonly state: Readonly<AdventureState>;
  /** Its puzzle: in progress, or the last one played. Null before the first. */
  readonly game: Game | null;
}

/** The application state and the actions that change it. */
export interface Controller {
  /** Current settings. */
  readonly settings: Readonly<Settings>;
  /** The current ordinary puzzle: the most recent one, in progress or finished. */
  readonly game: Game | null;
  /** The adventure, ended or not, or null if none was started. */
  readonly adventure: Adventure | null;
  /** The best 15 completed plays for each size and difficulty. */
  readonly results: readonly Result[];
  /** Lifetime games played and perfect solves, including plays outside the best times. */
  readonly stats: Readonly<GameStats>;
  /** How each recent win was solved, oldest first. */
  readonly solves: readonly Solve[];
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
  /** Saves after a change to the game on screen, records a win the first time it happens, and plays adventure turns. */
  readonly changed: () => void;
  /** Starts a new adventure run, after confirming if one is under way, and plays its first puzzle. */
  readonly startAdventure: () => Promise<void>;
  /** Returns to the adventure's puzzle, or starts its next one. Ignored once the run has ended. */
  readonly playAdventure: () => Promise<void>;
  /** Readies or unreadies an equipment slot. */
  readonly setReady: (slot: number, ready: boolean) => void;
  /** Gives up the adventure run, after confirming. */
  readonly abandonAdventure: () => void;
  /** @returns play time so far, in milliseconds */
  readonly tick: () => number;
  /** Pauses play time while the page is hidden. */
  readonly setHidden: (hidden: boolean) => void;
  /** Stops saving for good, because another tab or window saved newer progress that this one would overwrite. */
  readonly savedElsewhere: () => void;
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

  /* ------------------------------------------------------- *\
   *  Solve log, kept apart from the save                    *
  \* ------------------------------------------------------- */

  let solves: Solve[] = [];
  /** False if the saved log could not be read, so it is never overwritten. */
  let solvesWritable = writable;
  if (import.meta.env.VITE_COLLECT_SOLVE_DATA === 'true') {
    try {
      const raw = deps.storage.getItem('solves');
      const parsed = raw === null ? [] : parseSolves(raw);
      solves = parsed ?? [];
      solvesWritable &&= parsed !== null;
    } catch {
      solvesWritable = false;
    }
  }

  /** Adds a win to the solve log. Losing it to a failed write leaves play unaffected. */
  const logSolve = (won: Game): void => {
    const solve = solveOf(won, deps.date(), deps.theme?.() ?? 'woods');
    if (!solve || solves.some((other) => other.id === solve.id)) {
      return;
    }
    solves = [...solves, solve].slice(-MAX_SOLVES);
    if (solvesWritable) {
      try {
        deps.storage.setItem('solves', JSON.stringify(solves));
      } catch {
        // Kept in memory for export until the page is closed.
      }
    }
  };

  /* ------------------------------------------------------- *\
   *  Adventure, saved whole under its own key               *
  \* ------------------------------------------------------- */

  let adventure: AdventureSave | null = null;
  /** True once there is an adventure on this device, so giving one up is saved too. */
  let adventureSaved = false;
  if (writable) {
    try {
      const raw = deps.storage.getItem('adventure');
      const parsed = raw === null ? null : parseAdventure(raw);
      if (parsed === undefined) {
        deps.storage.setItem(`recovery.${deps.createId()}`, JSON.stringify({ date: deps.date(), entries: { adventure: raw } }));
        recoveryNotice = [recoveryNotice, 'Your adventure could not be opened. A recovery copy was kept on this device.']
          .filter(Boolean).join(' ');
      } else {
        adventure = parsed;
        adventureSaved = parsed !== null;
      }
    } catch {
      writable = false;
      storageError = 'Progress cannot be saved. Device storage may be full or unavailable; keep this page open.';
    }
  }

  let { settings, game } = data;
  const { played } = data;
  const stats = data.stats ?? initialStats(data);
  needsSave ||= data.stats === undefined;
  let results = topResults(data.results);
  needsSave ||= results.length !== data.results.length;
  let screen: Screen = 'menu';
  /** The start being generated; a result arriving after it changes is stale. Null when idle. */
  let starting: AbortController | null = null;
  let generationError: string | null = null;

  const listeners = new Set<() => void>();
  const emit = (): void => listeners.forEach((listener) => listener());

  /** The game on screen, whose play time is running. */
  const active = (): Game | null => (screen === 'adventure' ? adventure?.game ?? null : game);

  /* ------------------------------------------------------- *\
   *  Play time: runs only while a game in progress is on    *
   *  screen and the page is visible                         *
  \* ------------------------------------------------------- */

  let hidden = false;
  /** When the clock last started or was folded into game.elapsed, or null while paused. */
  let runningFrom: number | null = null;

  /** Adds the running span to the game's time and pauses. */
  const fold = (): void => {
    const playing = active();
    if (runningFrom !== null && playing) {
      playing.elapsed += Math.max(0, deps.now() - runningFrom);
    }
    runningFrom = null;
  };

  /** Folds in the running span, then runs the clock if play should be timed. */
  const syncClock = (): void => {
    fold();
    if (screen !== 'menu' && !hidden && active()?.status === 'playing') {
      runningFrom = deps.now();
    }
  };

  /** Records a finished play and writes all player data together. */
  const persist = (): void => {
    syncClock();
    if (game?.status === 'won' && stats.recordedWinId !== game.id) {
      const result = resultOf(game, deps.date());
      results = topResults([...results, result]);
      stats.perfectSolves += Number(isClean(result));
      stats.recordedWinId = game.id;
      if (import.meta.env.VITE_COLLECT_SOLVE_DATA === 'true') {
        logSolve(game);
      }
    }
    if (!writable) {
      return;
    }
    const before = storageError;
    try {
      deps.storage.setItem('save', JSON.stringify({ version: 1, settings, game, results, stats, played, open: data.open }));
      if (adventureSaved) {
        deps.storage.setItem('adventure', JSON.stringify(adventure));
      }
      storageError = null;
    } catch {
      storageError = 'Progress could not be saved. Device storage may be full or unavailable; keep this page open.';
    }
    if (before !== storageError) {
      emit();
    }
  };

  if (needsSave || (game?.status === 'won' && stats.recordedWinId !== game.id)) {
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
    const { timer: _timer, muted: _muted, silver, ...fixed } = settings;
    const key = JSON.stringify([silver, fixed]);
    if (prepared?.key !== key) {
      prepared?.abort.abort();
      const { sizes, tiers, ...rest } = fixed;
      // Sometimes leaves the generator's one-in-five chance in control.
      const singleAcorn = silver === 'sometimes' ? undefined : silver === 'always';
      const pick = <T>(choices: readonly T[] | undefined): T | undefined => (
        choices?.[Math.floor(deps.random() * choices.length)]);
      const request = {
        settings: randomSettings(deps.random, { ...rest, size: pick(sizes), tier: pick(tiers), silver: singleAcorn }),
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
    // Charges time so far to the game leaving the screen.
    fold();
    screen = next;
    // Remembered so a relaunch mid-puzzle lands back on the puzzle.
    data.open = next === 'puzzle';
    if (adventure) {
      adventure.open = next === 'adventure';
    }
    persist();
    emit();
  };

  /** Starts a puzzle from a blank board. Any play after the first on this device is a repeat. */
  const play = (puzzle: Puzzle): void => {
    fold();
    game = newGame(puzzle, played.includes(puzzle.code), deps.createId());
    stats.gamesPlayed++;
    if (!game.repeat) {
      played.push(puzzle.code);
    }
    show('puzzle');
  };

  const mayAbandon = (question: string): boolean => game?.status !== 'playing' || deps.confirm(question);

  /** Plays a puzzle once generated, unless the player has moved on. A failure leaves the current game as it was. */
  const generating = async (
    { puzzle, abort }: { puzzle: Promise<Puzzle>; abort: AbortController }, start: (puzzle: Puzzle) => void = play,
  ): Promise<void> => {
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
      start(result);
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
    if (game?.status === 'playing' && game.puzzle.code === encodeSeedCode(decoded.settings, decoded.seed, decoded.version)) {
      resume();
    } else if (mayAbandon('Abandon the puzzle in progress and play this one?')) {
      const abort = new AbortController();
      void generating({ puzzle: deps.generate(decoded, abort.signal), abort });
    }
    return true;
  };

  /* ------------------------------------------------------- *\
   *  Adventure                                              *
  \* ------------------------------------------------------- */

  const report = (events: readonly AdventureEvent[]): void => {
    if (events.length) {
      deps.onAdventure?.(events);
    }
  };

  /** Plays new reveals as turns. A run that ends mid-puzzle ends the puzzle too, back to the main screen. */
  const catchUp = (): void => {
    if (!adventure) {
      return;
    }
    report(sync(adventure));
    if (screen === 'adventure' && adventure.state.phase === 'ended') {
      show('menu');
    }
  };

  /** The adventure's next puzzle, always 9x9 medium with three acorns and no freebies, whatever the settings. */
  let adventurePrepared: Promise<Puzzle> | null = null;
  const prepareAdventure = (): Promise<Puzzle> => {
    if (!adventurePrepared) {
      const puzzle = deps.generate({
        settings: randomSettings(deps.random, { size: 9, tier: 'medium', silver: false, freebies: 0 }),
        seed: Math.floor(deps.random() * 2 ** 32),
      });
      adventurePrepared = puzzle;
      // A failed puzzle is not kept, so the next start asks again.
      puzzle.catch(() => {
        if (adventurePrepared === puzzle) {
          adventurePrepared = null;
        }
      });
    }
    return adventurePrepared;
  };

  const playAdventure = async (): Promise<void> => {
    if (!adventure || adventure.state.phase === 'ended' || starting) {
      return;
    }
    if (adventure.state.phase === 'round') {
      show('adventure');
      return;
    }
    const puzzle = prepareAdventure();
    adventurePrepared = null;
    await generating({ puzzle, abort: new AbortController() }, (result) => {
      if (adventure?.state.phase !== 'between') {
        return;
      }
      fold();
      report(beginRound(adventure, newGame(result, false, deps.createId(), true)));
      show('adventure');
      void prepareAdventure();
    });
  };

  return {
    get settings() {
      return settings;
    },
    get game() {
      return game;
    },
    get adventure() {
      return adventure;
    },
    get results() {
      return results;
    },
    get stats() {
      return stats;
    },
    get solves() {
      return solves;
    },
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
      } else if (adventure?.open) {
        void playAdventure();
      } else if (data.open) {
        resume();
      }
      catchUp();
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
    changed: () => {
      if (screen === 'adventure') {
        catchUp();
      }
      persist();
    },
    startAdventure: async () => {
      if (adventure && adventure.state.phase !== 'ended' && !deps.confirm('Abandon the adventure under way and start a new one?')) {
        return;
      }
      adventure = newAdventure();
      adventureSaved = true;
      persist();
      await playAdventure();
    },
    playAdventure,
    setReady: (slot, ready) => {
      if (adventure) {
        report(command(adventure, { type: 'set-ready', slot, ready }));
        persist();
        emit();
      }
    },
    abandonAdventure: () => {
      if (!adventure || adventure.state.phase === 'ended' || !deps.confirm('Give up this adventure?')) {
        return;
      }
      catchUp();
      if (adventure.state.phase === 'round') {
        report(command(adventure, { type: 'end-round', outcome: 'abandoned' }));
      } else {
        // shortcut: between rounds the engine has no way to end a run, so it is dropped; phase 7 adds run endings.
        adventure = null;
      }
      show('menu');
    },
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
    savedElsewhere: () => {
      writable = false;
      solvesWritable = false;
      storageError = 'Stumped was saved in another tab or window, so this one has stopped saving. Reload to keep playing here.';
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
