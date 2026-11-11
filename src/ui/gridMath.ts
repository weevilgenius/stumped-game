/**
 * Converts a canvas coordinate `(x, y)` into a board cell index `row * size + col`,
 * or returns `-1` if the point lies outside the board.
 * @param size grid size (5 to 10)
 * @param boardX top-left X of the board in canvas coordinates
 * @param boardY top-left Y of the board in canvas coordinates
 * @param boardPx width and height of the square board in pixels
 * @param x pointer X coordinate
 * @param y pointer Y coordinate
 * @returns cell index (0 to size*size - 1), or -1 if outside the board
 */
export function cellAtPoint(
  size: number,
  boardX: number,
  boardY: number,
  boardPx: number,
  x: number,
  y: number,
): number {
  if (boardPx <= 0 || x < boardX || y < boardY || x >= boardX + boardPx || y >= boardY + boardPx) {
    return -1;
  }
  const cellPx = boardPx / size;
  const col = Math.min(size - 1, Math.max(0, Math.floor((x - boardX) / cellPx)));
  const row = Math.min(size - 1, Math.max(0, Math.floor((y - boardY) / cellPx)));
  return row * size + col;
}

/**
 * Returns every board cell crossed along the straight line segment from `(x0, y0)`
 * to `(x1, y1)` in traversal order, so fast drag gestures never skip squares.
 * @param size grid size (5 to 10)
 * @param boardX top-left X of the board in canvas coordinates
 * @param boardY top-left Y of the board in canvas coordinates
 * @param boardPx width and height of the square board in pixels
 * @param x0 start X coordinate
 * @param y0 start Y coordinate
 * @param x1 end X coordinate
 * @param y1 end Y coordinate
 * @returns ordered list of distinct cell indexes crossed along the segment
 */
export function cellsAlongSegment(
  size: number,
  boardX: number,
  boardY: number,
  boardPx: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number[] {
  if (boardPx <= 0) {
    return [];
  }
  const cellPx = boardPx / size;
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, cellPx * 0.15)));
  const cells: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const cell = cellAtPoint(size, boardX, boardY, boardPx, x, y);
    if (cell >= 0 && cells[cells.length - 1] !== cell) {
      cells.push(cell);
    }
  }
  return cells;
}
