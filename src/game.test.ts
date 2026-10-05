import type { Puzzle } from './engine';
import { parseBoard } from './engine/testBoards';
import {
  applyExplanation, beginStroke, bestTimes, canHint, completedUnits, doubleTap, enterHypothesis, explain,
  explainPages, extendStroke, flaggedStumps, formatTime, type Game, HYPO_STUMP, isClean, isPerfectlyMarked, leaveHypothesis,
  MARK_NONE, MARK_RED, MARK_STUMP, MARK_X, newGame, type Result, resultOf, squirrel, stumps, undo, woodpecker,
} from './game';

// Unique, solved with easy steps only. Region E is the single square 22.
const SOLUTION = [1, 8, 10, 19, 22];
const PUZZLE: Puzzle = {
  ...parseBoard(`
    CAABB
    CBBBB
    CCCCC
    CCCDD
    CCEDD
  `),
  solution: SOLUTION, givens: [], colors: [0, 1, 2, 3, 4], tier: 'easy', silver: false, code: 'TEST',
};

const fresh = (overrides: Partial<Puzzle> = {}): Game => newGame({ ...PUZZLE, ...overrides }, false);

/** A tap: press and release on one square. */
const tap = (game: Game, cell: number): boolean => beginStroke(game, cell) !== null;

/** A double tap, the way the board delivers it: a single tap, then the second tap. */
const tapTwice = (game: Game, cell: number): ReturnType<typeof doubleTap> => doubleTap(game, cell, tap(game, cell));

describe('newGame', () => {
  it('starts with three acorns, or one in silver acorn mode', () => {
    expect(fresh().acorns).toBe(3);
    expect(fresh({ silver: true }).acorns).toBe(1);
  });

  it('reveals the givens', () => {
    expect(stumps(fresh({ givens: [8] }))).toEqual([8]);
  });
});

describe('marking', () => {
  it('toggles an X with a tap', () => {
    const game = fresh();
    expect(beginStroke(game, 0)).toBe('place');
    expect(game.marks[0]).toBe(MARK_X);
    expect(beginStroke(game, 0)).toBe('erase');
    expect(game.marks[0]).toBe(MARK_NONE);
  });

  it('places X on every unmarked square a drag crosses, as one undo step', () => {
    const game = fresh();
    tap(game, 5);
    const mode = beginStroke(game, 0);
    expect(extendStroke(game, 5, mode)).toBe(false);
    expect(extendStroke(game, 10, mode)).toBe(true);
    expect([0, 5, 10].map((cell) => game.marks[cell])).toEqual([MARK_X, MARK_X, MARK_X]);
    expect(game.undo).toHaveLength(2);

    undo(game);
    expect([0, 5, 10].map((cell) => game.marks[cell])).toEqual([MARK_NONE, MARK_X, MARK_NONE]);
  });

  it('erases every X a drag crosses when it starts on an X', () => {
    const game = fresh();
    tap(game, 0);
    tap(game, 10);
    const mode = beginStroke(game, 0);
    extendStroke(game, 5, mode);
    extendStroke(game, 10, mode);
    expect([0, 5, 10].map((cell) => game.marks[cell])).toEqual([MARK_NONE, MARK_NONE, MARK_NONE]);
  });

  it('never changes revealed stumps or red X\'s', () => {
    const game = fresh({ givens: [8] });
    tapTwice(game, 0);
    expect(beginStroke(game, 8)).toBeNull();
    expect(beginStroke(game, 0)).toBeNull();
    const mode = beginStroke(game, 3);
    expect(extendStroke(game, 8, mode)).toBe(false);
    expect(extendStroke(game, 0, mode)).toBe(false);
    expect([game.marks[8], game.marks[0]]).toEqual([MARK_STUMP, MARK_RED]);
  });

  it('reports when there is nothing to undo', () => {
    expect(undo(fresh())).toBe(false);
  });
});

describe('reveals', () => {
  it('reveals a stump on a double tap, with or without an X', () => {
    const game = fresh();
    expect(tapTwice(game, 1)).toEqual({ correct: true });
    tap(game, 8);
    expect(tapTwice(game, 8)).toEqual({ correct: true });
    expect(stumps(game)).toEqual([1, 8]);
    expect(game.acorns).toBe(3);
  });

  it('leaves a red X and takes an acorn on a wrong reveal', () => {
    const game = fresh();
    expect(tapTwice(game, 0)).toEqual({ correct: false, conflict: undefined });
    expect(game.marks[0]).toBe(MARK_RED);
    expect([game.acorns, game.acornsLost]).toEqual([2, 1]);
    expect(tapTwice(game, 0)).toBeNull();
    expect(game.acorns).toBe(2);
  });

  it('names the revealed stump a wrong reveal conflicts with', () => {
    const game = fresh();
    tapTwice(game, 1);
    expect(tapTwice(game, 4)?.conflict).toEqual({ stump: 1, rule: 'row' });
    expect(tapTwice(game, 5)?.conflict).toEqual({ stump: 1, rule: 'touch' });
  });

  it('is not undone', () => {
    const game = fresh();
    tap(game, 1);
    tap(game, 0);
    tapTwice(game, 1);
    expect(game.undo).toHaveLength(1);
    undo(game);
    expect(undo(game)).toBe(false);
    expect([game.marks[0], game.marks[1]]).toEqual([MARK_NONE, MARK_STUMP]);
  });

  it('wins when the last stump is revealed', () => {
    const game = fresh();
    SOLUTION.forEach((cell) => tapTwice(game, cell));
    expect(game.status).toBe('won');
    expect(tap(game, 0)).toBe(false);
  });

  it('loses when the last acorn is gone', () => {
    const game = fresh();
    [0, 2, 3].forEach((cell) => tapTwice(game, cell));
    expect(game.status).toBe('lost');
    expect(tapTwice(game, 1)).toBeNull();
    expect(fresh({ silver: true }).acorns).toBe(1);
  });
});

describe('hypothesis mode', () => {
  it('draws hypothesis X\'s without touching normal marks', () => {
    const game = fresh();
    tap(game, 0);
    enterHypothesis(game);
    const mode = beginStroke(game, 5);
    expect(extendStroke(game, 0, mode)).toBe(false);
    extendStroke(game, 10, mode);
    expect(game.hypo?.filter((mark) => mark === MARK_X)).toHaveLength(2);
    expect(beginStroke(game, 0)).toBeNull();
    expect(game.marks.filter((mark) => mark !== MARK_NONE)).toHaveLength(1);
  });

  it('places a tentative stump on a double tap, unchecked and free', () => {
    const game = fresh();
    enterHypothesis(game);
    expect(tapTwice(game, 0)).toBeNull();
    expect(game.hypo?.[0]).toBe(HYPO_STUMP);
    expect(game.acorns).toBe(3);
    expect(game.hypoUndo).toHaveLength(1);
  });

  it('removes a tentative stump on a tap or a double tap', () => {
    const game = fresh();
    enterHypothesis(game);
    tapTwice(game, 0);
    expect(beginStroke(game, 0)).toBe('lift');
    expect(game.hypo?.[0]).toBe(MARK_NONE);
    tapTwice(game, 0);
    tapTwice(game, 0);
    expect(game.hypo?.[0]).toBe(MARK_NONE);
  });

  it('flags tentative stumps that break a rule', () => {
    const game = fresh({ givens: [1] });
    enterHypothesis(game);
    tapTwice(game, 13);
    expect(flaggedStumps(game)).toEqual([]);
    tapTwice(game, 4);
    expect(flaggedStumps(game)).toEqual([4]);
    tapTwice(game, 19);
    expect(flaggedStumps(game)).toEqual([4, 13, 19]);
  });

  it('has its own undo stack', () => {
    const game = fresh();
    tap(game, 0);
    enterHypothesis(game);
    tap(game, 5);
    tapTwice(game, 10);
    expect(undo(game)).toBe(true);
    expect(undo(game)).toBe(true);
    expect(undo(game)).toBe(false);
    expect(game.hypo?.every((mark) => mark === MARK_NONE)).toBe(true);
    expect(game.marks[0]).toBe(MARK_X);
  });

  it('discards every hypothesis mark', () => {
    const game = fresh();
    enterHypothesis(game);
    tap(game, 5);
    tapTwice(game, 10);
    leaveHypothesis(game, false);
    expect(game.hypo).toBeNull();
    expect(game.marks.every((mark) => mark === MARK_NONE)).toBe(true);
  });

  it('keeps hypothesis X\'s as normal X\'s, drops tentative stumps, and cannot be undone', () => {
    const game = fresh();
    enterHypothesis(game);
    tap(game, 5);
    tapTwice(game, 10);
    leaveHypothesis(game, true);
    expect([game.marks[5], game.marks[10]]).toEqual([MARK_X, MARK_NONE]);
    expect(undo(game)).toBe(false);
    expect(stumps(game)).toEqual([]);
  });
});

describe('hints', () => {
  it('allows each hint once, and none in hypothesis mode', () => {
    const game = fresh();
    expect(canHint(game, 'squirrel')).toBe(true);
    squirrel(game);
    expect(canHint(game, 'squirrel')).toBe(false);
    enterHypothesis(game);
    expect(canHint(game, 'owl')).toBe(false);
  });

  it('woodpecker reveals the stump in the region with the fewest unmarked squares', () => {
    const game = fresh();
    expect(woodpecker(game)).toBe(22);
    expect(game.marks[22]).toBe(MARK_STUMP);

    const marked = fresh({ givens: [22] });
    [18, 19, 23].forEach((cell) => tap(marked, cell));
    expect(woodpecker(marked)).toBe(19);
    expect(marked.hints).toEqual(['woodpecker']);
  });

  it('squirrel marks three unmarked squares that hold no stump, permanently', () => {
    const game = fresh();
    const picked = squirrel(game, () => 0);
    expect(picked).toEqual([0, 2, 3]);
    expect(picked.every((cell) => game.marks[cell] === MARK_X)).toBe(true);
    expect(undo(game)).toBe(false);
  });

  it('squirrel marks what is left when fewer than three squares remain', () => {
    const game = fresh();
    game.marks.forEach((_, cell) => {
      if (cell > 2 && !SOLUTION.includes(cell)) {
        tap(game, cell);
      }
    });
    expect(squirrel(game).sort()).toEqual([0, 2]);
  });

  it('owl points out an X on a stump\'s square first, and removes it when closed', () => {
    const game = fresh();
    tap(game, 8);
    const explanation = explain(game);
    expect(explanation).toEqual({ type: 'wrongX', cell: 8 });
    expect(game.explaining).toBe(explanation);
    applyExplanation(game);
    expect([game.marks[8], game.explaining]).toEqual([MARK_NONE, null]);
    expect(game.hints).toEqual(['owl']);
    expect(undo(game)).toBe(false);
  });

  it('owl explains the simplest deduction and makes its mark when closed', () => {
    const game = fresh();
    const forced = explain(game);
    expect(forced).toMatchObject({ type: 'step', step: { type: 'forced', place: 22 } });
    applyExplanation(game);
    expect(stumps(game)).toEqual([22]);

    game.hints = [];
    const elimination = explain(game);
    expect(elimination).toMatchObject({ type: 'step', step: { type: 'elimination', stump: 22 } });
    applyExplanation(game);
    expect([20, 21, 23, 24, 2, 7, 12, 17, 16, 18].every((cell) => game.marks[cell] === MARK_X)).toBe(true);
    expect(SOLUTION.some((cell) => game.marks[cell] === MARK_X)).toBe(false);
  });
});

describe('feedback', () => {
  it('reports a stump\'s row, column, or region once every other square is marked', () => {
    const game = fresh({ givens: [22] });
    expect([...completedUnits(game).keys()]).toEqual([]);
    [20, 21, 23].forEach((cell) => tap(game, cell));
    expect([...completedUnits(game).keys()]).toEqual([]);
    tap(game, 24);
    expect(completedUnits(game)).toEqual(new Map([['row4', [20, 21, 23, 24]]]));
  });

  it('knows when no square is left unmarked', () => {
    const game = fresh();
    SOLUTION.slice(1).forEach((cell) => tapTwice(game, cell));
    game.marks.forEach((mark, cell) => {
      if (mark === MARK_NONE && cell !== 1) {
        tap(game, cell);
      }
    });
    expect(isPerfectlyMarked(game)).toBe(false);
    tapTwice(game, 1);
    expect(game.status).toBe('won');
    expect(isPerfectlyMarked(game)).toBe(true);
  });
});

describe('results', () => {
  const result = (overrides: Partial<Result>): Result => ({
    code: 'A', size: 5, tier: 'easy', time: 60_000, hints: [], acornsLost: 0, silver: false, repeat: false, date: 0,
    ...overrides,
  });

  it('records what qualified the solve', () => {
    const game = fresh({ silver: true });
    squirrel(game);
    game.elapsed = 83_000;
    expect(resultOf(game, 5)).toEqual(result({
      code: 'TEST', time: 83_000, hints: ['squirrel'], silver: true, date: 5,
    }));
  });

  it('calls a solve clean only with no hints, no acorns lost, and a first play', () => {
    expect(isClean(result({ silver: true }))).toBe(true);
    expect(isClean(result({ hints: ['owl'] }))).toBe(false);
    expect(isClean(result({ acornsLost: 1 }))).toBe(false);
    expect(isClean(result({ repeat: true }))).toBe(false);
  });

  it('lists best times per size and difficulty, clean solves first, then by time', () => {
    const results = [
      result({ code: 'slow clean', time: 90_000 }),
      result({ code: 'fast helped', time: 10_000, hints: ['owl'] }),
      result({ code: 'fast clean', time: 30_000 }),
      result({ code: 'other size', size: 6 }),
      result({ code: 'other tier', tier: 'hard' }),
      result({ code: 'slow repeat', time: 50_000, repeat: true }),
    ];
    expect(bestTimes(results, 5, 'easy').map((r) => r.code))
      .toEqual(['fast clean', 'slow clean', 'fast helped', 'slow repeat']);
  });

  it('formats times as minutes and seconds', () => {
    expect([0, 5_999, 65_000, 3_600_000].map(formatTime)).toEqual(['0:00', '0:05', '1:05', '60:00']);
  });
});

describe('saving', () => {
  it('survives a JSON round trip mid-game', () => {
    const game = fresh();
    tap(game, 0);
    tapTwice(game, 1);
    explain(game);
    enterHypothesis(game);
    tapTwice(game, 13);
    const restored = JSON.parse(JSON.stringify(game)) as Game;
    expect(restored).toEqual(game);
    expect(restored.explaining).not.toBeNull();
    expect(undo(restored)).toBe(true);
    leaveHypothesis(restored, false);
    expect(undo(restored)).toBe(true);
    expect(restored.marks[0]).toBe(MARK_NONE);
  });
});

describe('explainPages', () => {
  it('shows a wrong X on one page', () => {
    const pages = explainPages(fresh(), { type: 'wrongX', cell: 8 });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ lit: [8], marked: [8] });
  });

  it('shows where a forced stump goes', () => {
    const game = fresh();
    const pages = explainPages(game, explain(game)!);
    expect(pages).toEqual([expect.objectContaining({ lit: [22], marked: [22], stumps: [22], xs: [] })]);
  });

  it('steps through a chain, carrying forward what the assumed stump leads to', () => {
    // A made-up chain: the pages follow whatever steps the solver hands over.
    const game = fresh();
    const elimination = { type: 'elimination', stump: 0, eliminated: [1, 5, 6] } as const;
    const forced = { type: 'forced', unit: { kind: 'region', index: 0 }, place: 2, eliminated: [] } as const;
    const pages = explainPages(game, {
      type: 'step',
      step: { type: 'chain', cell: 0, unit: { kind: 'row', index: 4 }, steps: [elimination, forced], eliminated: [0] },
    });
    expect(pages).toHaveLength(3);
    expect(pages[0]).toMatchObject({ marked: [0], stumps: [0], xs: [20, 21, 22, 23, 24] });
    expect(pages[1]).toMatchObject({ marked: [0], stumps: [0], xs: [1, 5, 6] });
    expect(pages[2]).toMatchObject({ marked: [2], stumps: [0, 2], xs: [1, 5, 6] });
    expect(pages[2].text).toMatch(/Now row 5 has no open square left\.$/);
    expect(pages[2].lit).toEqual(expect.arrayContaining([20, 21, 22, 23, 24]));
  });
});
