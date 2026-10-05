import { colOf, conflicts, isValidSolution, neighbors, rowOf, unitCells } from './board';
import { parseBoard } from './testBoards';

// A valid 5x5 puzzle; solution stumps at (0,0) (1,2) (2,4) (3,1) (4,3).
const BOARD = parseBoard(`
  AABBB
  AABBC
  DDDCC
  DDECC
  EEEEC
`);
const SOLUTION = [0, 7, 14, 16, 23];

describe('geometry', () => {
  it('maps cells to rows and columns', () => {
    expect(rowOf(5, 7)).toBe(1);
    expect(colOf(5, 7)).toBe(2);
  });

  it('lists the eight neighbors, clipped at edges', () => {
    expect(neighbors(5, 0).sort((a, b) => a - b)).toEqual([1, 5, 6]);
    expect(neighbors(5, 12).sort((a, b) => a - b)).toEqual([6, 7, 8, 11, 13, 16, 17, 18]);
  });

  it('lists the cells of rows, columns, and regions', () => {
    expect(unitCells(BOARD, { kind: 'row', index: 1 })).toEqual([5, 6, 7, 8, 9]);
    expect(unitCells(BOARD, { kind: 'col', index: 2 })).toEqual([2, 7, 12, 17, 22]);
    expect(unitCells(BOARD, { kind: 'region', index: 4 })).toEqual([17, 20, 21, 22, 23]);
  });
});

describe('conflicts', () => {
  it('reports nothing for a compatible square', () => {
    expect(conflicts(BOARD, 7, [0])).toEqual([]);
  });

  it('reports each broken rule against each stump', () => {
    expect(conflicts(BOARD, 2, [0])).toEqual([{ stump: 0, rule: 'row' }]);
    expect(conflicts(BOARD, 15, [0])).toEqual([{ stump: 0, rule: 'col' }]);
    expect(conflicts(BOARD, 4, [9])).toEqual([{ stump: 9, rule: 'col' }, { stump: 9, rule: 'touch' }]);
    expect(conflicts(BOARD, 3, [9])).toEqual([{ stump: 9, rule: 'touch' }]);
    expect(conflicts(BOARD, 13, [19])).toEqual([
      { stump: 19, rule: 'region' },
      { stump: 19, rule: 'touch' },
    ]);
    expect(conflicts(BOARD, 1, [0])).toEqual([
      { stump: 0, rule: 'row' },
      { stump: 0, rule: 'region' },
      { stump: 0, rule: 'touch' },
    ]);
  });

  it('ignores the square itself', () => {
    expect(conflicts(BOARD, 0, [0])).toEqual([]);
  });
});

describe('isValidSolution', () => {
  it('accepts the solution in any order', () => {
    expect(isValidSolution(BOARD, SOLUTION)).toBe(true);
    expect(isValidSolution(BOARD, [...SOLUTION].reverse())).toBe(true);
  });

  it('rejects too few stumps or a broken rule', () => {
    expect(isValidSolution(BOARD, SOLUTION.slice(1))).toBe(false);
    // one per row and column, but 0 and 6 touch
    expect(isValidSolution(BOARD, [0, 6, 14, 17, 23])).toBe(false);
    expect(isValidSolution(BOARD, [0, 0, 7, 14, 16])).toBe(false);
  });
});
