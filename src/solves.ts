import { colOf, rowOf, type Tier, TIERS } from './engine';
import { FOUND_BY, type FoundBy, type Game, type Hint, HINTS } from './game';
import { duration, object } from './save';

/* ========================================================= *\
 *  Solve log: how each won puzzle was solved, kept on the   *
 *  device for export. Saved under its own key so older      *
 *  versions of the game, which rewrite the whole save,      *
 *  never drop it.                                           *
\* ========================================================= */

/** Most solves kept. The oldest are dropped first. */
export const MAX_SOLVES = 1000;

/** One stump of a solve, in the order found. */
export interface SolveStump {
  /** Row, from 0 at the top. */
  readonly row: number;
  /** Column, from 0 at the left. */
  readonly col: number;
  /** Palette index of its color patch, the same across themes. */
  readonly color: number;
  /** Squares in its color patch. */
  readonly patch: number;
  /** Play time when it was found, in milliseconds. */
  readonly time: number;
  /** How it was found. */
  readonly by: FoundBy;
}

/** One wrong reveal of a solve. */
export interface SolveMiss {
  /** Row, from 0 at the top. */
  readonly row: number;
  /** Column, from 0 at the left. */
  readonly col: number;
  /** Palette index of the square's color patch. */
  readonly color: number;
  /** Squares in that color patch. */
  readonly patch: number;
  /** Play time when it was revealed, in milliseconds. */
  readonly time: number;
  /** Stumps found before it. */
  readonly after: number;
}

/** One won puzzle. */
export interface Solve {
  /** Identifier of the play, the same as its best-times result. */
  readonly id: string;
  /** When it was completed, as epoch milliseconds. */
  readonly date: number;
  /** Seed code of the puzzle. */
  readonly code: string;
  /** Grid size. */
  readonly size: number;
  /** Rated difficulty. */
  readonly tier: Tier;
  /** Played with a single acorn. */
  readonly silver: boolean;
  /** A repeat play of the puzzle. */
  readonly repeat: boolean;
  /** Theme it was played in. */
  readonly theme: string;
  /** Time to completion in milliseconds. */
  readonly time: number;
  /** Hints used. */
  readonly hints: readonly Hint[];
  /** Acorns lost. */
  readonly acornsLost: number;
  /** Every stump, in the order found. */
  readonly stumps: readonly SolveStump[];
  /** Every wrong reveal, in order. Missing if they were not all recorded. */
  readonly misses?: readonly SolveMiss[];
}

/**
 * @param game a won game
 * @param date completion time as epoch milliseconds
 * @param theme the theme it was played in
 * @returns the solve, or null if the game did not keep the order of every stump
 */
export function solveOf(game: Game, date: number, theme: string): Solve | null {
  const { puzzle } = game;
  const found = game.found ?? [];
  if (found.length !== puzzle.size) {
    return null;
  }
  const square = (cell: number): Pick<SolveStump, 'row' | 'col' | 'color' | 'patch'> => {
    const region = puzzle.regions[cell];
    return {
      row: rowOf(puzzle.size, cell),
      col: colOf(puzzle.size, cell),
      color: puzzle.colors[region],
      patch: puzzle.regions.filter((r) => r === region).length,
    };
  };
  const misses = game.misses?.length === game.acornsLost
    ? game.misses.map(({ cell, time, after }) => ({ ...square(cell), time, after })) : undefined;
  return {
    id: game.id, date, code: puzzle.code, size: puzzle.size, tier: puzzle.tier, silver: puzzle.silver,
    repeat: game.repeat, theme, time: game.elapsed, hints: [...game.hints], acornsLost: game.acornsLost,
    stumps: found.map(({ cell, time, by }) => ({ ...square(cell), time, by })),
    ...(misses && { misses }),
  };
}

const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

const validStump = (value: unknown): value is SolveStump => object(value)
  && count(value.row) && count(value.col) && count(value.color) && count(value.patch) && duration(value.time)
  && FOUND_BY.some((by) => by === value.by);

const validMiss = (value: unknown): value is SolveMiss => object(value)
  && count(value.row) && count(value.col) && count(value.color) && count(value.patch) && duration(value.time)
  && count(value.after);

const validSolve = (value: unknown): value is Solve => object(value)
  && typeof value.id === 'string' && duration(value.date) && typeof value.code === 'string'
  && count(value.size) && TIERS.some((tier) => tier === value.tier)
  && typeof value.silver === 'boolean' && typeof value.repeat === 'boolean' && typeof value.theme === 'string'
  && duration(value.time) && count(value.acornsLost)
  && Array.isArray(value.hints) && value.hints.every((hint: unknown) => HINTS.some((h) => h === hint))
  && Array.isArray(value.stumps) && value.stumps.every(validStump)
  && (value.misses === undefined || (Array.isArray(value.misses) && value.misses.every(validMiss)));

/**
 * @param raw the saved solve log
 * @returns the solves, or null if the log is not readable
 */
export function parseSolves(raw: string): Solve[] | null {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every(validSolve) ? value : null;
  } catch {
    return null;
  }
}

/**
 * CSV columns: one row per stump or wrong reveal, in the order they happened,
 * with its solve's details repeated. `wrong` was added after the first
 * recordings, so older exports lack it.
 */
const COLUMNS = [
  'solve', 'date', 'size', 'difficulty', 'silver', 'repeat', 'theme', 'hints', 'acorns_lost', 'total_seconds', 'code',
  'order', 'row', 'col', 'color', 'patch_size', 'found_seconds', 'found_by', 'wrong',
] as const;

/** A solve's stumps and wrong reveals in the order they happened. Misses are always the player's. */
const turnsOf = (solve: Solve): (SolveStump & { readonly wrong: boolean })[] => {
  const misses = solve.misses ?? [];
  return solve.stumps.flatMap((stump, index) => [
    ...misses.filter((miss) => miss.after === index).map((miss) => ({ ...miss, by: 'player' as const, wrong: true })),
    { ...stump, wrong: false },
  ]);
};

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

/**
 * Formats solves for pasting into a spreadsheet. Rows, columns, and colors count from 1.
 * @param solves the solve log
 * @returns CSV text with a header row
 */
export function solvesCsv(solves: readonly Solve[]): string {
  const rows = solves.flatMap((solve) => turnsOf(solve).map((stump, index) => [
    solve.id, new Date(solve.date).toISOString(), solve.size, solve.tier, solve.silver, solve.repeat, solve.theme,
    solve.hints.join(' '), solve.acornsLost, seconds(solve.time), solve.code,
    index + 1, stump.row + 1, stump.col + 1, stump.color + 1, stump.patch, seconds(stump.time), stump.by,
    stump.wrong,
  ].join(',')));
  return [COLUMNS.join(','), ...rows].join('\n');
}
