import Phaser from 'phaser';
import { conflicts, EXCLUDED, OPEN, STUMP } from '../engine';
import { completedUnits, layer, markCells, reveal, tentativeConflicts, undo, WRONG } from './state';
import type { Change, Play } from './state';
import { crossedCells } from './gestures';
import type { Point } from './gestures';
import stumpUrl from '../assets/stump_icon@4x.png';

/** Meowdoku's ordered region palette. */
export const PALETTE = [0xE4BB49, 0x5B75B2, 0xD57374, 0xAED994, 0x48B5B2, 0xFAB4D0, 0xA7BFD7, 0x9778D6, 0xAD6F48, 0xFEAA6C];
/** Logical canvas width; Phaser scales this to the available square. */
export const BOARD_SIZE = 1000;
/** Phaser board rendering, pointer gestures, and nonblocking feedback. */
export class BoardScene extends Phaser.Scene {
  /** Wrong-reveal animation temporarily locks all controls. */
  blocked = false;
  /** Keyboard-selected square, or -1 when not focused. */
  focused = -1;
  private graphics!: Phaser.GameObjects.Graphics;
  private highlight!: Phaser.GameObjects.Graphics;
  private stumps: Phaser.GameObjects.Image[] = [];
  private ready = false;
  private highlighted: readonly number[] = [];
  private pulseKeys = new Set<string>();
  private playId = '';
  private stroke: { pointer: number; from: Point; start: number; dragged: boolean; value: number; changes: Change[] } | null = null;
  private lastTap: { cell: number; time: number; changes: Change[]; hypothesis: boolean } | null = null;

  constructor(private readonly getPlay: () => Play, private readonly onChange: (message?: string) => void) {
    super('forest');
  }

  /** Loads the existing woodland sprite. */
  preload(): void {
    this.load.image('stump', stumpUrl);
  }

  /** Installs one gesture handler for the entire grid. */
  create(): void {
    this.graphics = this.add.graphics();
    this.stumps = Array.from({ length: 100 }, () => this.add.image(0, 0, 'stump').setVisible(false));
    this.highlight = this.add.graphics();
    this.ready = true;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => this.onDown(pointer));
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => this.onMove(pointer));
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => this.onUp(pointer));
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, (pointer: Phaser.Input.Pointer) => this.onUp(pointer));
    this.game.canvas.setAttribute('aria-hidden', 'true');
    this.game.canvas.dataset.ready = 'true';
    this.draw();
  }

  /** Cancels pointer history on screen changes, interruptions, or layer changes. */
  cancelGesture(): void {
    this.stroke = null;
    this.lastTap = null;
  }

  private point(pointer: Phaser.Input.Pointer): Point {
    const n = this.getPlay().puzzle.size;
    return { x: pointer.x / BOARD_SIZE * n, y: pointer.y / BOARD_SIZE * n };
  }
  private onDown(pointer: Phaser.Input.Pointer): void {
    const play = this.getPlay();
    if (this.blocked || play.status !== 'playing' || play.explanation || this.stroke || !pointer.leftButtonDown()) return;
    const point = this.point(pointer);
    const cell = crossedCells(play.puzzle.size, point, point)[0];
    if (cell === undefined || play.marks[cell] >= STUMP) return;
    if (this.lastTap?.cell === cell && this.lastTap.hypothesis === play.hypothesis && performance.now() - this.lastTap.time < 330) {
      const stack = play.hypothesis ? play.pencilUndo : play.undo;
      if (stack.at(-1) === this.lastTap.changes) undo(play);
      this.lastTap = null;
      this.attempt(cell);
      return;
    }
    const value = layer(play)[cell] === OPEN ? EXCLUDED : OPEN;
    const changes = markCells(play, [cell], value);
    this.stroke = { pointer: pointer.id, from: point, start: cell, dragged: false, value, changes };
    this.lastTap = null;
    this.onChange();
  }
  private onMove(pointer: Phaser.Input.Pointer): void {
    const stroke = this.stroke;
    if (pointer.id !== stroke?.pointer || !pointer.isDown || this.blocked) return;
    const play = this.getPlay();
    const point = this.point(pointer);
    const cells = crossedCells(play.puzzle.size, stroke.from, point);
    if (cells.some((cell) => cell !== stroke.start)) stroke.dragged = true;
    const previousLength = stroke.changes.length;
    // Strokes only paint/erase Xs; passing over a tentative stump leaves it intact.
    markCells(play, cells.filter((cell) => layer(play)[cell] !== STUMP), stroke.value, stroke.changes);
    stroke.from = point;
    if (stroke.changes.length !== previousLength) this.onChange();
  }
  private onUp(pointer: Phaser.Input.Pointer): void {
    const stroke = this.stroke;
    if (pointer.id !== stroke?.pointer) return;
    // Include the last segment even when the browser delivered no move before release.
    const point = this.point(pointer);
    const play = this.getPlay();
    const cells = crossedCells(play.puzzle.size, stroke.from, point);
    if (cells.some((cell) => cell !== stroke.start)) stroke.dragged = true;
    markCells(play, cells.filter((cell) => layer(play)[cell] !== STUMP), stroke.value, stroke.changes);
    this.lastTap = stroke.dragged ? null : { cell: stroke.start, time: performance.now(), changes: stroke.changes, hypothesis: play.hypothesis };
    this.stroke = null;
    this.onChange();
  }

  /** Shared reveal path for pointers and keyboard users. */
  attempt(cell: number): void {
    const play = this.getPlay();
    if (this.blocked || play.explanation || play.status !== 'playing' || play.marks[cell] >= STUMP) return;
    const stumps = play.marks.flatMap((mark, c) => mark === STUMP ? [c] : []);
    const broken = conflicts(play.puzzle, cell, stumps);
    reveal(play, cell);
    const wrong = play.marks[cell] === WRONG;
    this.blocked = wrong;
    const ruleNames = { row: 'row', col: 'column', region: 'patch', touch: 'personal space' };
    this.onChange(wrong ? broken.length ? `That square conflicts with a stump’s ${ruleNames[broken[0].rule]}. One acorn lost.` : 'No stump here. One acorn lost.' : undefined);
    if (wrong && this.ready) {
      const overlay = this.add.graphics().setDepth(5);
      const width = BOARD_SIZE / play.puzzle.size;
      const center = (c: number): Point => ({ x: (c % play.puzzle.size + 0.5) * width, y: (Math.floor(c / play.puzzle.size) + 0.5) * width });
      const from = center(cell);
      overlay.lineStyle(9, 0x982e35, 1);
      for (const conflict of broken) {
        const to = center(conflict.stump);
        overlay.lineBetween(from.x, from.y, to.x, to.y);
        overlay.strokeCircle(to.x, to.y, width * 0.4);
      }
      this.time.delayedCall(700, () => {
        overlay.destroy();
        this.blocked = false;
        this.onChange();
      });
    } else if (!play.hypothesis && this.ready) {
      const sprite = this.stumps[cell];
      this.tweens.add({ targets: sprite, alpha: { from: 0.4, to: 1 }, duration: 200 });
    }
  }

  /** Updates explanation and keyboard focus highlights. */
  setHighlights(cells: readonly number[]): void {
    this.highlighted = cells;
    this.draw();
  }

  /** Redraws only after state changes, retaining the same Phaser objects. */
  draw(): void {
    if (!this.ready) return;
    const play = this.getPlay();
    const { size, regions, colors } = play.puzzle;
    const width = BOARD_SIZE / size;
    const g = this.graphics.clear();
    this.highlight.clear();
    const flagged = tentativeConflicts(play);
    const xMark = (x: number, y: number, radius: number, color: number, lineWidth: number): void => {
      g.lineStyle(lineWidth, color, 0.95);
      g.lineBetween(x - radius, y - radius, x + radius, y + radius);
      g.lineBetween(x + radius, y - radius, x - radius, y + radius);
    };
    this.stumps.forEach((sprite) => sprite.setVisible(false));
    play.marks.forEach((mark, cell) => {
      const col = cell % size;
      const row = Math.floor(cell / size);
      const x = col * width;
      const y = row * width;
      g.fillStyle(PALETTE[colors[regions[cell]]], 1).fillRect(x, y, width + 0.5, width + 0.5);
    });
    play.marks.forEach((mark, cell) => {
      const col = cell % size;
      const row = Math.floor(cell / size);
      const x = col * width;
      const y = row * width;
      const cx = x + width / 2;
      const cy = y + width / 2;
      g.lineStyle(col === 0 || regions[cell - 1] !== regions[cell] ? 5 : 1.5, 0x303c32, col === 0 || regions[cell - 1] !== regions[cell] ? 0.85 : 0.3);
      g.lineBetween(x, y, x, y + width);
      g.lineStyle(row === 0 || regions[cell - size] !== regions[cell] ? 5 : 1.5, 0x303c32, row === 0 || regions[cell - size] !== regions[cell] ? 0.85 : 0.3);
      g.lineBetween(x, y, x + width, y);
      if (mark === EXCLUDED || mark === WRONG) {
        if (mark === WRONG) g.fillStyle(0xffeee1, 0.8).fillCircle(cx, cy, width * 0.26);
        xMark(cx, cy, width * 0.13, mark === WRONG ? 0xa22636 : 0x263d35, width * 0.048);
      }
      if (mark === STUMP || play.pencil[cell] === STUMP) {
        const tentative = mark !== STUMP;
        this.stumps[cell].setPosition(cx, cy).setDisplaySize(width * (tentative ? 0.51 : 0.79), width * (tentative ? 0.51 : 0.79)).setVisible(true);
        if (tentative) {
          g.lineStyle(3, flagged.includes(cell) ? 0x9f2434 : 0x534082).strokeCircle(cx, cy, width * 0.32);
          if (flagged.includes(cell)) {
            g.fillStyle(0x9f2434).fillTriangle(x + width * 0.75, y + width * 0.08, x + width * 0.95, y + width * 0.4, x + width * 0.55, y + width * 0.4);
          }
        }
      } else if (play.pencil[cell] === EXCLUDED) {
        xMark(x + width * 0.78, y + width * 0.22, width * 0.07, 0x534082, width * 0.033);
      }
    });
    g.lineStyle(6, 0x303c32, 1).strokeRect(2, 2, BOARD_SIZE - 4, BOARD_SIZE - 4);
    for (const cell of [...this.highlighted, ...(this.focused >= 0 ? [this.focused] : [])]) {
      const x = cell % size * width;
      const y = Math.floor(cell / size) * width;
      this.highlight.lineStyle(8, 0xfff9e9).strokeRect(x + 7, y + 7, width - 14, width - 14);
      this.highlight.lineStyle(3, 0x344c37).strokeRect(x + 3, y + 3, width - 6, width - 6);
    }
    const units = completedUnits(play);
    if (this.playId !== play.id) {
      this.playId = play.id;
      this.pulseKeys = new Set(units.map((cells) => cells.join(',')));
      this.cancelGesture();
    }
    for (const cells of units) {
      const key = cells.join(',');
      if (this.pulseKeys.has(key)) continue;
      this.pulseKeys.add(key);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) continue;
      const pulse = this.add.graphics().setDepth(4).fillStyle(0xfffbe7, 0.45);
      cells.forEach((cell) => pulse.fillRect(cell % size * width, Math.floor(cell / size) * width, width, width));
      this.tweens.add({ targets: pulse, alpha: 0, duration: 550, onComplete: () => pulse.destroy() });
    }
  }
}
