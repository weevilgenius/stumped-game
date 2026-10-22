import type { Tier } from './engine';

/* ========================================================= *\
 *  Settings saved by earlier versions                       *
\* ========================================================= */

/** Inclusive puzzle sizes offered by each random size range that earlier versions saved. */
export const SIZE_RANGES = {
  smaller: [5, 6, 7],
  medium: [7, 8],
  larger: [8, 9, 10],
} as const;

/** A named size range that earlier versions saved as the size setting. */
export type SizeRange = keyof typeof SIZE_RANGES;

/** The single-choice size and difficulty that earlier versions saved. */
export interface LegacyChoices {
  /** Fixed size or named size range. */
  size?: number | SizeRange;
  /** Fixed difficulty. */
  tier?: Tier;
}

/** The size and difficulty choices that replace the single-choice settings. */
export interface Choices {
  /** Sizes to pick from at random; omitted to allow any size. */
  sizes?: readonly number[];
  /** Difficulties to pick from at random; omitted to allow any difficulty. */
  tiers?: readonly Tier[];
}

/**
 * Converts single-choice size and difficulty settings to the matching toggles.
 * A size range becomes its sizes, and a missing choice stays Any.
 * @param legacy the earlier settings
 * @returns the equivalent toggles
 */
export function upgradeChoices(legacy: LegacyChoices): Choices {
  const sizes = typeof legacy.size === 'string' ? [...SIZE_RANGES[legacy.size]]
    : legacy.size === undefined ? undefined : [legacy.size];
  return {
    ...(sizes && { sizes }),
    ...(legacy.tier && { tiers: [legacy.tier] }),
  };
}
