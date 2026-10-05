/**
 * Region colors from the product requirements, in priority order.
 * A puzzle of size N uses the first N, assigned to regions by the generator.
 */
export const REGION_COLORS: readonly number[] = [
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

/** Woodland chrome used by the Phaser scenes. */
export const CHROME = {
  /** Page background. */
  background: 0x1E3326,
  /** Warm off-white for text and icon halos. */
  cream: 0xF4EBD4,
  /** Button fill. */
  walnut: 0x5C3D2E,
  /** Board frame and mark ink. */
  ink: 0x2A1C12,
  /** Selected controls and the clean-solve star. */
  gold: 0xE4BB49,
  /** Wrong reveal and flagged hypotheses. */
  danger: 0xB42318,
  /** Hypothesis marks, distinct from the region palette. */
  hypo: 0x2C4C73,
  /** Panel scrim. */
  scrim: 0x102017,
} as const;
