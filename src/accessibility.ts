import { flaggedStumps, HYPO_STUMP, MARK_NONE, MARK_RED, MARK_STUMP, MARK_X, stumps } from './game';
import type { Game } from './game';

/** Canvas control mirrored by a semantic button. */
export interface AccessibleControl {
  /** Stable control name. */
  readonly name: string;
  /** Spoken action label. */
  readonly label: string;
  /** Bounds in CSS pixels relative to the canvas. */
  readonly bounds: readonly [number, number, number, number];
  /** Whether the shared action is unavailable. */
  readonly disabled: boolean;
}

/** Creates a semantic companion; actions and availability remain owned by the scene. */
export function createAccessiblePuzzle(
  parent: HTMLElement, game: Game, onMark: (cell: number) => void,
  onReveal: (cell: number) => void, onControl: (name: string) => void,
): {
  render: (bounds: readonly [number, number, number], controls: readonly AccessibleControl[], blocked: boolean, message: string) => void;
  focus: () => void;
  destroy: () => void;
} {
  const root = document.createElement('div');
  root.className = 'accessible-puzzle';
  const instructions = document.createElement('p');
  instructions.id = 'puzzle-instructions';
  instructions.className = 'sr-only';
  instructions.textContent = 'Find one stump in each row, column, and patch. Stumps cannot touch. Use arrow keys to move, Home and End within a row, Space to toggle an X, and Enter to reveal a stump or toggle a tentative stump in What if mode.';
  const grid = document.createElement('div');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', `${game.puzzle.size} by ${game.puzzle.size} puzzle`);
  grid.setAttribute('aria-describedby', instructions.id);
  grid.className = 'accessible-grid';
  const cells: HTMLButtonElement[] = [];
  const n = game.puzzle.size;
  let selected = 0;
  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.className = 'sr-only accessible-reveal';
  reveal.onclick = () => onReveal(selected);
  const labelReveal = (): void => {
    reveal.textContent = `${game.hypo ? 'Toggle tentative stump' : 'Reveal stump'} at row ${Math.floor(selected / n) + 1}, column ${selected % n + 1}`;
    reveal.setAttribute('aria-disabled', cells[selected]?.getAttribute('aria-disabled') ?? 'false');
  };
  const focusCell = (cell: number): void => {
    cells.forEach((button, i) => button.tabIndex = i === cell ? 0 : -1);
    cells[cell].focus();
  };
  for (let row = 0; row < n; row++) {
    const line = document.createElement('div');
    line.setAttribute('role', 'row');
    for (let col = 0; col < n; col++) {
      const cell = row * n + col;
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'gridcell');
      button.tabIndex = cell === 0 ? 0 : -1;
      button.onclick = () => {
        selected = cell;
        labelReveal();
        onMark(cell);
      };
      button.onfocus = () => {
        selected = cell;
        labelReveal();
        cells.forEach((other, i) => other.tabIndex = i === cell ? 0 : -1);
      };
      button.onkeydown = (event) => {
        let next: number;
        switch (event.key) {
        case 'ArrowLeft': next = row * n + Math.max(0, col - 1); break;
        case 'ArrowRight': next = row * n + Math.min(n - 1, col + 1); break;
        case 'ArrowUp': next = Math.max(0, row - 1) * n + col; break;
        case 'ArrowDown': next = Math.min(n - 1, row + 1) * n + col; break;
        case 'Home': next = event.ctrlKey ? 0 : row * n; break;
        case 'End': next = event.ctrlKey ? n * n - 1 : row * n + n - 1; break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          if (!event.repeat) {
            (event.key === 'Enter' ? onReveal : onMark)(cell);
          }
          return;
        default: return;
        }
        event.preventDefault();
        focusCell(next);
      };
      cells.push(button);
      line.append(button);
    }
    grid.append(line);
  }
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Puzzle controls');
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  root.append(instructions, grid, reveal, toolbar, live);
  parent.append(root);
  let names = '';
  return {
    render: ([x, y, size], controls, blocked, message) => {
      grid.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px`;
      const flagged = flaggedStumps(game);
      cells.forEach((button, cell) => {
        const mark = ['open', 'X', 'wrong reveal, permanent X', 'revealed stump'][game.marks[cell]];
        const hypo = game.hypo?.[cell];
        button.setAttribute('aria-label', `Row ${Math.floor(cell / n) + 1}, column ${cell % n + 1}, patch ${game.puzzle.regions[cell] + 1}: ${mark}${hypo === HYPO_STUMP ? ', tentative stump' : hypo === MARK_X ? ', hypothesis X' : ''}${flagged.includes(cell) ? ', rule conflict' : ''}`);
        button.setAttribute('aria-disabled', String(blocked || (game.marks[cell] === MARK_RED || game.marks[cell] === MARK_STUMP) || (!!game.hypo && game.marks[cell] !== MARK_NONE)));
      });
      labelReveal();
      const nextNames = controls.map(({ name }) => name).join(',');
      if (names !== nextNames) {
        const focused = toolbar.contains(document.activeElement);
        const previous = (document.activeElement as HTMLElement | null)?.dataset.action;
        toolbar.replaceChildren(...controls.map(({ name, label }) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.action = name;
          button.setAttribute('aria-label', label);
          button.onclick = () => onControl(name);
          return button;
        }));
        names = nextNames;
        if (focused) {
          const target = Array.from(toolbar.children).find((button) => (button as HTMLElement).dataset.action === previous)
            ?? toolbar.querySelector('[data-action="done"], [data-action="keep"], [data-action="hypothesis"]');
          (target as HTMLElement | null)?.focus();
        }
      }
      controls.forEach(({ bounds: [left, top, width, height], disabled }, i) => {
        const button = toolbar.children[i] as HTMLButtonElement;
        button.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
        button.setAttribute('aria-disabled', String(disabled));
      });
      const text = `${stumps(game).length} of ${n} stumps found. ${game.acorns} acorns remaining. ${game.hypo ? 'What if mode. ' : ''}${message}`;
      if (live.textContent !== text) {
        live.textContent = text;
      }
    },
    focus: () => {
      const done = toolbar.querySelector<HTMLButtonElement>('[data-action="done"]');
      if (done) {
        done.focus();
      } else {
        focusCell(0);
      }
    },
    destroy: () => root.remove(),
  };
}
