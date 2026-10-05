import type { Puzzle } from '../engine';
import { bestTimes, formatTime, makeRecord } from './records';

const puzzle = {
  size: 6,
  tier: 'medium',
  silver: false,
  code: 'CODE',
} as Puzzle;

describe('records', () => {
  it('stars a first play with no hints and no lost acorns', () => {
    const record = makeRecord({
      puzzle, elapsedMs: 12_000, hints: { woodpecker: false, owl: false, squirrel: false }, acornsLeft: 3, isRepeat: false,
    }, 1);
    expect(record.clean).toBe(true);
    expect(record.acornsLost).toBe(0);
  });

  it('does not star a repeat, a hint, or a lost acorn', () => {
    const hinted = makeRecord({
      puzzle, elapsedMs: 1, hints: { woodpecker: true, owl: false, squirrel: false }, acornsLeft: 3, isRepeat: false,
    }, 1);
    const repeat = makeRecord({
      puzzle, elapsedMs: 1, hints: { woodpecker: false, owl: false, squirrel: false }, acornsLeft: 3, isRepeat: true,
    }, 1);
    const missed = makeRecord({
      puzzle, elapsedMs: 1, hints: { woodpecker: false, owl: false, squirrel: false }, acornsLeft: 2, isRepeat: false,
    }, 1);
    expect(hinted.clean).toBe(false);
    expect(hinted.hints).toEqual(['woodpecker']);
    expect(repeat.clean).toBe(false);
    expect(repeat.repeat).toBe(true);
    expect(missed.acornsLost).toBe(1);
    expect(missed.clean).toBe(false);
  });

  it('counts a silver acorn from one', () => {
    const record = makeRecord({
      puzzle: { ...puzzle, silver: true },
      elapsedMs: 1,
      hints: { woodpecker: false, owl: false, squirrel: false },
      acornsLeft: 1,
      isRepeat: false,
    }, 1);
    expect(record.acornsLost).toBe(0);
    expect(record.clean).toBe(true);
  });

  it('lists clean times above the others, then fastest first', () => {
    const records = [
      makeRecord({ puzzle, elapsedMs: 5_000, hints: { woodpecker: false, owl: false, squirrel: false }, acornsLeft: 3, isRepeat: true }, 1),
      makeRecord({ puzzle, elapsedMs: 9_000, hints: { woodpecker: false, owl: false, squirrel: false }, acornsLeft: 3, isRepeat: false }, 2),
      makeRecord({ puzzle, elapsedMs: 4_000, hints: { woodpecker: false, owl: false, squirrel: false }, acornsLeft: 2, isRepeat: false }, 3),
      makeRecord({ puzzle: { ...puzzle, size: 5 }, elapsedMs: 1, hints: { woodpecker: false, owl: false, squirrel: false }, acornsLeft: 3, isRepeat: false }, 4),
    ];
    const listed = bestTimes(records, 6, 'medium');
    expect(listed.map((record) => record.elapsedMs)).toEqual([9_000, 4_000, 5_000]);
    expect(listed[0]?.clean).toBe(true);
  });

  it('formats the clock', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65_000)).toBe('1:05');
    expect(formatTime(3_661_000)).toBe('1:01:01');
  });
});
