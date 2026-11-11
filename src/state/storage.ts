import { type GeneratorSettings, MAX_SIZE, MIN_SIZE, type Tier, TIERS } from '../engine';
import {
  type AppSettings, DEFAULT_SETTINGS, type SavedPuzzleState, type SizePreference, type SolveRecord,
  type TierPreference, type VarietyPreference,
} from './types';

/* ========================================================= *\
 *  Storage keys                                             *
\* ========================================================= */

const KEY_SETTINGS = 'stumped.settings.v1';
const KEY_CURRENT_PUZZLE = 'stumped.currentPuzzle.v1';
const KEY_PLAYED_CODES = 'stumped.playedCodes.v1';
const KEY_BEST_TIMES = 'stumped.bestTimes.v1';
const KEY_ACTIVE_SCREEN = 'stumped.activeScreen.v1';

/** Screen identifier persisted for crash/relaunch recovery. */
export type ActiveScreen = 'main' | 'puzzle';

/* ========================================================= *\
 *  Safe localStorage access                                 *
\* ========================================================= */

let storageErrorFlag = false;

/**
 * @returns true if localStorage failed to read or write during this session
 */
export function hasStorageError(): boolean {
  return storageErrorFlag;
}

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    storageErrorFlag = true;
    return fallback;
  }
};

const writeJson = (key: string, value: unknown): boolean => {
  try {
    if (value === null || value === undefined) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
    return true;
  } catch {
    storageErrorFlag = true;
    return false;
  }
};

/* ========================================================= *\
 *  Settings persistence                                     *
\* ========================================================= */

const isValidSize = (val: unknown): val is SizePreference => (
  val === 'random' || (typeof val === 'number' && Number.isInteger(val) && val >= MIN_SIZE && val <= MAX_SIZE)
);

const isValidTier = (val: unknown): val is TierPreference => (
  val === 'random' || (typeof val === 'string' && (TIERS as readonly string[]).includes(val))
);

const isValidVariety = (val: unknown): val is VarietyPreference => (
  val === 'random' || val === 0 || val === 1 || val === 2 || val === 3
);

/**
 * Loads player settings from localStorage, filling in defaults for any missing fields.
 * @returns validated player settings
 */
export function loadSettings(): AppSettings {
  const raw = readJson<Partial<AppSettings>>(KEY_SETTINGS, {});
  return {
    showTimer: typeof raw.showTimer === 'boolean' ? raw.showTimer : DEFAULT_SETTINGS.showTimer,
    size: isValidSize(raw.size) ? raw.size : DEFAULT_SETTINGS.size,
    tier: isValidTier(raw.tier) ? raw.tier : DEFAULT_SETTINGS.tier,
    silver: typeof raw.silver === 'boolean' ? raw.silver : DEFAULT_SETTINGS.silver,
    sizeMix: isValidVariety(raw.sizeMix) ? raw.sizeMix : DEFAULT_SETTINGS.sizeMix,
    shape: isValidVariety(raw.shape) ? raw.shape : DEFAULT_SETTINGS.shape,
    freebies: isValidVariety(raw.freebies) ? raw.freebies : DEFAULT_SETTINGS.freebies,
  };
}

/**
 * Saves player settings to localStorage.
 * @param settings settings to persist
 */
export function saveSettings(settings: AppSettings): void {
  writeJson(KEY_SETTINGS, settings);
}

/**
 * Extracts fixed generator settings from player preferences for `randomSettings()`.
 * When `silver` is false, it is left unfixed so ~1 in 5 random puzzles is silver.
 * @param settings player settings
 * @returns partial generator settings with fixed fields
 */
export function toFixedGeneratorSettings(settings: AppSettings): Partial<GeneratorSettings> {
  return {
    ...(settings.size !== 'random' ? { size: settings.size } : {}),
    ...(settings.tier !== 'random' ? { tier: settings.tier } : {}),
    ...(settings.silver ? { silver: true } : {}),
    ...(settings.sizeMix !== 'random' ? { sizeMix: settings.sizeMix } : {}),
    ...(settings.shape !== 'random' ? { shape: settings.shape } : {}),
    ...(settings.freebies !== 'random' ? { freebies: settings.freebies } : {}),
  };
}

/* ========================================================= *\
 *  Current puzzle and active screen                         *
\* ========================================================= */

/**
 * Loads the saved current puzzle (in progress or finished), or null if none exists.
 * @returns saved puzzle state or null
 */
export function loadCurrentPuzzle(): SavedPuzzleState | null {
  const saved = readJson<SavedPuzzleState | null>(KEY_CURRENT_PUZZLE, null);
  if (!saved?.puzzle?.code || !Array.isArray(saved.normalMarks)) {
    return null;
  }
  return saved;
}

/**
 * Saves the current puzzle state to localStorage.
 * @param state puzzle state to persist, or null to clear
 */
export function saveCurrentPuzzle(state: SavedPuzzleState | null): void {
  writeJson(KEY_CURRENT_PUZZLE, state);
}

/**
 * Loads the last active screen ('main' or 'puzzle').
 * @returns active screen
 */
export function loadActiveScreen(): ActiveScreen {
  const screen = readJson<string>(KEY_ACTIVE_SCREEN, 'main');
  return screen === 'puzzle' ? 'puzzle' : 'main';
}

/**
 * Saves the active screen so crash/relaunch resumes directly when playing.
 * @param screen 'main' or 'puzzle'
 */
export function saveActiveScreen(screen: ActiveScreen): void {
  writeJson(KEY_ACTIVE_SCREEN, screen);
}

/* ========================================================= *\
 *  Played puzzle codes (repeat tracking)                    *
\* ========================================================= */

/**
 * Checks whether a puzzle seed code has already been played on this device.
 * @param code canonical puzzle seed code
 * @returns true if this code has been played before
 */
export function hasPlayedCode(code: string): boolean {
  const list = readJson<string[]>(KEY_PLAYED_CODES, []);
  return Array.isArray(list) && list.includes(code);
}

/**
 * Records a puzzle seed code as having been played on this device.
 * @param code canonical puzzle seed code
 */
export function markCodePlayed(code: string): void {
  const list = readJson<string[]>(KEY_PLAYED_CODES, []);
  const cleanList = Array.isArray(list) ? list : [];
  if (!cleanList.includes(code)) {
    cleanList.push(code);
    writeJson(KEY_PLAYED_CODES, cleanList);
  }
}

/* ========================================================= *\
 *  Best times                                               *
\* ========================================================= */

/**
 * Sorts solve records according to product requirements:
 * Starred (clean) times are listed above all others, then the rest by time.
 * @param records list of solve records
 * @returns new sorted array
 */
export function sortBestTimes(records: readonly SolveRecord[]): SolveRecord[] {
  return [...records].sort((a, b) => {
    if (a.clean !== b.clean) {
      return a.clean ? -1 : 1;
    }
    if (a.timeMs !== b.timeMs) {
      return a.timeMs - b.timeMs;
    }
    return a.completedAt - b.completedAt;
  });
}

/**
 * Loads all recorded completed puzzle solves.
 * @returns all solve records
 */
export function loadAllBestTimes(): SolveRecord[] {
  const list = readJson<SolveRecord[]>(KEY_BEST_TIMES, []);
  return Array.isArray(list) ? list : [];
}

/**
 * Loads and sorts recorded solves for a specific board size and difficulty tier.
 * @param size board size (5 to 10)
 * @param tier difficulty tier
 * @returns sorted solve records for that size and tier
 */
export function getBestTimesFor(size: number, tier: Tier): SolveRecord[] {
  const all = loadAllBestTimes();
  return sortBestTimes(all.filter((record) => record.size === size && record.tier === tier));
}

/**
 * Records a completed puzzle solve in Best Times.
 * @param record completed solve record
 */
export function recordSolve(record: SolveRecord): void {
  const all = loadAllBestTimes();
  all.push(record);
  writeJson(KEY_BEST_TIMES, all);
}

/* ========================================================= *\
 *  Time formatting                                          *
\* ========================================================= */

/**
 * Formats a duration in milliseconds as `M:SS` (or `H:MM:SS` if 1 hour or more).
 * @param ms elapsed time in milliseconds
 * @returns formatted duration string
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad2 = (n: number): string => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${minutes}:${pad2(seconds)}`;
}
