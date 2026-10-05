/* ========================================================= *\
 *  Local Storage Persistence Manager                        *
\* ========================================================= */

import type { Tier } from '../engine';
import type { BestTimeRecord, GameSettings, SavedGameState } from './types';

/** Key for user settings in localStorage. */
const SETTINGS_KEY = 'stumped_settings';
/** Key for the currently active or most recent puzzle state. */
const CURRENT_GAME_KEY = 'stumped_current_game';
/** Key for the set of all played seed codes. */
const PLAYED_CODES_KEY = 'stumped_played_codes';
/** Key for all recorded best times. */
const BEST_TIMES_KEY = 'stumped_best_times';

/** Default user settings. */
export const DEFAULT_SETTINGS: GameSettings = {
  timerVisible: true,
  size: 'random',
  difficulty: 'random',
  silverAcorn: false,
};

/**
 * Safely accesses browser localStorage.
 * @returns window.localStorage or null if not available
 */
const getStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

/**
 * Loads user settings from local storage.
 * @returns stored settings or default settings
 */
export function loadSettings(): GameSettings {
  const storage = getStorage();
  if (!storage) {
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      timerVisible: parsed.timerVisible ?? DEFAULT_SETTINGS.timerVisible,
      size: parsed.size ?? DEFAULT_SETTINGS.size,
      difficulty: parsed.difficulty ?? DEFAULT_SETTINGS.difficulty,
      silverAcorn: parsed.silverAcorn ?? DEFAULT_SETTINGS.silverAcorn,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Saves user settings to local storage.
 * @param settings settings to save
 */
export function saveSettings(settings: GameSettings): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or unavailable
  }
}

/**
 * Loads the current puzzle in progress or recently finished puzzle.
 * @returns saved game state or null if none
 */
export function loadSavedGame(): SavedGameState | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(CURRENT_GAME_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SavedGameState;
  } catch {
    return null;
  }
}

/**
 * Saves active puzzle state to local storage.
 * @param state state to persist
 */
export function saveSavedGame(state: SavedGameState): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(CURRENT_GAME_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable
  }
}

/**
 * Clears the currently saved game from local storage.
 */
export function clearSavedGame(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(CURRENT_GAME_KEY);
  } catch {
    // Ignore error
  }
}

/**
 * Loads the list of seed codes that have been played on this device.
 * @returns array of played seed codes
 */
export function loadPlayedCodes(): string[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(PLAYED_CODES_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/**
 * Checks whether a seed code has already been played on this device.
 * @param code seed code to check
 * @returns true if played before
 */
export function isCodePlayed(code: string): boolean {
  const list = loadPlayedCodes();
  return list.includes(code);
}

/**
 * Records a seed code as played on this device.
 * @param code seed code to mark
 */
export function markCodePlayed(code: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    const list = loadPlayedCodes();
    if (!list.includes(code)) {
      list.push(code);
      storage.setItem(PLAYED_CODES_KEY, JSON.stringify(list));
    }
  } catch {
    // Ignore error
  }
}

/**
 * Loads all best time records from local storage.
 * @returns list of all saved records
 */
export function loadBestTimes(): BestTimeRecord[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(BEST_TIMES_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as BestTimeRecord[];
  } catch {
    return [];
  }
}

/**
 * Saves a completed solve to best times.
 * Starred (clean) times appear first, then sorted by completion time.
 * @param record record to save
 */
export function saveBestTime(record: BestTimeRecord): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    const records = loadBestTimes();
    records.push(record);
    storage.setItem(BEST_TIMES_KEY, JSON.stringify(records));
  } catch {
    // Storage full or unavailable
  }
}

/**
 * Retrieves best times for a specific size and difficulty.
 * Starred (clean) times are listed above all others, then the rest by time.
 * @param size grid size (5 to 10)
 * @param difficulty difficulty tier
 * @returns filtered and sorted records
 */
export function getBestTimesFor(size: number, difficulty: Tier): BestTimeRecord[] {
  const all = loadBestTimes();
  const matching = all.filter((r) => r.size === size && r.difficulty === difficulty);

  matching.sort((a, b) => {
    if (a.clean !== b.clean) {
      return a.clean ? -1 : 1;
    }
    return a.timeMs - b.timeMs;
  });

  return matching;
}
