import type { Settings } from './controller';
import { decodeSeedCode, encodeSeedCode, isValidSolution, MAX_SIZE, MIN_SIZE, type Puzzle, type Step, TIERS } from './engine';
import { type Game, type Hint, HINTS, MARK_NONE, MARK_RED, MARK_STUMP, MARK_X, type Result, resultOf } from './game';

/** One atomic save. Its version is independent of the puzzle generator version. */
export interface Save {
  /** Save format version. */
  version: 1;
  /** Player preferences. */
  settings: Settings;
  /** Most recent play, including its histories and pending explanation. */
  game: Game | null;
  /** Completed plays. */
  results: Result[];
  /** Codes started on this device. */
  played: string[];
  /** Whether the puzzle screen was left open. */
  open: boolean;
}

/** The only keys read when migrating main's previous saves. */
export const LEGACY_KEYS = ['settings', 'game', 'results', 'played', 'open'] as const;

/** Creates the initial state for a device without a readable save. */
export function newSave(): Save {
  return { version: 1, settings: { timer: true, silver: false }, game: null, results: [], played: [], open: false };
}

const object = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value));
const integer = (value: unknown, min: number, max: number): value is number => (
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max);
const duration = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const tier = (value: unknown): boolean => TIERS.some((t) => t === value);
const cells = (value: unknown, max: number): value is number[] => (
  Array.isArray(value) && value.every((cell: unknown) => integer(cell, 0, max)));
const unique = (value: readonly unknown[]): boolean => new Set(value).size === value.length;
const code = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }
  const decoded = decodeSeedCode(value);
  return decoded !== null && encodeSeedCode(decoded.settings, decoded.seed) === value;
};
const hints = (value: unknown): value is Hint[] => Array.isArray(value) && unique(value)
  && value.every((hint: unknown) => HINTS.some((h) => h === hint));
const marks = (value: unknown, count: number, max: number): value is number[] => cells(value, max) && value.length === count;

const validSettings = (value: unknown): value is Settings => object(value)
  && typeof value.timer === 'boolean' && typeof value.silver === 'boolean'
  && (value.size === undefined || integer(value.size, MIN_SIZE, MAX_SIZE))
  && (value.tier === undefined || tier(value.tier))
  && [value.sizeMix, value.shape, value.freebies].every((v) => v === undefined || integer(v, 0, 3));

const validPuzzle = (value: unknown): value is Puzzle => {
  if (!object(value) || !integer(value.size, MIN_SIZE, MAX_SIZE) || !tier(value.tier)
    || typeof value.silver !== 'boolean' || !code(value.code)) {
    return false;
  }
  const n = value.size;
  const decoded = decodeSeedCode(value.code)!;
  return decoded.settings.size === n && decoded.settings.silver === value.silver
    // The engine may rate a puzzle differently from the requested seed-code tier.
    && marks(value.regions, n * n, n - 1)
    && marks(value.colors, n, n - 1) && unique(value.colors)
    && marks(value.solution, n, n * n - 1)
    && value.solution.every((cell, row) => Math.floor(cell / n) === row)
    && cells(value.givens, n * n - 1) && unique(value.givens)
    && value.givens.every((cell) => (value.solution as number[]).includes(cell))
    && isValidSolution(value as unknown as Puzzle, value.solution);
};

const validHistory = (value: unknown, layer: readonly number[], normal: readonly number[], max: number): boolean => (
  Array.isArray(value) && value.every((stroke: unknown) => Array.isArray(stroke)
    && stroke.every((change: unknown) => Array.isArray(change) && change.length === 2
      && integer(change[0], 0, layer.length - 1) && integer(change[1], 0, max)
      && (max === MARK_X ? normal[change[0]] < MARK_RED : normal[change[0]] === MARK_NONE))));
const validUnit = (value: unknown, size: number): boolean => object(value)
  && ['row', 'col', 'region'].some((kind) => kind === value.kind) && integer(value.index, 0, size - 1);

const validStep = (value: unknown, size: number, depth = 0): value is Step => {
  if (!object(value) || depth > 10 || !cells(value.eliminated, size ** 2 - 1) || !unique(value.eliminated)) {
    return false;
  }
  switch (value.type) {
  case 'elimination':
    return integer(value.stump, 0, size ** 2 - 1);
  case 'forced':
    return integer(value.place, 0, size ** 2 - 1) && validUnit(value.unit, size) && value.eliminated.length === 0;
  case 'confinement':
    return integer(value.k, 1, Math.min(5, size)) && typeof value.reverse === 'boolean'
      && (value.axis === 'row' || value.axis === 'col')
      && marks(value.regions, value.k, size - 1) && unique(value.regions)
      && marks(value.lines, value.k, size - 1) && unique(value.lines);
  case 'blocking':
  case 'chain':
    return integer(value.cell, 0, size ** 2 - 1) && validUnit(value.unit, size)
      && value.eliminated.length === 1 && value.eliminated[0] === value.cell
      && (value.type !== 'chain' || (Array.isArray(value.steps)
        && value.steps.every((step: unknown) => validStep(step, size, depth + 1))));
  default:
    return false;
  }
};

const validGame = (value: unknown): value is Game => {
  if (!object(value) || !id(value.id) || !validPuzzle(value.puzzle)) {
    return false;
  }
  const { puzzle } = value;
  const count = puzzle.size ** 2;
  const total = puzzle.silver ? 1 : 3;
  if (!marks(value.marks, count, MARK_STUMP) || !integer(value.acorns, 0, total)
    || !integer(value.acornsLost, 0, total) || value.acorns + value.acornsLost !== total
    || !duration(value.elapsed) || !hints(value.hints) || typeof value.repeat !== 'boolean') {
    return false;
  }
  const normal = value.marks;
  const solved = puzzle.solution.every((cell) => normal[cell] === MARK_STUMP);
  if (!normal.every((mark, cell) => (mark !== MARK_STUMP || puzzle.solution.includes(cell))
    && (mark !== MARK_RED || !puzzle.solution.includes(cell)))
  || normal.filter((mark) => mark === MARK_RED).length !== value.acornsLost
  || !puzzle.givens.every((cell) => normal[cell] === MARK_STUMP)
  || !(value.status === 'won' ? solved && value.acorns > 0
    : value.status === 'lost' ? value.acorns === 0 && !solved
      : value.status === 'playing' && value.acorns > 0 && !solved)
    || !validHistory(value.undo, normal, normal, MARK_X)) {
    return false;
  }
  if (value.hypo === null) {
    if (!Array.isArray(value.hypoUndo) || value.hypoUndo.length !== 0) {
      return false;
    }
  } else if (!marks(value.hypo, count, 2) || !value.hypo.every((mark, cell) => mark === MARK_NONE || normal[cell] === MARK_NONE)
    || !validHistory(value.hypoUndo, value.hypo, normal, 2)) {
    return false;
  }
  if (value.explaining === null) {
    return true;
  }
  const explanation = value.explaining;
  if (!object(explanation) || value.status !== 'playing' || value.hypo !== null
    || !value.hints.includes('owl')) {
    return false;
  }
  if (explanation.type === 'wrongX') {
    return integer(explanation.cell, 0, count - 1) && puzzle.solution.includes(explanation.cell)
      && normal[explanation.cell] === MARK_X;
  }
  if (explanation.type !== 'step' || !validStep(explanation.step, puzzle.size)) {
    return false;
  }
  const { step } = explanation;
  return step.type === 'forced'
    ? puzzle.solution.includes(step.place) && normal[step.place] === MARK_NONE
    : step.eliminated.every((cell) => !puzzle.solution.includes(cell) && normal[cell] < MARK_RED);
};

const validResult = (value: unknown): value is Result => object(value) && id(value.id) && code(value.code)
  && integer(value.size, MIN_SIZE, MAX_SIZE) && tier(value.tier) && duration(value.time) && duration(value.date)
  && hints(value.hints) && typeof value.silver === 'boolean' && typeof value.repeat === 'boolean'
  && integer(value.acornsLost, 0, value.silver ? 0 : 2)
  && decodeSeedCode(value.code)!.settings.size === value.size
  && decodeSeedCode(value.code)!.settings.silver === value.silver;

/** Matches a recorded result to a play, ignoring its ID and completion date. */
export function matchesResult(result: Result, game: Game): boolean {
  const expected = resultOf(game, result.date);
  return result.code === expected.code && result.size === expected.size && result.tier === expected.tier
    && result.time === expected.time && result.acornsLost === expected.acornsLost
    && result.silver === expected.silver && result.repeat === expected.repeat
    && result.hints.length === expected.hints.length && result.hints.every((hint, index) => hint === expected.hints[index]);
}

const validSave = (value: unknown): value is Save => {
  if (!object(value) || value.version !== 1 || !validSettings(value.settings) || typeof value.open !== 'boolean'
    || !Array.isArray(value.played) || !value.played.every(code)
    || !Array.isArray(value.results) || !value.results.every(validResult)
    || !unique(value.results.map((result) => result.id)) || (value.game !== null && !validGame(value.game))) {
    return false;
  }
  const game = value.game;
  const recorded = game && value.results.find((result) => result.id === game.id);
  return !recorded || (game.status === 'won' && matchesResult(recorded, game));
};

/** Parses compatible saves, returning null without exposing malformed data. */
export function parseSave(raw: string): Save | null {
  try {
    const value: unknown = JSON.parse(raw);
    return validSave(value) ? value : null;
  } catch {
    return null;
  }
}

/** Migrates the five legacy raw values; any invalid section rejects the whole save. */
export function migrateSave(raw: Record<typeof LEGACY_KEYS[number], string | null>, createId: () => string): Save | null {
  try {
    const defaults = newSave();
    const value: Record<string, unknown> = { version: 1 };
    for (const key of LEGACY_KEYS) {
      value[key] = raw[key] === null ? defaults[key] : JSON.parse(raw[key]);
    }
    if (value.game !== null) {
      if (!object(value.game)) {
        return null;
      }
      value.game = { ...value.game, id: createId() };
    }
    if (!Array.isArray(value.results) || !value.results.every(object)) {
      return null;
    }
    value.results = value.results.map((result) => ({ ...result, id: createId() }));
    if (!validSave(value)) {
      return null;
    }
    if (value.game?.status === 'won') {
      // shortcut: old saves have no play IDs; match the latest identical result until migration succeeds.
      const recorded = value.results.findLast((result) => matchesResult(result, value.game!));
      if (recorded) {
        value.game.id = recorded.id;
      }
    }
    return value;
  } catch {
    return null;
  }
}
