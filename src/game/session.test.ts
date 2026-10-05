import { isValidSolution, type Puzzle } from '../engine';
import { mulberry32 } from '../utils/mulberry';
import {
  CELL_OPEN, CELL_RED, CELL_STUMP, CELL_X, Session,
} from './session';

/**
 * A legal 5 by 5 board used by the gesture tests.
 * Stumps, one per row: (0,3) (1,0) (2,2) (3,4) (4,1).
 */
function samplePuzzle(overrides: Partial<Puzzle> = {}): Puzzle {
  return {
    size: 5,
    regions: [
      1, 0, 0, 0, 0,
      1, 1, 2, 0, 3,
      1, 2, 2, 3, 3,
      4, 2, 2, 3, 3,
      4, 4, 4, 3, 3,
    ],
    solution: [3, 5, 12, 19, 21],
    givens: [],
    colors: [0, 1, 2, 3, 4],
    tier: 'easy',
    silver: false,
    code: 'SAMPLECODE1',
    ...overrides,
  };
}

const puzzle = samplePuzzle();

describe('Session marks', () => {
  it('starts from a legal solution and three acorns', () => {
    expect(isValidSolution(puzzle, puzzle.solution)).toBe(true);
    const session = new Session(puzzle);
    expect(session.acornsLeft).toBe(3);
    expect(session.revealedCount()).toBe(0);
    expect([...session.marks].every((mark) => mark === CELL_OPEN)).toBe(true);
  });

  it('reveals givens and counts them', () => {
    const session = new Session(samplePuzzle({ givens: [3] }));
    expect(session.marks[3]).toBe(CELL_STUMP);
    expect(session.revealedCount()).toBe(1);
  });

  it('gives a silver puzzle one acorn', () => {
    const session = new Session(samplePuzzle({ silver: true }));
    expect(session.acornsLeft).toBe(1);
  });

  it('places an X on tap and removes it on the next tap', () => {
    const session = new Session(puzzle);
    session.tap(0);
    expect(session.marks[0]).toBe(CELL_X);
    session.tap(0);
    expect(session.marks[0]).toBe(CELL_OPEN);
  });

  it('does not change a stump or a red X on tap', () => {
    const session = new Session(puzzle);
    session.doubleTap(3);
    session.doubleTap(0);
    session.tap(3);
    session.tap(0);
    expect(session.marks[3]).toBe(CELL_STUMP);
    expect(session.marks[0]).toBe(CELL_RED);
  });

  it('treats a whole drag as one undo step and never rewrites a stump', () => {
    const session = new Session(puzzle);
    session.doubleTap(3);
    session.beginStroke(0);
    session.extendStroke(0);
    session.extendStroke(1);
    session.extendStroke(3);
    session.extendStroke(4);
    session.endStroke();
    expect(session.marks[0]).toBe(CELL_X);
    expect(session.marks[1]).toBe(CELL_X);
    expect(session.marks[3]).toBe(CELL_STUMP);
    expect(session.marks[4]).toBe(CELL_X);
    session.undo();
    expect(session.marks[0]).toBe(CELL_OPEN);
    expect(session.marks[1]).toBe(CELL_OPEN);
    expect(session.marks[4]).toBe(CELL_OPEN);
    expect(session.canUndo()).toBe(false);
  });

  it('erases the X\'s a drag crosses', () => {
    const session = new Session(puzzle);
    session.tap(0);
    session.tap(1);
    session.beginStroke(0);
    session.extendStroke(0);
    session.extendStroke(1);
    session.extendStroke(2);
    session.endStroke();
    expect(session.marks[0]).toBe(CELL_OPEN);
    expect(session.marks[1]).toBe(CELL_OPEN);
    expect(session.marks[2]).toBe(CELL_OPEN);
  });

  it('does not record a stroke that changes nothing', () => {
    const session = new Session(puzzle);
    session.doubleTap(3);
    session.beginStroke(3);
    session.extendStroke(3);
    session.endStroke();
    expect(session.canUndo()).toBe(false);
  });
});

describe('Session reveals', () => {
  it('reveals a correct stump and does not mark any X for the player', () => {
    const session = new Session(puzzle);
    const result = session.doubleTap(3);
    expect(result.type).toBe('correct');
    expect(session.marks[3]).toBe(CELL_STUMP);
    expect(session.acornsLeft).toBe(3);
    expect([...session.marks].filter((mark) => mark === CELL_X)).toHaveLength(0);
    session.undo();
    expect(session.marks[3]).toBe(CELL_STUMP);
  });

  it('seals the X that the first tap of a double tap placed', () => {
    const session = new Session(puzzle);
    session.tap(3);
    session.doubleTap(3);
    session.undo();
    expect(session.marks[3]).toBe(CELL_STUMP);
  });

  it('marks a wrong reveal in red, spends an acorn, and names the conflict', () => {
    const session = new Session(puzzle);
    session.doubleTap(3);
    const result = session.doubleTap(4);
    expect(result.type).toBe('wrong');
    expect(result.lost).toBe(false);
    expect(session.marks[4]).toBe(CELL_RED);
    expect(session.acornsLeft).toBe(2);
    expect(result.conflicts.map((conflict) => conflict.rule)).toEqual(['row', 'region', 'touch']);
    expect(result.conflicts.every((conflict) => conflict.stump === 3)).toBe(true);
    session.undo();
    expect(session.marks[4]).toBe(CELL_RED);
  });

  it('has no conflict line when nothing revealed is broken', () => {
    const session = new Session(puzzle);
    const result = session.doubleTap(0);
    expect(result.conflicts).toEqual([]);
    expect(session.acornsLeft).toBe(2);
  });

  it('loses on the last acorn', () => {
    const session = new Session(samplePuzzle({ silver: true }));
    const result = session.doubleTap(0);
    expect(result.lost).toBe(true);
    expect(session.status).toBe('lost');
    expect(session.tap(1)).toEqual([]);
    expect(session.marks[1]).toBe(CELL_OPEN);
  });

  it('wins when the last stump is revealed', () => {
    const session = new Session(puzzle);
    let result = session.doubleTap(3);
    for (const cell of puzzle.solution.slice(1)) {
      result = session.doubleTap(cell);
    }
    expect(result.won).toBe(true);
    expect(result.perfectlyMarked).toBe(false);
    expect(session.status).toBe('won');
  });

  it('reports Perfectly Marked only when nothing is left open', () => {
    const session = new Session(puzzle);
    for (let cell = 0; cell < 25; cell++) {
      if (!puzzle.solution.includes(cell)) {
        session.tap(cell);
      }
    }
    let result = session.doubleTap(puzzle.solution[0] ?? 0);
    for (const cell of puzzle.solution.slice(1)) {
      result = session.doubleTap(cell);
    }
    expect(result.perfectlyMarked).toBe(true);
  });

  it('pulses a stump\'s row once when its other squares are marked', () => {
    const session = new Session(puzzle);
    session.doubleTap(3);
    session.tap(0);
    session.tap(1);
    session.tap(2);
    const pulses = session.tap(4);
    expect(pulses).toEqual([{ kind: 'row', index: 0 }]);
    session.tap(6);
    expect(session.undo()).toEqual([]);
    session.tap(4);
    const again = session.tap(4);
    expect(again).toEqual([{ kind: 'row', index: 0 }]);
  });
});

describe('Session hypothesis', () => {
  it('places a tentative stump without spending an acorn or winning', () => {
    const session = new Session(puzzle);
    session.enterHypothesis();
    session.doubleTap(0);
    expect(session.hypoStump[0]).toBe(1);
    expect(session.marks[0]).toBe(CELL_OPEN);
    expect(session.acornsLeft).toBe(3);
    expect(session.status).toBe('playing');
  });

  it('flags a tentative stump that breaks a rule', () => {
    const session = new Session(puzzle);
    session.doubleTap(3);
    session.enterHypothesis();
    session.doubleTap(4);
    session.doubleTap(11);
    expect(session.flagged()).toEqual([4]);
  });

  it('removes a tentative stump on tap and keeps its own undo stack', () => {
    const session = new Session(puzzle);
    session.tap(1);
    session.enterHypothesis();
    session.doubleTap(0);
    session.tap(0);
    expect(session.hypoStump[0]).toBe(0);
    session.undo();
    expect(session.hypoStump[0]).toBe(1);
    expect(session.marks[1]).toBe(CELL_X);
    expect(session.hypothesis).toBe(true);
  });

  it('draws hypothesis X\'s without changing normal X\'s', () => {
    const session = new Session(puzzle);
    session.tap(1);
    session.enterHypothesis();
    session.tap(1);
    session.tap(2);
    expect(session.marks[1]).toBe(CELL_X);
    expect(session.hypoX[1]).toBe(0);
    expect(session.hypoX[2]).toBe(1);
    session.beginStroke(2);
    session.extendStroke(2);
    session.extendStroke(6);
    session.endStroke();
    expect(session.hypoX[2]).toBe(0);
    expect(session.hypoX[6]).toBe(0);
  });

  it('discards the scratch layer', () => {
    const session = new Session(puzzle);
    session.enterHypothesis();
    session.tap(2);
    session.doubleTap(0);
    session.discardHypothesis();
    expect(session.hypothesis).toBe(false);
    expect(session.hypoX[2]).toBe(0);
    expect(session.hypoStump[0]).toBe(0);
    expect(session.canUndo()).toBe(false);
  });

  it('keeps hypothesis X\'s as normal X\'s and drops tentative stumps', () => {
    const session = new Session(puzzle);
    session.enterHypothesis();
    session.tap(2);
    session.doubleTap(0);
    session.keepHypothesis();
    expect(session.hypothesis).toBe(false);
    expect(session.marks[2]).toBe(CELL_X);
    expect(session.hypoStump[0]).toBe(0);
    session.undo();
    expect(session.marks[2]).toBe(CELL_X);
  });
});

describe('Session hints', () => {
  it('reveals the stump in the region with the fewest open squares', () => {
    const session = new Session(puzzle);
    const result = session.useWoodpecker();
    // Regions 1 and 4 both have four squares; the lower index wins. Its stump is (1,0).
    expect(result?.cell).toBe(5);
    expect(session.marks[5]).toBe(CELL_STUMP);
    expect(session.helped()).toBe(true);
    expect(session.useWoodpecker()).toBeNull();
    session.undo();
    expect(session.marks[5]).toBe(CELL_STUMP);
  });

  it('marks up to three squares that are not stumps', () => {
    const session = new Session(puzzle);
    const rng = mulberry32(4);
    const first = session.useSquirrel(rng);
    expect(first.cells).toHaveLength(3);
    for (const cell of first.cells) {
      expect(puzzle.solution.includes(cell)).toBe(false);
      expect(session.marks[cell]).toBe(CELL_X);
    }
    expect(session.useSquirrel(rng).cells).toEqual([]);
  });

  it('marks fewer than three when that is all that is left', () => {
    const session = new Session(puzzle);
    for (let cell = 0; cell < 25; cell++) {
      if (!puzzle.solution.includes(cell) && cell !== 0 && cell !== 1) {
        session.tap(cell);
      }
    }
    const result = session.useSquirrel(() => 0);
    expect(result.cells.slice().sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('points at a wrong X and removes it when the explanation closes', () => {
    const session = new Session(puzzle);
    session.tap(3);
    session.tap(6);
    expect(session.openOwl()).toBe(true);
    expect(session.explainPage()?.focus).toEqual([3]);
    session.closeOwl();
    expect(session.marks[3]).toBe(CELL_OPEN);
    expect(session.marks[6]).toBe(CELL_X);
    expect(session.openOwl()).toBe(false);
  });

  it('explains a forced square and reveals it on close', () => {
    const session = new Session(puzzle);
    for (const cell of [0, 1, 2, 4]) {
      session.tap(cell);
    }
    expect(session.openOwl()).toBe(true);
    const page = session.explainPage();
    expect(page?.text).toMatch(/one open square/i);
    expect(page?.focus).toEqual([3]);
    const result = session.closeOwl();
    expect(result?.type).toBe('correct');
    expect(session.marks[3]).toBe(CELL_STUMP);
    expect(session.acornsLeft).toBe(3);
  });

  it('can step through a chain explanation', () => {
    const session = new Session(puzzle);
    session.explanation = {
      page: 0,
      pages: [
        { text: 'Suppose a stump is here. First.', cells: [1], focus: [1] },
        { text: 'Then this.', cells: [2], focus: [2] },
        { text: 'So the square is ruled out.', cells: [0], focus: [0] },
      ],
      effect: { type: 'clear-x', cells: [] },
    };
    expect(session.explainIndex()).toEqual({ page: 0, total: 3 });
    session.stepExplain(-1);
    expect(session.explainIndex()?.page).toBe(0);
    session.stepExplain(1);
    session.stepExplain(1);
    expect(session.explainPage()?.text).toMatch(/ruled out/);
  });

  it('refuses hints while a hypothesis is open', () => {
    const session = new Session(puzzle);
    session.enterHypothesis();
    expect(session.hintsAvailable()).toBe(false);
    expect(session.useWoodpecker()).toBeNull();
    expect(session.openOwl()).toBe(false);
  });
});

describe('Session saving', () => {
  it('round-trips marks, the scratch layer, and undo', () => {
    const session = new Session(puzzle, { isRepeat: true });
    session.tap(6);
    session.enterHypothesis();
    session.tap(7);
    session.elapsedMs = 1200;
    const revived = Session.revive(session.toJSON());
    expect(revived).not.toBeNull();
    expect(revived?.marks[6]).toBe(CELL_X);
    expect(revived?.hypoX[7]).toBe(1);
    expect(revived?.hypothesis).toBe(true);
    expect(revived?.isRepeat).toBe(true);
    expect(revived?.elapsedMs).toBe(1200);
    revived?.undo();
    expect(revived?.hypoX[7]).toBe(0);
  });
});
