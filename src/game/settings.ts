import {
  type GeneratorSettings, MAX_SIZE, MIN_SIZE, type Tier, TIERS,
} from '../engine';

/** Labels for the region size-mix control, from similar to one dominant region. */
export const SIZE_MIX_LABELS: readonly string[] = [
  'Similar sizes',
  'Slightly mixed',
  'Uneven',
  'One dominant',
];

/** Labels for the region shape control, from compact blobs to long thin runs. */
export const SHAPE_LABELS: readonly string[] = [
  'Compact blobs',
  'Mostly round',
  'Stretchy',
  'Long thin runs',
];

/** Labels for how often a freebie appears. */
export const FREEBIE_LABELS: readonly string[] = [
  'No freebies',
  'Rare freebies',
  'Some freebies',
  'Freebies often',
];

/**
 * Preferences stored on this device. Null means "pick at random" for a variety
 * control. Silver is a switch: on forces every puzzle to one acorn, off leaves
 * it to the generator (about one in five when the rest is random).
 */
export interface Settings {
  /** Whether the timer is drawn during play. The time is recorded either way. */
  showTimer: boolean;
  /** Fixed grid size, or null to choose 5 to 10 at random. */
  size: number | null;
  /** Fixed difficulty, or null to choose at random. */
  tier: Tier | null;
  /** When true, every puzzle starts with one acorn. */
  silver: boolean;
  /** Region size mix 0 to 3, or null to vary. */
  sizeMix: number | null;
  /** Region shape 0 to 3, or null to vary. */
  shape: number | null;
  /** Freebie frequency 0 to 3, or null to vary. */
  freebies: number | null;
}

/** Settings on a fresh install. */
export const DEFAULT_SETTINGS: Settings = {
  showTimer: true,
  size: null,
  tier: null,
  silver: false,
  sizeMix: null,
  shape: null,
  freebies: null,
};

/**
 * The fields the player has fixed, ready for `randomSettings`.
 * @param settings current preferences
 * @returns a partial generator request
 */
export function fixedSettings(settings: Settings): Partial<GeneratorSettings> {
  return {
    ...(settings.size !== null ? { size: settings.size } : {}),
    ...(settings.tier !== null ? { tier: settings.tier } : {}),
    ...(settings.silver ? { silver: true as const } : {}),
    ...(settings.sizeMix !== null ? { sizeMix: settings.sizeMix } : {}),
    ...(settings.shape !== null ? { shape: settings.shape } : {}),
    ...(settings.freebies !== null ? { freebies: settings.freebies } : {}),
  };
}

/**
 * Rebuilds settings from saved JSON, falling back to defaults for anything odd.
 * @param value parsed JSON
 * @returns a complete settings object
 */
export function sanitizeSettings(value: unknown): Settings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Settings>;
  return {
    showTimer: raw.showTimer !== false,
    size: validSize(raw.size),
    tier: raw.tier === 'easy' || raw.tier === 'medium' || raw.tier === 'hard' ? raw.tier : null,
    silver: raw.silver === true,
    sizeMix: validLevel(raw.sizeMix),
    shape: validLevel(raw.shape),
    freebies: validLevel(raw.freebies),
  };
}

/**
 * Cycles a fixed-or-random size. Null (random) advances to the minimum size,
 * and the maximum size wraps back to random.
 * @param size current value
 * @returns the next value
 */
export function cycleSize(size: number | null): number | null {
  if (size === null) {
    return MIN_SIZE;
  }
  return size >= MAX_SIZE ? null : size + 1;
}

/**
 * Cycles difficulty, including random.
 * @param tier current value
 * @returns the next value
 */
export function cycleTier(tier: Tier | null): Tier | null {
  if (tier === null) {
    return TIERS[0];
  }
  const index = TIERS.indexOf(tier);
  return index >= TIERS.length - 1 ? null : TIERS[index + 1];
}

/**
 * Cycles a 0-to-3 variety level, including random.
 * @param level current value
 * @returns the next value
 */
export function cycleLevel(level: number | null): number | null {
  if (level === null) {
    return 0;
  }
  return level >= 3 ? null : level + 1;
}

/**
 * @param size a saved size
 * @returns the size when it is in range, otherwise null
 */
function validSize(size: unknown): number | null {
  return typeof size === 'number' && Number.isInteger(size) && size >= MIN_SIZE && size <= MAX_SIZE
    ? size
    : null;
}

/**
 * @param level a saved variety level
 * @returns the level when it is 0 to 3, otherwise null
 */
function validLevel(level: unknown): number | null {
  return typeof level === 'number' && Number.isInteger(level) && level >= 0 && level <= 3 ? level : null;
}
