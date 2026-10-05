/* ========================================================= *\
 *  Stumped Game State Types                                 *
\* ========================================================= */

import type { Conflict, Puzzle, Tier, Unit } from '../engine';

/** Cell mark values in normal play. */
export const MARK_OPEN = 0;
export const MARK_X = 1;
export const MARK_RED_X = 2;
export const MARK_STUMP = 3;

/** Normal cell mark type. */
export type NormalMark = typeof MARK_OPEN | typeof MARK_X | typeof MARK_RED_X | typeof MARK_STUMP;

/** Cell mark values in hypothesis mode. */
export const HYPO_NONE = 0;
export const HYPO_X = 1;
export const HYPO_STUMP = 2;

/** Hypothesis mark type. */
export type HypoMark = typeof HYPO_NONE | typeof HYPO_X | typeof HYPO_STUMP;

/** Names of the three hints. */
export type HintKind = 'woodpecker' | 'owl' | 'squirrel';

/** Record of which hints have been used in the active puzzle. */
export interface HintsUsed {
  /** Reveal hint: woodpecker. */
  readonly woodpecker: boolean;
  /** Explain hint: owl. */
  readonly owl: boolean;
  /** Eliminate hint: squirrel. */
  readonly squirrel: boolean;
}

/** Single cell change inside an undo step. */
export interface CellChange {
  /** Cell index in row-major order: row * size + col. */
  readonly cell: number;
  /** Previous mark value. */
  readonly from: number;
  /** New mark value. */
  readonly to: number;
}

/** An undoable user action (tap or drag stroke). */
export interface UndoStep {
  /** Mode when action was taken. */
  readonly mode: 'normal' | 'hypothesis';
  /** List of cell changes made in this action. */
  readonly changes: readonly CellChange[];
}

/** Result of attempting to reveal a stump. */
export interface RevealResult {
  /** Whether the reveal was correct. */
  readonly correct: boolean;
  /** Target cell index. */
  readonly cell: number;
  /** Whether the puzzle is now won. */
  readonly won: boolean;
  /** Whether the puzzle was lost on this reveal. */
  readonly lost: boolean;
  /** Whether all cells on the board are marked upon winning. */
  readonly perfectlyMarked: boolean;
  /** Units (row, col, region) that became fully marked on this reveal. */
  readonly newlyCompletedUnits: readonly Unit[];
  /** Placement rule conflicts if the reveal was wrong. */
  readonly conflicts: readonly Conflict[];
}

/** Result of a player tap or drag gesture. */
export interface MarkResult {
  /** Cells modified by this gesture. */
  readonly modifiedCells: readonly number[];
  /** Units that became fully marked as a result of these marks. */
  readonly newlyCompletedUnits: readonly Unit[];
  /** Whether all cells on the board are now marked. */
  readonly perfectlyMarked: boolean;
}

/** User-configurable preferences. */
export interface GameSettings {
  /** Whether the in-game timer is displayed during play. */
  readonly timerVisible: boolean;
  /** Grid size preference: 5 to 10 or 'random'. */
  readonly size: number | 'random';
  /** Difficulty preference: 'easy', 'medium', 'hard', or 'random'. */
  readonly difficulty: Tier | 'random';
  /** Always play with a single acorn. */
  readonly silverAcorn: boolean;
}

/** Record of a finished puzzle solve. */
export interface BestTimeRecord {
  /** Unique solve identifier. */
  readonly id: string;
  /** Board size (5 to 10). */
  readonly size: number;
  /** Difficulty tier. */
  readonly difficulty: Tier;
  /** Time to completion in milliseconds. */
  readonly timeMs: number;
  /** Whether the solve was clean (no hints, no acorns lost, first play). */
  readonly clean: boolean;
  /** Hints used during this solve. */
  readonly hintsUsed: readonly HintKind[];
  /** Total acorns lost during this solve. */
  readonly acornsLost: number;
  /** Whether played in silver acorn mode. */
  readonly silver: boolean;
  /** Whether this solve was a repeat play of the puzzle. */
  readonly repeat: boolean;
  /** Date/time string when finished. */
  readonly date: string;
  /** Seed code for the puzzle. */
  readonly code: string;
}

/** Saved game state serialized in local storage. */
export interface SavedGameState {
  /** The generated puzzle data. */
  readonly puzzle: Puzzle;
  /** Normal marks array (length size * size). */
  readonly normalMarks: readonly NormalMark[];
  /** Hypothesis marks array (length size * size). */
  readonly hypoMarks: readonly HypoMark[];
  /** Current acorns remaining. */
  readonly acorns: number;
  /** Starting acorns for this puzzle. */
  readonly maxAcorns: number;
  /** Record of hints used. */
  readonly hintsUsed: HintsUsed;
  /** Elapsed play time in milliseconds. */
  readonly elapsedTimeMs: number;
  /** Puzzle status: 'playing', 'won', or 'lost'. */
  readonly status: 'playing' | 'won' | 'lost';
  /** Whether hypothesis mode is currently active. */
  readonly hypothesisMode: boolean;
  /** Whether this play is a repeat attempt. */
  readonly isRepeat: boolean;
  /** Normal undo stack. */
  readonly undoStack: readonly UndoStep[];
  /** Hypothesis undo stack. */
  readonly hypoUndoStack: readonly UndoStep[];
  /** Timestamp when completed, if finished. */
  readonly completedAt?: string;
  /** Whether the solve ended with every square marked. */
  readonly perfectlyMarked?: boolean;
}
