import type Phaser from 'phaser';
import type { Puzzle } from '../engine';
import { CELL_RED, CELL_STUMP, CELL_X } from '../game/session';
import { CHROME, REGION_COLORS } from '../game/palette';

/** Where the board sits, and how big the square is. */
export interface BoardFrame {
  /** Left edge. */
  x: number;
  /** Top edge. */
  y: number;
  /** Side length. */
  size: number;
}

/** Everything `paintBoard` needs. Arrays are cell-indexed. */
export interface BoardPaint {
  /** The puzzle. */
  puzzle: Puzzle;
  /** Permanent marks. */
  marks: ArrayLike<number>;
  /** Board rectangle. */
  frame: BoardFrame;
  /** Hypothesis X's, 0 or 1. */
  hypoX?: ArrayLike<number>;
  /** Tentative stumps, 0 or 1. */
  hypoStump?: ArrayLike<number>;
  /** Tentative stumps that break a rule. */
  flagged?: readonly number[];
  /** Squares the owl is talking about. */
  highlight?: readonly number[];
  /** Squares the owl will mark. */
  focus?: readonly number[];
  /** Draw a stand-in disk where a real stump icon will not be added. */
  stumpDisks?: boolean;
}

/** A cell rectangle. Same-region neighbors share an edge; a gap opens on a region change. */
export interface CellBox {
  /** Left. */
  x: number;
  /** Top. */
  y: number;
  /** Width. */
  w: number;
  /** Height. */
  h: number;
}

/**
 * @param puzzle the puzzle
 * @param frame the board rectangle
 * @param cell cell index
 * @returns the cell's box
 */
export function cellBox(puzzle: Puzzle, frame: BoardFrame, cell: number): CellBox {
  const { size, regions } = puzzle;
  const pitch = frame.size / size;
  const gap = Math.max(2, pitch * 0.05);
  const row = Math.floor(cell / size);
  const col = cell % size;
  const region = regions[cell];
  let x = frame.x + col * pitch;
  let y = frame.y + row * pitch;
  let right = x + pitch;
  let bottom = y + pitch;
  const differs = (nextRow: number, nextCol: number): boolean => {
    if (nextRow < 0 || nextCol < 0 || nextRow >= size || nextCol >= size) {
      return true;
    }
    return regions[nextRow * size + nextCol] !== region;
  };
  if (differs(row - 1, col)) {
    y += gap;
  }
  if (differs(row + 1, col)) {
    bottom -= gap;
  }
  if (differs(row, col - 1)) {
    x += gap;
  }
  if (differs(row, col + 1)) {
    right -= gap;
  }
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Paints regions, marks, and highlights. Stump icons are added by the caller
 * unless `stumpDisks` is set, which the thumbnail uses.
 * @param graphics the surface to draw on; it is cleared first
 * @param paint what to draw
 */
export function paintBoard(graphics: Phaser.GameObjects.Graphics, paint: BoardPaint): void {
  const { puzzle, frame } = paint;
  const count = puzzle.size * puzzle.size;
  graphics.clear();
  graphics.fillStyle(CHROME.ink, 1);
  graphics.fillRoundedRect(frame.x - 8, frame.y - 8, frame.size + 16, frame.size + 16, 16);

  const highlighted = new Set(paint.highlight ?? []);
  const focused = new Set(paint.focus ?? []);
  for (let cell = 0; cell < count; cell++) {
    const box = cellBox(puzzle, frame, cell);
    const color = REGION_COLORS[puzzle.colors[puzzle.regions[cell]] ?? 0] ?? REGION_COLORS[0];
    graphics.fillStyle(color, 1);
    graphics.fillRect(box.x, box.y, box.w, box.h);
    if (highlighted.has(cell)) {
      graphics.fillStyle(CHROME.cream, focused.has(cell) ? 0.42 : 0.22);
      graphics.fillRect(box.x, box.y, box.w, box.h);
    }
  }

  for (let cell = 0; cell < count; cell++) {
    const mark = paint.marks[cell];
    const box = cellBox(puzzle, frame, cell);
    if (mark === CELL_X || mark === CELL_RED) {
      drawX(graphics, box, mark === CELL_RED ? CHROME.danger : CHROME.ink, 1);
    } else if (mark === CELL_STUMP && paint.stumpDisks) {
      drawDisk(graphics, box, 0.72, false);
    }
    if (paint.hypoX?.[cell]) {
      drawX(graphics, {
        x: box.x + box.w * 0.5,
        y: box.y + box.h * 0.06,
        w: box.w * 0.4,
        h: box.h * 0.4,
      }, CHROME.hypo, 0.85);
    }
    if (paint.hypoStump?.[cell] && paint.stumpDisks) {
      drawDisk(graphics, box, 0.46, (paint.flagged ?? []).includes(cell));
    }
  }
}

/**
 * Draws an X with a light halo so it reads on every region color.
 * @param graphics the surface
 * @param box the rectangle the X fills
 * @param color the X color
 * @param scale how much of the box the X uses
 */
function drawX(
  graphics: Phaser.GameObjects.Graphics, box: CellBox, color: number, scale: number,
): void {
  const padX = box.w * (0.22 + (1 - scale) * 0.1);
  const padY = box.h * (0.22 + (1 - scale) * 0.1);
  const x1 = box.x + padX;
  const y1 = box.y + padY;
  const x2 = box.x + box.w - padX;
  const y2 = box.y + box.h - padY;
  const weight = Math.max(2, Math.min(box.w, box.h) * 0.08);
  graphics.lineStyle(weight + 3, CHROME.cream, 0.9);
  graphics.lineBetween(x1, y1, x2, y2);
  graphics.lineBetween(x2, y1, x1, y2);
  graphics.lineStyle(weight, color, 1);
  graphics.lineBetween(x1, y1, x2, y2);
  graphics.lineBetween(x2, y1, x1, y2);
}

/**
 * @param graphics the surface
 * @param box the cell
 * @param scale fraction of the cell
 * @param flagged whether to ring the disk
 */
function drawDisk(
  graphics: Phaser.GameObjects.Graphics, box: CellBox, scale: number, flagged: boolean,
): void {
  const radius = Math.min(box.w, box.h) * scale * 0.5;
  graphics.fillStyle(0x8B5A32, 1);
  graphics.fillCircle(box.x + box.w / 2, box.y + box.h / 2, radius);
  graphics.lineStyle(Math.max(2, radius * 0.12), 0xF0D2A0, 1);
  graphics.strokeCircle(box.x + box.w / 2, box.y + box.h / 2, radius * 0.55);
  if (flagged) {
    graphics.lineStyle(Math.max(2, radius * 0.14), CHROME.danger, 1);
    graphics.strokeCircle(box.x + box.w / 2, box.y + box.h / 2, radius + 3);
  }
}
