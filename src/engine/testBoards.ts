import { type Board, EXCLUDED, OPEN, STUMP } from './board';

/* ========================================================= *\
 *  Test fixtures: ASCII boards                              *
\* ========================================================= */

/**
 * Parses an ASCII region map, one letter per square, region `A` is 0.
 * Whitespace and blank lines are ignored.
 * @param text rows of region letters
 * @returns the board
 */
export function parseBoard(text: string): Board {
  const rows = text.trim().split('\n').map((line) => line.replace(/\s/g, ''));
  return {
    size: rows.length,
    regions: rows.join('').split('').map((ch) => ch.charCodeAt(0) - 65),
  };
}

/**
 * Parses an ASCII mark map: `.` open, `X` excluded, `S` stump.
 * @param text rows of marks
 * @returns cell states
 */
export function parseState(text: string): Uint8Array {
  const marks = text.replace(/\s/g, '').split('');
  return Uint8Array.from(marks, (ch) => (ch === 'X' ? EXCLUDED : ch === 'S' ? STUMP : OPEN));
}

/**
 * Lists the cells of a mark map that hold a given character.
 * @param text rows of marks
 * @param ch the character to find
 * @returns cell indexes
 */
export function cellsOf(text: string, ch: string): number[] {
  return text.replace(/\s/g, '').split('').flatMap((c, i) => (c === ch ? [i] : []));
}
