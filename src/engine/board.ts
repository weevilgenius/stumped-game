/* ========================================================= *\
 *  Core types                                               *
\* ========================================================= */

/** Difficulty tier, from the hardest technique the solver needed. */
export type Tier = 'easy' | 'medium' | 'hard';

/** All tiers, easiest first. */
export const TIERS: readonly Tier[] = ['easy', 'medium', 'hard'];

/**
 * An N by N grid split into N regions. Cells are indexed `row * size + col`.
 */
export interface Board {
  /** Grid width and height, 5 to 10. */
  readonly size: number;
  /** Region index (0 to size - 1) for each cell. */
  readonly regions: readonly number[];
}

/** A generated, playable puzzle. */
export interface Puzzle extends Board {
  /** The stump cells, one per row, ordered by row. */
  readonly solution: readonly number[];
  /** Stump cells revealed at the start. */
  readonly givens: readonly number[];
  /** Palette index (0 to 9) for each region. */
  readonly colors: readonly number[];
  /** Rated difficulty. */
  readonly tier: Tier;
  /** Whether the puzzle is played with a single acorn. */
  readonly silver: boolean;
  /** Seed code that regenerates this puzzle. */
  readonly code: string;
}

/**
 * Generator version, carried in every seed code. Bump it whenever the same
 * settings and seed would produce a different board.
 */
export const GENERATOR_VERSION = 2;

/** Smallest supported grid size. */
export const MIN_SIZE = 5;
/** Largest supported grid size. */
export const MAX_SIZE = 10;

/**
 * Everything besides the seed that determines a generated board. The variety
 * controls are levels 0 to 3 so they pack into a seed code.
 */
export interface GeneratorSettings {
  /** Grid size, 5 to 10. */
  readonly size: number;
  /** Requested difficulty. */
  readonly tier: Tier;
  /** Single acorn mode. */
  readonly silver: boolean;
  /** Region size mix: 0 similar sizes up to 3 one dominant region. */
  readonly sizeMix: number;
  /** Region shape: 0 compact blobs up to 3 long thin runs. */
  readonly shape: number;
  /** How often a freebie (revealed stump or one-square region) appears: 0 never up to 3 often. */
  readonly freebies: number;
}

/** Cell state: still possible. */
export const OPEN = 0;
/** Cell state: ruled out (an X). */
export const EXCLUDED = 1;
/** Cell state: holds a stump. */
export const STUMP = 2;

/** A row, column, or region: a set of cells that holds exactly one stump. */
export interface Unit {
  /** Which kind of unit. */
  readonly kind: 'row' | 'col' | 'region';
  /** Row, column, or region index. */
  readonly index: number;
}

/** A placement rule a stump can break. */
export type Rule = 'row' | 'col' | 'region' | 'touch';

/** A rule broken by a stump at some cell, against an existing stump. */
export interface Conflict {
  /** The existing stump's cell. */
  readonly stump: number;
  /** The rule broken. */
  readonly rule: Rule;
}

/* ========================================================= *\
 *  Geometry                                                 *
\* ========================================================= */

/**
 * @param size grid size
 * @param cell cell index
 * @returns the cell's row
 */
export function rowOf(size: number, cell: number): number {
  return Math.floor(cell / size);
}

/**
 * @param size grid size
 * @param cell cell index
 * @returns the cell's column
 */
export function colOf(size: number, cell: number): number {
  return cell % size;
}

/**
 * @param size grid size
 * @param cell cell index
 * @returns the up to eight cells touching this one, diagonals included
 */
export function neighbors(size: number, cell: number): number[] {
  const r = rowOf(size, cell);
  const c = colOf(size, cell);
  const result: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr;
      const nc = c + dc;
      if ((dr || dc) && nr >= 0 && nr < size && nc >= 0 && nc < size) {
        result.push(nr * size + nc);
      }
    }
  }
  return result;
}

/**
 * @param board the board
 * @param unit a row, column, or region
 * @returns the unit's cells in ascending order
 */
export function unitCells(board: Board, unit: Unit): number[] {
  const { size } = board;
  const cells: number[] = [];
  for (let i = 0; i < size; i++) {
    if (unit.kind === 'row') {
      cells.push(unit.index * size + i);
    } else if (unit.kind === 'col') {
      cells.push(i * size + unit.index);
    }
  }
  if (unit.kind === 'region') {
    board.regions.forEach((region, cell) => {
      if (region === unit.index) {
        cells.push(cell);
      }
    });
  }
  return cells;
}

/**
 * Lists every unit on the board: rows, then columns, then regions.
 * @param board the board
 * @returns all 3N units
 */
export function allUnits(board: Board): Unit[] {
  const units: Unit[] = [];
  for (const kind of ['row', 'col', 'region'] as const) {
    for (let index = 0; index < board.size; index++) {
      units.push({ kind, index });
    }
  }
  return units;
}

/* ========================================================= *\
 *  Placement rules                                          *
\* ========================================================= */

/**
 * Lists the rules a stump at `cell` would break against existing stumps.
 * Used for the wrong-reveal conflict line and for flagging tentative stumps.
 * @param board the board
 * @param cell the square being tried
 * @param stumps cells of stumps already on the board
 * @returns every (stump, rule) pair broken, in stump order then rule order
 */
export function conflicts(board: Board, cell: number, stumps: readonly number[]): Conflict[] {
  const { size, regions } = board;
  const r = rowOf(size, cell);
  const c = colOf(size, cell);
  const result: Conflict[] = [];
  for (const stump of stumps) {
    if (stump === cell) {
      continue;
    }
    const sr = rowOf(size, stump);
    const sc = colOf(size, stump);
    if (sr === r) {
      result.push({ stump, rule: 'row' });
    }
    if (sc === c) {
      result.push({ stump, rule: 'col' });
    }
    if (regions[stump] === regions[cell]) {
      result.push({ stump, rule: 'region' });
    }
    if (Math.abs(sr - r) <= 1 && Math.abs(sc - c) <= 1) {
      result.push({ stump, rule: 'touch' });
    }
  }
  return result;
}

/**
 * @param board the board
 * @param stumps candidate stump cells
 * @returns true if the stumps are a complete solution satisfying all four rules
 */
export function isValidSolution(board: Board, stumps: readonly number[]): boolean {
  return new Set(stumps).size === board.size
    && stumps.every((stump, i) => conflicts(board, stump, stumps.slice(0, i)).length === 0);
}
