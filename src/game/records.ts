import type { Puzzle, Tier } from '../engine';

/** One of the three hints, in woodpecker, owl, squirrel order. */
export type HintName = 'woodpecker' | 'owl' | 'squirrel';

/** Which hints have been used on a puzzle. */
export interface HintFlags {
  /** Reveal hint. */
  woodpecker: boolean;
  /** Explain hint. */
  owl: boolean;
  /** Eliminate hint. */
  squirrel: boolean;
}

/**
 * One completed play. Lost puzzles are not recorded. Starred (clean) times
 * sort above the others, then by time.
 */
export interface TimeRecord {
  /** Seed code of the puzzle. */
  readonly code: string;
  /** Grid size. */
  readonly size: number;
  /** Rated difficulty. */
  readonly tier: Tier;
  /** Completion time in milliseconds. */
  readonly elapsedMs: number;
  /** Hints used, in display order. */
  readonly hints: readonly HintName[];
  /** Acorns spent on wrong reveals. */
  readonly acornsLost: number;
  /** Whether the puzzle was a silver-acorn puzzle. */
  readonly silver: boolean;
  /** Whether this device had started the puzzle before. */
  readonly repeat: boolean;
  /** No hints, no acorns lost, and the first play on this device. */
  readonly clean: boolean;
  /** When the result was recorded, as a Unix millisecond timestamp. */
  readonly at: number;
}

/** The part of a session a result is built from. */
export interface ResultSource {
  /** The puzzle that was solved. */
  readonly puzzle: Puzzle;
  /** Time in milliseconds. */
  readonly elapsedMs: number;
  /** Hints used. */
  readonly hints: HintFlags;
  /** Acorns remaining at the end. */
  readonly acornsLeft: number;
  /** True when the code had already been started on this device. */
  readonly isRepeat: boolean;
}

/**
 * @param hints hint flags
 * @returns the used hints in display order
 */
export function hintsUsed(hints: HintFlags): HintName[] {
  const used: HintName[] = [];
  if (hints.woodpecker) {
    used.push('woodpecker');
  }
  if (hints.owl) {
    used.push('owl');
  }
  if (hints.squirrel) {
    used.push('squirrel');
  }
  return used;
}

/**
 * Builds the record for a win. Clean requires no hints, no lost acorns, and a
 * first play. Hypothesis use is not part of the record.
 * @param source the finished session
 * @param at timestamp for the record
 * @returns the record
 */
export function makeRecord(source: ResultSource, at: number): TimeRecord {
  const hints = hintsUsed(source.hints);
  const acornsLost = (source.puzzle.silver ? 1 : 3) - source.acornsLeft;
  return {
    code: source.puzzle.code,
    size: source.puzzle.size,
    tier: source.puzzle.tier,
    elapsedMs: source.elapsedMs,
    hints,
    acornsLost,
    silver: source.puzzle.silver,
    repeat: source.isRepeat,
    clean: hints.length === 0 && acornsLost === 0 && !source.isRepeat,
    at,
  };
}

/**
 * Best times for one size and difficulty. Clean solves come first, then faster times.
 * @param records every stored result
 * @param size grid size
 * @param tier difficulty
 * @returns the matching records, best first
 */
export function bestTimes(records: readonly TimeRecord[], size: number, tier: Tier): TimeRecord[] {
  return records
    .filter((record) => record.size === size && record.tier === tier)
    .sort((a, b) => Number(b.clean) - Number(a.clean) || a.elapsedMs - b.elapsedMs || a.at - b.at);
}

/**
 * Formats a duration as m:ss, or h:mm:ss once it reaches an hour.
 * @param ms milliseconds
 * @returns the clock text
 */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number): string => value.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}
