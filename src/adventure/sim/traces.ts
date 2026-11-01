import { decodeSeedCode, generate, MAX_SIZE, MIN_SIZE, type Tier, TIERS } from '../../engine';
import { FOUND_BY, type FoundBy, type Hint, HINTS } from '../../game';
import mulberry32 from '../../utils/mulberry';

/* ========================================================= *\
 *  Recorded solve traces: import, validation, round inputs, *
 *  and descriptive statistics. Reads the CSV that Settings  *
 *  copies (`solvesCsv()` in src/solves.ts), old and new.    *
\* ========================================================= */

/** One row of a trace: a stump found, or a wrong reveal. */
export interface TraceEvent {
  /** Order it happened in, from 1, including givens and wrong reveals. */
  readonly order: number;
  /** The square, `row * size + col`. */
  readonly cell: number;
  /** Palette index of the square's color patch, from 0. */
  readonly color: number;
  /** Squares in that color patch: the pulse strength of a collection. */
  readonly amount: number;
  /** Play time when it happened, in seconds. */
  readonly atSeconds: number;
  /** How it was found. Wrong reveals are always the player's. */
  readonly source: FoundBy;
  /** True for a wrong reveal, which collects nothing. */
  readonly wrong: boolean;
}

/** One recorded, won puzzle. */
export interface SolveTrace {
  /** Identifier of the play. */
  readonly id: string;
  /** Recording it came from, such as the file name. */
  readonly dataset: string;
  /** Seed code, which rebuilds the puzzle. */
  readonly code: string;
  /** Grid size. */
  readonly size: number;
  /** Rated difficulty. */
  readonly tier: Tier;
  /** Played with a single acorn. */
  readonly silver: boolean;
  /** Play time to completion, in seconds. */
  readonly totalSeconds: number;
  /** Wrong reveals. */
  readonly acornsLost: number;
  /** Hints used. */
  readonly hints: readonly Hint[];
  /** Every stump and recorded wrong reveal, in order. */
  readonly events: readonly TraceEvent[];
  /** True if every wrong reveal is in `events`, so the turn order is fully known. */
  readonly turnsKnown: boolean;
}

/** A recording that could not be used, and why. */
export interface TraceProblem {
  /** Recording it came from. */
  readonly dataset: string;
  /** Identifier of the play, or the line number if it has none. */
  readonly id: string;
  /** What is wrong with it. */
  readonly message: string;
}

/** The result of importing one recording. */
export interface TraceImport {
  /** Valid traces, in the order they first appear. */
  readonly traces: SolveTrace[];
  /** Plays or lines that were rejected rather than repaired. */
  readonly problems: TraceProblem[];
}

const REQUIRED = [
  'solve', 'date', 'size', 'difficulty', 'silver', 'repeat', 'theme', 'hints', 'acorns_lost', 'total_seconds', 'code',
  'order', 'row', 'col', 'color', 'patch_size', 'found_seconds', 'found_by',
] as const;

/** Columns repeated on every row of a play, which must agree. */
const SHARED = REQUIRED.slice(0, 11);

type Row = Record<string, string>;

const whole = (text: string, min: number, max = Infinity): number | null => {
  const value = Number(text);
  return text !== '' && Number.isInteger(value) && value >= min && value <= max ? value : null;
};

const decimal = (text: string): number | null => {
  const value = Number(text);
  return text !== '' && Number.isFinite(value) && value >= 0 ? value : null;
};

const flag = (text: string): boolean | null => (text === 'true' ? true : text === 'false' ? false : null);

/** Builds one trace from its rows, or explains why it cannot. */
const traceOf = (rows: readonly Row[], dataset: string, hasWrong: boolean): SolveTrace | string => {
  const first = rows[0];
  const differs = SHARED.find((column) => rows.some((row) => row[column] !== first[column]));
  if (differs) {
    return `rows disagree on ${differs}`;
  }
  const size = whole(first.size, MIN_SIZE, MAX_SIZE);
  const tier = TIERS.find((t) => t === first.difficulty);
  const silver = flag(first.silver);
  const acornsLost = whole(first.acorns_lost, 0);
  const totalSeconds = decimal(first.total_seconds);
  const hints = first.hints === '' ? [] : first.hints.split(' ');
  if (size === null || !tier || silver === null || flag(first.repeat) === null || acornsLost === null
    || totalSeconds === null || Number.isNaN(Date.parse(first.date)) || !hints.every((h) => HINTS.some((x) => x === h))) {
    return 'invalid puzzle details';
  }
  if (acornsLost >= (silver ? 1 : 3)) {
    return `${acornsLost} acorns lost, which would have lost the puzzle`;
  }
  const events: TraceEvent[] = [];
  for (const row of rows) {
    const order = whole(row.order, 1);
    const r = whole(row.row, 1, size);
    const c = whole(row.col, 1, size);
    const color = whole(row.color, 1, size);
    const amount = whole(row.patch_size, 1, size ** 2);
    const atSeconds = decimal(row.found_seconds);
    const source = FOUND_BY.find((by) => by === row.found_by);
    const wrong = hasWrong ? flag(row.wrong) : false;
    if (order === null || r === null || c === null || color === null || amount === null || atSeconds === null
      || !source || wrong === null || (wrong && source !== 'player')) {
      return `invalid row ${row.order}`;
    }
    events.push({ order, cell: (r - 1) * size + c - 1, color: color - 1, amount, atSeconds, source, wrong });
  }
  events.sort((a, b) => a.order - b.order);
  const stumps = events.filter((event) => !event.wrong);
  const misses = events.length - stumps.length;
  if (events.some((event, index) => event.order !== index + 1)) {
    return 'order is not 1 to the number of rows';
  }
  if (events.some((event, index) => index > 0 && event.atSeconds < events[index - 1].atSeconds)
    || events.at(-1)!.atSeconds > totalSeconds) {
    return 'times go backwards';
  }
  if (stumps.length !== size) {
    return `${stumps.length} stumps on a ${size}×${size} board`;
  }
  if (new Set(stumps.map((s) => s.cell)).size !== size || new Set(stumps.map((s) => s.color)).size !== size) {
    return 'stumps repeat a square or a color';
  }
  if (stumps.reduce((sum, s) => sum + s.amount, 0) !== size ** 2) {
    return `region sizes do not add up to ${size ** 2}`;
  }
  if (misses > acornsLost) {
    return `${misses} wrong reveals but ${acornsLost} acorns lost`;
  }
  return {
    id: first.solve, dataset, code: first.code, size, tier, silver, totalSeconds, acornsLost,
    hints: hints as Hint[], events, turnsKnown: misses === acornsLost,
  };
};

/**
 * Reads a solve log CSV, grouping rows by play and validating each play.
 * Invalid plays are reported, never repaired.
 * @param csv the CSV text, with its header row
 * @param dataset name of the recording, kept on every trace
 * @returns the valid traces and the problems found
 */
export function parseTraces(csv: string, dataset: string): TraceImport {
  // shortcut: plain comma split, since solvesCsv() never writes commas or quotes inside a value
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = lines[0]?.split(',') ?? [];
  const missing = REQUIRED.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return { traces: [], problems: [{ dataset, id: 'header', message: `missing columns: ${missing.join(', ')}` }] };
  }
  const hasWrong = header.includes('wrong');
  const problems: TraceProblem[] = [];
  const plays = new Map<string, Row[]>();
  lines.slice(1).forEach((line, index) => {
    const values = line.split(',');
    if (values.length !== header.length) {
      problems.push({ dataset, id: `line ${index + 2}`, message: `${values.length} values for ${header.length} columns` });
      return;
    }
    const row = Object.fromEntries(header.map((column, i) => [column, values[i]]));
    plays.set(row.solve, [...plays.get(row.solve) ?? [], row]);
  });
  const traces: SolveTrace[] = [];
  for (const [id, rows] of plays) {
    const trace = traceOf(rows, dataset, hasWrong);
    if (typeof trace === 'string') {
      problems.push({ dataset, id, message: trace });
    } else {
      traces.push(trace);
    }
  }
  return { traces, problems };
}

/**
 * Rebuilds a trace's puzzle from its seed code and checks that every row
 * matches it: stump squares, colors, region sizes, givens, and wrong squares.
 * Slow for large boards, since it runs the generator.
 * @param trace the trace
 * @returns null if the board matches, otherwise what differs
 */
export function checkBoard(trace: SolveTrace): string | null {
  const decoded = decodeSeedCode(trace.code);
  if (!decoded) {
    return `seed code ${trace.code} does not decode`;
  }
  const { settings, seed, version } = decoded;
  if (settings.size !== trace.size || settings.silver !== trace.silver) {
    return 'seed code size or silver acorns differ';
  }
  const puzzle = generate(settings, seed, version);
  if (puzzle.tier !== trace.tier) {
    return `puzzle is ${puzzle.tier}, recorded ${trace.tier}`;
  }
  const regionSize = (region: number): number => puzzle.regions.filter((r) => r === region).length;
  for (const event of trace.events) {
    const region = puzzle.regions[event.cell];
    if (puzzle.solution.includes(event.cell) === event.wrong) {
      return `order ${event.order} ${event.wrong ? 'is a stump' : 'is not a stump'}`;
    }
    if (puzzle.colors[region] !== event.color || regionSize(region) !== event.amount) {
      return `order ${event.order} color or region size differs`;
    }
  }
  const givens = trace.events.filter((event) => event.source === 'given').map((event) => event.cell);
  if (givens.length !== puzzle.givens.length || !puzzle.givens.every((cell) => givens.includes(cell))) {
    return 'givens differ';
  }
  return null;
}

/* ========================================================= *\
 *  Round inputs                                             *
\* ========================================================= */

/** One turn of a round: a collection, or a wrong reveal that collects nothing. */
export type RoundTurn =
  | {
    readonly type: 'collect';
    /** Palette index, from 0. */
    readonly color: number;
    /** Pulse strength: squares in the region. */
    readonly amount: number;
    /** How the stump was found. */
    readonly source: FoundBy;
  }
  | { readonly type: 'wrong' };

/** The turns of one puzzle, ready for the adventure simulator. */
export interface RoundInput {
  /** Recording the trace came from. */
  readonly dataset: string;
  /** Identifier of the recorded play. */
  readonly id: string;
  /** Seed code of the puzzle. */
  readonly code: string;
  /** Grid size. */
  readonly size: number;
  /** Rated difficulty. */
  readonly tier: Tier;
  /** `replay` is the exact recorded order; `synthetic` has wrong turns that were not recorded. */
  readonly sequence: 'replay' | 'synthetic';
  /** Turns in order. Givens make no turn. */
  readonly turns: readonly RoundTurn[];
}

const collectOf = (event: TraceEvent): RoundTurn => (event.wrong
  ? { type: 'wrong' }
  : { type: 'collect', color: event.color, amount: event.amount, source: event.source });

const roundOf = (trace: SolveTrace, sequence: RoundInput['sequence'], turns: RoundTurn[]): RoundInput => ({
  dataset: trace.dataset, id: trace.id, code: trace.code, size: trace.size, tier: trace.tier, sequence, turns,
});

/**
 * @param trace the trace
 * @returns its exact recorded turns, or null if some wrong reveals were not recorded
 */
export function replayRound(trace: SolveTrace): RoundInput | null {
  return trace.turnsKnown
    ? roundOf(trace, 'replay', trace.events.filter((event) => event.source !== 'given').map(collectOf))
    : null;
}

/**
 * The trace's collections in recorded order, with a set number of wrong turns
 * placed at random before collections. Recorded wrong reveals are dropped.
 * The same trace, count, and seed always give the same round.
 * @param trace the trace
 * @param wrongTurns wrong turns to add, 0 to 2 for a puzzle with 3 acorns
 * @param seed 32-bit seed for placing them
 * @returns the synthetic round
 */
export function syntheticRound(trace: SolveTrace, wrongTurns: number, seed: number): RoundInput {
  const collections = trace.events.filter((event) => !event.wrong && event.source !== 'given').map(collectOf);
  const rng = mulberry32(seed);
  const turns = [...collections];
  // A wrong turn cannot come last: the final collection solves the puzzle.
  for (let i = 0; i < wrongTurns; i++) {
    turns.splice(Math.floor(rng() * turns.length), 0, { type: 'wrong' });
  }
  return roundOf(trace, 'synthetic', turns);
}

/* ========================================================= *\
 *  Descriptive statistics (technical design, section 10)    *
\* ========================================================= */

/** Collection statistics for a group of traces. Pulses exclude givens. */
export interface TraceStats {
  /** Plays in the group. */
  readonly games: number;
  /** Collections, excluding givens. */
  readonly collections: number;
  /** Median first collection. */
  readonly medianFirst: number;
  /** Median last collection. */
  readonly medianLast: number;
  /** Share of plays whose first collection was 4 or fewer. */
  readonly smallFirst: number;
  /** Share of plays whose last collection exceeded the first. */
  readonly lastExceedsFirst: number;
  /** Share of plays whose largest region was among the last three collections (ties count). */
  readonly largestLate: number;
  /** Largest pulse. */
  readonly largest: number;
  /** Median pulse. */
  readonly medianPulse: number;
  /** Share of all collected energy in each play's first three collections. */
  readonly firstThreeEnergy: number;
  /** Share of all collected energy in each play's last three collections. */
  readonly lastThreeEnergy: number;
}

/**
 * @param values numbers
 * @returns their median, or NaN if there are none
 */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length === 0 ? NaN : Number.isInteger(mid) ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/**
 * @param traces the traces to describe
 * @returns their collection statistics
 */
export function traceStats(traces: readonly SolveTrace[]): TraceStats {
  const pulses = traces.map((trace) => trace.events.filter((e) => !e.wrong && e.source !== 'given').map((e) => e.amount));
  const share = (test: (p: readonly number[], trace: SolveTrace) => boolean): number => (
    pulses.filter((p, i) => test(p, traces[i])).length / traces.length);
  const total = sum(pulses.map(sum));
  return {
    games: traces.length,
    collections: sum(pulses.map((p) => p.length)),
    medianFirst: median(pulses.map((p) => p[0])),
    medianLast: median(pulses.map((p) => p.at(-1)!)),
    smallFirst: share((p) => p[0] <= 4),
    lastExceedsFirst: share((p) => p.at(-1)! > p[0]),
    largestLate: share((p, trace) => p.slice(-3).includes(Math.max(...trace.events.filter((e) => !e.wrong).map((e) => e.amount)))),
    largest: Math.max(...pulses.flat()),
    medianPulse: median(pulses.flat()),
    firstThreeEnergy: sum(pulses.map((p) => sum(p.slice(0, 3)))) / total,
    lastThreeEnergy: sum(pulses.map((p) => sum(p.slice(-3)))) / total,
  };
}
