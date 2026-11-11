import {
  formatDuration, getBestTimesFor, hasPlayedCode, loadActiveScreen, loadAllBestTimes, loadCurrentPuzzle, loadSettings,
  markCodePlayed, recordSolve, saveActiveScreen, saveCurrentPuzzle, saveSettings, sortBestTimes,
  toFixedGeneratorSettings,
} from './storage';
import { DEFAULT_SETTINGS, type SolveRecord } from './types';

describe('storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('saves and loads settings with validation', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    const custom = {
      showTimer: false,
      size: 8,
      tier: 'hard' as const,
      silver: true,
      sizeMix: 2 as const,
      shape: 3 as const,
      freebies: 0 as const,
    };
    saveSettings(custom);
    expect(loadSettings()).toEqual(custom);
    expect(toFixedGeneratorSettings(custom)).toEqual({
      size: 8,
      tier: 'hard',
      silver: true,
      sizeMix: 2,
      shape: 3,
      freebies: 0,
    });
  });

  it('tracks played codes and active screen', () => {
    expect(hasPlayedCode('1D9R7BF6HAE')).toBe(false);
    markCodePlayed('1D9R7BF6HAE');
    expect(hasPlayedCode('1D9R7BF6HAE')).toBe(true);

    expect(loadActiveScreen()).toBe('main');
    saveActiveScreen('puzzle');
    expect(loadActiveScreen()).toBe('puzzle');
  });

  it('sorts best times with clean (starred) solves above all others, then by time', () => {
    const records: SolveRecord[] = [
      {
        code: 'A',
        size: 7,
        tier: 'medium',
        timeMs: 30_000, // 0:30 but used a hint -> not clean
        hintsUsed: ['eliminate'],
        acornsLost: 0,
        silver: false,
        repeat: false,
        clean: false,
        completedAt: 100,
      },
      {
        code: 'B',
        size: 7,
        tier: 'medium',
        timeMs: 90_000, // 1:30 clean
        hintsUsed: [],
        acornsLost: 0,
        silver: false,
        repeat: false,
        clean: true,
        completedAt: 200,
      },
      {
        code: 'C',
        size: 7,
        tier: 'medium',
        timeMs: 60_000, // 1:00 clean
        hintsUsed: [],
        acornsLost: 0,
        silver: true,
        repeat: false,
        clean: true,
        completedAt: 300,
      },
    ];

    for (const r of records) {
      recordSolve(r);
    }

    expect(loadAllBestTimes()).toHaveLength(3);
    const sorted = getBestTimesFor(7, 'medium');
    expect(sorted.map((r) => r.code)).toEqual(['C', 'B', 'A']);
    expect(sortBestTimes(records).map((r) => r.code)).toEqual(['C', 'B', 'A']);
  });

  it('formats durations as M:SS or H:MM:SS', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59_900)).toBe('0:59');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_661_000)).toBe('1:01:01');
  });

  it('returns null when no current puzzle is saved', () => {
    expect(loadCurrentPuzzle()).toBeNull();
    saveCurrentPuzzle(null);
    expect(loadCurrentPuzzle()).toBeNull();
  });
});
