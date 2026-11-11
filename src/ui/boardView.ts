import type Phaser from 'phaser';
import { colOf, type Conflict, EXCLUDED, type Puzzle, rowOf, type Step, STUMP, unitCells } from '../engine';
import type { GameSession } from '../state/gameSession';
import {
  type ActiveExplanation, HYP_STUMP, HYP_X, type HypothesisMark, MARK_OPEN, MARK_RED_X, MARK_STUMP, MARK_X,
  type NormalMark, REGION_PALETTE_NUM,
} from '../state/types';
import { TEXTURE_KEYS } from './assets';
import { drawOutlinedX, THEME } from './theme';

/** Options for rendering a static thumbnail board. */
export interface ThumbnailRenderOptions {
  /** Puzzle to draw. */
  readonly puzzle: Puzzle;
  /** Normal marks on the board. */
  readonly normalMarks: readonly NormalMark[];
  /** Top-left X in scene coordinates. */
  readonly x: number;
  /** Top-left Y in scene coordinates. */
  readonly y: number;
  /** Width and height of the square thumbnail in pixels. */
  readonly sizePx: number;
}

/**
 * Renders a static board thumbnail into a Phaser Container (used on the Main screen).
 * @param scene owning Phaser Scene
 * @param opts thumbnail options
 * @returns Phaser Container holding the thumbnail graphics and stump icons
 */
export function createBoardThumbnail(
  scene: Phaser.Scene,
  opts: ThumbnailRenderOptions,
): Phaser.GameObjects.Container {
  const { puzzle, normalMarks, x, y, sizePx } = opts;
  const container = scene.add.container(x, y);
  const gfx = scene.add.graphics();
  container.add(gfx);

  const { size, regions, colors } = puzzle;
  const cellPx = sizePx / size;

  // 1. Cell region fills
  for (let cell = 0; cell < size * size; cell++) {
    const r = rowOf(size, cell);
    const c = colOf(size, cell);
    const color = REGION_PALETTE_NUM[colors[regions[cell]] ?? 0];
    gfx.fillStyle(color, 1);
    gfx.fillRect(c * cellPx, r * cellPx, cellPx + 0.5, cellPx + 0.5);
  }

  // 2. Internal grid lines and region boundaries
  drawGridAndRegionBorders(gfx, puzzle, 0, 0, sizePx, true);

  // 3. Marks (stumps and X's)
  for (let cell = 0; cell < normalMarks.length; cell++) {
    const mark = normalMarks[cell];
    const cx = (colOf(size, cell) + 0.5) * cellPx;
    const cy = (rowOf(size, cell) + 0.5) * cellPx;
    if (mark === MARK_STUMP) {
      const img = scene.add.image(cx, cy, TEXTURE_KEYS.STUMP);
      img.setDisplaySize(cellPx * 0.78, cellPx * 0.78);
      container.add(img);
    } else if (mark === MARK_X) {
      drawOutlinedX(gfx, cx, cy, cellPx * 0.2, 0xFFFFFF, THEME.BOARD_BORDER, 0.35);
    } else if (mark === MARK_RED_X) {
      drawOutlinedX(gfx, cx, cy, cellPx * 0.22, THEME.DANGER_RED, THEME.BOARD_BORDER, 0.38);
    }
  }

  return container;
}

/**
 * Draws the internal cell lines, thick region borders with corner caps, and outer frame.
 */
function drawGridAndRegionBorders(
  gfx: Phaser.GameObjects.Graphics,
  puzzle: Puzzle,
  boardX: number,
  boardY: number,
  boardPx: number,
  isThumbnail = false,
): void {
  const { size, regions } = puzzle;
  const cellPx = boardPx / size;
  const thinW = isThumbnail ? 1 : Math.max(1, Math.round(cellPx * 0.018));
  const thickW = isThumbnail
    ? Math.max(2, cellPx * 0.08)
    : Math.max(3, Math.round(cellPx * 0.062));
  const outerW = isThumbnail
    ? Math.max(2.5, cellPx * 0.1)
    : Math.max(4, Math.round(cellPx * 0.075));

  // Thin internal lines between same-region neighbors
  gfx.lineStyle(thinW, THEME.BOARD_BORDER, 0.25);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = r * size + c;
      if (c + 1 < size && regions[cell] === regions[cell + 1]) {
        const lx = boardX + (c + 1) * cellPx;
        gfx.lineBetween(lx, boardY + r * cellPx, lx, boardY + (r + 1) * cellPx);
      }
      if (r + 1 < size && regions[cell] === regions[cell + size]) {
        const ly = boardY + (r + 1) * cellPx;
        gfx.lineBetween(boardX + c * cellPx, ly, boardX + (c + 1) * cellPx, ly);
      }
    }
  }

  // Thick region borders between different-region neighbors
  gfx.lineStyle(thickW, THEME.BOARD_BORDER, 1);
  gfx.fillStyle(THEME.BOARD_BORDER, 1);
  const capRadius = thickW * 0.5;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = r * size + c;
      if (c + 1 < size && regions[cell] !== regions[cell + 1]) {
        const lx = boardX + (c + 1) * cellPx;
        const y0 = boardY + r * cellPx;
        const y1 = boardY + (r + 1) * cellPx;
        gfx.lineBetween(lx, y0, lx, y1);
        gfx.fillCircle(lx, y0, capRadius);
        gfx.fillCircle(lx, y1, capRadius);
      }
      if (r + 1 < size && regions[cell] !== regions[cell + size]) {
        const ly = boardY + (r + 1) * cellPx;
        const x0 = boardX + c * cellPx;
        const x1 = boardX + (c + 1) * cellPx;
        gfx.lineBetween(x0, ly, x1, ly);
        gfx.fillCircle(x0, ly, capRadius);
        gfx.fillCircle(x1, ly, capRadius);
      }
    }
  }

  // Outer board border
  gfx.lineStyle(outerW, THEME.BOARD_BORDER, 1);
  gfx.strokeRect(boardX, boardY, boardPx, boardPx);
}

/**
 * Interactive Phaser 4 view for the N by N Stumped puzzle board.
 * Handles rendering regions, marks, hypothesis scratch marks, conflict flags,
 * unit completion pulses, wrong-reveal blocking animations, and Owl explanations.
 */
export class BoardView {
  private readonly scene: Phaser.Scene;
  private readonly baseGfx: Phaser.GameObjects.Graphics;
  private readonly pulseGfx: Phaser.GameObjects.Graphics;
  private readonly marksGfx: Phaser.GameObjects.Graphics;
  private readonly overlayGfx: Phaser.GameObjects.Graphics;
  private readonly stumpSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly hypStumpSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly previewStumpSprites: Phaser.GameObjects.Image[] = [];

  private boardX = 0;
  private boardY = 0;
  private boardPx = 0;
  private pulseAlpha = 0;
  private pulsedCells: number[] = [];
  private wrongRevealState: {
    readonly cell: number;
    readonly conflicts: readonly Conflict[];
    progress: number;
  } | null = null;

  public constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.baseGfx = scene.add.graphics();
    this.pulseGfx = scene.add.graphics();
    this.marksGfx = scene.add.graphics();
    this.overlayGfx = scene.add.graphics();
  }

  /** @returns top-left X of the board in canvas coordinates */
  public getBoardX(): number {
    return this.boardX;
  }

  /** @returns top-left Y of the board in canvas coordinates */
  public getBoardY(): number {
    return this.boardY;
  }

  /** @returns width and height of the square board in pixels */
  public getBoardPx(): number {
    return this.boardPx;
  }

  /** @returns true while the wrong-reveal animation is playing and blocking input */
  public isAnimatingWrongReveal(): boolean {
    return this.wrongRevealState !== null;
  }

  /**
   * Updates the board bounds and redraws everything for the given session.
   * @param session active game session
   * @param x top-left X coordinate
   * @param y top-left Y coordinate
   * @param sizePx square width/height in pixels
   */
  public setLayout(session: GameSession, x: number, y: number, sizePx: number): void {
    this.boardX = Math.round(x);
    this.boardY = Math.round(y);
    this.boardPx = Math.round(sizePx);
    this.render(session);
  }

  /**
   * Renders the full board state (regions, marks, hypothesis layer, explain overlay).
   * @param session active game session
   * @param newlyRevealedCell optional cell index to play a reveal pop animation on
   */
  public render(session: GameSession, newlyRevealedCell?: number): void {
    if (this.boardPx <= 0) {
      return;
    }
    const { puzzle } = session;
    const { size, regions, colors } = puzzle;
    const cellPx = this.boardPx / size;
    const explanation = session.getActiveExplanation();

    this.baseGfx.clear();
    this.marksGfx.clear();
    this.overlayGfx.clear();
    this.clearPreviewStumps();

    // Determine which cells are dimmed if an Owl explanation is active
    const brightCells = explanation ? this.computeBrightCells(session, explanation) : null;

    // 1. Draw colored region squares
    for (let cell = 0; cell < size * size; cell++) {
      const r = rowOf(size, cell);
      const c = colOf(size, cell);
      const rx = this.boardX + c * cellPx;
      const ry = this.boardY + r * cellPx;
      const color = REGION_PALETTE_NUM[colors[regions[cell]] ?? 0];
      this.baseGfx.fillStyle(color, 1);
      this.baseGfx.fillRect(rx, ry, cellPx + 0.5, cellPx + 0.5);

      if (brightCells && !brightCells.has(cell)) {
        this.baseGfx.fillStyle(0x101C15, 0.62);
        this.baseGfx.fillRect(rx, ry, cellPx + 0.5, cellPx + 0.5);
      }
    }

    // 2. Draw grid lines and region boundaries
    drawGridAndRegionBorders(this.baseGfx, puzzle, this.boardX, this.boardY, this.boardPx, false);

    // 3. Draw normal marks (X's, Red X's, Stumps)
    const normalMarks = session.getNormalMarks();
    this.syncStumpSprites(puzzle, normalMarks, cellPx, newlyRevealedCell, brightCells);

    for (let cell = 0; cell < normalMarks.length; cell++) {
      const mark = normalMarks[cell];
      const cx = this.boardX + (colOf(size, cell) + 0.5) * cellPx;
      const cy = this.boardY + (rowOf(size, cell) + 0.5) * cellPx;
      const alpha = brightCells && !brightCells.has(cell) ? 0.38 : 1;

      if (mark === MARK_X) {
        drawOutlinedX(this.marksGfx, cx, cy, cellPx * 0.21, 0xFFFFFF, THEME.BOARD_BORDER, 0.36, alpha);
      } else if (mark === MARK_RED_X) {
        drawOutlinedX(this.marksGfx, cx, cy, cellPx * 0.22, THEME.DANGER_RED, THEME.BOARD_BORDER, 0.38, alpha);
      }
    }

    // 4. Draw hypothesis marks when hypothesis mode is on (and not in Explain overlay)
    const hypMarks = session.getHypothesisMarks();
    const showHyp = session.isHypothesisMode() && !explanation;
    this.syncHypothesisSprites(puzzle, showHyp ? hypMarks : [], cellPx);

    if (showHyp) {
      const flagged = session.getFlaggedTentativeStumps();

      // Draw conflict lines between flagged tentative stumps and the stumps they conflict with
      for (const [cell, cellConflicts] of flagged.entries()) {
        const x0 = this.boardX + (colOf(size, cell) + 0.5) * cellPx;
        const y0 = this.boardY + (rowOf(size, cell) + 0.5) * cellPx;
        for (const conflict of cellConflicts) {
          const x1 = this.boardX + (colOf(size, conflict.stump) + 0.5) * cellPx;
          const y1 = this.boardY + (rowOf(size, conflict.stump) + 0.5) * cellPx;
          this.overlayGfx.lineStyle(Math.max(2.5, cellPx * 0.055), THEME.DANGER_RED, 0.85);
          this.overlayGfx.lineBetween(x0, y0, x1, y1);
        }
      }

      for (let cell = 0; cell < hypMarks.length; cell++) {
        const hMark = hypMarks[cell];
        const r = rowOf(size, cell);
        const c = colOf(size, cell);
        if (hMark === HYP_X) {
          // Hypothesis X: smaller, placed in the upper right of the square, and tinted.
          const hx = this.boardX + (c + 0.76) * cellPx;
          const hy = this.boardY + (r + 0.24) * cellPx;
          drawOutlinedX(this.marksGfx, hx, hy, cellPx * 0.115, THEME.HYP_X_FILL, THEME.BOARD_BORDER, 0.4);
        } else if (hMark === HYP_STUMP && flagged.has(cell)) {
          // Flagged tentative stump: red ring and warning badge
          const cx = this.boardX + (c + 0.5) * cellPx;
          const cy = this.boardY + (r + 0.5) * cellPx;
          this.overlayGfx.lineStyle(Math.max(2.5, cellPx * 0.06), THEME.DANGER_RED, 1);
          this.overlayGfx.strokeCircle(cx, cy, cellPx * 0.34);

          // Exclamation badge in top-right corner of the cell
          const bx = this.boardX + (c + 0.8) * cellPx;
          const by = this.boardY + (r + 0.2) * cellPx;
          const br = Math.max(6, cellPx * 0.13);
          this.overlayGfx.fillStyle(THEME.DANGER_RED, 1);
          this.overlayGfx.fillCircle(bx, by, br);
          this.overlayGfx.lineStyle(1.5, 0xFFFFFF, 1);
          this.overlayGfx.strokeCircle(bx, by, br);
          this.overlayGfx.fillStyle(0xFFFFFF, 1);
          this.overlayGfx.fillRect(bx - 1, by - br * 0.55, 2, br * 0.65);
          this.overlayGfx.fillCircle(bx, by + br * 0.42, 1.4);
        }
      }
    }

    // 5. Draw Explain (Owl) highlights and previews if active
    if (explanation) {
      this.drawExplanationOverlay(session, explanation, cellPx);
    }

    // 6. Draw wrong-reveal conflict overlay if currently animating
    if (this.wrongRevealState) {
      this.drawWrongRevealOverlay(puzzle, cellPx);
    }

    // 7. Redraw pulse overlay if active
    this.redrawPulse(puzzle);
  }

  /**
   * Triggers a non-blocking pulse animation on the given cells (when a revealed stump's
   * row, column, or region has every other square marked).
   * @param session active game session
   * @param cells cells to pulse
   */
  public triggerUnitPulse(session: GameSession, cells: readonly number[]): void {
    if (cells.length === 0) {
      return;
    }
    this.pulsedCells = [...cells];
    this.pulseAlpha = 0.55;
    this.redrawPulse(session.puzzle);

    this.scene.tweens.addCounter({
      from: 0.55,
      to: 0,
      duration: 460,
      ease: 'Sine.easeOut',
      onUpdate: (tween) => {
        this.pulseAlpha = tween.getValue() ?? 0;
        this.redrawPulse(session.puzzle);
      },
      onComplete: () => {
        this.pulseAlpha = 0;
        this.pulsedCells = [];
        this.pulseGfx.clear();
      },
    });
  }

  /**
   * Plays the blocking wrong-reveal animation showing any conflicts against already-revealed
   * stumps, then invokes `onComplete`.
   * @param session active game session
   * @param cell cell that was wrongly revealed
   * @param broken conflicts against already-revealed stumps
   * @param onComplete callback invoked once the animation finishes
   */
  public playWrongReveal(
    session: GameSession,
    cell: number,
    broken: readonly Conflict[],
    onComplete: () => void,
  ): void {
    this.wrongRevealState = {
      cell,
      conflicts: broken,
      progress: 0,
    };
    this.render(session);

    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 620,
      ease: 'Cubic.easeOut',
      onUpdate: (tween) => {
        if (this.wrongRevealState) {
          this.wrongRevealState.progress = tween.getValue() ?? 0;
          this.render(session);
        }
      },
      onComplete: () => {
        this.wrongRevealState = null;
        this.render(session);
        onComplete();
      },
    });
  }

  /**
   * Cleans up all Phaser display objects owned by this BoardView.
   */
  public destroy(): void {
    this.baseGfx.destroy();
    this.pulseGfx.destroy();
    this.marksGfx.destroy();
    this.overlayGfx.destroy();
    for (const img of this.stumpSprites.values()) {
      img.destroy();
    }
    this.stumpSprites.clear();
    for (const img of this.hypStumpSprites.values()) {
      img.destroy();
    }
    this.hypStumpSprites.clear();
    this.clearPreviewStumps();
  }

  /* ========================================================= *\
   *  Internal rendering helpers                               *
  \* ========================================================= */

  private syncStumpSprites(
    puzzle: Puzzle,
    normalMarks: readonly NormalMark[],
    cellPx: number,
    newlyRevealedCell?: number,
    brightCells?: Set<number> | null,
  ): void {
    const { size } = puzzle;
    const targetDisplay = cellPx * 0.78;

    for (const [cell, sprite] of this.stumpSprites.entries()) {
      if (normalMarks[cell] !== MARK_STUMP) {
        sprite.destroy();
        this.stumpSprites.delete(cell);
      }
    }

    for (let cell = 0; cell < normalMarks.length; cell++) {
      if (normalMarks[cell] !== MARK_STUMP) {
        continue;
      }
      const cx = this.boardX + (colOf(size, cell) + 0.5) * cellPx;
      const cy = this.boardY + (rowOf(size, cell) + 0.5) * cellPx;
      let sprite = this.stumpSprites.get(cell);
      const isNew = !sprite || cell === newlyRevealedCell;
      if (!sprite) {
        sprite = this.scene.add.image(cx, cy, TEXTURE_KEYS.STUMP);
        this.stumpSprites.set(cell, sprite);
      }
      sprite.setPosition(cx, cy);
      sprite.setDisplaySize(targetDisplay, targetDisplay);
      sprite.setAlpha(brightCells && !brightCells.has(cell) ? 0.42 : 1);

      if (isNew && cell === newlyRevealedCell) {
        const finalScaleX = sprite.scaleX;
        const finalScaleY = sprite.scaleY;
        sprite.setScale(finalScaleX * 0.35, finalScaleY * 0.35);
        this.scene.tweens.add({
          targets: sprite,
          scaleX: finalScaleX,
          scaleY: finalScaleY,
          duration: 200,
          ease: 'Back.easeOut',
        });
      }
    }
  }

  private syncHypothesisSprites(
    puzzle: Puzzle,
    hypMarks: readonly HypothesisMark[],
    cellPx: number,
  ): void {
    const { size } = puzzle;
    const targetDisplay = cellPx * 0.52;

    for (const [cell, sprite] of this.hypStumpSprites.entries()) {
      if (hypMarks[cell] !== HYP_STUMP) {
        sprite.destroy();
        this.hypStumpSprites.delete(cell);
      }
    }

    for (let cell = 0; cell < hypMarks.length; cell++) {
      if (hypMarks[cell] !== HYP_STUMP) {
        continue;
      }
      const cx = this.boardX + (colOf(size, cell) + 0.5) * cellPx;
      const cy = this.boardY + (rowOf(size, cell) + 0.5) * cellPx;
      let sprite = this.hypStumpSprites.get(cell);
      if (!sprite) {
        sprite = this.scene.add.image(cx, cy, TEXTURE_KEYS.STUMP);
        this.hypStumpSprites.set(cell, sprite);
      }
      sprite.setPosition(cx, cy);
      sprite.setDisplaySize(targetDisplay, targetDisplay);
      sprite.setAlpha(0.92);
    }
  }

  private clearPreviewStumps(): void {
    while (this.previewStumpSprites.length > 0) {
      this.previewStumpSprites.pop()?.destroy();
    }
  }

  private redrawPulse(puzzle: Puzzle): void {
    this.pulseGfx.clear();
    if (this.pulseAlpha <= 0 || this.pulsedCells.length === 0) {
      return;
    }
    const { size } = puzzle;
    const cellPx = this.boardPx / size;
    this.pulseGfx.fillStyle(0xFFFDF0, this.pulseAlpha);
    for (const cell of this.pulsedCells) {
      const rx = this.boardX + colOf(size, cell) * cellPx + 2;
      const ry = this.boardY + rowOf(size, cell) * cellPx + 2;
      this.pulseGfx.fillRect(rx, ry, cellPx - 4, cellPx - 4);
    }
  }

  private drawWrongRevealOverlay(puzzle: Puzzle, cellPx: number): void {
    if (!this.wrongRevealState) {
      return;
    }
    const { size } = puzzle;
    const { cell, conflicts: broken, progress } = this.wrongRevealState;
    const alpha = Math.max(0, 1 - progress * 0.7);
    const r = rowOf(size, cell);
    const c = colOf(size, cell);
    const cx = this.boardX + (c + 0.5) * cellPx;
    const cy = this.boardY + (r + 0.5) * cellPx;

    // Flash the wrongly guessed square
    this.overlayGfx.fillStyle(THEME.DANGER_RED, 0.35 * alpha);
    this.overlayGfx.fillRect(this.boardX + c * cellPx, this.boardY + r * cellPx, cellPx, cellPx);
    this.overlayGfx.lineStyle(Math.max(3, cellPx * 0.08), THEME.DANGER_RED, alpha);
    this.overlayGfx.strokeRect(
      this.boardX + c * cellPx + 2,
      this.boardY + r * cellPx + 2,
      cellPx - 4,
      cellPx - 4,
    );

    // Draw conflict lines to each conflicting revealed stump
    for (const item of broken) {
      const sr = rowOf(size, item.stump);
      const sc = colOf(size, item.stump);
      const sx = this.boardX + (sc + 0.5) * cellPx;
      const sy = this.boardY + (sr + 0.5) * cellPx;

      this.overlayGfx.lineStyle(Math.max(4, cellPx * 0.09), 0xFFFFFF, alpha * 0.9);
      this.overlayGfx.lineBetween(cx, cy, sx, sy);
      this.overlayGfx.lineStyle(Math.max(2.5, cellPx * 0.055), THEME.DANGER_RED, alpha);
      this.overlayGfx.lineBetween(cx, cy, sx, sy);

      this.overlayGfx.lineStyle(Math.max(3, cellPx * 0.075), THEME.DANGER_RED, alpha);
      this.overlayGfx.strokeRect(
        this.boardX + sc * cellPx + 2,
        this.boardY + sr * cellPx + 2,
        cellPx - 4,
        cellPx - 4,
      );
    }
  }

  private computeBrightCells(session: GameSession, explanation: ActiveExplanation): Set<number> {
    const { puzzle } = session;
    const { size, regions } = puzzle;
    const bright = new Set<number>();

    if (explanation.type === 'wrong-x') {
      bright.add(explanation.cell);
      return bright;
    }

    const preview = session.getChainPreview();
    const step = preview?.activeSubStep ?? explanation.step;

    for (const c of step.eliminated) {
      bright.add(c);
    }

    switch (step.type) {
    case 'elimination':
      bright.add(step.stump);
      for (const c of unitCells(puzzle, { kind: 'row', index: rowOf(size, step.stump) })) {
        bright.add(c);
      }
      for (const c of unitCells(puzzle, { kind: 'col', index: colOf(size, step.stump) })) {
        bright.add(c);
      }
      for (const c of unitCells(puzzle, { kind: 'region', index: regions[step.stump] })) {
        bright.add(c);
      }
      break;
    case 'forced':
      bright.add(step.place);
      for (const c of unitCells(puzzle, step.unit)) {
        bright.add(c);
      }
      break;
    case 'confinement':
      for (const line of step.lines) {
        for (const c of unitCells(puzzle, { kind: step.axis, index: line })) {
          bright.add(c);
        }
      }
      for (const reg of step.regions) {
        for (const c of unitCells(puzzle, { kind: 'region', index: reg })) {
          if (
            step.reverse
            || step.lines.includes(step.axis === 'row' ? rowOf(size, c) : colOf(size, c))
          ) {
            bright.add(c);
          }
        }
      }
      break;
    case 'blocking':
      bright.add(step.cell);
      for (const c of unitCells(puzzle, step.unit)) {
        bright.add(c);
      }
      break;
    case 'chain':
      bright.add(step.cell);
      for (const c of unitCells(puzzle, step.unit)) {
        bright.add(c);
      }
      break;
    }

    if (explanation.step.type === 'chain') {
      bright.add(explanation.step.cell);
      for (const c of unitCells(puzzle, explanation.step.unit)) {
        bright.add(c);
      }
    }

    return bright;
  }

  private drawExplanationOverlay(
    session: GameSession,
    explanation: ActiveExplanation,
    cellPx: number,
  ): void {
    const { puzzle } = session;
    const { size } = puzzle;
    const normalMarks = session.getNormalMarks();
    const inset = Math.max(2.5, cellPx * 0.055);
    const frameW = Math.max(2.5, cellPx * 0.06);

    const strokeCell = (cell: number, color = 0xFFFFFF): void => {
      const r = rowOf(size, cell);
      const c = colOf(size, cell);
      this.overlayGfx.lineStyle(frameW, color, 1);
      this.overlayGfx.strokeRect(
        this.boardX + c * cellPx + inset,
        this.boardY + r * cellPx + inset,
        cellPx - inset * 2,
        cellPx - inset * 2,
      );
    };

    if (explanation.type === 'wrong-x') {
      strokeCell(explanation.cell, THEME.GOLD_BTN_FILL);
      return;
    }

    // If viewing a sub-step of a multi-step chain, render the simulated chain marks
    const chainPreview = session.getChainPreview();
    if (chainPreview && explanation.chainIndex > 0) {
      const { state, activeSubStep } = chainPreview;
      for (let cell = 0; cell < state.length; cell++) {
        if (normalMarks[cell] !== MARK_OPEN) {
          continue;
        }
        const cx = this.boardX + (colOf(size, cell) + 0.5) * cellPx;
        const cy = this.boardY + (rowOf(size, cell) + 0.5) * cellPx;
        if (state[cell] === STUMP) {
          const img = this.scene.add.image(cx, cy, TEXTURE_KEYS.STUMP);
          img.setDisplaySize(cellPx * 0.62, cellPx * 0.62);
          img.setAlpha(0.92);
          this.previewStumpSprites.push(img);
          const isTestedCell = explanation.step.type === 'chain' && cell === explanation.step.cell;
          strokeCell(cell, isTestedCell ? THEME.GOLD_BTN_FILL : 0xFFFFFF);
        } else if (state[cell] === EXCLUDED) {
          drawOutlinedX(this.overlayGfx, cx, cy, cellPx * 0.18, THEME.HYP_X_FILL, THEME.BOARD_BORDER, 0.36);
        }
      }
      if (activeSubStep) {
        this.highlightDeductionStep(puzzle, normalMarks, activeSubStep, cellPx, strokeCell, false);
      }
      return;
    }

    this.highlightDeductionStep(puzzle, normalMarks, explanation.step, cellPx, strokeCell, true);
  }

  private highlightDeductionStep(
    puzzle: Puzzle,
    normalMarks: readonly NormalMark[],
    step: Step,
    cellPx: number,
    strokeCell: (cell: number, color?: number) => void,
    drawResultMarks: boolean,
  ): void {
    const { size, regions } = puzzle;

    switch (step.type) {
    case 'elimination':
      strokeCell(step.stump, 0xFFFFFF);
      break;
    case 'forced':
      for (const c of unitCells(puzzle, step.unit)) {
        if (c === step.place) {
          strokeCell(c, 0xFFFFFF);
        }
      }
      if (drawResultMarks) {
        const cx = this.boardX + (colOf(size, step.place) + 0.5) * cellPx;
        const cy = this.boardY + (rowOf(size, step.place) + 0.5) * cellPx;
        const img = this.scene.add.image(cx, cy, TEXTURE_KEYS.STUMP);
        img.setDisplaySize(cellPx * 0.72, cellPx * 0.72);
        img.setAlpha(0.9);
        this.previewStumpSprites.push(img);
      }
      break;
    case 'confinement':
      for (let cell = 0; cell < size * size; cell++) {
        if (normalMarks[cell] !== MARK_OPEN || step.eliminated.includes(cell)) {
          continue;
        }
        const inRegions = step.regions.includes(regions[cell]);
        const line = step.axis === 'row' ? rowOf(size, cell) : colOf(size, cell);
        const inLines = step.lines.includes(line);
        if (inRegions && inLines) {
          strokeCell(cell, 0xFFFFFF);
        }
      }
      break;
    case 'blocking':
    case 'chain':
      strokeCell(step.cell, THEME.GOLD_BTN_FILL);
      for (const c of unitCells(puzzle, step.unit)) {
        if (normalMarks[c] === MARK_OPEN && c !== step.cell) {
          strokeCell(c, 0xFFFFFF);
        }
      }
      break;
    }

    if (drawResultMarks) {
      for (const cell of step.eliminated) {
        const cx = this.boardX + (colOf(size, cell) + 0.5) * cellPx;
        const cy = this.boardY + (rowOf(size, cell) + 0.5) * cellPx;
        drawOutlinedX(this.overlayGfx, cx, cy, cellPx * 0.21, 0xFFFFFF, THEME.BOARD_BORDER, 0.36);
      }
    }
  }
}
