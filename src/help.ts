import type { Board } from './engine';
import stumpUrl from './assets/stump_icon.png';

/* ========================================================= *\
 *  How to play: the small example boards in the help        *
 *  dialog, drawn as DOM squares in the board's own colors   *
 *  and marks.                                               *
\* ========================================================= */

/** A mark on an example square, matching the marks on the puzzle screen. */
export type HelpMark = 'stump' | 'x' | 'red' | 'tentative' | 'hypoX';

/** One example board or strip of squares. */
export interface HelpBoard {
  /** Squares across. */
  readonly cols: number;
  /** Palette index for each square, row by row. */
  readonly colors: readonly number[];
  /** Marks by square. */
  readonly marks?: Readonly<Record<number, HelpMark>>;
  /** Squares left bright. When given, every other square is dimmed, as the owl does. */
  readonly lit?: readonly number[];
  /** Spoken description, since the squares themselves are hidden from screen readers. */
  readonly label: string;
}

/** The 5 by 5 forest the rules are shown on. Cells are indexed `row * 5 + col`. */
export const EXAMPLE: Board = {
  size: 5,
  regions: [
    0, 0, 1, 1, 1,
    0, 2, 2, 1, 1,
    3, 2, 2, 2, 4,
    3, 3, 2, 4, 4,
    3, 3, 4, 4, 4,
  ],
};

/** Where the example forest's stumps are. */
export const EXAMPLE_STUMPS: readonly number[] = [1, 8, 10, 17, 24];

/** Marks one stump and an X on each other square in `cells`. */
const oneStump = (stump: number, cells: readonly number[]): Record<number, HelpMark> => (
  Object.fromEntries(cells.map((cell) => [cell, cell === stump ? 'stump' : 'x'])));

const ROW = [5, 6, 7, 8, 9];
const COLUMN = [2, 7, 12, 17, 22];
const PATCH = EXAMPLE.regions.flatMap((region, cell) => (region === 4 ? [cell] : []));
const AROUND = [11, 12, 13, 16, 17, 18, 21, 22, 23];

/** Every example, by the name its placeholder in index.html gives in `data-help-board`. */
export const HELP_BOARDS: Readonly<Record<string, HelpBoard>> = {
  solved: {
    cols: 5, colors: EXAMPLE.regions, marks: Object.fromEntries(EXAMPLE_STUMPS.map((cell) => [cell, 'stump'])),
    label: 'A solved five by five forest with five stumps',
  },
  row: { cols: 5, colors: EXAMPLE.regions, marks: oneStump(8, ROW), lit: ROW, label: 'A row with one stump' },
  column: {
    cols: 5, colors: EXAMPLE.regions, marks: oneStump(17, COLUMN), lit: COLUMN, label: 'A column with one stump',
  },
  patch: {
    cols: 5, colors: EXAMPLE.regions, marks: oneStump(24, PATCH), lit: PATCH, label: 'A color patch with one stump',
  },
  touch: {
    cols: 5, colors: EXAMPLE.regions, marks: oneStump(17, AROUND), lit: AROUND,
    label: 'A stump with X marks on all eight squares around it',
  },
  tap: { cols: 1, colors: [3], marks: { 0: 'x' }, label: 'A square marked with an X' },
  drag: { cols: 3, colors: [0, 2, 2], marks: { 0: 'x', 1: 'x', 2: 'x' }, label: 'Three squares in a row marked with X' },
  reveal: { cols: 1, colors: [1], marks: { 0: 'stump' }, label: 'A revealed stump' },
  wrong: { cols: 1, colors: [4], marks: { 0: 'red' }, label: 'A red X from a wrong guess' },
  whatIf: {
    cols: 2, colors: [2, 4], marks: { 0: 'tentative', 1: 'hypoX' }, label: 'A pencil stump and a small pencil X',
  },
};

/** An X as drawn on the board: round ends, over a wider outline if one is given. */
const cross = (color: string, outline?: string): string => {
  const path = 'M27 27 73 73M73 27 27 73';
  const line = (stroke: string, width: number): string => (
    `<path d='${path}' stroke='${stroke}' stroke-width='${width}' stroke-linecap='round' fill='none'/>`);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>`
    + `${outline ? line(outline, 19) : ''}${line(color, 10)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};

/** Background image for each mark. */
const MARK_IMAGES: Record<HelpMark, string> = {
  stump: `url("${stumpUrl}")`,
  tentative: `url("${stumpUrl}")`,
  x: cross('rgba(43, 29, 18, 0.8)'),
  red: cross('#d62828', '#ffffff'),
  hypoX: cross('#ffffff', 'rgba(43, 29, 18, 0.85)'),
};

/**
 * Draws an example board.
 * @param board the example
 * @param palette region colors, as on the puzzle screen
 * @returns the board element
 */
export function drawHelpBoard(board: HelpBoard, palette: readonly number[]): HTMLElement {
  const element = document.createElement('div');
  element.className = 'mini-board';
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', board.label);
  element.style.gridTemplateColumns = `repeat(${board.cols}, 1fr)`;
  element.replaceChildren(...board.colors.map((color, cell) => {
    const square = document.createElement('i');
    square.style.backgroundColor = `#${palette[color].toString(16).padStart(6, '0')}`;
    const mark = board.marks?.[cell];
    if (mark) {
      square.className = mark;
      square.style.backgroundImage = MARK_IMAGES[mark];
    }
    if (board.lit && !board.lit.includes(cell)) {
      square.classList.add('dim');
    }
    return square;
  }));
  return element;
}

/**
 * Fills each `[data-help-board]` placeholder under `root` with its example board.
 * @param root the help dialog
 * @param palette region colors, as on the puzzle screen
 */
export function fillHelpBoards(root: ParentNode, palette: readonly number[]): void {
  for (const slot of root.querySelectorAll<HTMLElement>('[data-help-board]')) {
    const board = HELP_BOARDS[slot.dataset.helpBoard ?? ''];
    if (board) {
      slot.replaceChildren(drawHelpBoard(board, palette));
    }
  }
}
