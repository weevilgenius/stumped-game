/** Inclusive puzzle sizes offered by each random size range. */
export const SIZE_RANGES = {
  smaller: [5, 6, 7],
  medium: [7, 8],
  larger: [8, 9, 10],
} as const;

/** A named range to choose from when preparing each new puzzle. */
export type SizeRange = keyof typeof SIZE_RANGES;
