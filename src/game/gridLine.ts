/**
 * Every cell a straight stroke from `from` to `to` crosses, in order.
 * Diagonal steps include both side squares, so a fast drag cannot skip a
 * square the segment passes through. Both cells are indexed `row * size + col`.
 * @param size grid size
 * @param from starting cell
 * @param to ending cell
 * @returns the cells crossed, including both ends
 */
export function cellsBetween(size: number, from: number, to: number): number[] {
  let row = Math.floor(from / size);
  let col = from % size;
  const rowEnd = Math.floor(to / size);
  const colEnd = to % size;
  const cells = [row * size + col];
  const dRow = rowEnd - row;
  const dCol = colEnd - col;
  const stepsRow = Math.abs(dRow);
  const stepsCol = Math.abs(dCol);
  if (stepsRow === 0 && stepsCol === 0) {
    return cells;
  }
  const signRow = Math.sign(dRow);
  const signCol = Math.sign(dCol);
  let walkedRow = 0;
  let walkedCol = 0;
  const push = (nextRow: number, nextCol: number): void => {
    const cell = nextRow * size + nextCol;
    if (cells[cells.length - 1] !== cell) {
      cells.push(cell);
    }
  };
  while (walkedRow < stepsRow || walkedCol < stepsCol) {
    const rowBoundary = (1 + 2 * walkedRow) * stepsCol;
    const colBoundary = (1 + 2 * walkedCol) * stepsRow;
    if (rowBoundary === colBoundary) {
      push(row, col + signCol);
      push(row + signRow, col);
      col += signCol;
      row += signRow;
      walkedCol += 1;
      walkedRow += 1;
      push(row, col);
    } else if (colBoundary < rowBoundary) {
      col += signCol;
      walkedCol += 1;
      push(row, col);
    } else {
      row += signRow;
      walkedRow += 1;
      push(row, col);
    }
  }
  return cells;
}
