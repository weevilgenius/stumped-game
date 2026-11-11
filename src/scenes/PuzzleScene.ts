import Phaser from 'phaser';
import type { Tier } from '../engine';
import { appController } from '../state/appController';
import type { GameSession } from '../state/gameSession';
import { formatDuration } from '../state/storage';
import type { HintKind } from '../state/types';
import { TEXTURE_KEYS } from '../ui/assets';
import { BoardView } from '../ui/boardView';
import { UiButton } from '../ui/button';
import { cellAtPoint, cellsAlongSegment } from '../ui/gridMath';
import { closeActiveModal, showToast } from '../ui/modals';
import { FONT_BODY, FONT_DISPLAY, textResolution, THEME } from '../ui/theme';

const TIER_LABELS: Record<Tier, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

/**
 * Interactive puzzle scene hosting the board, top status bar, Undo & Hypothesis controls,
 * Woodpecker / Owl / Squirrel hint buttons, Owl explanation step viewer, and win/loss banners.
 */
export class PuzzleScene extends Phaser.Scene {
  private session!: GameSession;
  private boardView!: BoardView;

  private bgGfx!: Phaser.GameObjects.Graphics;
  private chromeGfx!: Phaser.GameObjects.Graphics;
  private bannerGfx!: Phaser.GameObjects.Graphics;

  private backBtn!: UiButton;
  private stumpIcon!: Phaser.GameObjects.Image;
  private stumpCountText!: Phaser.GameObjects.Text;
  private puzzleTierText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private acornIcons: Phaser.GameObjects.Image[] = [];

  private undoBtn!: UiButton;
  private whatIfBtn!: UiButton;
  private discardHypBtn!: UiButton;
  private keepHypBtn!: UiButton;

  private revealHintBtn!: UiButton;
  private explainHintBtn!: UiButton;
  private eliminateHintBtn!: UiButton;

  // Owl explanation overlay panel
  private explainPanelGfx!: Phaser.GameObjects.Graphics;
  private explainOwlIcon!: Phaser.GameObjects.Image;
  private explainTitleText!: Phaser.GameObjects.Text;
  private explainBodyText!: Phaser.GameObjects.Text;
  private explainPrevBtn!: UiButton;
  private explainNextBtn!: UiButton;
  private explainDoneBtn!: UiButton;

  // Win / Loss end-of-puzzle banner
  private bannerContainer!: Phaser.GameObjects.Container;
  private bannerTitleText!: Phaser.GameObjects.Text;
  private bannerSubtitleText!: Phaser.GameObjects.Text;

  // Pointer & gesture tracking
  private isDraggingBoard = false;
  private activePointerId: number | null = null;
  private lastDragX = 0;
  private lastDragY = 0;
  private isBlockingInput = false;
  private isEndingPuzzle = false;

  // Timer tick state
  private lastTimerTickMs = 0;
  private isPageHidden = false;

  constructor() {
    super({ key: 'PuzzleScene' });
  }

  create(): void {
    closeActiveModal();
    const a11yRoot = document.getElementById('a11y-layer');
    if (a11yRoot) {
      a11yRoot.innerHTML = '';
    }
    const current = appController.getSession() ?? appController.startNewPuzzle();
    this.session = current;
    appController.setActiveScreen('puzzle');

    this.isDraggingBoard = false;
    this.activePointerId = null;
    this.isBlockingInput = false;
    this.isEndingPuzzle = false;
    this.lastTimerTickMs = performance.now();
    this.isPageHidden = document.hidden;

    this.bgGfx = this.add.graphics();
    this.chromeGfx = this.add.graphics();
    this.boardView = new BoardView(this);

    this.createHeaderObjects();
    this.createActionButtons();
    this.createExplanationPanel();
    this.createEndBanner();
    this.setupBoardInput();
    this.setupLifecycleListeners();

    this.refreshState();
    this.layout(this.scale.width, this.scale.height);
  }

  override update(): void {
    const now = performance.now();
    const dt = now - this.lastTimerTickMs;
    this.lastTimerTickMs = now;

    if (
      !this.isPageHidden
      && !this.isEndingPuzzle
      && this.session.getStatus() === 'in_progress'
      && dt > 0
      && dt < 2000
    ) {
      this.session.tick(dt);
      const settings = appController.getSettings();
      if (settings.showTimer) {
        this.timerText.setText(formatDuration(this.session.getElapsedMs()));
      }
    }
  }

  /**
   * Returns the active {@link BoardView} instance for coordinate lookups.
   */
  getBoardView(): BoardView {
    return this.boardView;
  }

  /**
   * Programmatically taps a cell on the board (used by tests and keyboard shortcuts).
   * @param cell cell index `0 .. size*size - 1`
   */
  tapCell(cell: number): void {
    if (this.isBlockingInput || this.isEndingPuzzle || this.session.getActiveExplanation()) {
      return;
    }
    const res = this.session.pointerDown(cell, performance.now());
    this.session.pointerUp();
    appController.persistSession();
    this.handleGestureResult(res);
  }

  /**
   * Programmatically double-taps a cell on the board (revealing in normal mode or
   * placing a tentative stump in hypothesis mode).
   * @param cell cell index `0 .. size*size - 1`
   */
  doubleTapCellDirect(cell: number): void {
    if (this.isBlockingInput || this.isEndingPuzzle || this.session.getActiveExplanation()) {
      return;
    }
    const now = performance.now();
    this.session.pointerDown(cell, now);
    this.session.pointerUp();
    const res = this.session.pointerDown(cell, now + 40);
    this.session.pointerUp();
    appController.persistSession();
    this.handleGestureResult(res);
  }

  private createHeaderObjects(): void {
    this.backBtn = new UiButton({
      scene: this,
      label: '‹ Menu',
      variant: 'secondary',
      ariaLabel: 'Back to main menu',
      testId: 'back-to-menu-btn',
      onClick: () => {
        if (this.isBlockingInput) {
          return;
        }
        appController.persistSession();
        this.scene.start('MainScene');
      },
    });

    const res = textResolution();
    this.stumpIcon = this.add.image(0, 0, TEXTURE_KEYS.STUMP).setOrigin(0.5);
    this.stumpCountText = this.add.text(0, 0, '0/0', {
      fontFamily: FONT_DISPLAY,
      fontSize: '18px',
      fontStyle: 'bold',
      color: THEME.TEXT_CREAM,
      resolution: res,
    }).setOrigin(0, 0.5);

    this.puzzleTierText = this.add.text(0, 0, '', {
      fontFamily: FONT_BODY,
      fontSize: '12px',
      fontStyle: '600',
      color: THEME.TEXT_MUTED,
      resolution: res,
    }).setOrigin(0.5, 0.5);

    this.timerText = this.add.text(0, 0, '0:00', {
      fontFamily: FONT_BODY,
      fontSize: '16px',
      fontStyle: 'bold',
      color: THEME.TEXT_GOLD,
      resolution: res,
    }).setOrigin(1, 0.5);

    this.acornIcons = [];
    const maxAcorns = this.session.getMaxAcorns();
    const acornKey = this.session.puzzle.silver ? TEXTURE_KEYS.SILVER_ACORN : TEXTURE_KEYS.ACORN;
    for (let i = 0; i < maxAcorns; i++) {
      const icon = this.add.image(0, 0, acornKey).setOrigin(0.5);
      this.acornIcons.push(icon);
    }
  }

  private createActionButtons(): void {
    this.undoBtn = new UiButton({
      scene: this,
      label: 'Undo',
      variant: 'secondary',
      testId: 'undo-btn',
      onClick: () => {
        if (this.isBlockingInput || this.isEndingPuzzle || this.session.getActiveExplanation()) {
          return;
        }
        const reverted = this.session.undo();
        if (reverted.length > 0) {
          appController.persistSession();
          this.refreshState();
        }
      },
    });

    this.whatIfBtn = new UiButton({
      scene: this,
      label: 'What if?',
      subLabel: 'Hypothesis',
      variant: 'secondary',
      testId: 'what-if-btn',
      onClick: () => {
        if (this.isBlockingInput || this.isEndingPuzzle || this.session.getActiveExplanation()) {
          return;
        }
        this.session.enterHypothesis();
        appController.persistSession();
        this.refreshState();
        this.layout(this.scale.width, this.scale.height);
      },
    });

    this.discardHypBtn = new UiButton({
      scene: this,
      label: 'Discard',
      variant: 'danger',
      testId: 'discard-hypothesis-btn',
      onClick: () => {
        if (this.isBlockingInput || this.isEndingPuzzle) {
          return;
        }
        this.session.discardHypothesis();
        appController.persistSession();
        this.refreshState();
        this.layout(this.scale.width, this.scale.height);
      },
    });

    this.keepHypBtn = new UiButton({
      scene: this,
      label: 'Keep',
      variant: 'gold',
      testId: 'keep-hypothesis-btn',
      onClick: () => {
        if (this.isBlockingInput || this.isEndingPuzzle) {
          return;
        }
        const res = this.session.keepHypothesis();
        appController.persistSession();
        this.refreshState();
        this.layout(this.scale.width, this.scale.height);

        if (res.pulsedCells.length > 0) {
          this.boardView.triggerUnitPulse(this.session, res.pulsedCells);
        }
      },
    });

    this.revealHintBtn = new UiButton({
      scene: this,
      label: 'Reveal',
      subLabel: '1 left',
      iconKey: TEXTURE_KEYS.WOODPECKER,
      iconLayout: 'vertical',
      variant: 'secondary',
      testId: 'hint-reveal-btn',
      onClick: () => {
        this.handleHintClick('reveal');
      },
    });

    this.explainHintBtn = new UiButton({
      scene: this,
      label: 'Explain',
      subLabel: '1 left',
      iconKey: TEXTURE_KEYS.OWL,
      iconLayout: 'vertical',
      variant: 'secondary',
      testId: 'hint-explain-btn',
      onClick: () => {
        this.handleHintClick('explain');
      },
    });

    this.eliminateHintBtn = new UiButton({
      scene: this,
      label: 'Eliminate',
      subLabel: '1 left',
      iconKey: TEXTURE_KEYS.SQUIRREL,
      iconLayout: 'vertical',
      variant: 'secondary',
      testId: 'hint-eliminate-btn',
      onClick: () => {
        this.handleHintClick('eliminate');
      },
    });
  }

  private createExplanationPanel(): void {
    const res = textResolution();
    this.explainPanelGfx = this.add.graphics().setDepth(30);
    this.explainOwlIcon = this.add.image(0, 0, TEXTURE_KEYS.OWL).setOrigin(0.5).setDepth(31);
    this.explainTitleText = this.add.text(0, 0, 'Owl Explanation', {
      fontFamily: FONT_DISPLAY,
      fontSize: '15px',
      fontStyle: 'bold',
      color: THEME.TEXT_GOLD,
      resolution: res,
    }).setDepth(31);

    this.explainBodyText = this.add.text(0, 0, '', {
      fontFamily: FONT_BODY,
      fontSize: '13px',
      color: THEME.TEXT_CREAM,
      wordWrap: { width: 260 },
      lineSpacing: 3,
      resolution: res,
    }).setDepth(31);

    this.explainPrevBtn = new UiButton({
      scene: this,
      label: '‹ Step',
      variant: 'secondary',
      testId: 'explain-prev-btn',
      onClick: () => {
        this.session.stepExplanation(-1);
        this.refreshState();
        this.layout(this.scale.width, this.scale.height);
      },
    }).setDepth(32);

    this.explainNextBtn = new UiButton({
      scene: this,
      label: 'Step ›',
      variant: 'secondary',
      testId: 'explain-next-btn',
      onClick: () => {
        this.session.stepExplanation(1);
        this.refreshState();
        this.layout(this.scale.width, this.scale.height);
      },
    }).setDepth(32);

    this.explainDoneBtn = new UiButton({
      scene: this,
      label: 'Apply & Done',
      variant: 'gold',
      testId: 'explain-done-btn',
      onClick: () => {
        const expBefore = this.session.getActiveExplanation();
        const forcedCell = expBefore?.type === 'deduction' && expBefore.step.type === 'forced'
          ? expBefore.step.place
          : undefined;
        const res = this.session.applyExplainHint();
        appController.persistSession();
        this.refreshState(forcedCell);
        this.layout(this.scale.width, this.scale.height);

        if (res.pulsedCells.length > 0) {
          this.boardView.triggerUnitPulse(this.session, res.pulsedCells);
        }
        if (res.won) {
          this.triggerEndOfPuzzle('won');
        }
      },
    }).setDepth(32);
  }

  private createEndBanner(): void {
    this.bannerGfx = this.add.graphics();
    this.bannerTitleText = this.add.text(0, 0, '', {
      fontFamily: FONT_DISPLAY,
      fontSize: '30px',
      fontStyle: 'bold',
      color: THEME.TEXT_CREAM,
      align: 'center',
    }).setOrigin(0.5);

    this.bannerSubtitleText = this.add.text(0, 0, '', {
      fontFamily: FONT_BODY,
      fontSize: '17px',
      fontStyle: 'bold',
      color: THEME.TEXT_GOLD,
      align: 'center',
    }).setOrigin(0.5);

    this.bannerContainer = this.add.container(0, 0, [
      this.bannerGfx,
      this.bannerTitleText,
      this.bannerSubtitleText,
    ]).setDepth(100).setVisible(false);
  }

  private setupBoardInput(): void {
    const canvas = this.sys.game.canvas;

    const toSceneCoords = (e: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width > 0 ? this.scale.width / rect.width : 1;
      const scaleY = rect.height > 0 ? this.scale.height / rect.height : 1;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' && e.button !== 0) {
        return;
      }
      if (this.isBlockingInput || this.isEndingPuzzle || this.session.getActiveExplanation()) {
        return;
      }
      const { x, y } = toSceneCoords(e);
      const cell = cellAtPoint(
        this.session.puzzle.size,
        this.boardView.getBoardX(),
        this.boardView.getBoardY(),
        this.boardView.getBoardPx(),
        x,
        y,
      );
      if (cell < 0) {
        return;
      }

      this.isDraggingBoard = true;
      this.activePointerId = e.pointerId;
      this.lastDragX = x;
      this.lastDragY = y;

      const res = this.session.pointerDown(cell, performance.now());
      appController.persistSession();
      this.handleGestureResult(res);
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (
        !this.isDraggingBoard
        || this.activePointerId !== e.pointerId
        || this.isBlockingInput
        || this.isEndingPuzzle
      ) {
        return;
      }

      const { x, y } = toSceneCoords(e);
      const cells = cellsAlongSegment(
        this.session.puzzle.size,
        this.boardView.getBoardX(),
        this.boardView.getBoardY(),
        this.boardView.getBoardPx(),
        this.lastDragX,
        this.lastDragY,
        x,
        y,
      );
      this.lastDragX = x;
      this.lastDragY = y;

      if (cells.length === 0) {
        return;
      }

      let anyChanged = false;
      const allPulsed: number[] = [];

      for (const cell of cells) {
        const res = this.session.pointerMove(cell);
        if (res.changedCells.length > 0) {
          anyChanged = true;
        }
        for (const p of res.pulsedCells) {
          if (!allPulsed.includes(p)) {
            allPulsed.push(p);
          }
        }
      }

      if (anyChanged) {
        appController.persistSession();
        this.refreshState();
      }
      if (allPulsed.length > 0) {
        this.boardView.triggerUnitPulse(this.session, allPulsed);
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (this.activePointerId !== null && e.pointerId === this.activePointerId) {
        this.isDraggingBoard = false;
        this.activePointerId = null;
        this.session.pointerUp();
        appController.persistSession();
        this.refreshState();
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    const cleanup = (): void => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    this.events.once('shutdown', cleanup);
    this.events.once('destroy', cleanup);
  }

  private handleGestureResult(res: ReturnType<GameSession['pointerDown']>): void {
    if (res.kind === 'noop') {
      return;
    }

    if (res.kind === 'tap-or-drag') {
      this.refreshState();
      if (res.pulsedCells.length > 0) {
        this.boardView.triggerUnitPulse(this.session, res.pulsedCells);
      }
      return;
    }

    if (res.kind === 'double-tap') {
      this.isDraggingBoard = false;
      this.activePointerId = null;

      if (!res.reveal) {
        // Hypothesis tentative stump placed
        this.refreshState();
        return;
      }

      const { reveal } = res;
      if (reveal.outcome === 'correct') {
        this.refreshState(reveal.cell);
        if (reveal.pulsedCells.length > 0) {
          this.boardView.triggerUnitPulse(this.session, reveal.pulsedCells);
        }
        if (reveal.won) {
          this.triggerEndOfPuzzle('won');
        }
        return;
      }

      if (reveal.outcome === 'wrong') {
        // Wrong-reveal animation is the one exception that blocks input until it finishes
        this.isBlockingInput = true;
        this.refreshState();
        this.boardView.playWrongReveal(this.session, reveal.cell, reveal.conflicts, () => {
          this.isBlockingInput = false;
          this.refreshState();
          if (reveal.lost) {
            this.triggerEndOfPuzzle('lost');
          }
        });
      }
    }
  }

  private setupLifecycleListeners(): void {
    const onResize = (gameSize: Phaser.Structs.Size): void => {
      this.layout(gameSize.width, gameSize.height);
    };
    const onVisibilityChange = (): void => {
      this.isPageHidden = document.hidden;
      this.lastTimerTickMs = performance.now();
      appController.persistSession();
    };
    const onBlur = (): void => {
      this.isPageHidden = true;
      appController.persistSession();
    };
    const onFocus = (): void => {
      this.isPageHidden = document.hidden;
      this.lastTimerTickMs = performance.now();
    };

    this.scale.on('resize', onResize);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    const cleanup = (): void => {
      this.scale.off('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };

    this.events.once('shutdown', cleanup);
    this.events.once('destroy', cleanup);
  }

  private handleHintClick(kind: HintKind): void {
    if (this.isBlockingInput || this.isEndingPuzzle || this.session.getActiveExplanation()) {
      return;
    }
    const hintsUsed = this.session.getHintsUsed();
    if (hintsUsed[kind]) {
      return;
    }

    if (kind === 'reveal') {
      const res = this.session.useRevealHint();
      if (!res) {
        showToast('All stumps are already revealed.');
        return;
      }
      appController.persistSession();
      this.refreshState(res.cell);
      if (res.pulsedCells.length > 0) {
        this.boardView.triggerUnitPulse(this.session, res.pulsedCells);
      }
      if (res.won) {
        this.triggerEndOfPuzzle('won');
      }
      return;
    }

    if (kind === 'explain') {
      const exp = this.session.startExplainHint();
      if (!exp) {
        showToast('No explanation needed right now.');
        return;
      }
      appController.persistSession();
      this.refreshState();
      this.layout(this.scale.width, this.scale.height);
      return;
    }

    if (kind === 'eliminate') {
      const res = this.session.useEliminateHint();
      if (!res) {
        showToast('No unmarked non-stump squares remain.');
        return;
      }
      appController.persistSession();
      this.refreshState();
      if (res.pulsedCells.length > 0) {
        this.boardView.triggerUnitPulse(this.session, res.pulsedCells);
      }
    }
  }

  private refreshState(newlyRevealedCell?: number): void {
    const { size, tier } = this.session.puzzle;
    const revealed = this.session.getRevealedStumpCount();
    this.stumpCountText.setText(`${revealed}/${size}`);
    this.puzzleTierText.setText(`${size}×${size} ${TIER_LABELS[tier]}`);

    const settings = appController.getSettings();
    this.timerText.setVisible(settings.showTimer);
    if (settings.showTimer) {
      this.timerText.setText(formatDuration(this.session.getElapsedMs()));
    }

    const remainingAcorns = this.session.getAcorns();
    this.acornIcons.forEach((icon, idx) => {
      const alive = idx < remainingAcorns;
      icon.setAlpha(alive ? 1 : 0.22);
      icon.setTint(alive ? 0xFFFFFF : 0x6E5D4F);
    });

    const inHyp = this.session.isHypothesisMode();
    const hasExplanation = this.session.getActiveExplanation() !== null;
    const canInteract = !this.isBlockingInput && !this.isEndingPuzzle && !hasExplanation;

    this.undoBtn.setEnabled(canInteract && this.session.canUndo());
    this.whatIfBtn.setVisible(!inHyp);
    this.whatIfBtn.setEnabled(canInteract);
    this.discardHypBtn.setVisible(inHyp);
    this.discardHypBtn.setEnabled(canInteract);
    this.keepHypBtn.setVisible(inHyp);
    this.keepHypBtn.setEnabled(canInteract);

    const hintsUsed = this.session.getHintsUsed();
    const updateHintBtn = (btn: UiButton, kind: HintKind): void => {
      const used = hintsUsed[kind];
      btn.setSubLabel(used ? 'Used' : '1 left');
      btn.setEnabled(canInteract && !used);
    };
    updateHintBtn(this.revealHintBtn, 'reveal');
    updateHintBtn(this.explainHintBtn, 'explain');
    updateHintBtn(this.eliminateHintBtn, 'eliminate');

    this.updateExplanationUI();
    this.boardView.render(this.session, newlyRevealedCell);
  }

  private updateExplanationUI(): void {
    const exp = this.session.getActiveExplanation();
    if (!exp) {
      this.explainPanelGfx.setVisible(false);
      this.explainOwlIcon.setVisible(false);
      this.explainTitleText.setVisible(false);
      this.explainBodyText.setVisible(false);
      this.explainPrevBtn.setVisible(false);
      this.explainNextBtn.setVisible(false);
      this.explainDoneBtn.setVisible(false);
      return;
    }

    this.explainPanelGfx.setVisible(true);
    this.explainOwlIcon.setVisible(true);
    this.explainTitleText.setVisible(true);
    this.explainBodyText.setVisible(true);
    this.explainDoneBtn.setVisible(true);

    if (exp.type === 'wrong-x') {
      this.explainTitleText.setText('Owl Spotted a Mistake');
      this.explainDoneBtn.setLabel('Remove X');
      this.explainPrevBtn.setVisible(false);
      this.explainNextBtn.setVisible(false);
    } else {
      const totalChain = exp.step.type === 'chain' ? exp.step.steps.length : 0;
      const isChain = totalChain > 0;
      this.explainTitleText.setText(
        isChain
          ? `Owl Explanation (${exp.chainIndex}/${totalChain})`
          : 'Owl Explanation',
      );
      this.explainDoneBtn.setLabel('Apply & Done');
      this.explainPrevBtn.setVisible(isChain).setEnabled(exp.chainIndex > 0);
      this.explainNextBtn.setVisible(isChain).setEnabled(exp.chainIndex < totalChain);
    }

    this.explainBodyText.setText(exp.text);
  }

  private triggerEndOfPuzzle(outcome: 'won' | 'lost'): void {
    if (this.isEndingPuzzle) {
      return;
    }
    this.isEndingPuzzle = true;
    this.isBlockingInput = true;
    appController.persistSession();
    this.refreshState();

    if (outcome === 'won') {
      this.bannerTitleText.setText('Solved!');
      this.bannerTitleText.setColor('#A6E07A');
      const perf = this.session.isPerfectlyMarked();
      const timeStr = formatDuration(this.session.getElapsedMs());
      this.bannerSubtitleText.setText(perf ? `Perfectly Marked • ${timeStr}` : `Completed in ${timeStr}`);
    } else {
      this.bannerTitleText.setText('Stumped.');
      this.bannerTitleText.setColor('#F28B82');
      this.bannerSubtitleText.setText('Out of acorns');
    }

    this.layoutEndBanner(this.scale.width, this.scale.height);
    this.bannerContainer.setVisible(true);
    this.bannerContainer.setAlpha(0);
    this.bannerContainer.setScale(0.88);

    this.tweens.add({
      targets: this.bannerContainer,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 260,
      ease: 'Back.easeOut',
    });

    this.time.delayedCall(1350, () => {
      if (this.scene.isActive()) {
        this.scene.start('MainScene');
      }
    });
  }

  private layoutEndBanner(width: number, height: number): void {
    const bw = Math.min(340, Math.round(width * 0.84));
    const bh = 112;
    this.bannerGfx.clear();
    this.bannerGfx.fillStyle(0x160E07, 0.94);
    this.bannerGfx.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 16);
    this.bannerGfx.lineStyle(3, THEME.GOLD_BTN_FILL, 1);
    this.bannerGfx.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, 16);

    this.bannerTitleText.setPosition(0, -16);
    this.bannerSubtitleText.setPosition(0, 22);
    this.bannerContainer.setPosition(width / 2, height / 2);
  }

  private layout(width: number, height: number): void {
    this.bgGfx.clear();
    this.chromeGfx.clear();

    this.bgGfx.fillGradientStyle(
      THEME.BG_WOOD_LIGHT,
      THEME.BG_WOOD_LIGHT,
      THEME.BG_WOOD_DARK,
      THEME.BG_WOOD_DARK,
      1,
    );
    this.bgGfx.fillRect(0, 0, width, height);

    const isLandscape = width >= height * 1.08;
    if (isLandscape) {
      this.layoutLandscape(width, height);
    } else {
      this.layoutPortrait(width, height);
    }

    if (this.bannerContainer.visible) {
      this.layoutEndBanner(width, height);
    }
  }

  private layoutPortrait(width: number, height: number): void {
    const padX = Math.max(10, Math.round(width * 0.035));
    const padY = Math.max(8, Math.round(height * 0.015));
    const topBarH = Math.min(48, Math.max(38, Math.round(height * 0.062)));

    this.layoutTopBar(padX, padY, width - padX * 2, topBarH);

    const controlsH = Math.min(156, Math.max(118, Math.round(height * 0.21)));
    const availBoardH = height - (padY + topBarH + 8) - controlsH - padY - 8;
    const availBoardW = width - padX * 2;
    const boardPx = Math.max(180, Math.floor(Math.min(availBoardW, availBoardH)));

    const boardX = Math.round((width - boardPx) / 2);
    const boardY = Math.round(padY + topBarH + 8 + Math.max(0, (availBoardH - boardPx) / 2));

    this.boardView.setLayout(this.session, boardX, boardY, boardPx);

    const controlsW = Math.min(500, Math.max(boardPx, width - padX * 2));
    const controlsX = Math.round((width - controlsW) / 2);
    const controlsY = boardY + boardPx + 10;
    const actualControlsH = Math.max(110, height - controlsY - padY);

    this.layoutControlsBlock(controlsX, controlsY, controlsW, actualControlsH, false);
  }

  private layoutLandscape(width: number, height: number): void {
    const padX = Math.max(12, Math.round(width * 0.025));
    const padY = Math.max(10, Math.round(height * 0.025));
    const availH = height - padY * 2;

    const sideW = Math.min(320, Math.max(220, Math.round(width * 0.34)));
    const gapX = Math.max(14, Math.round(width * 0.025));
    const availBoardW = width - padX * 2 - sideW - gapX;
    const boardPx = Math.max(180, Math.floor(Math.min(availBoardW, availH)));

    const totalW = boardPx + gapX + sideW;
    const startX = Math.round((width - totalW) / 2);
    const boardX = startX;
    const boardY = Math.round((height - boardPx) / 2);

    this.boardView.setLayout(this.session, boardX, boardY, boardPx);

    const sideX = boardX + boardPx + gapX;
    const topBarH = Math.min(78, Math.max(66, Math.round(availH * 0.22)));
    this.layoutTopBar(sideX, boardY, sideW, topBarH, true);

    const controlsY = boardY + topBarH + 10;
    const controlsH = Math.max(150, boardPx - topBarH - 10);
    this.layoutControlsBlock(sideX, controlsY, sideW, controlsH, true);
  }

  private layoutTopBar(x: number, y: number, w: number, h: number, twoRow = false): void {
    this.chromeGfx.fillStyle(THEME.TOP_BAR_BG, 0.95);
    this.chromeGfx.fillRoundedRect(x, y, w, h, 10);
    this.chromeGfx.lineStyle(1.5, THEME.PANEL_STROKE, 1);
    this.chromeGfx.strokeRoundedRect(x, y, w, h, 10);

    const settings = appController.getSettings();

    if (twoRow) {
      const row1Cy = y + h * 0.28;
      const row2Cy = y + h * 0.74;
      const backW = Math.min(78, Math.max(62, Math.round(w * 0.28)));
      const backH = Math.max(26, Math.round(h * 0.38));
      this.backBtn.setBounds(x + 8, Math.round(row1Cy - backH / 2), backW, backH, 13);

      this.puzzleTierText.setVisible(true);
      this.puzzleTierText.setPosition(x + w * 0.54, row1Cy);

      this.timerText.setFontSize(15);
      this.timerText.setPosition(x + w - 10, row1Cy);

      const stumpIconSize = Math.min(24, Math.round(h * 0.33));
      const stumpX = x + 12 + stumpIconSize / 2;
      this.stumpIcon.setDisplaySize(stumpIconSize, stumpIconSize);
      this.stumpIcon.setPosition(stumpX, row2Cy);

      this.stumpCountText.setFontSize(16);
      this.stumpCountText.setPosition(stumpX + stumpIconSize / 2 + 6, row2Cy);

      const acornSize = Math.min(22, Math.round(h * 0.31));
      const acornGap = 5;
      const totalAcornW = this.acornIcons.length * acornSize + Math.max(0, this.acornIcons.length - 1) * acornGap;
      const acornStartX = x + w - 10 - totalAcornW;
      this.acornIcons.forEach((icon, idx) => {
        icon.setDisplaySize(acornSize, acornSize);
        icon.setPosition(acornStartX + idx * (acornSize + acornGap) + acornSize / 2, row2Cy);
      });
      return;
    }

    const cy = y + h / 2;
    const backW = Math.min(82, Math.max(64, Math.round(w * 0.22)));
    const backH = Math.max(28, h - 10);
    this.backBtn.setBounds(x + 6, y + 5, backW, backH, 13);

    const stumpIconSize = Math.min(26, Math.round(h * 0.6));
    const stumpX = x + backW + 14 + stumpIconSize / 2;
    this.stumpIcon.setDisplaySize(stumpIconSize, stumpIconSize);
    this.stumpIcon.setPosition(stumpX, cy);

    this.stumpCountText.setFontSize(Math.min(18, Math.max(14, Math.round(h * 0.42))));
    this.stumpCountText.setPosition(stumpX + stumpIconSize / 2 + 5, cy);

    const acornSize = Math.min(24, Math.round(h * 0.56));
    const acornGap = 4;
    const totalAcornW = this.acornIcons.length * acornSize + Math.max(0, this.acornIcons.length - 1) * acornGap;
    const timerW = settings.showTimer ? 54 : 0;
    const rightAnchor = x + w - 10 - timerW;
    const acornStartX = rightAnchor - totalAcornW;

    this.acornIcons.forEach((icon, idx) => {
      icon.setDisplaySize(acornSize, acornSize);
      icon.setPosition(acornStartX + idx * (acornSize + acornGap) + acornSize / 2, cy);
    });

    const midLeft = this.stumpCountText.x + this.stumpCountText.width + 8;
    const midRight = acornStartX - 8;
    if (midRight - midLeft >= 78) {
      this.puzzleTierText.setVisible(true);
      this.puzzleTierText.setPosition((midLeft + midRight) / 2, cy);
    } else {
      this.puzzleTierText.setVisible(false);
    }

    this.timerText.setFontSize(Math.min(16, Math.max(13, Math.round(h * 0.38))));
    this.timerText.setPosition(x + w - 10, cy);
  }

  private layoutControlsBlock(
    x: number,
    y: number,
    w: number,
    h: number,
    isLandscapeSidebar: boolean,
  ): void {
    const gap = 8;
    const row1H = Math.min(48, Math.max(36, Math.round(h * (isLandscapeSidebar ? 0.24 : 0.34))));
    const inHyp = this.session.isHypothesisMode();

    if (inHyp) {
      this.chromeGfx.fillStyle(0x16383B, 0.9);
      this.chromeGfx.fillRoundedRect(x - 3, y - 3, w + 6, row1H + 6, 12);
      this.chromeGfx.lineStyle(1.5, 0x48B5B2, 1);
      this.chromeGfx.strokeRoundedRect(x - 3, y - 3, w + 6, row1H + 6, 12);

      const btnW = Math.floor((w - gap * 2) / 3);
      this.undoBtn.setBounds(x, y, btnW, row1H, 14);
      this.discardHypBtn.setBounds(x + btnW + gap, y, btnW, row1H, 14);
      this.keepHypBtn.setBounds(x + (btnW + gap) * 2, y, w - (btnW + gap) * 2, row1H, 14);
    } else {
      const halfW = Math.floor((w - gap) / 2);
      this.undoBtn.setBounds(x, y, halfW, row1H, 15);
      this.whatIfBtn.setBounds(x + halfW + gap, y, w - halfW - gap, row1H, 15);
    }

    const row2Y = y + row1H + gap;
    const row2H = Math.max(64, h - row1H - gap);

    const exp = this.session.getActiveExplanation();
    if (exp) {
      this.revealHintBtn.setVisible(false);
      this.explainHintBtn.setVisible(false);
      this.eliminateHintBtn.setVisible(false);
      this.layoutExplanationPanel(x, row2Y, w, row2H);
    } else {
      this.revealHintBtn.setVisible(true);
      this.explainHintBtn.setVisible(true);
      this.eliminateHintBtn.setVisible(true);

      const hintH = Math.min(92, row2H);
      const hintW = Math.floor((w - gap * 2) / 3);
      this.revealHintBtn.setBounds(x, row2Y, hintW, hintH);
      this.explainHintBtn.setBounds(x + hintW + gap, row2Y, hintW, hintH);
      this.eliminateHintBtn.setBounds(x + (hintW + gap) * 2, row2Y, w - (hintW + gap) * 2, hintH);
    }
  }

  private layoutExplanationPanel(x: number, y: number, w: number, h: number): void {
    const panelH = Math.max(96, h);
    this.explainPanelGfx.clear();
    this.explainPanelGfx.fillStyle(THEME.PANEL_BG, 0.98);
    this.explainPanelGfx.fillRoundedRect(x, y, w, panelH, 12);
    this.explainPanelGfx.lineStyle(2, THEME.GOLD_BTN_FILL, 1);
    this.explainPanelGfx.strokeRoundedRect(x, y, w, panelH, 12);

    const pad = 10;
    const iconSize = 32;
    this.explainOwlIcon.setDisplaySize(iconSize, iconSize);
    this.explainOwlIcon.setPosition(x + pad + iconSize / 2, y + pad + iconSize / 2);

    const textX = x + pad + iconSize + 8;
    const textW = Math.max(120, x + w - pad - textX);

    this.explainTitleText.setPosition(textX, y + 8);
    this.explainBodyText.setWordWrapWidth(textW);
    this.explainBodyText.setPosition(textX, y + 27);

    const btnH = 32;
    const btnY = y + panelH - pad - btnH;
    const exp = this.session.getActiveExplanation();
    const isChain = exp !== null && exp.type === 'deduction' && exp.step.type === 'chain' && exp.step.steps.length > 0;

    if (isChain) {
      const gap = 6;
      const stepW = Math.min(82, Math.floor((w - pad * 2 - gap * 2) * 0.28));
      const doneW = w - pad * 2 - (stepW + gap) * 2;
      this.explainPrevBtn.setBounds(x + pad, btnY, stepW, btnH, 12);
      this.explainNextBtn.setBounds(x + pad + stepW + gap, btnY, stepW, btnH, 12);
      this.explainDoneBtn.setBounds(x + pad + (stepW + gap) * 2, btnY, doneW, btnH, 13);
    } else {
      const doneW = Math.min(150, w - pad * 2);
      this.explainDoneBtn.setBounds(x + w - pad - doneW, btnY, doneW, btnH, 13);
    }
  }
}
