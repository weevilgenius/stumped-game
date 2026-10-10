import {
  allUnits, applyStep, colOf, type Conflict, conflicts, describeStep, EXCLUDED, nextStep, OPEN, type Puzzle, rowOf,
  type Step, STUMP, type Tier, type Unit, unitCells,
} from './engine';

/* ========================================================= *\
 *  Game state                                               *
 *                                                           *
 *  One play of one puzzle: marks, the hypothesis layer,     *
 *  undo, acorns, hints, and time. Plain JSON data with no   *
 *  UI imports, so saving it is JSON.stringify.              *
\* ========================================================= */

/** Mark: nothing. */
export const MARK_NONE = 0;
/** Mark: an X, on the normal or the hypothesis layer. */
export const MARK_X = 1;
/** Normal-layer mark: the red X left by a wrong reveal. */
export const MARK_RED = 2;
/** Normal-layer mark: a revealed stump. */
export const MARK_STUMP = 3;
/** Hypothesis-layer mark: a tentative stump. */
export const HYPO_STUMP = 2;

/** A hint, named for its animal. */
export type Hint = 'woodpecker' | 'owl' | 'squirrel';

/** All hints, in button order. */
export const HINTS: readonly Hint[] = ['woodpecker', 'owl', 'squirrel'];

/** One undo step: `[cell, mark before]` for each square a tap or stroke changed. */
export type UndoStep = [number, number][];

/** One play of one puzzle. */
export interface Game {
  /** Stable identifier of this play, retained across reloads. */
  id: string;
  /** The puzzle being played. */
  puzzle: Puzzle;
  /** Normal-layer mark for each cell. */
  marks: number[];
  /** Hypothesis-layer mark for each cell, or null while the mode is off. */
  hypo: number[] | null;
  /** Undo stack for normal play. */
  undo: UndoStep[];
  /** Undo stack for the hypothesis layer. */
  hypoUndo: UndoStep[];
  /** Acorns left. */
  acorns: number;
  /** Acorns lost to wrong reveals. */
  acornsLost: number;
  /** Hints used so far. */
  hints: Hint[];
  /** Play time in milliseconds. */
  elapsed: number;
  /** Whether the puzzle is still being played. */
  status: 'playing' | 'won' | 'lost';
  /** True if this puzzle was played before on this device. */
  repeat: boolean;
  /** The explain hint's explanation while it is open, so a relaunch reopens it instead of losing the hint. */
  explaining: Explanation | null;
}

/**
 * Starts a play of a puzzle from a blank board.
 * @param puzzle the puzzle
 * @param repeat whether it was played before on this device
 * @param id unique identifier for this play
 * @returns the new game
 */
export function newGame(puzzle: Puzzle, repeat: boolean, id: string = crypto.randomUUID()): Game {
  const marks = new Array<number>(puzzle.size ** 2).fill(MARK_NONE);
  for (const cell of puzzle.givens) {
    marks[cell] = MARK_STUMP;
  }
  return {
    id, puzzle, marks, hypo: null, undo: [], hypoUndo: [],
    acorns: puzzle.silver ? 1 : 3, acornsLost: 0, hints: [], elapsed: 0, status: 'playing', repeat,
    explaining: null,
  };
}

/**
 * @param game the game
 * @returns cells of the revealed stumps, ascending
 */
export function stumps(game: Game): number[] {
  return game.marks.flatMap((mark, cell) => (mark === MARK_STUMP ? [cell] : []));
}

/* ========================================================= *\
 *  Marking: taps, drags, and undo                           *
 *                                                           *
 *  These act on the hypothesis layer while it is on, and    *
 *  on the normal layer otherwise.                           *
\* ========================================================= */

/**
 * What a stroke does to the squares it crosses. A lift removed a tentative
 * stump and does nothing more; null means the first square was inert.
 */
export type StrokeMode = 'place' | 'erase' | 'lift' | null;

const activeLayer = (game: Game): number[] => game.hypo ?? game.marks;

const activeUndo = (game: Game): UndoStep[] => (game.hypo ? game.hypoUndo : game.undo);

/** Changes a square on the active layer, recording it in the newest undo step. */
const setMark = (game: Game, cell: number, value: number): void => {
  const layer = activeLayer(game);
  activeUndo(game).at(-1)?.push([cell, layer[cell]]);
  layer[cell] = value;
};

/** Drops squares from the normal undo history. Reveals and hint results are permanent. */
const settle = (game: Game, cells: readonly number[]): void => {
  game.undo = game.undo
    .map((step) => step.filter(([cell]) => !cells.includes(cell)))
    .filter((step) => step.length > 0);
};

/**
 * Applies a stroke to one more square it crossed.
 * @param game the game
 * @param cell the square
 * @param mode the stroke's mode, from `beginStroke`
 * @returns true if the square changed
 */
export function extendStroke(game: Game, cell: number, mode: StrokeMode): boolean {
  const layer = activeLayer(game);
  // A square holding a normal mark is off limits to the hypothesis layer.
  if (mode === 'place' && game.marks[cell] === MARK_NONE && layer[cell] === MARK_NONE) {
    setMark(game, cell, MARK_X);
    return true;
  }
  if (mode === 'erase' && layer[cell] === MARK_X) {
    setMark(game, cell, MARK_NONE);
    return true;
  }
  return false;
}

/**
 * Starts a tap or drag. The first square changes at once and opens one undo
 * step that the rest of the stroke adds to.
 * @param game the game
 * @param cell the square under the pointer
 * @returns the stroke's mode
 */
export function beginStroke(game: Game, cell: number): StrokeMode {
  const layer = activeLayer(game);
  let mode: StrokeMode = null;
  if (game.status !== 'playing') {
    return mode;
  }
  if (game.hypo && layer[cell] === HYPO_STUMP) {
    mode = 'lift';
  } else if (layer[cell] === MARK_X) {
    mode = 'erase';
  } else if (game.marks[cell] === MARK_NONE && layer[cell] === MARK_NONE) {
    mode = 'place';
  }
  if (mode) {
    activeUndo(game).push([]);
    if (mode === 'lift') {
      setMark(game, cell, MARK_NONE);
    } else {
      extendStroke(game, cell, mode);
    }
  }
  return mode;
}

/**
 * Takes back the newest tap or stroke on the active layer.
 * @param game the game
 * @returns false if there was nothing to undo
 */
export function undo(game: Game): boolean {
  const step = activeUndo(game).pop();
  const layer = activeLayer(game);
  step?.reverse().forEach(([cell, value]) => {
    layer[cell] = value;
  });
  return step !== undefined;
}

/* ========================================================= *\
 *  Reveals                                                  *
\* ========================================================= */

/** The outcome of a reveal attempt. */
export interface RevealResult {
  /** True if the square held a stump. */
  readonly correct: boolean;
  /** For a wrong reveal, a rule it broke against a stump that was already revealed, if any. */
  readonly conflict?: Conflict;
}

const reveal = (game: Game, cell: number): RevealResult => {
  settle(game, [cell]);
  if (game.puzzle.solution.includes(cell)) {
    game.marks[cell] = MARK_STUMP;
    if (stumps(game).length === game.puzzle.size) {
      game.status = 'won';
    }
    return { correct: true };
  }
  const conflict = conflicts(game.puzzle, cell, stumps(game)).at(0);
  game.marks[cell] = MARK_RED;
  game.acorns--;
  game.acornsLost++;
  if (game.acorns === 0) {
    game.status = 'lost';
  }
  return { correct: false, conflict };
};

/**
 * Handles the second tap of a double tap. The first tap already acted as a
 * single tap, so it is taken back first. In normal play this then attempts a
 * reveal; in hypothesis mode it places or removes a tentative stump.
 * @param game the game
 * @param cell the square tapped twice
 * @param firstTapChanged whether the first tap changed the square
 * @returns the reveal outcome, or null if nothing was revealed
 */
export function doubleTap(game: Game, cell: number, firstTapChanged: boolean): RevealResult | null {
  if (game.status !== 'playing') {
    return null;
  }
  if (firstTapChanged) {
    undo(game);
  }
  if (game.hypo) {
    if (game.marks[cell] === MARK_NONE) {
      game.hypoUndo.push([]);
      setMark(game, cell, game.hypo[cell] === HYPO_STUMP ? MARK_NONE : HYPO_STUMP);
    }
    return null;
  }
  return game.marks[cell] === MARK_NONE || game.marks[cell] === MARK_X ? reveal(game, cell) : null;
}

/* ========================================================= *\
 *  Hypothesis mode                                          *
\* ========================================================= */

/**
 * Turns hypothesis mode on with an empty scratch layer.
 * @param game the game
 */
export function enterHypothesis(game: Game): void {
  game.hypo = game.marks.map(() => MARK_NONE);
  game.hypoUndo = [];
}

/**
 * Turns hypothesis mode off. Tentative stumps are always removed.
 * @param game the game
 * @param keep true to turn hypothesis X's into normal X's, false to discard them
 */
export function leaveHypothesis(game: Game, keep: boolean): void {
  if (keep) {
    const kept = (game.hypo ?? []).flatMap((mark, cell) => (mark === MARK_X ? [cell] : []));
    for (const cell of kept) {
      game.marks[cell] = MARK_X;
    }
    settle(game, kept);
  }
  game.hypo = null;
  game.hypoUndo = [];
}

/**
 * @param game the game
 * @returns tentative stumps that break a rule against a revealed or another tentative stump
 */
export function flaggedStumps(game: Game): number[] {
  const tentative = (game.hypo ?? []).flatMap((mark, cell) => (mark === HYPO_STUMP ? [cell] : []));
  const all = [...stumps(game), ...tentative];
  return tentative.filter((cell) => conflicts(game.puzzle, cell, all).length > 0);
}

/* ========================================================= *\
 *  Hints                                                    *
\* ========================================================= */

/** The explain hint found an X on a stump's square. Closing it removes the X. */
export interface WrongXExplanation {
  readonly type: 'wrongX';
  /** The square with the wrong X. */
  readonly cell: number;
}

/** The explain hint found a deduction. Closing it makes the deduction's mark. */
export interface StepExplanation {
  readonly type: 'step';
  /** The simplest deduction available. */
  readonly step: Step;
}

/** What the explain hint shows. */
export type Explanation = WrongXExplanation | StepExplanation;

/**
 * @param game the game
 * @param hint a hint
 * @returns true if the hint can be used now: once per puzzle, and not in hypothesis mode
 */
export function canHint(game: Game, hint: Hint): boolean {
  return game.status === 'playing' && !game.hypo && !game.hints.includes(hint);
}

/**
 * Reveal hint: reveals the stump in the region with the fewest unmarked squares.
 * @param game the game
 * @returns the revealed cell
 */
export function woodpecker(game: Game): number {
  const { puzzle, marks } = game;
  const open = new Array<number>(puzzle.size).fill(0);
  marks.forEach((mark, cell) => {
    if (mark === MARK_NONE) {
      open[puzzle.regions[cell]]++;
    }
  });
  const cell = puzzle.solution
    .filter((stump) => marks[stump] !== MARK_STUMP)
    .reduce((best, stump) => (open[puzzle.regions[stump]] < open[puzzle.regions[best]] ? stump : best));
  game.hints.push('woodpecker');
  reveal(game, cell);
  return cell;
}

/**
 * Eliminate hint: puts X's on up to three random unmarked squares that hold no stump.
 * @param game the game
 * @param rng random source returning [0, 1)
 * @returns the squares marked
 */
export function squirrel(game: Game, rng: () => number = Math.random): number[] {
  const candidates = game.marks.flatMap((mark, cell) => (
    mark === MARK_NONE && !game.puzzle.solution.includes(cell) ? [cell] : []));
  const picked: number[] = [];
  while (picked.length < 3 && candidates.length > 0) {
    picked.push(...candidates.splice(Math.floor(rng() * candidates.length), 1));
  }
  for (const cell of picked) {
    game.marks[cell] = MARK_X;
  }
  settle(game, picked);
  game.hints.push('squirrel');
  return picked;
}

/**
 * @param game the game
 * @returns the normal-layer marks as solver cell states
 */
export function solverState(game: Game): Uint8Array {
  return Uint8Array.from(game.marks, (mark) => (mark === MARK_STUMP ? STUMP : mark === MARK_NONE ? OPEN : EXCLUDED));
}

/**
 * Explain hint: finds what to show. An X on a stump's square comes first,
 * otherwise the simplest deduction from the player's marks.
 * @param game the game
 * @returns the explanation, or null (hint not used) if no deduction was found
 */
export function explain(game: Game): Explanation | null {
  const wrong = game.puzzle.solution.find((cell) => game.marks[cell] === MARK_X);
  let explanation: Explanation | null;
  if (wrong !== undefined) {
    explanation = { type: 'wrongX', cell: wrong };
  } else {
    const step = nextStep(game.puzzle, solverState(game));
    explanation = step && { type: 'step', step };
  }
  if (explanation) {
    game.hints.push('owl');
    game.explaining = explanation;
  }
  return explanation;
}

/**
 * Closes the open explanation and makes its mark: removes the wrong X,
 * reveals a forced stump, or places the deduction's X's.
 * @param game the game
 */
export function applyExplanation(game: Game): void {
  const explanation = game.explaining;
  game.explaining = null;
  if (!explanation) {
    return;
  }
  if (explanation.type === 'wrongX') {
    game.marks[explanation.cell] = MARK_NONE;
    settle(game, [explanation.cell]);
  } else if (explanation.step.type === 'forced') {
    reveal(game, explanation.step.place);
  } else {
    for (const cell of explanation.step.eliminated) {
      game.marks[cell] = MARK_X;
    }
    settle(game, explanation.step.eliminated);
  }
}

/* ========================================================= *\
 *  Feedback                                                 *
\* ========================================================= */

/**
 * Finds the rows, columns, and regions that hold a revealed stump and have
 * every other square marked. The UI pulses a unit when it first shows up here.
 * @param game the game
 * @returns the other squares of each such unit, keyed by a unit name like `row3`
 */
export function completedUnits(game: Game): Map<string, number[]> {
  const done = new Map<string, number[]>();
  for (const unit of allUnits(game.puzzle)) {
    const cells = unitCells(game.puzzle, unit);
    const others = cells.filter((cell) => game.marks[cell] !== MARK_STUMP);
    if (others.length > 0 && others.length < cells.length && others.every((cell) => game.marks[cell] !== MARK_NONE)) {
      done.set(`${unit.kind}${unit.index}`, others);
    }
  }
  return done;
}

/**
 * @param game the game
 * @returns true if no square is left unmarked
 */
export function isPerfectlyMarked(game: Game): boolean {
  return game.marks.every((mark) => mark !== MARK_NONE);
}

/* ========================================================= *\
 *  Results and best times                                   *
\* ========================================================= */

/** One completed play, as kept in the best times. */
export interface Result {
  /** Identifier of the completed play. */
  readonly id: string;
  /** Seed code of the puzzle. */
  readonly code: string;
  /** Grid size. */
  readonly size: number;
  /** Rated difficulty. */
  readonly tier: Tier;
  /** Time to completion in milliseconds. */
  readonly time: number;
  /** Hints used. */
  readonly hints: readonly Hint[];
  /** Acorns lost. */
  readonly acornsLost: number;
  /** Played with a single acorn. */
  readonly silver: boolean;
  /** A repeat play of the puzzle. */
  readonly repeat: boolean;
  /** When it was completed, as epoch milliseconds. */
  readonly date: number;
}

/**
 * @param game a won game
 * @param date completion time as epoch milliseconds
 * @returns the result to record
 */
export function resultOf(game: Game, date: number = Date.now()): Result {
  const { code, size, tier, silver } = game.puzzle;
  return {
    id: game.id, code, size, tier, silver, date,
    time: game.elapsed, hints: [...game.hints], acornsLost: game.acornsLost, repeat: game.repeat,
  };
}

/**
 * @param result a completed play
 * @returns true for a clean solve: no hints, no acorns lost, and a first play
 */
export function isClean(result: Result): boolean {
  return result.hints.length === 0 && result.acornsLost === 0 && !result.repeat;
}

/**
 * Lists the times for one size and difficulty, clean solves first, then by time.
 * @param results every recorded result
 * @param size grid size
 * @param tier difficulty
 * @returns the matching results in display order
 */
export function bestTimes(results: readonly Result[], size: number, tier: Tier): Result[] {
  return results
    .filter((result) => result.size === size && result.tier === tier)
    .sort((a, b) => Number(isClean(b)) - Number(isClean(a)) || a.time - b.time);
}

/**
 * @param ms a duration in milliseconds
 * @returns the duration as minutes and seconds, such as `2:05`
 */
export function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/* ========================================================= *\
 *  Explanations                                             *
\* ========================================================= */

/** One page of the explain hint: what to say and which squares to show. */
export interface ExplainPage {
  /** The reasoning in words. */
  readonly text: string;
  /** Squares involved in the deduction. The rest of the board is dimmed. */
  readonly lit: readonly number[];
  /** Squares to outline: the subject of the deduction. */
  readonly marked: readonly number[];
  /** Squares to show ruled out. */
  readonly xs: readonly number[];
  /** Squares to show holding a stump. */
  readonly stumps: readonly number[];
}

const unitLabel = (unit: Unit): string => (unit.kind === 'region'
  ? 'that patch'
  : `${unit.kind === 'row' ? 'row' : 'column'} ${unit.index + 1}`);

/**
 * Lays out an explanation as pages. Most deductions are one page. A chain is
 * an overview followed by one page per step, each showing everything the
 * assumed stump has led to so far.
 * @param game the game, with the marks the explanation was found from
 * @param explanation the explanation
 * @returns the pages, in order
 */
export function explainPages(game: Game, explanation: Explanation): ExplainPage[] {
  const { puzzle } = game;
  if (explanation.type === 'wrongX') {
    const { cell } = explanation;
    return [{
      text: 'This X is on a square that holds a stump. Closing this hint removes the X.',
      lit: [cell], marked: [cell], xs: [], stumps: [],
    }];
  }
  const cells = puzzle.regions.map((_, cell) => cell);
  const pageFor = (step: Step, state: Uint8Array): ExplainPage => {
    const text = describeStep(step);
    switch (step.type) {
    case 'elimination':
      return { text, lit: [step.stump, ...step.eliminated], marked: [step.stump], xs: step.eliminated, stumps: [] };
    case 'forced':
      return { text, lit: unitCells(puzzle, step.unit), marked: [step.place], xs: [], stumps: [step.place] };
    case 'confinement': {
      const inLines = (cell: number): boolean => step.lines
        .includes((step.axis === 'row' ? rowOf : colOf)(puzzle.size, cell));
      const inRegions = (cell: number): boolean => step.regions.includes(puzzle.regions[cell]);
      return {
        text,
        lit: cells.filter((cell) => inLines(cell) || inRegions(cell)),
        marked: cells.filter((cell) => state[cell] === OPEN && (step.reverse ? inLines(cell) : inRegions(cell))),
        xs: step.eliminated,
        stumps: [],
      };
    }
    case 'blocking':
    case 'chain': {
      const unit = unitCells(puzzle, step.unit);
      return {
        text,
        lit: [step.cell, ...unit],
        marked: [step.cell],
        xs: unit.filter((cell) => state[cell] === OPEN),
        stumps: [step.cell],
      };
    }
    }
  };

  const state = solverState(game);
  const { step } = explanation;
  const pages = [pageFor(step, state)];
  if (step.type === 'chain') {
    let sim: Uint8Array = state.slice();
    sim[step.cell] = STUMP;
    step.steps.forEach((sub, i) => {
      const page = pageFor(sub, sim);
      sim = applyStep(sim, sub);
      const last = i === step.steps.length - 1;
      pages.push({
        text: page.text + (last ? ` Now ${unitLabel(step.unit)} has no open square left.` : ''),
        lit: last ? [...page.lit, ...unitCells(puzzle, step.unit)] : page.lit,
        marked: page.marked,
        xs: cells.filter((cell) => sim[cell] === EXCLUDED && state[cell] === OPEN),
        stumps: cells.filter((cell) => sim[cell] === STUMP && state[cell] !== STUMP),
      });
    });
  }
  return pages;
}
