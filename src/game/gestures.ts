/** Board position in cell units. */
export interface Point {
  /** Horizontal position. */
  x: number;
  /** Vertical position. */
  y: number;
}
/** Every square crossed by a line segment, even across sparse pointer events or the board edge. */
export function crossedCells(size: number, from: Point, to: Point): number[] {
  const times = [0, 1];
  for (const axis of ['x', 'y'] as const) {
    const delta = to[axis] - from[axis];
    if (delta === 0) continue;
    for (let boundary = 0; boundary <= size; boundary++) {
      const t = (boundary - from[axis]) / delta;
      if (t > 0 && t < 1) times.push(t);
    }
  }
  times.sort((a, b) => a - b);
  const samples = [...times.slice(1).map((t, i) => (t + times[i]) / 2), 0, 1];
  const cells = samples.flatMap((t) => {
    const x = Math.floor(from.x + (to.x - from.x) * t);
    const y = Math.floor(from.y + (to.y - from.y) * t);
    return x >= 0 && x < size && y >= 0 && y < size ? [y * size + x] : [];
  });
  return [...new Set(cells)];
}

