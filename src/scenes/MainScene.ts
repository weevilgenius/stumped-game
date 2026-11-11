import Phaser from 'phaser';
import type { Tier } from '../engine';
import { appController, extractSeedCode } from '../state/appController';
import { formatDuration, hasStorageError } from '../state/storage';
import { HINT_KINDS, type HintKind } from '../state/types';
import { TEXTURE_KEYS } from '../ui/assets';
import { createBoardThumbnail } from '../ui/boardView';
import { UiButton } from '../ui/button';
import {
  closeActiveModal,
  openBestTimesModal,
  openConfirmModal,
  openSettingsModal,
  showToast,
} from '../ui/modals';
import { drawRepeatIcon, drawStarIcon, FONT_BODY, FONT_DISPLAY, textResolution, THEME } from '../ui/theme';
import { puzzleService } from '../worker/puzzleService';

interface MainSceneInitData {
  readonly pendingSeedCode?: string;
}

const TIER_NAMES: Record<Tier, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

const HINT_TEXTURE: Record<HintKind, string> = {
  reveal: TEXTURE_KEYS.WOODPECKER,
  explain: TEXTURE_KEYS.OWL,
  eliminate: TEXTURE_KEYS.SQUIRREL,
};

let storageWarningShown = false;

/**
 * Main menu scene displaying the Stumped logo, current puzzle thumbnail and status,
 * Share & Retry buttons, New Puzzle button, Seed Code entry, Best Times, and Settings.
 */
export class MainScene extends Phaser.Scene {
  private bgGfx!: Phaser.GameObjects.Graphics;
  private cardGfx!: Phaser.GameObjects.Graphics;
  private badgeGfx!: Phaser.GameObjects.Graphics;
  private logoImg!: Phaser.GameObjects.Image;

  private thumbnailContainer: Phaser.GameObjects.Container | null = null;
  private qualIcons: Phaser.GameObjects.Image[] = [];
  private thumbResumeBtn: HTMLButtonElement | null = null;

  private cardTitleText!: Phaser.GameObjects.Text;
  private cardMetaText!: Phaser.GameObjects.Text;
  private cardStatusText!: Phaser.GameObjects.Text;
  private cardQualText!: Phaser.GameObjects.Text;
  private seedLabelText!: Phaser.GameObjects.Text;

  private resumeBtn: UiButton | null = null;
  private shareBtn: UiButton | null = null;
  private retryBtn: UiButton | null = null;
  private newPuzzleBtn!: UiButton;
  private playCodeBtn!: UiButton;
  private bestTimesBtn!: UiButton;
  private settingsBtn!: UiButton;

  private seedInputEl: HTMLInputElement | null = null;
  private pendingSeedCode: string | undefined;

  constructor() {
    super({ key: 'MainScene' });
  }

  init(data?: MainSceneInitData): void {
    this.pendingSeedCode = data?.pendingSeedCode;
  }

  create(): void {
    appController.setActiveScreen('main');
    closeActiveModal();
    const a11yRoot = document.getElementById('a11y-layer');
    if (a11yRoot) {
      a11yRoot.innerHTML = '';
    }

    this.bgGfx = this.add.graphics();
    this.cardGfx = this.add.graphics();
    this.badgeGfx = this.add.graphics();

    this.logoImg = this.add.image(0, 0, TEXTURE_KEYS.LOGO).setOrigin(0.5);

    const res = textResolution();

    this.cardTitleText = this.add.text(0, 0, '', {
      fontFamily: FONT_DISPLAY,
      fontSize: '18px',
      fontStyle: 'bold',
      color: THEME.TEXT_CREAM,
      resolution: res,
    });

    this.cardMetaText = this.add.text(0, 0, '', {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color: THEME.TEXT_MUTED,
      resolution: res,
    });

    this.cardStatusText = this.add.text(0, 0, '', {
      fontFamily: FONT_DISPLAY,
      fontSize: '16px',
      fontStyle: 'bold',
      color: THEME.TEXT_GOLD,
      resolution: res,
    });

    this.cardQualText = this.add.text(0, 0, '', {
      fontFamily: FONT_BODY,
      fontSize: '12px',
      fontStyle: '600',
      color: THEME.TEXT_CREAM,
      resolution: res,
    });

    this.seedLabelText = this.add.text(0, 0, 'Play by Seed Code', {
      fontFamily: FONT_BODY,
      fontSize: '12px',
      fontStyle: '600',
      color: THEME.TEXT_MUTED,
      resolution: res,
    });

    this.newPuzzleBtn = new UiButton({
      scene: this,
      label: 'New Puzzle',
      subLabel: this.formatSettingsSummary(),
      variant: 'primary',
      testId: 'new-puzzle-btn',
      onClick: () => {
        this.handleNewPuzzleClick();
      },
    });

    this.playCodeBtn = new UiButton({
      scene: this,
      label: 'Play Code',
      variant: 'gold',
      testId: 'play-code-btn',
      onClick: () => {
        const raw = this.seedInputEl?.value ?? '';
        this.handlePlaySeedCode(raw);
      },
    });

    this.bestTimesBtn = new UiButton({
      scene: this,
      label: 'Best Times',
      variant: 'secondary',
      testId: 'best-times-btn',
      onClick: () => {
        const session = appController.getSession();
        const settings = appController.getSettings();
        const initSize = session?.puzzle.size ?? (settings.size === 'random' ? 6 : settings.size);
        const initTier = session?.puzzle.tier ?? (settings.tier === 'random' ? 'medium' : settings.tier);
        openBestTimesModal(initSize, initTier, (code) => {
          this.handlePlaySeedCode(code);
        });
      },
    });

    this.settingsBtn = new UiButton({
      scene: this,
      label: 'Settings',
      variant: 'secondary',
      testId: 'settings-btn',
      onClick: () => {
        openSettingsModal(appController.getSettings(), (updated) => {
          appController.updateSettings(updated);
          this.newPuzzleBtn.setSubLabel(this.formatSettingsSummary());
          this.layout(this.scale.width, this.scale.height);
        });
      },
    });

    this.createSeedInputDom();
    this.buildCurrentPuzzleControls();

    const onResize = (gameSize: Phaser.Structs.Size): void => {
      this.layout(gameSize.width, gameSize.height);
    };
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => {
      this.scale.off('resize', onResize);
      this.cleanupDomElements();
    });
    this.events.once('destroy', () => {
      this.scale.off('resize', onResize);
      this.cleanupDomElements();
    });

    this.layout(this.scale.width, this.scale.height);

    if (hasStorageError() && !storageWarningShown) {
      storageWarningShown = true;
      showToast('Storage is restricted; progress is saved for this session only.');
    }

    if (this.pendingSeedCode) {
      const codeToPlay = this.pendingSeedCode;
      this.pendingSeedCode = undefined;
      this.handlePlaySeedCode(codeToPlay);
    }
  }

  private createSeedInputDom(): void {
    const a11yRoot = document.getElementById('a11y-layer');
    if (!a11yRoot) {
      return;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'seed-code-input';
    input.placeholder = 'Enter seed code...';
    input.setAttribute('aria-label', 'Seed code');
    input.setAttribute('data-testid', 'seed-code-input');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handlePlaySeedCode(input.value);
      }
    });

    a11yRoot.appendChild(input);
    this.seedInputEl = input;
  }

  private cleanupDomElements(): void {
    this.seedInputEl?.remove();
    this.seedInputEl = null;
    this.thumbResumeBtn?.remove();
    this.thumbResumeBtn = null;
  }

  private clearQualIcons(): void {
    for (const img of this.qualIcons) {
      img.destroy();
    }
    this.qualIcons = [];
  }

  private buildCurrentPuzzleControls(): void {
    this.resumeBtn?.destroy();
    this.shareBtn?.destroy();
    this.retryBtn?.destroy();
    this.resumeBtn = null;
    this.shareBtn = null;
    this.retryBtn = null;
    this.thumbResumeBtn?.remove();
    this.thumbResumeBtn = null;

    const session = appController.getSession();
    if (!session) {
      return;
    }

    const isPlaying = session.getStatus() === 'in_progress';

    if (isPlaying) {
      this.resumeBtn = new UiButton({
        scene: this,
        label: 'Continue',
        variant: 'gold',
        testId: 'continue-puzzle-btn',
        onClick: () => {
          this.scene.start('PuzzleScene');
        },
      });

      const a11yRoot = document.getElementById('a11y-layer');
      if (a11yRoot) {
        const thumbBtn = document.createElement('button');
        thumbBtn.type = 'button';
        thumbBtn.className = 'a11y-btn';
        thumbBtn.setAttribute('aria-label', 'Resume current puzzle');
        thumbBtn.setAttribute('data-testid', 'thumbnail-resume-btn');
        thumbBtn.addEventListener('click', () => {
          this.scene.start('PuzzleScene');
        });
        a11yRoot.appendChild(thumbBtn);
        this.thumbResumeBtn = thumbBtn;
      }
    }

    this.shareBtn = new UiButton({
      scene: this,
      label: 'Share',
      variant: 'secondary',
      testId: 'share-puzzle-btn',
      onClick: () => {
        void this.handleSharePuzzle();
      },
    });

    this.retryBtn = new UiButton({
      scene: this,
      label: 'Retry',
      variant: 'secondary',
      testId: 'retry-puzzle-btn',
      onClick: () => {
        this.handleRetryPuzzle();
      },
    });
  }

  private formatSettingsSummary(): string {
    const s = appController.getSettings();
    const sizePart = s.size === 'random' ? 'Random Size' : `${s.size}×${s.size}`;
    const diffPart = s.tier === 'random' ? 'Random Tier' : TIER_NAMES[s.tier];
    const silverPart = s.silver ? ' • Silver Acorn' : '';
    return `${sizePart} • ${diffPart}${silverPart}`;
  }

  private handleNewPuzzleClick(): void {
    if (appController.hasPuzzleInProgress()) {
      openConfirmModal({
        title: 'Start New Puzzle?',
        message: 'A puzzle is currently in progress. Starting a new puzzle will replace it.',
        confirmLabel: 'Start New Puzzle',
        onConfirm: () => {
          appController.startNewPuzzle();
          this.scene.start('PuzzleScene');
        },
      });
      return;
    }
    appController.startNewPuzzle();
    this.scene.start('PuzzleScene');
  }

  private handleRetryPuzzle(): void {
    const session = appController.getSession();
    if (!session) {
      return;
    }
    if (session.getStatus() === 'in_progress') {
      openConfirmModal({
        title: 'Retry Puzzle?',
        message: 'Restart this puzzle from the beginning? Your current marks will be cleared.',
        confirmLabel: 'Retry Puzzle',
        onConfirm: () => {
          appController.retryCurrentPuzzle();
          this.scene.start('PuzzleScene');
        },
      });
      return;
    }
    appController.retryCurrentPuzzle();
    this.scene.start('PuzzleScene');
  }

  private async handleSharePuzzle(): Promise<void> {
    const session = appController.getSession();
    if (!session) {
      return;
    }
    const code = session.puzzle.code;
    const shareUrl = `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast(`Copied share link (${code})!`);
    } catch {
      showToast(`Seed code: ${code}`);
    }
  }

  private handlePlaySeedCode(rawInput: string): void {
    const code = extractSeedCode(rawInput);
    if (!code) {
      showToast('Please enter a puzzle seed code.');
      return;
    }
    const decoded = puzzleService.fromSeedCodeSync(code);
    if (!decoded) {
      showToast('Invalid seed code. Please check the code and try again.');
      return;
    }

    if (appController.hasPuzzleInProgress()) {
      openConfirmModal({
        title: 'Play Seed Code?',
        message: `Replace your current puzzle in progress with seed ${code}?`,
        confirmLabel: 'Play Seed Code',
        onConfirm: () => {
          appController.startSeedPuzzle(code);
          this.scene.start('PuzzleScene');
        },
      });
      return;
    }

    appController.startSeedPuzzle(code);
    this.scene.start('PuzzleScene');
  }

  private layout(width: number, height: number): void {
    this.bgGfx.clear();
    this.cardGfx.clear();
    this.badgeGfx.clear();
    this.clearQualIcons();

    this.bgGfx.fillGradientStyle(
      THEME.BG_WOOD_LIGHT,
      THEME.BG_WOOD_LIGHT,
      THEME.BG_WOOD_DARK,
      THEME.BG_WOOD_DARK,
      1,
    );
    this.bgGfx.fillRect(0, 0, width, height);

    const isLandscape = width >= height * 1.12 && height < 720;
    const session = appController.getSession();

    if (isLandscape) {
      this.layoutLandscape(width, height, session !== null);
    } else {
      this.layoutPortrait(width, height, session !== null);
    }
  }

  private layoutPortrait(width: number, height: number, hasSession: boolean): void {
    const padX = Math.max(16, Math.round(width * 0.05));
    const colW = Math.min(460, width - padX * 2);
    const colX = Math.round((width - colW) / 2);

    const padY = Math.max(12, Math.round(height * 0.022));
    let cursorY = padY;

    // 1. Logo
    const maxLogoH = hasSession
      ? Math.min(130, Math.max(72, Math.round(height * 0.16)))
      : Math.min(180, Math.max(100, Math.round(height * 0.24)));
    this.positionLogo(colX + colW / 2, cursorY + maxLogoH / 2, colW, maxLogoH);
    cursorY += maxLogoH + Math.max(10, Math.round(height * 0.018));

    // 2. Current puzzle card (if any)
    if (hasSession) {
      const cardH = Math.min(205, Math.max(148, Math.round(height * 0.28)));
      this.renderCurrentPuzzleCard(colX, cursorY, colW, cardH);
      cursorY += cardH + Math.max(12, Math.round(height * 0.02));
    } else {
      this.hideCurrentPuzzleCard();
      cursorY += Math.round(height * 0.02);
    }

    // 3. New Puzzle button
    const newBtnH = Math.min(64, Math.max(50, Math.round(height * 0.085)));
    this.newPuzzleBtn.setBounds(colX, cursorY, colW, newBtnH);
    cursorY += newBtnH + Math.max(12, Math.round(height * 0.022));

    // 4. Seed code section
    const seedCardH = Math.min(82, Math.max(68, Math.round(height * 0.11)));
    this.renderSeedSection(colX, cursorY, colW, seedCardH);
    cursorY += seedCardH + Math.max(12, Math.round(height * 0.022));

    // 5. Best Times & Settings row
    const bottomBtnH = Math.min(50, Math.max(42, Math.round(height * 0.068)));
    const gap = 12;
    const halfW = Math.floor((colW - gap) / 2);
    this.bestTimesBtn.setBounds(colX, cursorY, halfW, bottomBtnH);
    this.settingsBtn.setBounds(colX + halfW + gap, cursorY, colW - halfW - gap, bottomBtnH);
  }

  private layoutLandscape(width: number, height: number, hasSession: boolean): void {
    const padX = Math.max(16, Math.round(width * 0.035));
    const padY = Math.max(10, Math.round(height * 0.035));
    const gapX = Math.max(16, Math.round(width * 0.03));
    const totalW = Math.min(920, width - padX * 2);
    const startX = Math.round((width - totalW) / 2);
    const colW = Math.floor((totalW - gapX) / 2);
    const leftX = startX;
    const rightX = startX + colW + gapX;

    const availH = height - padY * 2;

    if (hasSession) {
      const logoH = Math.min(92, Math.max(58, Math.round(availH * 0.25)));
      this.positionLogo(leftX + colW / 2, padY + logoH / 2, colW, logoH);
      const cardY = padY + logoH + 10;
      const cardH = Math.max(138, availH - logoH - 10);
      this.renderCurrentPuzzleCard(leftX, cardY, colW, cardH);
    } else {
      this.hideCurrentPuzzleCard();
      const logoH = Math.min(200, Math.round(availH * 0.65));
      this.positionLogo(leftX + colW / 2, padY + availH / 2, colW, logoH);
    }

    const gapY = Math.max(10, Math.round(availH * 0.04));
    const newBtnH = Math.min(62, Math.max(46, Math.round(availH * 0.22)));
    const seedCardH = Math.min(82, Math.max(64, Math.round(availH * 0.28)));
    const bottomBtnH = Math.min(48, Math.max(38, Math.round(availH * 0.17)));
    const rightContentH = newBtnH + seedCardH + bottomBtnH + gapY * 2;
    let rightY = padY + Math.max(0, Math.round((availH - rightContentH) / 2));

    this.newPuzzleBtn.setBounds(rightX, rightY, colW, newBtnH);
    rightY += newBtnH + gapY;

    this.renderSeedSection(rightX, rightY, colW, seedCardH);
    rightY += seedCardH + gapY;

    const btnGap = 10;
    const halfW = Math.floor((colW - btnGap) / 2);
    this.bestTimesBtn.setBounds(rightX, rightY, halfW, bottomBtnH);
    this.settingsBtn.setBounds(rightX + halfW + btnGap, rightY, colW - halfW - btnGap, bottomBtnH);
  }

  private positionLogo(cx: number, cy: number, maxW: number, maxH: number): void {
    const tex = this.textures.get(TEXTURE_KEYS.LOGO).getSourceImage() as { width: number; height: number };
    const ratio = (tex.width || 975) / (tex.height || 557);
    let drawH = maxH;
    let drawW = drawH * ratio;
    if (drawW > maxW) {
      drawW = maxW;
      drawH = drawW / ratio;
    }

    const framePad = 4;
    this.cardGfx.fillStyle(0x160E07, 0.55);
    this.cardGfx.fillRoundedRect(
      cx - drawW / 2 - framePad,
      cy - drawH / 2 - framePad + 3,
      drawW + framePad * 2,
      drawH + framePad * 2,
      12,
    );
    this.cardGfx.lineStyle(2, THEME.PANEL_STROKE, 1);
    this.cardGfx.strokeRoundedRect(
      cx - drawW / 2 - framePad,
      cy - drawH / 2 - framePad,
      drawW + framePad * 2,
      drawH + framePad * 2,
      12,
    );

    this.logoImg.setPosition(cx, cy);
    this.logoImg.setDisplaySize(drawW, drawH);
  }

  private hideCurrentPuzzleCard(): void {
    this.thumbnailContainer?.destroy(true);
    this.thumbnailContainer = null;
    this.clearQualIcons();
    this.cardTitleText.setVisible(false);
    this.cardMetaText.setVisible(false);
    this.cardStatusText.setVisible(false);
    this.cardQualText.setVisible(false);
    this.resumeBtn?.setVisible(false);
    this.shareBtn?.setVisible(false);
    this.retryBtn?.setVisible(false);
    if (this.thumbResumeBtn) {
      this.thumbResumeBtn.style.display = 'none';
    }
  }

  private renderCurrentPuzzleCard(x: number, y: number, w: number, h: number): void {
    const session = appController.getSession();
    if (!session) {
      this.hideCurrentPuzzleCard();
      return;
    }

    this.cardGfx.fillStyle(THEME.PANEL_BG, 0.96);
    this.cardGfx.fillRoundedRect(x, y, w, h, 14);
    this.cardGfx.lineStyle(2, THEME.PANEL_STROKE, 1);
    this.cardGfx.strokeRoundedRect(x, y, w, h, 14);

    const pad = Math.min(14, Math.max(10, Math.round(h * 0.08)));
    const thumbSize = Math.min(h - pad * 2, Math.round(w * 0.36), 152);
    const thumbX = x + pad;
    const thumbY = Math.round(y + (h - thumbSize) / 2);

    this.thumbnailContainer?.destroy(true);
    this.thumbnailContainer = createBoardThumbnail(this, {
      puzzle: session.puzzle,
      normalMarks: session.getNormalMarks(),
      x: thumbX,
      y: thumbY,
      sizePx: thumbSize,
    });

    if (this.thumbResumeBtn) {
      if (session.getStatus() === 'in_progress') {
        this.thumbResumeBtn.style.display = 'block';
        this.thumbResumeBtn.style.left = `${thumbX}px`;
        this.thumbResumeBtn.style.top = `${thumbY}px`;
        this.thumbResumeBtn.style.width = `${thumbSize}px`;
        this.thumbResumeBtn.style.height = `${thumbSize}px`;
      } else {
        this.thumbResumeBtn.style.display = 'none';
      }
    }

    const infoX = thumbX + thumbSize + pad;
    const infoW = Math.max(120, x + w - pad - infoX);

    const status = session.getStatus();
    const tierName = TIER_NAMES[session.puzzle.tier];
    const sizeStr = `${session.puzzle.size}×${session.puzzle.size}`;

    this.cardTitleText.setVisible(true);
    this.cardTitleText.setText(`${sizeStr} • ${tierName}`);
    this.cardTitleText.setFontSize(Math.min(16, Math.max(13, Math.round(h * 0.095))));
    this.cardTitleText.setPosition(infoX, y + pad);

    this.cardMetaText.setVisible(true);
    this.cardMetaText.setText(`Code: ${session.puzzle.code}`);
    this.cardMetaText.setFontSize(Math.min(12, Math.max(10, Math.round(h * 0.072))));
    this.cardMetaText.setPosition(infoX, this.cardTitleText.y + this.cardTitleText.height + 2);

    const statusY = this.cardMetaText.y + this.cardMetaText.height + 5;
    this.cardStatusText.setVisible(true);
    this.cardStatusText.setFontSize(Math.min(14, Math.max(12, Math.round(h * 0.082))));
    this.cardStatusText.setWordWrapWidth(infoW);

    let badgeOffsetX = infoX;
    const isRepeat = session.isRepeat();

    if (status === 'won') {
      const solveRecord = session.toSolveRecord();
      const timeStr = formatDuration(session.getElapsedMs());
      const perfStr = session.isPerfectlyMarked() ? ' • Perfectly Marked' : '';
      this.cardStatusText.setColor('#A6E07A');
      this.cardStatusText.setText(`Solved in ${timeStr}${perfStr}`);
      this.cardStatusText.setPosition(infoX, statusY);

      const qualY = this.cardStatusText.y + this.cardStatusText.height + 5;
      const iconSize = 18;

      if (solveRecord.clean) {
        drawStarIcon(this.badgeGfx, badgeOffsetX + 9, qualY + 9, 8.5);
        badgeOffsetX += 22;
      }
      if (solveRecord.silver) {
        const img = this.add.image(badgeOffsetX + iconSize / 2, qualY + 9, TEXTURE_KEYS.SILVER_ACORN);
        img.setDisplaySize(iconSize, iconSize);
        this.qualIcons.push(img);
        badgeOffsetX += iconSize + 5;
      }
      for (const hKind of HINT_KINDS) {
        if (solveRecord.hintsUsed.includes(hKind)) {
          const img = this.add.image(badgeOffsetX + iconSize / 2, qualY + 9, HINT_TEXTURE[hKind]);
          img.setDisplaySize(iconSize, iconSize);
          this.qualIcons.push(img);
          badgeOffsetX += iconSize + 5;
        }
      }
      if (solveRecord.acornsLost > 0) {
        const img = this.add.image(badgeOffsetX + iconSize / 2, qualY + 9, TEXTURE_KEYS.ACORN);
        img.setDisplaySize(iconSize, iconSize);
        this.qualIcons.push(img);
        badgeOffsetX += iconSize + 3;
      }
      if (isRepeat) {
        drawRepeatIcon(this.badgeGfx, badgeOffsetX + 9, qualY + 9, 7.5, 0xDCCB9E);
        badgeOffsetX += 22;
      }

      const qualLabels: string[] = [];
      if (solveRecord.acornsLost > 0) {
        qualLabels.push(`-${solveRecord.acornsLost}`);
      }
      if (solveRecord.clean) {
        qualLabels.push('Clean Solve');
      } else if (isRepeat) {
        qualLabels.push('Repeat Play');
      }
      this.cardQualText.setVisible(qualLabels.length > 0);
      this.cardQualText.setText(qualLabels.join(' • '));
      this.cardQualText.setPosition(badgeOffsetX, qualY + 1);
    } else if (status === 'lost') {
      this.cardStatusText.setColor('#F28B82');
      this.cardStatusText.setText('Stumped.');
      this.cardStatusText.setPosition(infoX, statusY);

      const qualY = this.cardStatusText.y + this.cardStatusText.height + 5;
      if (isRepeat) {
        drawRepeatIcon(this.badgeGfx, badgeOffsetX + 8, qualY + 8, 7, 0xDCCB9E);
        badgeOffsetX += 20;
        this.cardQualText.setVisible(true);
        this.cardQualText.setText('Repeat Play');
        this.cardQualText.setPosition(badgeOffsetX, qualY);
      } else {
        this.cardQualText.setVisible(false);
      }
    } else {
      const settings = appController.getSettings();
      const timePart = settings.showTimer ? ` • ${formatDuration(session.getElapsedMs())}` : '';
      this.cardStatusText.setColor(THEME.TEXT_GOLD);
      this.cardStatusText.setText(`In Progress (${session.getRevealedStumpCount()}/${session.puzzle.size})${timePart}`);
      this.cardStatusText.setPosition(infoX, statusY);

      const qualY = this.cardStatusText.y + this.cardStatusText.height + 5;
      if (isRepeat) {
        drawRepeatIcon(this.badgeGfx, badgeOffsetX + 8, qualY + 8, 7, 0xDCCB9E);
        badgeOffsetX += 20;
        this.cardQualText.setVisible(true);
        this.cardQualText.setText('Repeat Play');
        this.cardQualText.setPosition(badgeOffsetX, qualY);
      } else {
        this.cardQualText.setVisible(false);
      }
    }

    const btnH = Math.min(38, Math.max(30, Math.round(h * 0.22)));
    const btnY = y + h - pad - btnH;
    const btnGap = 8;

    if (status === 'in_progress' && this.resumeBtn) {
      this.resumeBtn.setVisible(true);
      const count = 3;
      const eachW = Math.floor((infoW - btnGap * (count - 1)) / count);
      this.resumeBtn.setBounds(infoX, btnY, eachW, btnH, 13);
      this.shareBtn?.setVisible(true).setBounds(infoX + eachW + btnGap, btnY, eachW, btnH, 13);
      this.retryBtn?.setVisible(true).setBounds(
        infoX + (eachW + btnGap) * 2,
        btnY,
        infoW - (eachW + btnGap) * 2,
        btnH,
        13,
      );
    } else {
      this.resumeBtn?.setVisible(false);
      const eachW = Math.floor((infoW - btnGap) / 2);
      this.shareBtn?.setVisible(true).setBounds(infoX, btnY, eachW, btnH, 13);
      this.retryBtn?.setVisible(true).setBounds(infoX + eachW + btnGap, btnY, infoW - eachW - btnGap, btnH, 13);
    }
  }

  private renderSeedSection(x: number, y: number, w: number, h: number): void {
    this.cardGfx.fillStyle(THEME.PANEL_BG, 0.9);
    this.cardGfx.fillRoundedRect(x, y, w, h, 12);
    this.cardGfx.lineStyle(1.5, THEME.PANEL_STROKE, 1);
    this.cardGfx.strokeRoundedRect(x, y, w, h, 12);

    const padX = 12;
    this.seedLabelText.setPosition(x + padX, y + 7);

    const rowY = y + 26;
    const rowH = Math.max(34, h - 34);
    const btnW = Math.min(118, Math.max(94, Math.round(w * 0.28)));
    const gap = 8;
    const inputW = w - padX * 2 - btnW - gap;

    if (this.seedInputEl) {
      this.seedInputEl.style.left = `${x + padX}px`;
      this.seedInputEl.style.top = `${rowY}px`;
      this.seedInputEl.style.width = `${inputW}px`;
      this.seedInputEl.style.height = `${rowH}px`;
      this.seedInputEl.style.display = 'block';
    }

    this.playCodeBtn.setBounds(x + padX + inputW + gap, rowY, btnW, rowH, 14);
  }
}
