import type { Conflict, Puzzle, Step, Tier } from '../engine';

/* ========================================================= *\
 *  Color palette                                            *
\* ========================================================= */

/**
 * Ten region colors in priority order, from Meowdoku.
 * A puzzle of size N uses the first N colors.
 */
export const REGION_PALETTE_HEX: readonly string[] = [
  '#E4BB49', // Gold
  '#5B75B2', // Blue
  '#D57374', // Rose
  '#AED994', // Green
  '#48B5B2', // Teal
  '#FAB4D0', // Pink
  '#A7BFD7', // Light blue
  '#9778D6', // Purple
  '#AD6F48', // Brown
  '#FEAA6C', // Orange
];

/** Numeric RGB values for the ten region colors in priority order. */
export const REGION_PALETTE_NUM: readonly number[] = [
  0xE4BB49,
  0x5B75B2,
  0xD57374,
  0xAED994,
  0x48B5B2,
  0xFAB4D0,
  0xA7BFD7,
  0x9778D6,
  0xAD6F48,
  0xFEAA6C,
];

/* ========================================================= *\
 *  Cell marks                                               *
\* ========================================================= */

/** Normal-layer cell state: unmarked. */
export const MARK_OPEN = 0;
/** Normal-layer cell state: player or hint X. */
export const MARK_X = 1;
/** Normal-layer cell state: revealed stump. */
export const MARK_STUMP = 2;
/** Normal-layer cell state: wrong-reveal red X. */
export const MARK_RED_X = 3;

/** Cell state on the normal play layer. */
export type NormalMark = typeof MARK_OPEN | typeof MARK_X | typeof MARK_STUMP | typeof MARK_RED_X;

/** Hypothesis-layer cell state: unmarked in hypothesis mode. */
export const HYP_NONE = 0;
/** Hypothesis-layer cell state: hypothesis X (upper-right). */
export const HYP_X = 1;
/** Hypothesis-layer cell state: tentative stump. */
export const HYP_STUMP = 2;

/** Cell state on the hypothesis scratch layer. */
export type HypothesisMark = typeof HYP_NONE | typeof HYP_X | typeof HYP_STUMP;

/* ========================================================= *\
 *  Hints and undo                                           *
\* ========================================================= */

/** Identifier for each of the three per-puzzle hints. */
export type HintKind = 'reveal' | 'explain' | 'eliminate';

/** All three hint kinds in display order (Woodpecker, Owl, Squirrel). */
export const HINT_KINDS: readonly HintKind[] = ['reveal', 'explain', 'eliminate'];

/** Tracks which hints have been used in the current puzzle. */
export interface HintsUsed {
  /** Woodpecker: reveals the stump in the region with the fewest open squares. */
  readonly reveal: boolean;
  /** Owl: explains the simplest available deduction (or points out a wrong X). */
  readonly explain: boolean;
  /** Squirrel: marks up to three random unmarked squares that hold no stump. */
  readonly eliminate: boolean;
}

/** A single cell change within an undo step. */
export interface CellChange {
  /** Cell index (row * size + col). */
  readonly cell: number;
  /** Mark before the gesture. */
  readonly before: number;
  /** Mark after the gesture. */
  readonly after: number;
}

/** One undoable tap or drag stroke. */
export interface UndoStep {
  /** Cell changes recorded during the tap or drag stroke. */
  readonly changes: readonly CellChange[];
}

/* ========================================================= *\
 *  Explain (Owl) hint state                                 *
\* ========================================================= */

/** Explain hint pointing out a player X sitting on a solution stump's square. */
export interface WrongXExplanation {
  /** Discriminator for a wrong-X explanation. */
  readonly type: 'wrong-x';
  /** The cell holding a solution stump that the player marked with an X. */
  readonly cell: number;
  /** Human-readable explanation text. */
  readonly text: string;
}

/** Explain hint showing a solver deduction step (including multi-step chains). */
export interface DeductionExplanation {
  /** Discriminator for a solver deduction explanation. */
  readonly type: 'deduction';
  /** The primary solver step being explained. */
  readonly step: Step;
  /** Current sub-step index for chain explanations (0 = overview, 1..steps.length = sub-steps). */
  readonly chainIndex: number;
  /** Human-readable explanation text for the current view. */
  readonly text: string;
}

/** Active state of the Owl explain hint overlay. */
export type ActiveExplanation = WrongXExplanation | DeductionExplanation;

/* ========================================================= *\
 *  Settings                                                 *
\* ========================================================= */

/** Level 0..3 or 'random' for generator variety controls. */
export type VarietyPreference = 0 | 1 | 2 | 3 | 'random';

/** Grid size 5..10 or 'random'. */
export type SizePreference = number | 'random';

/** Difficulty tier or 'random'. */
export type TierPreference = Tier | 'random';

/** Persisted player settings. */
export interface AppSettings {
  /** Whether the timer is shown during play (time is always recorded). */
  readonly showTimer: boolean;
  /** Fixed grid size (5 to 10) or 'random'. */
  readonly size: SizePreference;
  /** Fixed difficulty tier or 'random'. */
  readonly tier: TierPreference;
  /** Whether every generated puzzle is a silver acorn (1 life) puzzle. */
  readonly silver: boolean;
  /** Region size mix preference (0 similar to 3 one dominant, or 'random'). */
  readonly sizeMix: VarietyPreference;
  /** Region shape preference (0 compact blobs to 3 long thin runs, or 'random'). */
  readonly shape: VarietyPreference;
  /** Freebies frequency preference (0 never to 3 often, or 'random'). */
  readonly freebies: VarietyPreference;
}

/** Default settings for a fresh install. */
export const DEFAULT_SETTINGS: AppSettings = {
  showTimer: true,
  size: 'random',
  tier: 'random',
  silver: false,
  sizeMix: 'random',
  shape: 'random',
  freebies: 'random',
};

/* ========================================================= *\
 *  Puzzle status, persistence, and best times               *
\* ========================================================= */

/** Lifecycle status of a puzzle session. */
export type PuzzleStatus = 'in_progress' | 'won' | 'lost';

/** Serialized state of the current puzzle for instant crash/relaunch recovery. */
export interface SavedPuzzleState {
  /** The generated puzzle definition. */
  readonly puzzle: Puzzle;
  /** Current status of the puzzle. */
  readonly status: PuzzleStatus;
  /** Normal marks for each cell (length size * size). */
  readonly normalMarks: readonly NormalMark[];
  /** Cells whose marks are permanent (givens, reveals, red X's, hint marks) and cannot be undone. */
  readonly lockedCells: readonly number[];
  /** Whether hypothesis mode is currently active. */
  readonly hypothesisMode: boolean;
  /** Hypothesis marks for each cell (length size * size). */
  readonly hypothesisMarks: readonly HypothesisMark[];
  /** Normal play undo stack. */
  readonly normalUndoStack: readonly UndoStep[];
  /** Hypothesis mode undo stack. */
  readonly hypothesisUndoStack: readonly UndoStep[];
  /** Remaining acorns (lives). */
  readonly acorns: number;
  /** Number of acorns lost so far. */
  readonly acornsLost: number;
  /** Which hints have been used on this puzzle. */
  readonly hintsUsed: HintsUsed;
  /** Elapsed play time in milliseconds. */
  readonly elapsedMs: number;
  /** True if this puzzle seed code had already been played on this device before this attempt. */
  readonly repeat: boolean;
  /** True if the puzzle was won with no square left unmarked. */
  readonly perfectlyMarked: boolean;
  /** Keys of units ('row:0', 'col:1', 'region:2') that have already played their completion pulse. */
  readonly pulsedUnits: readonly string[];
}

/** A completed puzzle solve record stored in Best Times. */
export interface SolveRecord {
  /** Seed code of the completed puzzle. */
  readonly code: string;
  /** Board size (5 to 10). */
  readonly size: number;
  /** Rated difficulty tier. */
  readonly tier: Tier;
  /** Elapsed time to completion in milliseconds. */
  readonly timeMs: number;
  /** Hints used during the solve, in canonical order. */
  readonly hintsUsed: readonly HintKind[];
  /** Number of acorns lost during the solve. */
  readonly acornsLost: number;
  /** Whether the puzzle was played in silver acorn mode. */
  readonly silver: boolean;
  /** Whether this was a repeat play of the puzzle on this device. */
  readonly repeat: boolean;
  /** True if no hints were used, no acorns were lost, and it was the first play on this device. */
  readonly clean: boolean;
  /** Epoch milliseconds when the solve completed. */
  readonly completedAt: number;
}

/** Result of attempting to reveal a stump at a cell in normal mode. */
export interface RevealResult {
  /** Whether the reveal was a valid stump, a wrong guess, or ignored. */
  readonly outcome: 'correct' | 'wrong' | 'noop';
  /** Cell index that was revealed. */
  readonly cell: number;
  /** Rule conflicts against already-revealed stumps when outcome is 'wrong'. */
  readonly conflicts: readonly Conflict[];
  /** Cells belonging to units that became completely marked by this action (for pulse animation). */
  readonly pulsedCells: readonly number[];
  /** True if this reveal won the puzzle. */
  readonly won: boolean;
  /** True if the puzzle was won and every non-stump square was marked. */
  readonly perfectlyMarked: boolean;
  /** True if this wrong reveal cost the last acorn and lost the puzzle. */
  readonly lost: boolean;
}
