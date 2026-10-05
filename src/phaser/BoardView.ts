import Phaser from 'phaser';
import { cellsBetween } from '../game/gridLine';
import { CHROME } from '../game/palette';
import {
  CELL_STUMP, type RevealResult, type Session,
} from '../game/session';
import { cellBox, paintBoard, type BoardFrame, type CellBox } from './drawBoard';
import type { Unit } from '../engine';
import { unitCells } from '../engine';

const DRAG_PX = 12;
const DOUBLE_TAP_MS = 280;
const WRONG_MS = 820;
const PULSE_MS = 460;

interface Stroke {
  id: number;
  cell: number;
  dragged: boolean;
  last: number;
}

/**
 * The board: regions, marks, stump icons, and the tap, drag, and double-tap
 * gestures. A tap changes the board immediately. The wrong-reveal line is the
 * one animation that locks input, and the session owns that lock.
 */
export class BoardView {
  /** Called after a gesture changes the session. */
  onChange: () => void = () => undefined;

  /** Called when a reveal attempt finishes, including a noop. */
  onReveal: (result: RevealResult) => void = () => undefined;

  private readonly graphics: Phaser.GameObjects.Graphics;

  private readonly overlay: Phaser.GameObjects.Graphics;

  private readonly stumps = new Map<number, Phaser.GameObjects.Image>();

  private frame: BoardFrame = { x: 0, y: 0, size: 0 };

  private stroke: Stroke | null = null;

  private lastTap: { cell: number; time: number } | null = null;

  private pulses: { cells: number[]; until: number }[] = [];

  private wrong: { result: RevealResult; start: number } | null = null;

  private pops = new Map<number, number>();

  private highlight: readonly number[] = [];

  private focus: readonly number[] = [];

  /**
   * @param scene the puzzle scene
   * @param session the play in progress
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly session: Session,
  ) {
    this.graphics = scene.add.graphics();
    this.overlay = scene.add.graphics();
    this.overlay.setDepth(4);
    scene.input.on('pointerdown', this.onDown);
    scene.input.on('pointermove', this.onMove);
    scene.input.on('pointerup', this.onUp);
    this.sync();
  }

  /**
   * Moves the board.
   * @param frame the new rectangle
   */
  layout(frame: BoardFrame): void {
    this.frame = frame;
    this.sync();
  }

  /**
   * Squares the owl is showing.
   * @param cells evidence squares
   * @param focus squares that will be marked
   */
  setHighlight(cells: readonly number[], focus: readonly number[]): void {
    this.highlight = cells;
    this.focus = focus;
    this.sync();
  }

  /**
   * Remembers units that just filled in, so they pulse once.
   * @param units the units
   */
  addPulses(units: readonly Unit[]): void {
    if (units.length === 0) {
      return;
    }
    const until = this.scene.time.now + PULSE_MS;
    for (const unit of units) {
      const cells = unitCells(this.session.puzzle, unit).filter((cell) => this.session.marks[cell] !== CELL_STUMP);
      if (cells.length > 0) {
        this.pulses.push({ cells, until });
      }
    }
  }

  /**
   * @param time the scene clock
   */
  update(time: number): void {
    const pulsing = this.pulses.some((pulse) => pulse.until > time);
    if (pulsing || this.wrong || this.pops.size > 0) {
      this.pulses = this.pulses.filter((pulse) => pulse.until > time);
      for (const [cell, start] of this.pops) {
        if (time - start > 280) {
          this.pops.delete(cell);
        }
      }
      if (this.wrong && time - this.wrong.start > WRONG_MS) {
        this.finishWrong();
        return;
      }
      this.drawOverlay(time);
      this.placeStumps(time);
    }
  }

  /** Drops listeners and objects. */
  destroy(): void {
    this.session.inputLocked = false;
    this.scene.input.off('pointerdown', this.onDown);
    this.scene.input.off('pointermove', this.onMove);
    this.scene.input.off('pointerup', this.onUp);
    this.graphics.destroy();
    this.overlay.destroy();
    for (const image of this.stumps.values()) {
      image.destroy();
    }
    this.stumps.clear();
  }

  /** Redraws from the session. */
  sync(): void {
    const session = this.session;
    paintBoard(this.graphics, {
      puzzle: session.puzzle,
      marks: session.marks,
      frame: this.frame,
      hypoX: session.hypothesis ? session.hypoX : undefined,
      hypoStump: session.hypothesis ? session.hypoStump : undefined,
      highlight: this.highlight,
      focus: this.focus,
    });
    this.placeStumps(this.scene.time.now);
    this.drawOverlay(this.scene.time.now);
  }

  private readonly onDown = (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[] = []): void => {
    if (!pointer.primaryDown || this.stroke || this.overUi(over)) {
      return;
    }
    const cell = this.cellAt(pointer);
    if (cell === null) {
      return;
    }
    this.stroke = { id: pointer.id, cell, dragged: false, last: cell };
    this.session.beginStroke(cell);
  };

  private readonly onMove = (pointer: Phaser.Input.Pointer): void => {
    const stroke = this.stroke;
    if (pointer.id !== stroke?.id || !pointer.isDown) {
      return;
    }
    const cell = this.cellAt(pointer);
    if (!stroke.dragged && pointer.getDistance() < DRAG_PX && (cell === null || cell === stroke.cell)) {
      return;
    }
    stroke.dragged = true;
    this.lastTap = null;
    if (cell === null) {
      return;
    }
    const crossed = cellsBetween(this.session.puzzle.size, stroke.last, cell);
    for (const crossedCell of crossed) {
      this.session.extendStroke(crossedCell);
    }
    stroke.last = cell;
    this.sync();
  };

  private readonly onUp = (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[] = []): void => {
    const stroke = this.stroke;
    if (pointer.id !== stroke?.id) {
      return;
    }
    this.stroke = null;
    if (stroke.dragged) {
      this.addPulses(this.session.endStroke());
      this.sync();
      this.onChange();
      return;
    }
    this.session.cancelStroke();
    if (this.overUi(over)) {
      return;
    }
    const now = pointer.upTime;
    if (this.lastTap?.cell === stroke.cell && now - this.lastTap.time <= DOUBLE_TAP_MS) {
      this.lastTap = null;
      const result = this.session.doubleTap(stroke.cell);
      this.acceptReveal(result);
      return;
    }
    this.lastTap = { cell: stroke.cell, time: now };
    this.addPulses(this.session.tap(stroke.cell));
    this.sync();
    this.onChange();
  };

  private acceptReveal(result: RevealResult): void {
    if (result.type === 'correct') {
      this.pops.set(result.cell, this.scene.time.now);
      this.addPulses(result.pulses);
    } else if (result.type === 'wrong') {
      this.session.inputLocked = true;
      this.wrong = { result, start: this.scene.time.now };
    }
    this.sync();
    this.onChange();
    if (result.type !== 'wrong') {
      this.onReveal(result);
    }
  }

  private finishWrong(): void {
    const result = this.wrong?.result;
    this.wrong = null;
    this.session.inputLocked = false;
    this.sync();
    if (result) {
      this.onReveal(result);
    }
  }

  private drawOverlay(time: number): void {
    const overlay = this.overlay;
    overlay.clear();
    for (const pulse of this.pulses) {
      const age = 1 - (pulse.until - time) / PULSE_MS;
      const alpha = Math.sin(Math.max(0, Math.min(1, age)) * Math.PI) * 0.5;
      overlay.fillStyle(CHROME.cream, alpha);
      for (const cell of pulse.cells) {
        const box = cellBox(this.session.puzzle, this.frame, cell);
        overlay.fillRect(box.x, box.y, box.w, box.h);
      }
    }
    if (this.wrong) {
      const progress = Math.max(0, Math.min(1, (time - this.wrong.start) / (WRONG_MS * 0.7)));
      const from = centerOf(cellBox(this.session.puzzle, this.frame, this.wrong.result.cell));
      const targets = [...new Set(this.wrong.result.conflicts.map((conflict) => conflict.stump))];
      overlay.lineStyle(Math.max(3, this.frame.size / this.session.puzzle.size * 0.06), CHROME.danger, 0.95);
      for (const target of targets) {
        const to = centerOf(cellBox(this.session.puzzle, this.frame, target));
        overlay.lineBetween(from.x, from.y, from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress);
      }
    }
    for (const cell of this.session.flagged()) {
      const box = cellBox(this.session.puzzle, this.frame, cell);
      overlay.lineStyle(Math.max(2, box.w * 0.06), CHROME.danger, 1);
      overlay.strokeCircle(box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) * 0.38);
    }
  }

  private placeStumps(time: number): void {
    const session = this.session;
    const show = new Set<number>();
    for (let cell = 0; cell < session.marks.length; cell++) {
      if (session.marks[cell] === CELL_STUMP || (session.hypothesis && session.hypoStump[cell])) {
        show.add(cell);
      }
    }
    for (const [cell, image] of this.stumps) {
      if (!show.has(cell)) {
        image.setVisible(false);
      }
    }
    for (const cell of show) {
      const image = this.stumpImage(cell);
      const box = cellBox(session.puzzle, this.frame, cell);
      const tentative = session.marks[cell] !== CELL_STUMP;
      const target = Math.min(box.w, box.h) * (tentative ? 0.58 : 0.8);
      const started = this.pops.get(cell);
      const pop = started === undefined ? 1 : Phaser.Math.Easing.Back.Out(Math.min(1, (time - started) / 260));
      image.setVisible(true);
      image.setPosition(box.x + box.w / 2, box.y + box.h / 2);
      image.setDisplaySize(target * pop, target * pop);
      image.setAlpha(tentative ? 0.92 : 1);
    }
  }

  private stumpImage(cell: number): Phaser.GameObjects.Image {
    let image = this.stumps.get(cell);
    if (!image) {
      image = this.scene.add.image(0, 0, 'stump').setOrigin(0.5).setDepth(3);
      this.stumps.set(cell, image);
    }
    return image;
  }

  private cellAt(pointer: Phaser.Input.Pointer): number | null {
    const { frame, session } = this;
    const localX = pointer.worldX - frame.x;
    const localY = pointer.worldY - frame.y;
    if (localX < 0 || localY < 0 || localX >= frame.size || localY >= frame.size) {
      return null;
    }
    const pitch = frame.size / session.puzzle.size;
    const col = Math.min(session.puzzle.size - 1, Math.floor(localX / pitch));
    const row = Math.min(session.puzzle.size - 1, Math.floor(localY / pitch));
    return row * session.puzzle.size + col;
  }

  private overUi(over: readonly Phaser.GameObjects.GameObject[]): boolean {
    return over.some((object) => object.getData('ui') === true);
  }
}

/**
 * @param box a cell
 * @returns its center
 */
function centerOf(box: CellBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}
