import { cellAtPoint, cellsAlongSegment } from './gridMath';

describe('gridMath', () => {
  it('maps board coordinates to cell indices and returns -1 outside bounds', () => {
    expect(cellAtPoint(5, 10, 20, 500, 15, 25)).toBe(0);
    expect(cellAtPoint(5, 10, 20, 500, 509, 519)).toBe(24);
    expect(cellAtPoint(5, 10, 20, 500, 5, 25)).toBe(-1);
    expect(cellAtPoint(5, 10, 20, 500, 515, 25)).toBe(-1);
  });

  it('never skips cells during a fast horizontal, vertical, or diagonal drag stroke', () => {
    // Fast horizontal drag across all 8 columns of row 2
    const row2 = cellsAlongSegment(8, 0, 0, 800, 10, 250, 790, 250);
    expect(row2).toEqual([16, 17, 18, 19, 20, 21, 22, 23]);

    // Fast diagonal drag from top-left cell 0 to bottom-right cell 24 on a 5x5 board
    const diag = cellsAlongSegment(5, 0, 0, 500, 50, 50, 450, 450);
    expect(diag).toEqual([0, 6, 12, 18, 24]);
  });
});
