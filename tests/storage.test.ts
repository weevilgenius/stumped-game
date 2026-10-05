/* ========================================================= *\
 *  Storage Unit Tests                                        *
\* ========================================================= */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSavedGame, getBestTimesFor, isCodePlayed, loadBestTimes,
  loadPlayedCodes, loadSavedGame, loadSettings, markCodePlayed,
  saveBestTime, saveSavedGame, saveSettings,
} from '../src/state/storage';
import type { BestTimeRecord, GameSettings, SavedGameState } from '../src/state/types';

describe('Storage Manager', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads and saves settings', () => {
    const initial = loadSettings();
    expect(initial.timerVisible).toBe(true);

    const custom: GameSettings = {
      timerVisible: false,
      size: 7,
      difficulty: 'hard',
      silverAcorn: true,
    };
    saveSettings(custom);

    const reloaded = loadSettings();
    expect(reloaded).toEqual(custom);
  });

  it('records and checks played seed codes', () => {
    expect(loadPlayedCodes()).toEqual([]);
    expect(isCodePlayed('CODE1')).toBe(false);

    markCodePlayed('CODE1');
    expect(isCodePlayed('CODE1')).toBe(true);
    expect(loadPlayedCodes()).toContain('CODE1');

    // Duplicate marks should not duplicate entries
    markCodePlayed('CODE1');
    expect(loadPlayedCodes().length).toBe(1);
  });

  it('saves and clears saved game', () => {
    expect(loadSavedGame()).toBeNull();

    const fakeGame: SavedGameState = {
      puzzle: {
        size: 5,
        regions: [],
        solution: [],
        givens: [],
        colors: [],
        tier: 'easy',
        silver: false,
        code: 'TESTCODE',
      },
      normalMarks: [0, 1, 2],
      hypoMarks: [0, 0, 0],
      acorns: 3,
      maxAcorns: 3,
      hintsUsed: { woodpecker: false, owl: false, squirrel: false },
      elapsedTimeMs: 12000,
      status: 'playing',
      hypothesisMode: false,
      isRepeat: false,
      undoStack: [],
      hypoUndoStack: [],
    };

    saveSavedGame(fakeGame);
    expect(loadSavedGame()?.elapsedTimeMs).toBe(12000);

    clearSavedGame();
    expect(loadSavedGame()).toBeNull();
  });

  it('records best times and sorts clean (starred) times above all others', () => {
    const rec1: BestTimeRecord = {
      id: '1',
      size: 6,
      difficulty: 'medium',
      timeMs: 50000,
      clean: false, // 50s, not clean
      hintsUsed: ['woodpecker'],
      acornsLost: 0,
      silver: false,
      repeat: false,
      date: '2026-10-05',
      code: 'CODE_A',
    };

    const rec2: BestTimeRecord = {
      id: '2',
      size: 6,
      difficulty: 'medium',
      timeMs: 80000,
      clean: true, // 80s, clean (starred)
      hintsUsed: [],
      acornsLost: 0,
      silver: false,
      repeat: false,
      date: '2026-10-05',
      code: 'CODE_B',
    };

    const rec3: BestTimeRecord = {
      id: '3',
      size: 6,
      difficulty: 'medium',
      timeMs: 30000,
      clean: false, // 30s, not clean
      hintsUsed: ['owl'],
      acornsLost: 1,
      silver: false,
      repeat: false,
      date: '2026-10-05',
      code: 'CODE_C',
    };

    saveBestTime(rec1);
    saveBestTime(rec2);
    saveBestTime(rec3);

    expect(loadBestTimes().length).toBe(3);

    const sorted = getBestTimesFor(6, 'medium');
    expect(sorted.length).toBe(3);
    // rec2 is clean, so it must be first, despite having higher time!
    expect(sorted[0].id).toBe('2');
    // Non-clean ones sorted by time ascending: 30s then 50s
    expect(sorted[1].id).toBe('3');
    expect(sorted[2].id).toBe('1');
  });
});
