import { EXCLUDED, OPEN, STUMP, unitCells } from './board';
import {
  applyStep, countSolutions, describeStep, findSolutions, findBlocking, findChain, findConfinement, findElimination,
  findForced, nextStep, solve, stepTier, type Step,
} from './solver';
import { parseBoard, parseState } from './testBoards';

// 8 solutions: fine for single techniques, not a real puzzle.
const BOARD = parseBoard(`
  AABBB
  AABBC
  DDDCC
  DDECC
  EEEEC
`);

// Unique, solution [1, 8, 10, 19, 22], solved with easy steps only.
const UNIQUE = parseBoard(`
  CAABB
  CBBBB
  CCCCC
  CCCDD
  CCEDD
`);

const FRESH = (): Uint8Array => new Uint8Array(25);

describe('countSolutions', () => {
  it('counts solutions up to the limit', () => {
    expect(countSolutions(UNIQUE)).toBe(1);
    expect(countSolutions(BOARD, Infinity)).toBe(8);
    expect(countSolutions(BOARD)).toBe(2);
    expect(countSolutions(parseBoard('AAAAA/BBBBB/CCCCC/DDDDD/EEEEE'.replace(/\//g, '\n')), Infinity)).toBe(14);
  });

  it('finds no solution when two regions share one row', () => {
    expect(countSolutions(parseBoard('ABCCC/CCCCC/DDDDD/DDDDD/EEEEE'.replace(/\//g, '\n')))).toBe(0);
  });
});

describe('findSolutions', () => {
  it('lists solutions in row order up to the limit', () => {
    expect(findSolutions(UNIQUE, 5)).toEqual([[1, 8, 10, 19, 22]]);
    expect(findSolutions(BOARD, 2)).toEqual([[0, 7, 14, 16, 23], [0, 8, 11, 19, 22]]);
  });
});

describe('findElimination', () => {
  it('rules out the row, column, region, and neighbors of a stump', () => {
    const state = parseState('S.... ..... ..... ..... .....');
    expect(findElimination(BOARD, state)).toEqual({
      type: 'elimination', stump: 0, eliminated: [1, 2, 3, 4, 5, 6, 10, 15, 20],
    });
  });

  it('skips squares already marked, and stumps with nothing left to rule out', () => {
    expect(findElimination(BOARD, parseState('SXX.. ..... ..... ..... .....'))?.eliminated)
      .toEqual([3, 4, 5, 6, 10, 15, 20]);
    expect(findElimination(BOARD, parseState('SXXXX XX... X.... X.... X....'))).toBeNull();
  });
});

describe('findForced', () => {
  it('places a stump on the last open square of a row', () => {
    const state = parseState('..... ..... XXXX. ..... .....');
    expect(findForced(BOARD, state)).toEqual({
      type: 'forced', unit: { kind: 'row', index: 2 }, place: 14, eliminated: [],
    });
  });

  it('places a stump in a one-square region', () => {
    expect(findForced(UNIQUE, FRESH())).toEqual({
      type: 'forced', unit: { kind: 'region', index: 4 }, place: 22, eliminated: [],
    });
  });

  it('ignores units that already hold a stump', () => {
    expect(findForced(BOARD, parseState('SXXXX ..... ..... ..... .....'))).toBeNull();
  });
});

describe('findConfinement', () => {
  it('k=1: a region inside one row rules out the rest of the row', () => {
    const state = parseState('..... ..XX. ..... ..... .....');
    expect(findConfinement(BOARD, state, 1)).toEqual({
      type: 'confinement', k: 1, axis: 'row', reverse: false, regions: [1], lines: [0], eliminated: [0, 1],
    });
  });

  it('k=1 reverse: a column inside one region rules out the rest of the region', () => {
    const state = parseState('....X ..... ..... ..... .....');
    expect(findConfinement(BOARD, state, 1)).toEqual({
      type: 'confinement', k: 1, axis: 'col', reverse: true, regions: [2], lines: [4], eliminated: [13, 18],
    });
  });

  it('k=2: two regions inside two rows rule out the rest of those rows', () => {
    expect(findConfinement(BOARD, FRESH(), 1)).toBeNull();
    expect(findConfinement(BOARD, FRESH(), 2)).toEqual({
      type: 'confinement', k: 2, axis: 'row', reverse: false, regions: [0, 1], lines: [0, 1], eliminated: [9],
    });
  });
});

describe('findBlocking', () => {
  it('rules out a square whose stump would empty another unit', () => {
    // Region A is down to squares 1 and 5. A stump at 7 rules out all of row 0.
    const state = parseState('X.... .X... ..... ..... .....');
    expect(findBlocking(BOARD, state)).toEqual({
      type: 'blocking', cell: 7, unit: { kind: 'row', index: 0 }, eliminated: [7],
    });
  });
});

describe('findChain', () => {
  it('rules out a square that leads to an empty unit after several easy steps', () => {
    const state = FRESH();
    const step = findChain(UNIQUE, state);
    if (step?.type !== 'chain') {
      throw new Error(`expected a chain, got ${step?.type}`);
    }
    expect(step.steps.length).toBeGreaterThanOrEqual(2);
    expect(step.steps.every((s) => stepTier(s) === 'easy')).toBe(true);
    expect(step.eliminated).toEqual([step.cell]);
    expect([1, 8, 10, 19, 22]).not.toContain(step.cell);

    // Replaying the chain from the assumption empties the reported unit.
    let replay: Uint8Array = state.slice();
    replay[step.cell] = STUMP;
    for (const sub of step.steps) {
      replay = applyStep(replay, sub);
    }
    expect(unitCells(UNIQUE, step.unit).every((cell) => replay[cell] === EXCLUDED)).toBe(true);
  });
});

describe('nextStep', () => {
  it('returns the simplest technique available', () => {
    // Both a forced square (easy) and two-in-two (medium) are available.
    expect(nextStep(BOARD, parseState('..... ..... XXXX. ..... .....'))?.type).toBe('forced');
    expect(nextStep(BOARD, FRESH())).toMatchObject({ type: 'confinement', k: 2 });
  });

  it('only returns steps that make progress on the given marks', () => {
    const state = parseState('..... ....X ..... ..... .....');
    const step = nextStep(BOARD, state);
    expect(step).not.toBeNull();
    expect(step?.eliminated.every((cell) => state[cell] === OPEN)).toBe(true);
    expect(step?.eliminated.length).toBeGreaterThan(0);
  });
});

describe('applyStep', () => {
  it('marks eliminations and placements without mutating the input', () => {
    const state = FRESH();
    const step: Step = { type: 'forced', unit: { kind: 'row', index: 0 }, place: 3, eliminated: [] };
    const next = applyStep(applyStep(state, step), { type: 'blocking', cell: 7, unit: step.unit, eliminated: [7, 8] });
    expect(state.every((v) => v === OPEN)).toBe(true);
    expect([next[3], next[7], next[8], next[9]]).toEqual([STUMP, EXCLUDED, EXCLUDED, OPEN]);
  });
});

describe('solve', () => {
  it('solves a unique puzzle by deduction and rates it', () => {
    const result = solve(UNIQUE);
    expect(result.solved).toBe(true);
    expect(result.tier).toBe('easy');
    expect(result.stumps).toEqual([1, 8, 10, 19, 22]);
  });

  it('starts from revealed stumps', () => {
    const result = solve(UNIQUE, [22]);
    expect(result.solved).toBe(true);
    expect(result.steps[0]).toMatchObject({ type: 'elimination', stump: 22 });
  });

  it('gets stuck rather than guessing on a board with several solutions', () => {
    expect(solve(BOARD).solved).toBe(false);
  });

  it('stops on a board with no solution', () => {
    expect(solve(parseBoard('ABCCC/CCCCC/DDDDD/DDDDD/EEEEE'.replace(/\//g, '\n'))).solved).toBe(false);
  });
});

describe('stepTier', () => {
  it('rates each technique', () => {
    const unit = { kind: 'row', index: 0 } as const;
    const confine = (k: number): Step => ({
      type: 'confinement', k, axis: 'row', reverse: false, regions: [], lines: [], eliminated: [],
    });
    expect(stepTier({ type: 'elimination', stump: 0, eliminated: [] })).toBe('easy');
    expect(stepTier({ type: 'forced', unit, place: 0, eliminated: [] })).toBe('easy');
    expect([1, 2, 3, 4, 5].map((k) => stepTier(confine(k)))).toEqual(['easy', 'medium', 'medium', 'hard', 'hard']);
    expect(stepTier({ type: 'blocking', cell: 0, unit, eliminated: [0] })).toBe('medium');
    expect(stepTier({ type: 'chain', cell: 0, unit, steps: [], eliminated: [0] })).toBe('hard');
  });
});

describe('describeStep', () => {
  it('explains each technique in words, numbering rows and columns from 1', () => {
    expect(describeStep({ type: 'forced', unit: { kind: 'row', index: 2 }, place: 14, eliminated: [] }))
      .toMatch(/row 3/i);
    expect(describeStep({
      type: 'confinement', k: 2, axis: 'row', reverse: false, regions: [0, 1], lines: [0, 1], eliminated: [9],
    })).toMatch(/rows 1 and 2/);
    expect(describeStep({ type: 'blocking', cell: 7, unit: { kind: 'col', index: 0 }, eliminated: [7] }))
      .toMatch(/column 1/);
  });
});
