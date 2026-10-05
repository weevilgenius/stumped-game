/* ========================================================= *\
 *  Puzzle Gameplay Scene for Stumped                         *
\* ========================================================= */

import Phaser from 'phaser';
import { colOf, describeStep, type Puzzle, rowOf, type Step, type Unit, unitCells } from '../engine';
import { GameSession } from '../state/gameSession';
import { loadSettings } from '../state/storage';
import {
  type GameSettings, HYPO_STUMP, HYPO_X,
  MARK_OPEN, MARK_RED_X, MARK_STUMP, MARK_X, type SavedGameState,
} from '../state/types';
import { Button } from '../ui/button';
import { getActiveTheme, REGION_COLORS, type ThemePalette } from '../ui/theme';

/**
 * Main gameplay scene managing the interactive grid, gestures, animations,
 * hypothesis layer, and hints.
 */
export class GameScene extends Phaser.Scene {
  private session: GameSession = new GameSession();
  private settings!: GameSettings;
  private theme!: ThemePalette;

  // Board layout geometry
  private boardX: number = 0;
  private boardY: number = 0;
  private cellSize: number = 0;
  private boardSize: number = 0;

  // Visual containers & graphics layers
  private rootContainer!: Phaser.GameObjects.Container;
  private boardContainer!: Phaser.GameObjects.Container;
  private gridFillGfx!: Phaser.GameObjects.Graphics;
  private gridLinesGfx!: Phaser.GameObjects.Graphics;
  private highlightGfx!: Phaser.GameObjects.Graphics;
  private conflictGfx!: Phaser.GameObjects.Graphics;
  private marksContainer!: Phaser.GameObjects.Container;

  // HUD elements
  private topBarContainer!: Phaser.GameObjects.Container;
  private bottomBarContainer!: Phaser.GameObjects.Container;
  private stumpCountText?: Phaser.GameObjects.Text;
  private timerText?: Phaser.GameObjects.Text;
  private acornIcons: Phaser.GameObjects.Image[] = [];

  private undoBtn?: Button;
  private hypoToggleBtn?: Button;
  private discardBtn?: Button;
  private keepBtn?: Button;
  private woodpeckerBtn?: Button;
  private owlBtn?: Button;
  private squirrelBtn?: Button;

  // Modals & Banners
  private modalContainer?: Phaser.GameObjects.Container;
  private bannerContainer?: Phaser.GameObjects.Container;

  // Gesture tracking
  private isPointerDown: boolean = false;
  private dragAction: 'PLACE_X' | 'ERASE_X' | null = null;
  private dragCells: number[] = [];
  private lastCell: number = -1;
  private downCell: number = -1;
  private downTime: number = 0;
  private lastTapCell: number = -1;
  private lastTapTime: number = 0;
  private inputBlocked: boolean = false;

  constructor() {
    super('GameScene');
  }

  public init(data: { puzzle: Puzzle, savedState?: SavedGameState, isRetry?: boolean }): void {
    this.settings = loadSettings();
    this.theme = getActiveTheme();

    if (data.isRetry) {
      this.session.initialize(data.puzzle, { isRepeat: true });
    } else {
      this.session.initialize(data.puzzle, { savedState: data.savedState });
    }
  }

  public create(): void {
    this.theme = getActiveTheme();
    this.rootContainer = this.add.container(0, 0);

    // Setup board layers
    this.boardContainer = this.add.container(0, 0);
    this.gridFillGfx = this.add.graphics();
    this.gridLinesGfx = this.add.graphics();
    this.highlightGfx = this.add.graphics();
    this.conflictGfx = this.add.graphics();
    this.marksContainer = this.add.container(0, 0);

    this.boardContainer.add([
      this.gridFillGfx,
      this.highlightGfx,
      this.gridLinesGfx,
      this.marksContainer,
      this.conflictGfx,
    ]);

    this.topBarContainer = this.add.container(0, 0);
    this.bottomBarContainer = this.add.container(0, 0);

    this.rootContainer.add([
      this.boardContainer,
      this.topBarContainer,
      this.bottomBarContainer,
    ]);

    // Input pointer events
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', () => this.onPointerUp());

    // Window resize handler
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.theme = getActiveTheme();
      this.layout();
    });

    // Auto-save on window blur / tab switch
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', () => this.session.persist());
      window.addEventListener('beforeunload', () => this.session.persist());
    }

    this.layout();

    // Check query params for automated visual testing
    this.checkQueryParams();
  }

  public override update(_time: number, delta: number): void {
    if (this.session.status === 'playing') {
      this.session.updateElapsedTime(delta);
      if (this.settings.timerVisible && this.timerText) {
        const totalSec = Math.floor(this.session.elapsedTimeMs / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        this.timerText.setText(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
      }
    }
  }

  /* ========================================================= *\
   *  Layout & Geometry                                        *
  \* ========================================================= */

  private layout(): void {
    const { width, height } = this.scale;
    const isPortrait = height > width;

    // Background
    this.boardContainer.removeAll(false);
    this.rootContainer.removeAll(false);

    const bg = this.add.rectangle(width / 2, height / 2, width, height, this.theme.background);
    this.rootContainer.add(bg);
    this.rootContainer.add([this.boardContainer, this.topBarContainer, this.bottomBarContainer]);

    const topBarH = 60;
    const bottomBarH = isPortrait ? 130 : 90;

    const availW = width - (isPortrait ? 24 : 60);
    const availH = height - topBarH - bottomBarH - 20;

    const maxGrid = Math.min(availW, availH);
    this.cellSize = Math.max(30, Math.floor(maxGrid / this.session.puzzle.size));
    this.boardSize = this.cellSize * this.session.puzzle.size;

    this.boardX = Math.round((width - this.boardSize) / 2);
    this.boardY = Math.round(topBarH + (availH - this.boardSize) / 2 + 10);

    this.boardContainer.setPosition(this.boardX, this.boardY);
    this.boardContainer.add([
      this.gridFillGfx,
      this.highlightGfx,
      this.gridLinesGfx,
      this.marksContainer,
      this.conflictGfx,
    ]);

    this.buildTopBar(width, topBarH);
    this.buildBottomBar(width, height, bottomBarH, isPortrait);

    this.renderGrid();
    this.renderMarks();
    this.updateHUD();
  }

  /* ========================================================= *\
   *  Top & Bottom Bars                                        *
  \* ========================================================= */

  private buildTopBar(width: number, _height: number): void {
    this.topBarContainer.removeAll(true);
    this.acornIcons = [];

    // Back to Menu button
    const backBtn = new Button({
      scene: this,
      x: 55,
      y: 32,
      width: 80,
      height: 36,
      text: '< Menu',
      fontSize: 13,
      onClick: () => {
        this.session.persist();
        this.scene.start('MainScene');
      },
    });
    this.topBarContainer.add(backBtn);

    // Stump count e.g. "2/9"
    const stumpIcon = this.add.image(width / 2 - 25, 32, 'stump');
    stumpIcon.setScale(24 / stumpIcon.height);
    this.topBarContainer.add(stumpIcon);

    this.stumpCountText = this.add.text(width / 2 + 10, 32, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '17px',
      color: this.theme.textPrimary,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);
    this.topBarContainer.add(this.stumpCountText);

    // Acorns (lives)
    const rightMargin = width - 20;
    const isSilver = this.session.puzzle.silver;

    if (isSilver) {
      const acorn = this.add.image(rightMargin - 15, 32, 'silver_acorn');
      acorn.setScale(26 / acorn.height);
      this.topBarContainer.add(acorn);
      this.acornIcons.push(acorn);
    } else {
      for (let i = 0; i < 3; i++) {
        const acorn = this.add.image(rightMargin - (2 - i) * 28 - 14, 32, 'acorn');
        acorn.setScale(24 / acorn.height);
        this.topBarContainer.add(acorn);
        this.acornIcons.push(acorn);
      }
    }

    // Timer (centered below if space or right side)
    if (this.settings.timerVisible) {
      this.timerText = this.add.text(width / 2, 54, '00:00', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: this.theme.textSecondary,
      }).setOrigin(0.5, 0.5);
      this.topBarContainer.add(this.timerText);
    }
  }

  private buildBottomBar(width: number, height: number, barH: number, isPortrait: boolean): void {
    this.bottomBarContainer.removeAll(true);
    const cy = height - barH / 2;

    if (isPortrait) {
      // Row 1: Undo + Hypothesis controls
      const row1Y = cy - 24;
      const undoW = Math.min(width * 0.28, 100);

      this.undoBtn = new Button({
        scene: this,
        x: width / 2 - undoW - 10,
        y: row1Y,
        width: undoW,
        height: 38,
        text: 'Undo',
        fontSize: 13,
        onClick: () => this.handleUndo(),
      });
      this.bottomBarContainer.add(this.undoBtn);

      // Hypothesis toggle / Discard & Keep
      const hypoW = Math.min(width * 0.45, 160);
      this.hypoToggleBtn = new Button({
        scene: this,
        x: width / 2 + hypoW / 2 + 10 - (hypoW - undoW) / 2,
        y: row1Y,
        width: hypoW,
        height: 38,
        text: 'Hypothesis',
        fontSize: 13,
        onClick: () => this.toggleHypothesisMode(),
      });
      this.bottomBarContainer.add(this.hypoToggleBtn);

      this.discardBtn = new Button({
        scene: this,
        x: width / 2 + 5,
        y: row1Y,
        width: hypoW / 2 - 4,
        height: 38,
        text: 'Discard',
        fontSize: 12,
        onClick: () => this.handleDiscardHypothesis(),
      });
      this.keepBtn = new Button({
        scene: this,
        x: width / 2 + hypoW / 2 + 6,
        y: row1Y,
        width: hypoW / 2 - 4,
        height: 38,
        text: 'Keep',
        primary: true,
        fontSize: 12,
        onClick: () => this.handleKeepHypothesis(),
      });
      this.bottomBarContainer.add(this.discardBtn);
      this.bottomBarContainer.add(this.keepBtn);

      // Row 2: Three Hints
      const row2Y = cy + 24;
      const hintBtnW = Math.min((width - 48) / 3, 110);

      this.woodpeckerBtn = new Button({
        scene: this,
        x: width / 2 - hintBtnW - 8,
        y: row2Y,
        width: hintBtnW,
        height: 40,
        text: 'Reveal',
        icon: 'woodpecker',
        fontSize: 12,
        onClick: () => this.handleWoodpeckerHint(),
      });
      this.owlBtn = new Button({
        scene: this,
        x: width / 2,
        y: row2Y,
        width: hintBtnW,
        height: 40,
        text: 'Explain',
        icon: 'owl',
        fontSize: 12,
        onClick: () => this.handleOwlHint(),
      });
      this.squirrelBtn = new Button({
        scene: this,
        x: width / 2 + hintBtnW + 8,
        y: row2Y,
        width: hintBtnW,
        height: 40,
        text: 'Eliminate',
        icon: 'squirrel',
        fontSize: 12,
        onClick: () => this.handleSquirrelHint(),
      });

      this.bottomBarContainer.add(this.woodpeckerBtn);
      this.bottomBarContainer.add(this.owlBtn);
      this.bottomBarContainer.add(this.squirrelBtn);
    } else {
      // Landscape single row
      const btnH = 40;
      const totalW = Math.min(width * 0.85, 780);
      const btnW = (totalW - 40) / 5;
      const startX = width / 2 - totalW / 2 + btnW / 2;

      this.undoBtn = new Button({
        scene: this,
        x: startX,
        y: cy,
        width: btnW,
        height: btnH,
        text: 'Undo',
        fontSize: 13,
        onClick: () => this.handleUndo(),
      });
      this.hypoToggleBtn = new Button({
        scene: this,
        x: startX + btnW + 10,
        y: cy,
        width: btnW,
        height: btnH,
        text: 'Hypothesis',
        fontSize: 13,
        onClick: () => this.toggleHypothesisMode(),
      });
      this.discardBtn = new Button({
        scene: this,
        x: startX + btnW + 10 - btnW / 4 - 2,
        y: cy,
        width: btnW / 2 - 3,
        height: btnH,
        text: 'Discard',
        fontSize: 11,
        onClick: () => this.handleDiscardHypothesis(),
      });
      this.keepBtn = new Button({
        scene: this,
        x: startX + btnW + 10 + btnW / 4 + 2,
        y: cy,
        width: btnW / 2 - 3,
        height: btnH,
        text: 'Keep',
        primary: true,
        fontSize: 11,
        onClick: () => this.handleKeepHypothesis(),
      });

      this.woodpeckerBtn = new Button({
        scene: this,
        x: startX + (btnW + 10) * 2,
        y: cy,
        width: btnW,
        height: btnH,
        text: 'Reveal',
        icon: 'woodpecker',
        fontSize: 12,
        onClick: () => this.handleWoodpeckerHint(),
      });
      this.owlBtn = new Button({
        scene: this,
        x: startX + (btnW + 10) * 3,
        y: cy,
        width: btnW,
        height: btnH,
        text: 'Explain',
        icon: 'owl',
        fontSize: 12,
        onClick: () => this.handleOwlHint(),
      });
      this.squirrelBtn = new Button({
        scene: this,
        x: startX + (btnW + 10) * 4,
        y: cy,
        width: btnW,
        height: btnH,
        text: 'Eliminate',
        icon: 'squirrel',
        fontSize: 12,
        onClick: () => this.handleSquirrelHint(),
      });

      this.bottomBarContainer.add([
        this.undoBtn,
        this.hypoToggleBtn,
        this.discardBtn,
        this.keepBtn,
        this.woodpeckerBtn,
        this.owlBtn,
        this.squirrelBtn,
      ]);
    }
  }

  /* ========================================================= *\
   *  Grid & Mark Rendering                                    *
  \* ========================================================= */

  private renderGrid(): void {
    const { size, regions, colors } = this.session.puzzle;
    const cs = this.cellSize;

    this.gridFillGfx.clear();
    this.gridLinesGfx.clear();

    // 1. Draw solid color regions
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = r * size + c;
        const reg = regions[cell];
        const hex = REGION_COLORS[colors[reg]];
        this.gridFillGfx.fillStyle(hex, 1);
        this.gridFillGfx.fillRect(c * cs, r * cs, cs, cs);
      }
    }

    // 2. Draw subtle inner grid lines between cells of same region
    this.gridLinesGfx.lineStyle(1, this.theme.gridInnerLine, this.theme.gridInnerAlpha);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = r * size + c;
        const reg = regions[cell];
        const x = c * cs;
        const y = r * cs;

        if (r + 1 < size && regions[(r + 1) * size + c] === reg) {
          this.gridLinesGfx.beginPath();
          this.gridLinesGfx.moveTo(x, y + cs);
          this.gridLinesGfx.lineTo(x + cs, y + cs);
          this.gridLinesGfx.strokePath();
        }
        if (c + 1 < size && regions[r * size + (c + 1)] === reg) {
          this.gridLinesGfx.beginPath();
          this.gridLinesGfx.moveTo(x + cs, y);
          this.gridLinesGfx.lineTo(x + cs, y + cs);
          this.gridLinesGfx.strokePath();
        }
      }
    }

    // 3. Draw bold region boundary lines & outer border
    this.gridLinesGfx.lineStyle(3, this.theme.gridBorder, 1);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = r * size + c;
        const reg = regions[cell];
        const x = c * cs;
        const y = r * cs;

        if (r + 1 < size && regions[(r + 1) * size + c] !== reg) {
          this.gridLinesGfx.beginPath();
          this.gridLinesGfx.moveTo(x, y + cs);
          this.gridLinesGfx.lineTo(x + cs, y + cs);
          this.gridLinesGfx.strokePath();
        }
        if (c + 1 < size && regions[r * size + (c + 1)] !== reg) {
          this.gridLinesGfx.beginPath();
          this.gridLinesGfx.moveTo(x + cs, y);
          this.gridLinesGfx.lineTo(x + cs, y + cs);
          this.gridLinesGfx.strokePath();
        }
      }
    }
    // Outer border
    this.gridLinesGfx.strokeRect(0, 0, this.boardSize, this.boardSize);
  }

  private renderMarks(): void {
    this.marksContainer.removeAll(true);
    const { size } = this.session.puzzle;
    const cs = this.cellSize;

    // Draw normal marks and hypothesis marks
    for (let i = 0; i < size * size; i++) {
      const r = Math.floor(i / size);
      const c = i % size;
      const cx = c * cs + cs / 2;
      const cy = r * cs + cs / 2;

      const normal = this.session.normalMarks[i];
      const hypo = this.session.hypoMarks[i];

      // Normal Stumps
      if (normal === MARK_STUMP) {
        const stump = this.add.image(cx, cy, 'stump');
        stump.setScale((cs * 0.76) / stump.height);
        this.marksContainer.add(stump);
      }
      // Normal X
      else if (normal === MARK_X) {
        const xMark = this.createXGraphic(cx, cy, cs * 0.44, this.theme.markX, 2.5);
        this.marksContainer.add(xMark);
      }
      // Red X (wrong reveal)
      else if (normal === MARK_RED_X) {
        const redX = this.createXGraphic(cx, cy, cs * 0.52, this.theme.markRedX, 3.5);
        this.marksContainer.add(redX);
      }

      // Hypothesis Marks (only if normal mark is open)
      if (normal === MARK_OPEN) {
        if (hypo === HYPO_STUMP) {
          // Tentative stump: smaller, semi-transparent
          const tentative = this.add.image(cx, cy, 'stump');
          tentative.setScale((cs * 0.55) / tentative.height);
          tentative.setAlpha(0.85);
          this.marksContainer.add(tentative);

          // Check if tentative stump breaks any rules
          const conflictsList = this.session.getHypoConflicts(i);
          if (conflictsList.length > 0) {
            const flagBadge = this.add.circle(cx + cs * 0.28, cy - cs * 0.28, 7, 0xC83232);
            const flagExcl = this.add.text(cx + cs * 0.28, cy - cs * 0.28, '!', {
              fontFamily: 'sans-serif',
              fontSize: '11px',
              color: '#FFFFFF',
              fontStyle: 'bold',
            }).setOrigin(0.5, 0.5);
            this.marksContainer.add(flagBadge);
            this.marksContainer.add(flagExcl);
          }
        } else if (hypo === HYPO_X) {
          // Hypothesis X: smaller, positioned in upper right of cell, tinted
          const hypoSize = cs * 0.26;
          const hx = cx + cs * 0.24;
          const hy = cy - cs * 0.24;
          const hypoXMark = this.createXGraphic(hx, hy, hypoSize, this.theme.hypoX, 2);
          this.marksContainer.add(hypoXMark);
        }
      }
    }
  }

  private createXGraphic(cx: number, cy: number, span: number, color: number, strokeW: number): Phaser.GameObjects.Graphics {
    const gfx = this.add.graphics();
    gfx.lineStyle(strokeW, color, 1);
    const half = span / 2;

    gfx.beginPath();
    gfx.moveTo(cx - half, cy - half);
    gfx.lineTo(cx + half, cy + half);
    gfx.moveTo(cx + half, cy - half);
    gfx.lineTo(cx - half, cy + half);
    gfx.strokePath();

    return gfx;
  }

  private updateHUD(): void {
    const { puzzle, acorns, hintsUsed, hypothesisMode } = this.session;
    const revealedCount = this.session.getRevealedStumps().length;

    // Stump count
    if (this.stumpCountText) {
      this.stumpCountText.setText(`${revealedCount}/${puzzle.size}`);
    }

    // Acorns
    for (let i = 0; i < this.acornIcons.length; i++) {
      const active = i < acorns;
      this.acornIcons[i].setAlpha(active ? 1 : 0.25);
    }

    // Undo button
    const hasUndo = hypothesisMode ? this.session.hypoUndoStack.length > 0 : this.session.undoStack.length > 0;
    this.undoBtn?.setEnabled(hasUndo);

    // Hypothesis Mode UI
    if (hypothesisMode) {
      this.hypoToggleBtn?.setVisible(false);
      this.discardBtn?.setVisible(true);
      this.keepBtn?.setVisible(true);
    } else {
      this.hypoToggleBtn?.setVisible(true);
      this.discardBtn?.setVisible(false);
      this.keepBtn?.setVisible(false);
    }

    // Hint buttons disabled once used
    this.woodpeckerBtn?.setEnabled(!hintsUsed.woodpecker && this.session.status === 'playing');
    this.owlBtn?.setEnabled(!hintsUsed.owl && this.session.status === 'playing');
    this.squirrelBtn?.setEnabled(!hintsUsed.squirrel && this.session.status === 'playing');
  }

  /* ========================================================= *\
   *  Pointer & Gesture Handling                               *
  \* ========================================================= */

  private getCellFromPoint(x: number, y: number): number {
    const relX = x - this.boardX;
    const relY = y - this.boardY;
    if (relX < 0 || relX >= this.boardSize || relY < 0 || relY >= this.boardSize) {
      return -1;
    }
    const c = Math.floor(relX / this.cellSize);
    const r = Math.floor(relY / this.cellSize);
    const { size } = this.session.puzzle;
    if (r >= 0 && r < size && c >= 0 && c < size) {
      return r * size + c;
    }
    return -1;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.inputBlocked || this.session.status !== 'playing') {
      return;
    }

    const cell = this.getCellFromPoint(pointer.x, pointer.y);
    if (cell < 0) {
      return;
    }

    this.isPointerDown = true;
    this.downCell = cell;
    this.downTime = this.time.now;
    this.lastCell = cell;

    // Check double-tap: within 350ms on the same cell
    if (cell === this.lastTapCell && (this.time.now - this.lastTapTime) < 350) {
      this.lastTapCell = -1;
      this.isPointerDown = false;

      // Revert the mark from the first tap before executing reveal
      this.session.undo();

      // Execute double-tap reveal attempt
      this.executeReveal(cell);
      return;
    }

    // Single tap / Drag start: immediate execution
    if (this.session.hypothesisMode) {
      const normal = this.session.normalMarks[cell];
      if (normal === MARK_STUMP || normal === MARK_RED_X || normal === MARK_X) {
        return;
      }
      const hypo = this.session.hypoMarks[cell];
      if (hypo === HYPO_STUMP) {
        this.session.handleTap(cell);
        this.dragAction = null;
        this.dragCells = [cell];
      } else if (hypo === HYPO_X) {
        this.dragAction = 'ERASE_X';
        this.session.handleTap(cell);
        this.dragCells = [cell];
      } else {
        this.dragAction = 'PLACE_X';
        this.session.handleTap(cell);
        this.dragCells = [cell];
      }
    } else {
      const normal = this.session.normalMarks[cell];
      if (normal === MARK_STUMP || normal === MARK_RED_X) {
        return;
      }
      if (normal === MARK_X) {
        this.dragAction = 'ERASE_X';
        this.session.handleTap(cell);
        this.dragCells = [cell];
      } else {
        this.dragAction = 'PLACE_X';
        this.session.handleTap(cell);
        this.dragCells = [cell];
      }
    }

    this.renderMarks();
    this.updateHUD();
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.isPointerDown || this.inputBlocked || this.dragAction === null) {
      return;
    }

    const currentCell = this.getCellFromPoint(pointer.x, pointer.y);
    if (currentCell >= 0 && currentCell !== this.lastCell) {
      // Interpolate all cells on the line between lastCell and currentCell
      const lineCells = this.getCellsOnLine(this.lastCell, currentCell);
      const toProcess = lineCells.slice(1);

      if (toProcess.length > 0) {
        const res = this.session.handleDrag(toProcess, this.dragAction);
        if (res) {
          this.dragCells.push(...res.modifiedCells);
          this.triggerUnitPulse(res.newlyCompletedUnits);
        }
        this.lastCell = currentCell;
        this.renderMarks();
        this.updateHUD();
      }
    }
  }

  private onPointerUp(): void {
    if (!this.isPointerDown) {
      return;
    }
    this.isPointerDown = false;

    if (this.dragCells.length > 1) {
      // Drag stroke completed
      this.lastTapCell = -1;
    } else if (this.dragCells.length === 1 && this.downCell >= 0) {
      // Tap completed
      this.lastTapCell = this.downCell;
      this.lastTapTime = this.time.now;
    }

    this.dragAction = null;
    this.dragCells = [];
    this.updateHUD();
  }

  /**
   * Bresenham line algorithm ensuring drag strokes never skip cells.
   */
  private getCellsOnLine(cell0: number, cell1: number): number[] {
    const { size } = this.session.puzzle;
    const r0 = rowOf(size, cell0);
    const c0 = colOf(size, cell0);
    const r1 = rowOf(size, cell1);
    const c1 = colOf(size, cell1);

    const cells: number[] = [];
    const dr = Math.abs(r1 - r0);
    const dc = Math.abs(c1 - c0);
    const sr = r0 < r1 ? 1 : -1;
    const sc = c0 < c1 ? 1 : -1;
    let err = dr - dc;

    let r = r0;
    let c = c0;

    while (true) {
      cells.push(r * size + c);
      if (r === r1 && c === c1) break;
      const e2 = 2 * err;
      if (e2 > -dc) {
        err -= dc;
        r += sr;
      }
      if (e2 < dr) {
        err += dr;
        c += sc;
      }
    }
    return cells;
  }

  /* ========================================================= *\
   *  Reveal & Wrong Reveal Sequence                            *
  \* ========================================================= */

  private executeReveal(cell: number): void {
    const res = this.session.attemptReveal(cell);
    if (!res) {
      return;
    }

    if (res.correct) {
      this.renderMarks();
      this.updateHUD();

      // Stump pop animation
      const r = rowOf(this.session.puzzle.size, cell);
      const c = colOf(this.session.puzzle.size, cell);
      const cx = c * this.cellSize + this.cellSize / 2;
      const cy = r * this.cellSize + this.cellSize / 2;

      const popStump = this.add.image(cx, cy, 'stump');
      popStump.setScale(0.1);
      this.boardContainer.add(popStump);

      this.tweens.add({
        targets: popStump,
        scale: (this.cellSize * 0.76) / popStump.height,
        duration: 220,
        ease: 'Back.easeOut',
        onComplete: () => {
          popStump.destroy();
          this.renderMarks();
        },
      });

      this.triggerUnitPulse(res.newlyCompletedUnits);

      if (res.won) {
        if (res.perfectlyMarked) {
          this.showPerfectlyMarkedBanner();
        }
        this.time.delayedCall(800, () => this.showWinModal());
      }
    } else {
      // Wrong reveal: blocks input until animation finishes
      this.inputBlocked = true;
      this.renderMarks();
      this.updateHUD();

      // Show conflict line if broke rule against already-revealed stump
      if (res.conflicts.length > 0) {
        const { size } = this.session.puzzle;
        const r0 = rowOf(size, cell);
        const c0 = colOf(size, cell);
        const x0 = c0 * this.cellSize + this.cellSize / 2;
        const y0 = r0 * this.cellSize + this.cellSize / 2;

        this.conflictGfx.clear();
        this.conflictGfx.lineStyle(3.5, this.theme.conflictLine, 0.9);

        for (const conf of res.conflicts) {
          const r1 = rowOf(size, conf.stump);
          const c1 = colOf(size, conf.stump);
          const x1 = c1 * this.cellSize + this.cellSize / 2;
          const y1 = r1 * this.cellSize + this.cellSize / 2;

          this.conflictGfx.beginPath();
          this.conflictGfx.moveTo(x0, y0);
          this.conflictGfx.lineTo(x1, y1);
          this.conflictGfx.strokePath();
        }
      }

      this.time.delayedCall(700, () => {
        this.conflictGfx.clear();
        this.inputBlocked = false;

        if (res.lost) {
          this.showLossModal();
        }
      });
    }
  }

  /* ========================================================= *\
   *  Animations: Pulse and Perfectly Marked                   *
  \* ========================================================= */

  private triggerUnitPulse(units: readonly Unit[]): void {
    if (units.length === 0) {
      return;
    }

    const { size } = this.session.puzzle;
    const allCellsToPulse: number[] = [];

    for (const unit of units) {
      const cells = unitCells(this.session.puzzle, unit);
      allCellsToPulse.push(...cells);
    }

    // Visual pulse effect on the cells
    const pulseGfx = this.add.graphics();
    pulseGfx.fillStyle(0xFFFFFF, 0.35);

    for (const c of allCellsToPulse) {
      const row = rowOf(size, c);
      const col = colOf(size, c);
      pulseGfx.fillRect(col * this.cellSize, row * this.cellSize, this.cellSize, this.cellSize);
    }
    this.boardContainer.add(pulseGfx);

    this.tweens.add({
      targets: pulseGfx,
      alpha: 0,
      duration: 350,
      ease: 'Quad.easeOut',
      onComplete: () => pulseGfx.destroy(),
    });
  }

  private showPerfectlyMarkedBanner(): void {
    const { width, height } = this.scale;
    const cont = this.add.container(width / 2, height / 2 - 80);

    const txt = this.add.text(0, 0, 'Perfectly Marked!', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '24px',
      color: '#FFFFFF',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);

    const bg = this.add.rectangle(0, 0, txt.displayWidth + 40, 52, 0x2A5E35, 0.95);
    bg.setStrokeStyle(2, 0x56B368);

    cont.add([bg, txt]);
    this.add.existing(cont);

    cont.setScale(0.2);
    this.tweens.add({
      targets: cont,
      scale: 1,
      duration: 300,
      ease: 'Back.easeOut',
    });

    this.time.delayedCall(2200, () => cont.destroy());
  }

  /* ========================================================= *\
   *  Actions: Undo, Hypothesis, Hints                         *
  \* ========================================================= */

  private handleUndo(): void {
    const undone = this.session.undo();
    if (undone) {
      this.renderMarks();
      this.updateHUD();
    }
  }

  private toggleHypothesisMode(): void {
    this.session.setHypothesisMode(!this.session.hypothesisMode);
    this.updateHUD();
  }

  private handleDiscardHypothesis(): void {
    this.session.discardHypothesis();
    this.renderMarks();
    this.updateHUD();
  }

  private handleKeepHypothesis(): void {
    this.session.keepHypothesis();
    this.renderMarks();
    this.updateHUD();
  }

  private handleWoodpeckerHint(): void {
    const revealedCell = this.session.useWoodpeckerHint();
    if (revealedCell !== null) {
      this.executeReveal(revealedCell);
      this.renderMarks();
      this.updateHUD();
    }
  }

  private handleSquirrelHint(): void {
    const eliminated = this.session.useSquirrelHint();
    if (eliminated.length > 0) {
      this.renderMarks();
      this.updateHUD();
    }
  }

  private handleOwlHint(): void {
    // 1. Check if player has placed an X on a stump
    const incorrectX = this.session.findIncorrectPlayerX();
    if (incorrectX !== null) {
      const { size } = this.session.puzzle;
      const r = rowOf(size, incorrectX) + 1;
      const c = colOf(size, incorrectX) + 1;

      this.highlightCell(incorrectX);

      this.openOwlModal(
        "Owl's Insight",
        `An X was mistakenly placed on a stump at row ${r}, column ${c}.\n\nWhen closed, this X will be removed.`,
        () => {
          this.session.removeIncorrectPlayerX(incorrectX);
          this.clearHighlight();
          this.renderMarks();
          this.updateHUD();
        },
      );
      return;
    }

    // 2. Find simplest deduction
    const deduction = this.session.getOwlDeduction();
    if (!deduction) {
      this.openOwlModal("Owl's Insight", 'No deduction found from current marks.', () => this.clearHighlight());
      return;
    }

    const { step } = deduction;
    this.highlightDeduction(step);

    if (step.type === 'chain' && step.steps.length > 1) {
      // Multi-step chain stepping
      this.openChainModal(step);
    } else {
      this.openOwlModal("Owl's Insight", deduction.description, () => {
        this.session.applyOwlDeduction(step);
        this.clearHighlight();
        this.renderMarks();
        this.updateHUD();
        if (this.session.status === 'won') {
          this.time.delayedCall(800, () => this.showWinModal());
        }
      });
    }
  }

  private highlightCell(cell: number): void {
    this.highlightGfx.clear();
    const { size } = this.session.puzzle;
    const r = rowOf(size, cell);
    const c = colOf(size, cell);
    this.highlightGfx.fillStyle(0xFFEE55, 0.45);
    this.highlightGfx.fillRect(c * this.cellSize, r * this.cellSize, this.cellSize, this.cellSize);
  }

  private highlightDeduction(step: Step): void {
    this.highlightGfx.clear();
    const { size } = this.session.puzzle;
    this.highlightGfx.fillStyle(0xFFEE55, 0.35);

    if (step.type === 'elimination') {
      for (const cell of step.eliminated) {
        const r = rowOf(size, cell);
        const c = colOf(size, cell);
        this.highlightGfx.fillRect(c * this.cellSize, r * this.cellSize, this.cellSize, this.cellSize);
      }
    } else if (step.type === 'forced') {
      const cells = unitCells(this.session.puzzle, step.unit);
      for (const cell of cells) {
        const r = rowOf(size, cell);
        const c = colOf(size, cell);
        this.highlightGfx.fillRect(c * this.cellSize, r * this.cellSize, this.cellSize, this.cellSize);
      }
    } else if (step.type === 'confinement') {
      for (const cell of step.eliminated) {
        const r = rowOf(size, cell);
        const c = colOf(size, cell);
        this.highlightGfx.fillRect(c * this.cellSize, r * this.cellSize, this.cellSize, this.cellSize);
      }
    }
  }

  private clearHighlight(): void {
    this.highlightGfx.clear();
  }

  /* ========================================================= *\
   *  Modals: Owl, Win, Loss                                   *
  \* ========================================================= */

  private openOwlModal(title: string, explanation: string, onApply: () => void): void {
    this.closeModal();
    const { width, height } = this.scale;
    const modal = this.add.container(0, 0);

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, this.theme.modalOverlay, 0.6);
    overlay.setInteractive();
    modal.add(overlay);

    const boxW = Math.min(width * 0.9, 440);
    const boxH = 240;
    const box = this.add.rectangle(width / 2, height / 2, boxW, boxH, this.theme.surface);
    box.setStrokeStyle(1.5, this.theme.border);
    modal.add(box);

    const owlIcon = this.add.image(width / 2 - 80, height / 2 - 80, 'owl');
    owlIcon.setScale(32 / owlIcon.height);
    modal.add(owlIcon);

    const titleText = this.add.text(width / 2 + 10, height / 2 - 80, title, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '18px',
      color: this.theme.textPrimary,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);
    modal.add(titleText);

    const explText = this.add.text(width / 2, height / 2 - 15, explanation, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      color: this.theme.textSecondary,
      wordWrap: { width: boxW - 48 },
      align: 'center',
    }).setOrigin(0.5, 0.5);
    modal.add(explText);

    const applyBtn = new Button({
      scene: this,
      x: width / 2,
      y: height / 2 + 75,
      width: 150,
      height: 42,
      text: 'Apply Deduction',
      primary: true,
      fontSize: 14,
      onClick: () => {
        this.closeModal();
        onApply();
      },
    });
    modal.add(applyBtn);

    this.modalContainer = modal;
  }

  private openChainModal(step: Step): void {
    if (step.type !== 'chain') return;
    this.closeModal();

    const { width, height } = this.scale;
    const modal = this.add.container(0, 0);

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, this.theme.modalOverlay, 0.6);
    overlay.setInteractive();
    modal.add(overlay);

    const boxW = Math.min(width * 0.9, 460);
    const boxH = 260;
    const box = this.add.rectangle(width / 2, height / 2, boxW, boxH, this.theme.surface);
    box.setStrokeStyle(1.5, this.theme.border);
    modal.add(box);

    let stepIndex = 0;
    const totalSteps = step.steps.length;

    const title = this.add.text(width / 2, height / 2 - 90, `Owl Chain (Step 1 of ${totalSteps})`, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
      color: this.theme.textPrimary,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);
    modal.add(title);

    const desc = this.add.text(width / 2, height / 2 - 20, describeStep(step.steps[0]), {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      color: this.theme.textSecondary,
      wordWrap: { width: boxW - 50 },
      align: 'center',
    }).setOrigin(0.5, 0.5);
    modal.add(desc);

    const prevBtn = new Button({
      scene: this,
      x: width / 2 - 130,
      y: height / 2 + 50,
      width: 70,
      height: 36,
      text: '< Prev',
      fontSize: 12,
      onClick: () => {
        if (stepIndex > 0) {
          stepIndex--;
          title.setText(`Owl Chain (Step ${stepIndex + 1} of ${totalSteps})`);
          desc.setText(describeStep(step.steps[stepIndex]));
          this.highlightDeduction(step.steps[stepIndex]);
        }
      },
    });

    const nextBtn = new Button({
      scene: this,
      x: width / 2 - 50,
      y: height / 2 + 50,
      width: 70,
      height: 36,
      text: 'Next >',
      fontSize: 12,
      onClick: () => {
        if (stepIndex < totalSteps - 1) {
          stepIndex++;
          title.setText(`Owl Chain (Step ${stepIndex + 1} of ${totalSteps})`);
          desc.setText(describeStep(step.steps[stepIndex]));
          this.highlightDeduction(step.steps[stepIndex]);
        }
      },
    });

    const applyBtn = new Button({
      scene: this,
      x: width / 2 + 80,
      y: height / 2 + 50,
      width: 140,
      height: 38,
      text: 'Apply Deduction',
      primary: true,
      fontSize: 13,
      onClick: () => {
        this.closeModal();
        this.session.applyOwlDeduction(step);
        this.clearHighlight();
        this.renderMarks();
        this.updateHUD();
      },
    });

    modal.add([prevBtn, nextBtn, applyBtn]);
    this.modalContainer = modal;
  }

  private showWinModal(): void {
    this.closeModal();
    const { width, height } = this.scale;
    const modal = this.add.container(0, 0);

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, this.theme.modalOverlay, 0.7);
    overlay.setInteractive();
    modal.add(overlay);

    const boxW = Math.min(width * 0.88, 380);
    const boxH = 260;
    const box = this.add.rectangle(width / 2, height / 2, boxW, boxH, this.theme.surface);
    box.setStrokeStyle(1.5, this.theme.border);
    modal.add(box);

    const title = this.add.text(width / 2, height / 2 - 80, 'Solved!', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '26px',
      color: this.theme.textAccent,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);
    modal.add(title);

    const totalSec = Math.floor(this.session.elapsedTimeMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const timeTxt = this.add.text(width / 2, height / 2 - 35, `Completion Time: ${timeStr}`, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
      color: this.theme.textPrimary,
    }).setOrigin(0.5, 0.5);
    modal.add(timeTxt);

    let badgeStr = '';
    if (this.session.perfectlyMarked) badgeStr += '✓ Perfectly Marked  ';
    if (!this.session.isRepeat && this.session.acorns === this.session.maxAcorns) badgeStr += '★ Clean Solve';

    if (badgeStr) {
      const badgeText = this.add.text(width / 2, height / 2 - 5, badgeStr, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#D49B24',
        fontStyle: 'bold',
      }).setOrigin(0.5, 0.5);
      modal.add(badgeText);
    }

    const btnW = (boxW - 48) / 2;
    const menuBtn = new Button({
      scene: this,
      x: width / 2 - btnW / 2 - 6,
      y: height / 2 + 70,
      width: btnW,
      height: 42,
      text: 'Main Menu',
      fontSize: 14,
      onClick: () => {
        this.closeModal();
        this.scene.start('MainScene');
      },
    });

    const retryBtn = new Button({
      scene: this,
      x: width / 2 + btnW / 2 + 6,
      y: height / 2 + 70,
      width: btnW,
      height: 42,
      text: 'Play Again',
      primary: true,
      fontSize: 14,
      onClick: () => {
        this.closeModal();
        this.session.retry();
        this.renderMarks();
        this.updateHUD();
      },
    });

    modal.add(menuBtn);
    modal.add(retryBtn);

    this.modalContainer = modal;
  }

  private showLossModal(): void {
    this.closeModal();
    const { width, height } = this.scale;
    const modal = this.add.container(0, 0);

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, this.theme.modalOverlay, 0.7);
    overlay.setInteractive();
    modal.add(overlay);

    const boxW = Math.min(width * 0.88, 360);
    const boxH = 220;
    const box = this.add.rectangle(width / 2, height / 2, boxW, boxH, this.theme.surface);
    box.setStrokeStyle(1.5, this.theme.border);
    modal.add(box);

    const title = this.add.text(width / 2, height / 2 - 65, 'Stumped.', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '26px',
      color: '#C83232',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);
    modal.add(title);

    const desc = this.add.text(width / 2, height / 2 - 15, 'All acorns have been lost.', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      color: this.theme.textSecondary,
    }).setOrigin(0.5, 0.5);
    modal.add(desc);

    const btnW = (boxW - 48) / 2;
    const menuBtn = new Button({
      scene: this,
      x: width / 2 - btnW / 2 - 6,
      y: height / 2 + 55,
      width: btnW,
      height: 42,
      text: 'Main Menu',
      fontSize: 14,
      onClick: () => {
        this.closeModal();
        this.scene.start('MainScene');
      },
    });

    const retryBtn = new Button({
      scene: this,
      x: width / 2 + btnW / 2 + 6,
      y: height / 2 + 55,
      width: btnW,
      height: 42,
      text: 'Retry',
      primary: true,
      fontSize: 14,
      onClick: () => {
        this.closeModal();
        this.session.retry();
        this.renderMarks();
        this.updateHUD();
      },
    });

    modal.add(menuBtn);
    modal.add(retryBtn);

    this.modalContainer = modal;
  }

  private closeModal(): void {
    if (this.modalContainer) {
      this.modalContainer.destroy();
      this.modalContainer = undefined;
    }
  }

  private checkQueryParams(): void {
    if (typeof window === 'undefined' || !window.location) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('modal') === 'owl') {
      this.handleOwlHint();
    } else if (params.get('hypothesis') === 'true') {
      this.toggleHypothesisMode();
    } else if (params.get('status') === 'won') {
      this.showWinModal();
    }
  }
}
