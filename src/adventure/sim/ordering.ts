import {
  allUnits, applyStep, type Board, nextStep, OPEN, type Puzzle, STUMP, unitCells,
} from '../../engine';
import mulberry32 from '../../utils/mulberry';
import type { RoundTurn } from './traces';

/** Independent deterministic random stream, stable when unrelated experiments are added. */
export function streamSeed(seed: number, key: string): number {
  let hash = seed >>> 0;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

/** Shuffle whole color/amount pairs; retain wrong-turn positions and their count. */
export function shuffleTurns(turns: readonly RoundTurn[], seed: number): RoundTurn[] {
  const rng = mulberry32(seed);
  const pulses = turns.filter((turn) => turn.type === 'collect');
  for (let i = pulses.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pulses[i], pulses[j]] = [pulses[j], pulses[i]];
  }
  let index = 0;
  return turns.map((turn) => (turn.type === 'wrong' ? turn : pulses[index++]));
}

/** Public board geometry for a policy: deliberately excludes the hidden solution. */
export interface VisibleBoard extends Board {
  /** Region to palette index. */
  readonly colors: readonly number[];
}

const availabilityCache = new WeakMap<VisibleBoard, Map<string, readonly number[]>>();

/**
 * Conservative availability model: apply solver eliminations until the first
 * forced placement, then offer all simultaneously forced cells. Never apply
 * an unrevealed placement to unlock another candidate. No solution is read.
 * Rebuild marks from actual revealed cells each time; cache by that set.
 */
export function reachableCells(board: VisibleBoard, revealed: readonly number[]): readonly number[] {
  let cache = availabilityCache.get(board);
  if (!cache) {
    cache = new Map();
    availabilityCache.set(board, cache);
  }
  const key = [...revealed].sort((a, b) => a - b).join(',');
  const cached = cache.get(key);
  if (cached) return cached;
  let marks: Uint8Array = new Uint8Array(board.size ** 2);
  for (const cell of revealed) marks[cell] = STUMP;
  for (;;) {
    const deduction = nextStep(board, marks);
    if (!deduction || deduction.type === 'forced') break;
    marks = applyStep(marks, deduction);
  }
  const cells = new Set<number>();
  for (const unit of allUnits(board)) {
    const members = unitCells(board, unit);
    if (members.some((cell) => marks[cell] === STUMP)) continue;
    const open = members.filter((cell) => marks[cell] === OPEN);
    if (open.length === 1) cells.add(open[0]);
  }
  const result = [...cells].sort((a, b) => a - b);
  cache.set(key, result);
  return result;
}

/** One deducible or oracle collection opportunity. */
export interface Opportunity {
  /** Cell that may be revealed. */
  readonly cell: number;
  /** Its visible palette index. */
  readonly color: number;
  /** Size of its visible region. */
  readonly amount: number;
}

/** Visible color and size at a cell; does not inspect the solution. */
export function opportunity(board: VisibleBoard, cell: number): Opportunity {
  const region = board.regions[cell];
  return { cell, color: board.colors[region], amount: board.regions.filter((r) => r === region).length };
}

/**
 * Opportunities constrained by solver deductions, or full hidden-solution
 * knowledge for the explicitly labeled oracle benchmark.
 */
export function opportunities(puzzle: Puzzle, revealed: readonly number[], oracle = false): Opportunity[] {
  const cells = oracle ? puzzle.solution.filter((cell) => !revealed.includes(cell)) : reachableCells(puzzle, revealed);
  return cells.map((cell) => opportunity(puzzle, cell));
}
