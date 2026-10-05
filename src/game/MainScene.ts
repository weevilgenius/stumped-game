/* ========================================================= *\
 *  Main Menu Scene: Dashboard, Thumbnail, and Modals        *
\* ========================================================= */

import Phaser from 'phaser';
import type { Puzzle, Tier } from '../engine';
import {
  generateFromCode, getOrGeneratePuzzle, prepareNextPuzzle,
} from '../generator/generatorService';
import {
  getBestTimesFor, loadSavedGame, loadSettings, saveSettings,
} from '../state/storage';
import {
  type GameSettings, MARK_RED_X, MARK_STUMP,
  MARK_X, type SavedGameState,
} from '../state/types';
import { Button } from '../ui/button';
import { getActiveTheme, REGION_COLORS, type ThemePalette } from '../ui/theme';

/**
 * Main screen displaying logo, current puzzle thumbnail, play controls,
 * settings, and best times.
 */
export class MainScene extends Phaser.Scene {
  private currentSavedGame: SavedGameState | null = null;
  private settings!: GameSettings;
  private theme!: ThemePalette;

  private rootContainer!: Phaser.GameObjects.Container;
  private modalContainer?: Phaser.GameObjects.Container;
  private toastContainer?: Phaser.GameObjects.Container;

  constructor() {
    super('MainScene');
  }

  public create(): void {
    this.theme = getActiveTheme();
    this.settings = loadSettings();
    this.currentSavedGame = loadSavedGame();

    this.rootContainer = this.add.container(0, 0);

    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.theme = getActiveTheme();
      this.buildUI();
    });

    this.buildUI();
    this.checkUrlModals();
  }

  /**
   * Rebuilds the main screen layout based on current dimensions and orientation.
   */
  private buildUI(): void {
    this.rootContainer.removeAll(true);
    if (this.modalContainer) {
      this.modalContainer.destroy();
      this.modalContainer = undefined;
    }

    const { width, height } = this.scale;
    const isPortrait = height > width;

    // Background fill
    const bg = this.add.rectangle(width / 2, height / 2, width, height, this.theme.background);
    this.rootContainer.add(bg);

    if (isPortrait) {
      this.buildPortraitLayout(width, height);
    } else {
      this.buildLandscapeLayout(width, height);
    }
  }

  /**
   * Builds single-column layout for portrait devices.
   */
  private buildPortraitLayout(width: number, height: number): void {
    const cx = width / 2;
    let y = Math.min(height * 0.04, 30);

    // 1. Logo
    const logoImg = this.add.image(cx, y + 45, 'logo');
    const maxLogoW = Math.min(width * 0.85, 420);
    const logoScale = Math.min(maxLogoW / logoImg.width, 0.35);
    logoImg.setScale(logoScale);
    this.rootContainer.add(logoImg);
    y += logoImg.displayHeight + 20;

    // 2. "New Puzzle" primary button
    const btnW = Math.min(width * 0.85, 340);
    const newPuzzleBtn = new Button({
      scene: this,
      x: cx,
      y: y + 25,
      width: btnW,
      height: 50,
      text: 'New Puzzle',
      primary: true,
      fontSize: 18,
      onClick: () => this.handleNewPuzzleClick(),
    });
    this.rootContainer.add(newPuzzleBtn);
    y += 75;

    // 3. Current puzzle thumbnail / card (if present)
    if (this.currentSavedGame) {
      const cardContainer = this.createThumbnailCard(cx, y + 105, btnW, 200);
      this.rootContainer.add(cardContainer);
      y += 225;
    }

    // 4. Secondary actions: Enter Code, Best Times, Settings
    const subBtnW = (btnW - 16) / 3;
    const enterCodeBtn = new Button({
      scene: this,
      x: cx - subBtnW - 8,
      y: y + 20,
      width: subBtnW,
      height: 44,
      text: 'Enter Code',
      fontSize: 13,
      onClick: () => this.openEnterCodeModal(),
    });
    const bestTimesBtn = new Button({
      scene: this,
      x: cx,
      y: y + 20,
      width: subBtnW,
      height: 44,
      text: 'Best Times',
      fontSize: 13,
      onClick: () => this.openBestTimesModal(),
    });
    const settingsBtn = new Button({
      scene: this,
      x: cx + subBtnW + 8,
      y: y + 20,
      width: subBtnW,
      height: 44,
      text: 'Settings',
      fontSize: 13,
      onClick: () => this.openSettingsModal(),
    });

    this.rootContainer.add(enterCodeBtn);
    this.rootContainer.add(bestTimesBtn);
    this.rootContainer.add(settingsBtn);
  }

  /**
   * Builds two-column layout for landscape devices / tablets / desktop.
   */
  private buildLandscapeLayout(width: number, height: number): void {
    const leftX = this.currentSavedGame ? width * 0.32 : width / 2;
    const rightX = width * 0.68;
    const centerY = height * 0.48;

    // Left Column: Logo + New Puzzle + Actions
    let y = centerY - 140;

    const logoImg = this.add.image(leftX, y, 'logo');
    const logoScale = Math.min((width * 0.38) / logoImg.width, 180 / logoImg.height, 0.32);
    logoImg.setScale(logoScale);
    this.rootContainer.add(logoImg);
    y += logoImg.displayHeight / 2 + 35;

    const btnW = Math.min(width * 0.32, 340);
    const newPuzzleBtn = new Button({
      scene: this,
      x: leftX,
      y,
      width: btnW,
      height: 52,
      text: 'New Puzzle',
      primary: true,
      fontSize: 18,
      onClick: () => this.handleNewPuzzleClick(),
    });
    this.rootContainer.add(newPuzzleBtn);
    y += 65;

    const subBtnW = (btnW - 16) / 3;
    const enterCodeBtn = new Button({
      scene: this,
      x: leftX - subBtnW - 8,
      y,
      width: subBtnW,
      height: 44,
      text: 'Enter Code',
      fontSize: 13,
      onClick: () => this.openEnterCodeModal(),
    });
    const bestTimesBtn = new Button({
      scene: this,
      x: leftX,
      y,
      width: subBtnW,
      height: 44,
      text: 'Best Times',
      fontSize: 13,
      onClick: () => this.openBestTimesModal(),
    });
    const settingsBtn = new Button({
      scene: this,
      x: leftX + subBtnW + 8,
      y,
      width: subBtnW,
      height: 44,
      text: 'Settings',
      fontSize: 13,
      onClick: () => this.openSettingsModal(),
    });

    this.rootContainer.add(enterCodeBtn);
    this.rootContainer.add(bestTimesBtn);
    this.rootContainer.add(settingsBtn);

    // Right Column: Current Puzzle Card
    if (this.currentSavedGame) {
      const cardContainer = this.createThumbnailCard(rightX, centerY, Math.min(width * 0.36, 420), 300);
      this.rootContainer.add(cardContainer);
    }
  }

  /**
   * Creates the current puzzle card with thumbnail grid, stats, and action buttons.
   */
  private createThumbnailCard(cx: number, cy: number, cardW: number, cardH: number): Phaser.GameObjects.Container {
    const card = this.add.container(cx, cy);
    const saved = this.currentSavedGame!;
    const { puzzle } = saved;

    // Card background
    const bg = this.add.rectangle(0, 0, cardW, cardH, this.theme.surface);
    bg.setStrokeStyle(1.5, this.theme.border);
    card.add(bg);

    // Mini board thumbnail
    const thumbSize = Math.min(cardH * 0.65, cardW * 0.38, 140);
    const thumbX = -cardW / 2 + thumbSize / 2 + 16;
    const thumbY = -cardH / 2 + thumbSize / 2 + 18;
    const miniGrid = this.createMiniGrid(puzzle, saved, thumbSize);
    miniGrid.setPosition(thumbX, thumbY);
    card.add(miniGrid);

    // Hit area on thumbnail to resume
    const hitArea = this.add.rectangle(thumbX, thumbY, thumbSize, thumbSize, 0x000000, 0.001);
    hitArea.setInteractive({ useHandCursor: true });
    hitArea.on('pointerup', () => this.resumePuzzle());
    card.add(hitArea);

    // Info labels
    const infoX = thumbX + thumbSize / 2 + 16;
    let labelY = thumbY - thumbSize / 2 + 10;

    const titleText = this.add.text(infoX, labelY, `Size ${puzzle.size} · ${puzzle.tier.toUpperCase()}`, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      color: this.theme.textPrimary,
      fontStyle: 'bold',
    });
    card.add(titleText);
    labelY += 24;

    let statusString = 'In Progress';
    if (saved.status === 'won') {
      const minutes = Math.floor(saved.elapsedTimeMs / 60000);
      const seconds = Math.floor((saved.elapsedTimeMs % 60000) / 1000);
      const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      statusString = `Solved in ${timeStr}`;
    } else if (saved.status === 'lost') {
      statusString = 'Stumped';
    }

    const statusText = this.add.text(infoX, labelY, statusString, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      color: saved.status === 'won' ? this.theme.textAccent : this.theme.textSecondary,
    });
    card.add(statusText);
    labelY += 24;

    // Badges / qualification icons if won
    if (saved.status === 'won') {
      const badgeContainer = this.createWinBadges(saved, infoX, labelY);
      card.add(badgeContainer);
    } else {
      const resumeHint = this.add.text(infoX, labelY, 'Tap board to resume', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: this.theme.textSecondary,
        fontStyle: 'italic',
      });
      card.add(resumeHint);
    }

    // Share & Retry action buttons at bottom of card
    const btnRowY = cardH / 2 - 28;
    const btnW = (cardW - 48) / 2;

    const retryBtn = new Button({
      scene: this,
      x: -cardW / 2 + 16 + btnW / 2,
      y: btnRowY,
      width: btnW,
      height: 38,
      text: 'Retry',
      fontSize: 13,
      onClick: () => this.handleRetryClick(),
    });
    const shareBtn = new Button({
      scene: this,
      x: cardW / 2 - 16 - btnW / 2,
      y: btnRowY,
      width: btnW,
      height: 38,
      text: 'Share',
      fontSize: 13,
      onClick: () => this.handleShareClick(),
    });

    card.add(retryBtn);
    card.add(shareBtn);

    return card;
  }

  /**
   * Renders mini board graphics for thumbnail.
   */
  private createMiniGrid(puzzle: Puzzle, saved: SavedGameState, sizePx: number): Phaser.GameObjects.Container {
    const cont = this.add.container(0, 0);
    const { size, regions, colors } = puzzle;
    const cellSize = sizePx / size;

    const gfx = this.add.graphics();
    const half = sizePx / 2;

    // 1. Draw colored regions
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = r * size + c;
        const reg = regions[cell];
        const color = REGION_COLORS[colors[reg]];
        gfx.fillStyle(color, 1);
        gfx.fillRect(-half + c * cellSize, -half + r * cellSize, cellSize, cellSize);
      }
    }

    // 2. Draw region boundary lines
    gfx.lineStyle(1.5, this.theme.gridBorder, 1);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = r * size + c;
        const reg = regions[cell];
        const x = -half + c * cellSize;
        const y = -half + r * cellSize;

        if (r + 1 < size && regions[(r + 1) * size + c] !== reg) {
          gfx.beginPath();
          gfx.moveTo(x, y + cellSize);
          gfx.lineTo(x + cellSize, y + cellSize);
          gfx.strokePath();
        }
        if (c + 1 < size && regions[r * size + (c + 1)] !== reg) {
          gfx.beginPath();
          gfx.moveTo(x + cellSize, y);
          gfx.lineTo(x + cellSize, y + cellSize);
          gfx.strokePath();
        }
      }
    }
    // Outer border
    gfx.strokeRect(-half, -half, sizePx, sizePx);
    cont.add(gfx);

    // 3. Draw stumps and marks
    for (let i = 0; i < saved.normalMarks.length; i++) {
      const mark = saved.normalMarks[i];
      const r = Math.floor(i / size);
      const c = i % size;
      const x = -half + c * cellSize + cellSize / 2;
      const y = -half + r * cellSize + cellSize / 2;

      if (mark === MARK_STUMP) {
        const stump = this.add.image(x, y, 'stump');
        stump.setScale((cellSize * 0.7) / stump.width);
        cont.add(stump);
      } else if (mark === MARK_X) {
        const xMark = this.add.text(x, y, 'x', {
          fontFamily: 'sans-serif',
          fontSize: `${Math.round(cellSize * 0.6)}px`,
          color: '#251E17',
        }).setOrigin(0.5, 0.5);
        cont.add(xMark);
      } else if (mark === MARK_RED_X) {
        const redX = this.add.text(x, y, 'x', {
          fontFamily: 'sans-serif',
          fontSize: `${Math.round(cellSize * 0.7)}px`,
          color: '#C83232',
          fontStyle: 'bold',
        }).setOrigin(0.5, 0.5);
        cont.add(redX);
      }
    }

    return cont;
  }

  /**
   * Creates win qualification badges (clean star, hints, acorns).
   */
  private createWinBadges(saved: SavedGameState, startX: number, y: number): Phaser.GameObjects.Container {
    const cont = this.add.container(startX, y);
    let xOffset = 0;

    const acornsLost = saved.maxAcorns - saved.acorns;
    const isClean = !saved.hintsUsed.woodpecker && !saved.hintsUsed.owl && !saved.hintsUsed.squirrel
      && acornsLost === 0 && !saved.isRepeat;

    if (isClean) {
      const star = this.add.text(xOffset, 0, '★ Clean', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: '#D49B24',
        fontStyle: 'bold',
      });
      cont.add(star);
      xOffset += star.displayWidth + 8;
    }

    if (saved.puzzle.silver) {
      const silver = this.add.image(xOffset + 8, 6, 'silver_acorn');
      silver.setScale(16 / silver.height);
      cont.add(silver);
      xOffset += 20;
    }

    if (saved.isRepeat) {
      const repeat = this.add.text(xOffset, 0, '↺ Repeat', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '11px',
        color: this.theme.textSecondary,
      });
      cont.add(repeat);
    }

    return cont;
  }

  /**
   * Resumes the active puzzle in GameScene.
   */
  private resumePuzzle(): void {
    if (!this.currentSavedGame) {
      return;
    }
    this.scene.start('GameScene', {
      puzzle: this.currentSavedGame.puzzle,
      savedState: this.currentSavedGame,
    });
  }

  /**
   * Handles clicking "New Puzzle". Asks for confirmation if puzzle is in progress.
   */
  private handleNewPuzzleClick(): void {
    if (this.currentSavedGame?.status === 'playing') {
      this.openConfirmModal(
        'Abandon Puzzle?',
        'A puzzle is currently in progress. Abandon it and start a new one?',
        'Abandon & Start',
        () => this.startNewPuzzle(),
      );
      return;
    }
    this.startNewPuzzle();
  }

  /**
   * Generates and starts a brand new puzzle.
   */
  private startNewPuzzle(): void {
    getOrGeneratePuzzle(this.settings).then((puzzle) => {
      this.scene.start('GameScene', { puzzle });
    }).catch(() => {
      this.showToast('Failed to generate puzzle. Please retry.');
    });
  }

  /**
   * Retries the current puzzle from scratch.
   */
  private handleRetryClick(): void {
    if (!this.currentSavedGame) {
      return;
    }
    this.scene.start('GameScene', {
      puzzle: this.currentSavedGame.puzzle,
      isRetry: true,
    });
  }

  /**
   * Shares the puzzle seed code / link to clipboard.
   */
  private handleShareClick(): void {
    if (!this.currentSavedGame) {
      return;
    }
    const { code } = this.currentSavedGame.puzzle;
    const url = typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?code=${code}`
      : code;

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        this.showToast('Copied seed code to clipboard!');
      }).catch(() => {
        this.showToast(`Seed Code: ${code}`);
      });
    } else {
      this.showToast(`Seed Code: ${code}`);
    }
  }

  /**
   * Displays a temporary notification toast at bottom of screen.
   */
  private showToast(message: string): void {
    if (this.toastContainer) {
      this.toastContainer.destroy();
    }

    const { width, height } = this.scale;
    const cont = this.add.container(width / 2, height - 60);

    const txt = this.add.text(0, 0, message, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      color: '#FFFFFF',
    }).setOrigin(0.5, 0.5);

    const bg = this.add.rectangle(0, 0, txt.displayWidth + 32, 40, 0x1F261E, 0.95);
    bg.setStrokeStyle(1, 0x485846);

    cont.add(bg);
    cont.add(txt);
    this.add.existing(cont);
    this.toastContainer = cont;

    this.time.delayedCall(2500, () => {
      cont.destroy();
      this.toastContainer = undefined;
    });
  }

  /* ========================================================= *\
   *  Modals: Confirm, Enter Code, Best Times, Settings         *
  \* ========================================================= */

  private openConfirmModal(title: string, message: string, confirmLabel: string, onConfirm: () => void): void {
    this.closeModal();
    const { width, height } = this.scale;
    const modal = this.add.container(0, 0);

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, this.theme.modalOverlay, this.theme.modalOverlayAlpha);
    overlay.setInteractive();
    modal.add(overlay);

    const boxW = Math.min(width * 0.88, 380);
    const boxH = 200;
    const box = this.add.rectangle(width / 2, height / 2, boxW, boxH, this.theme.surface);
    box.setStrokeStyle(1.5, this.theme.border);
    modal.add(box);

    const t = this.add.text(width / 2, height / 2 - 60, title, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '18px',
      color: this.theme.textPrimary,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);
    modal.add(t);

    const m = this.add.text(width / 2, height / 2 - 20, message, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      color: this.theme.textSecondary,
      wordWrap: { width: boxW - 40 },
      align: 'center',
    }).setOrigin(0.5, 0.5);
    modal.add(m);

    const btnW = (boxW - 48) / 2;
    const cancelBtn = new Button({
      scene: this,
      x: width / 2 - btnW / 2 - 8,
      y: height / 2 + 50,
      width: btnW,
      height: 42,
      text: 'Cancel',
      fontSize: 14,
      onClick: () => this.closeModal(),
    });
    const confirmBtn = new Button({
      scene: this,
      x: width / 2 + btnW / 2 + 8,
      y: height / 2 + 50,
      width: btnW,
      height: 42,
      text: confirmLabel,
      primary: true,
      fontSize: 14,
      onClick: () => {
        this.closeModal();
        onConfirm();
      },
    });

    modal.add(cancelBtn);
    modal.add(confirmBtn);

    this.modalContainer = modal;
  }

  public openEnterCodeModal(): void {
    this.closeModal();
    const { width, height } = this.scale;
    const modal = this.add.container(0, 0);

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, this.theme.modalOverlay, this.theme.modalOverlayAlpha);
    overlay.setInteractive();
    modal.add(overlay);

    const boxW = Math.min(width * 0.88, 420);
    const boxH = 260;
    const box = this.add.rectangle(width / 2, height / 2, boxW, boxH, this.theme.surface);
    box.setStrokeStyle(1.5, this.theme.border);
    modal.add(box);

    const title = this.add.text(width / 2, height / 2 - 95, 'Enter Seed Code', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '18px',
      color: this.theme.textPrimary,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);
    modal.add(title);

    let enteredCode = '';
    const codeDisplay = this.add.text(width / 2, height / 2 - 40, 'Tap Paste or enter code below', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: this.theme.textSecondary,
    }).setOrigin(0.5, 0.5);
    modal.add(codeDisplay);

    const errorDisplay = this.add.text(width / 2, height / 2 - 12, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      color: '#C83232',
    }).setOrigin(0.5, 0.5);
    modal.add(errorDisplay);

    const pasteBtn = new Button({
      scene: this,
      x: width / 2,
      y: height / 2 + 25,
      width: boxW - 60,
      height: 40,
      text: 'Paste from Clipboard',
      fontSize: 14,
      onClick: () => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.readText().then((text) => {
            const trimmed = text.trim();
            enteredCode = trimmed;
            codeDisplay.setText(trimmed);
            codeDisplay.setColor(this.theme.textPrimary);
          }).catch(() => {
            const promptCode = window.prompt('Enter 11-character seed code:');
            if (promptCode) {
              enteredCode = promptCode.trim();
              codeDisplay.setText(enteredCode);
              codeDisplay.setColor(this.theme.textPrimary);
            }
          });
        } else {
          const promptCode = window.prompt('Enter 11-character seed code:');
          if (promptCode) {
            enteredCode = promptCode.trim();
            codeDisplay.setText(enteredCode);
            codeDisplay.setColor(this.theme.textPrimary);
          }
        }
      },
    });
    modal.add(pasteBtn);

    const btnW = (boxW - 60) / 2;
    const cancelBtn = new Button({
      scene: this,
      x: width / 2 - btnW / 2 - 6,
      y: height / 2 + 85,
      width: btnW,
      height: 42,
      text: 'Cancel',
      fontSize: 14,
      onClick: () => this.closeModal(),
    });

    const playBtn = new Button({
      scene: this,
      x: width / 2 + btnW / 2 + 6,
      y: height / 2 + 85,
      width: btnW,
      height: 42,
      text: 'Play Puzzle',
      primary: true,
      fontSize: 14,
      onClick: () => {
        if (!enteredCode) {
          errorDisplay.setText('Please enter or paste a seed code.');
          return;
        }
        const puzzle = generateFromCode(enteredCode);
        if (!puzzle) {
          errorDisplay.setText('Invalid seed code. Check for typos.');
          return;
        }
        this.closeModal();
        this.scene.start('GameScene', { puzzle });
      },
    });

    modal.add(cancelBtn);
    modal.add(playBtn);

    this.modalContainer = modal;
  }

  public openBestTimesModal(): void {
    this.closeModal();
    const { width, height } = this.scale;
    const modal = this.add.container(0, 0);

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, this.theme.modalOverlay, this.theme.modalOverlayAlpha);
    overlay.setInteractive();
    modal.add(overlay);

    const boxW = Math.min(width * 0.92, 520);
    const boxH = Math.min(height * 0.88, 560);
    const box = this.add.rectangle(width / 2, height / 2, boxW, boxH, this.theme.surface);
    box.setStrokeStyle(1.5, this.theme.border);
    modal.add(box);

    let selectedSize = 6;
    let selectedTier: Tier = 'medium';

    const title = this.add.text(width / 2, height / 2 - boxH / 2 + 25, 'Best Times', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '20px',
      color: this.theme.textPrimary,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);
    modal.add(title);

    // Size selector buttons
    const sizeTabsY = height / 2 - boxH / 2 + 60;
    const sizes = [5, 6, 7, 8, 9, 10];
    const sizeBtnW = Math.floor((boxW - 60) / sizes.length);
    sizes.forEach((sz, idx) => {
      const btn = new Button({
        scene: this,
        x: width / 2 - (boxW - 60) / 2 + idx * sizeBtnW + sizeBtnW / 2,
        y: sizeTabsY,
        width: sizeBtnW - 4,
        height: 28,
        text: String(sz),
        fontSize: 12,
        onClick: () => {
          selectedSize = sz;
          renderList();
        },
      });
      modal.add(btn);
    });

    // Tier selector buttons
    const tierTabsY = sizeTabsY + 34;
    const tiers: readonly Tier[] = ['easy', 'medium', 'hard'];
    const tierBtnW = Math.floor((boxW - 60) / tiers.length);
    tiers.forEach((t, idx) => {
      const btn = new Button({
        scene: this,
        x: width / 2 - (boxW - 60) / 2 + idx * tierBtnW + tierBtnW / 2,
        y: tierTabsY,
        width: tierBtnW - 6,
        height: 28,
        text: t.toUpperCase(),
        fontSize: 12,
        onClick: () => {
          selectedTier = t;
          renderList();
        },
      });
      modal.add(btn);
    });

    const listContainer = this.add.container(width / 2, height / 2 + 35);
    modal.add(listContainer);

    const renderList = (): void => {
      listContainer.removeAll(true);
      const records = getBestTimesFor(selectedSize, selectedTier);

      if (records.length === 0) {
        const empty = this.add.text(0, 0, `No completed puzzles yet for Size ${selectedSize} (${selectedTier}).`, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '14px',
          color: this.theme.textSecondary,
        }).setOrigin(0.5, 0.5);
        listContainer.add(empty);
        return;
      }

      const rowH = 34;
      const startY = -Math.min(records.length * rowH, 200) / 2 + 10;

      for (let i = 0; i < Math.min(records.length, 6); i++) {
        const r = records[i];
        const minutes = Math.floor(r.timeMs / 60000);
        const seconds = Math.floor((r.timeMs % 60000) / 1000);
        const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        const rowY = startY + i * rowH;

        const starPrefix = r.clean ? '★ ' : '  ';
        const rowText = this.add.text(-boxW / 2 + 40, rowY, `${starPrefix}${timeStr}`, {
          fontFamily: 'monospace',
          fontSize: '15px',
          color: r.clean ? '#D49B24' : this.theme.textPrimary,
          fontStyle: r.clean ? 'bold' : 'normal',
        });
        listContainer.add(rowText);

        let icons = '';
        if (r.hintsUsed.length > 0) icons += ` [${r.hintsUsed.length} hint${r.hintsUsed.length > 1 ? 's' : ''}]`;
        if (r.acornsLost > 0) icons += ` [-${r.acornsLost} acorn${r.acornsLost > 1 ? 's' : ''}]`;
        if (r.silver) icons += ' [Silver]';
        if (r.repeat) icons += ' [Repeat]';

        const detailText = this.add.text(0, rowY, icons, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '12px',
          color: this.theme.textSecondary,
        });
        listContainer.add(detailText);
      }
    };

    renderList();

    // Close button
    const closeBtn = new Button({
      scene: this,
      x: width / 2,
      y: height / 2 + boxH / 2 - 35,
      width: 140,
      height: 40,
      text: 'Close',
      primary: true,
      fontSize: 14,
      onClick: () => this.closeModal(),
    });
    modal.add(closeBtn);

    this.modalContainer = modal;
  }

  public openSettingsModal(): void {
    this.closeModal();
    const { width, height } = this.scale;
    const modal = this.add.container(0, 0);

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, this.theme.modalOverlay, this.theme.modalOverlayAlpha);
    overlay.setInteractive();
    modal.add(overlay);

    const boxW = Math.min(width * 0.92, 460);
    const boxH = Math.min(height * 0.88, 500);
    const box = this.add.rectangle(width / 2, height / 2, boxW, boxH, this.theme.surface);
    box.setStrokeStyle(1.5, this.theme.border);
    modal.add(box);

    const title = this.add.text(width / 2, height / 2 - boxH / 2 + 35, 'Settings', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '20px',
      color: this.theme.textPrimary,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);
    modal.add(title);

    let curTimer = this.settings.timerVisible;
    let curSilver = this.settings.silverAcorn;
    let curSize = this.settings.size;
    let curDifficulty = this.settings.difficulty;

    let y = height / 2 - boxH / 2 + 75;

    // Board Size Setting
    const sizeLabel = this.add.text(width / 2 - boxW / 2 + 35, y, 'Board Size', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      color: this.theme.textPrimary,
      fontStyle: '600',
    });
    modal.add(sizeLabel);

    const sizeOptions: (number | 'random')[] = ['random', 5, 6, 7, 8, 9, 10];
    const sizeBtn = new Button({
      scene: this,
      x: width / 2 + boxW / 2 - 75,
      y: y + 10,
      width: 90,
      height: 34,
      text: curSize === 'random' ? 'Random' : `${curSize}×${curSize}`,
      fontSize: 13,
      onClick: () => {
        const idx = sizeOptions.indexOf(curSize);
        curSize = sizeOptions[(idx + 1) % sizeOptions.length];
        sizeBtn.setText(curSize === 'random' ? 'Random' : `${curSize}×${curSize}`);
      },
    });
    modal.add(sizeBtn);
    y += 55;

    // Difficulty Setting
    const diffLabel = this.add.text(width / 2 - boxW / 2 + 35, y, 'Difficulty', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      color: this.theme.textPrimary,
      fontStyle: '600',
    });
    modal.add(diffLabel);

    const diffOptions: (Tier | 'random')[] = ['random', 'easy', 'medium', 'hard'];
    const diffBtn = new Button({
      scene: this,
      x: width / 2 + boxW / 2 - 75,
      y: y + 10,
      width: 90,
      height: 34,
      text: curDifficulty === 'random' ? 'Random' : curDifficulty.toUpperCase(),
      fontSize: 13,
      onClick: () => {
        const idx = diffOptions.indexOf(curDifficulty);
        curDifficulty = diffOptions[(idx + 1) % diffOptions.length];
        diffBtn.setText(curDifficulty === 'random' ? 'Random' : curDifficulty.toUpperCase());
      },
    });
    modal.add(diffBtn);
    y += 55;

    // Timer Setting
    const timerLabel = this.add.text(width / 2 - boxW / 2 + 35, y, 'In-Game Timer', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      color: this.theme.textPrimary,
      fontStyle: '600',
    });
    modal.add(timerLabel);

    const timerBtn = new Button({
      scene: this,
      x: width / 2 + boxW / 2 - 75,
      y: y + 10,
      width: 90,
      height: 34,
      text: curTimer ? 'Shown' : 'Hidden',
      fontSize: 13,
      onClick: () => {
        curTimer = !curTimer;
        timerBtn.setText(curTimer ? 'Shown' : 'Hidden');
      },
    });
    modal.add(timerBtn);
    y += 55;

    // Silver Acorn Mode Setting
    const silverLabel = this.add.text(width / 2 - boxW / 2 + 35, y, 'Silver Acorn Mode (1 life)', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      color: this.theme.textPrimary,
      fontStyle: '600',
    });
    modal.add(silverLabel);

    const silverBtn = new Button({
      scene: this,
      x: width / 2 + boxW / 2 - 75,
      y: y + 10,
      width: 90,
      height: 34,
      text: curSilver ? 'ON' : 'OFF',
      fontSize: 13,
      onClick: () => {
        curSilver = !curSilver;
        silverBtn.setText(curSilver ? 'ON' : 'OFF');
      },
    });
    modal.add(silverBtn);

    // Save & Close
    const saveBtn = new Button({
      scene: this,
      x: width / 2,
      y: height / 2 + boxH / 2 - 40,
      width: 160,
      height: 44,
      text: 'Save & Close',
      primary: true,
      fontSize: 14,
      onClick: () => {
        this.settings = {
          timerVisible: curTimer,
          silverAcorn: curSilver,
          size: curSize,
          difficulty: curDifficulty,
        };
        saveSettings(this.settings);
        prepareNextPuzzle(this.settings);
        this.closeModal();
      },
    });
    modal.add(saveBtn);

    this.modalContainer = modal;
  }

  private closeModal(): void {
    if (this.modalContainer) {
      this.modalContainer.destroy();
      this.modalContainer = undefined;
    }
  }

  private checkUrlModals(): void {
    if (typeof window === 'undefined' || !window.location) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const modalParam = params.get('modal');
    if (modalParam === 'settings') {
      this.openSettingsModal();
    } else if (modalParam === 'best-times') {
      this.openBestTimesModal();
    } else if (modalParam === 'enter-code') {
      this.openEnterCodeModal();
    }
  }
}
