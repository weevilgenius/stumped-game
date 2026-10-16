import { describe, expect, it } from 'vitest';
import { isValidSolution } from './engine';
import { drawHelpBoard, EXAMPLE, EXAMPLE_STUMPS, fillHelpBoards, HELP_BOARDS } from './help';

const PALETTE = [0x111111, 0x222222, 0x333333, 0x444444, 0x555555];

describe('help boards', () => {
  it('shows a forest that follows every rule', () => {
    expect(isValidSolution(EXAMPLE, EXAMPLE_STUMPS)).toBe(true);
  });

  it('puts exactly one stump in each rule example', () => {
    for (const name of ['row', 'column', 'patch', 'touch']) {
      const { marks = {}, lit = [] } = HELP_BOARDS[name];
      const stumps = Object.entries(marks).filter(([, mark]) => mark === 'stump').map(([cell]) => Number(cell));
      expect(stumps, name).toHaveLength(1);
      expect(EXAMPLE_STUMPS, name).toContain(stumps[0]);
      expect(Object.keys(marks).map(Number).sort((a, b) => a - b), name).toEqual([...lit].sort((a, b) => a - b));
    }
  });

  it('draws squares in palette colors with marks and dimming', () => {
    const board = drawHelpBoard(HELP_BOARDS.row, PALETTE);
    const squares = board.querySelectorAll('i');
    expect(squares).toHaveLength(25);
    expect(board.getAttribute('aria-label')).toBe('A row with one stump');
    expect(squares[8].classList.contains('stump')).toBe(true);
    expect(squares[5].classList.contains('x')).toBe(true);
    expect(squares[0].classList.contains('dim')).toBe(true);
    expect(squares[6].classList.contains('dim')).toBe(false);
  });

  it('fills placeholders by name', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-help-board="drag"></div><div data-help-board="missing"></div>';
    fillHelpBoards(root, PALETTE);
    expect(root.querySelectorAll('.mini-board')).toHaveLength(1);
    expect(root.querySelectorAll('.mini-board i.x')).toHaveLength(3);
  });
});
