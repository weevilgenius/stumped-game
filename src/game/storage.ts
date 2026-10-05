import type { TimeRecord } from './records';
import type { SavedSession } from './session';
import { type Settings, sanitizeSettings } from './settings';

/** localStorage key for the whole save. */
export const SAVE_KEY = 'stumped-save-v1';

/** Everything this device remembers. */
export interface SaveData {
  /** Schema version. */
  readonly version: 1;
  /** Preferences. */
  readonly settings: Settings;
  /** The current puzzle, in progress or finished, if there is one. */
  readonly session: SavedSession | null;
  /** Every recorded win. */
  readonly records: readonly TimeRecord[];
  /** Seed codes that have been started, so a later play is a repeat. */
  readonly played: readonly string[];
}

/**
 * @param storage the backing store
 * @returns the save, or null when there is nothing usable
 */
export function readSave(storage: Storage): SaveData | null {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const data = parsed as Partial<SaveData>;
    if (data.version !== 1) {
      return null;
    }
    return {
      version: 1,
      settings: sanitizeSettings(data.settings),
      session: data.session ?? null,
      records: Array.isArray(data.records) ? data.records : [],
      played: Array.isArray(data.played) ? data.played.filter((code) => typeof code === 'string') : [],
    };
  } catch {
    return null;
  }
}

/**
 * @param storage the backing store
 * @param data the save to write
 */
export function writeSave(storage: Storage, data: SaveData): void {
  storage.setItem(SAVE_KEY, JSON.stringify(data));
}
