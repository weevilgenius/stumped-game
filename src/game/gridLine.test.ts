import { cellsBetween } from './gridLine';

describe('cellsBetween', () => {
  it('stays on one cell', () => {
    expect(cellsBetween(5, 7, 7)).toEqual([7]);
  });

  it('includes every cell of a horizontal stroke', () => {
    expect(cellsBetween(5, 0, 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it('includes every cell of a vertical stroke', () => {
    expect(cellsBetween(5, 1, 21)).toEqual([1, 6, 11, 16, 21]);
  });

  it('never jumps over a square, including on a diagonal', () => {
    const cells = cellsBetween(8, 0, 7 * 8 + 7);
    expect(cells[0]).toBe(0);
    expect(cells[cells.length - 1]).toBe(63);
    for (let i = 1; i < cells.length; i++) {
      const previous = cells[i - 1] ?? 0;
      const current = cells[i] ?? 0;
      const rowStep = Math.abs(Math.floor(current / 8) - Math.floor(previous / 8));
      const colStep = Math.abs((current % 8) - (previous % 8));
      expect(Math.max(rowStep, colStep)).toBe(1);
    }
    for (let i = 0; i < 8; i++) {
      expect(cells).toContain(i * 8 + i);
    }
  });
});
