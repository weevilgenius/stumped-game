import Phaser from 'phaser';
import { formatTime } from '../game/records';
import type { RevealResult, Session } from '../game/session';
import { CHROME } from '../game/palette';
import { BoardView } from './BoardView';
import { controllerOf } from './controllerOf';
import { layoutPuzzle, readInsets, type PuzzleChrome } from './layout';
import { addText, iconButton, textButton, type IconButton, type UiButton } from './widgets';

/**
 * The puzzle screen: the board, the acorns, the hints, undo, and hypothesis.
 */
export class PuzzleScene extends Phaser.Scene {
  private controller!: ReturnType<typeof controllerOf>;

  private session!: Session;

  private board!: BoardView;

  private back!: UiButton;

  private hints!: [IconButton, IconButton, IconButton];

  private undoButton!: UiButton;

  private suppose!: UiButton;

  private discard!: UiButton;

  private keep!: UiButton;

  private countText!: Phaser.GameObjects.Text;

  private timerText!: Phaser.GameObjects.Text;

  private acorns!: Phaser.GameObjects.Image[];

  private explainBg!: Phaser.GameObjects.Graphics;

  private explainText!: Phaser.GameObjects.Text;

  private explainPage!: Phaser.GameObjects.Text;

  private explainOk!: UiButton;

  private explainPrev!: UiButton;

  private explainNext!: UiButton;

  private banner!: Phaser.GameObjects.Text;

  private unsubscribe = (): void => undefined;

  private leaving = false;

  private dirty = false;

  private exitAt = 0;

  private chrome: PuzzleChrome = 'play';

  constructor() {
    super('puzzle');
  }

  create(): void {
    this.controller = controllerOf(this);
    const session = this.controller.session;
    if (!session) {
      this.scene.start('main');
      return;
    }
    this.session = session;
    this.leaving = false;
    this.exitAt = 0;
    this.board = new BoardView(this, session);
    this.board.onChange = () => {
      this.controller.persist();
    };
    this.board.onReveal = (result) => {
      this.afterReveal(result);
    };

    this.back = textButton(this, 'Back', () => this.controller.showMain());
    this.hints = [
      iconButton(this, 'woodpecker', () => this.useWoodpecker()),
      iconButton(this, 'owl', () => this.useOwl()),
      iconButton(this, 'squirrel', () => this.useSquirrel()),
    ];
    this.undoButton = textButton(this, 'Undo', () => {
      this.board.addPulses(this.session.undo());
      this.board.sync();
      this.controller.persist();
    });
    this.suppose = textButton(this, 'Suppose', () => {
      this.session.enterHypothesis();
      this.controller.persist();
    });
    this.discard = textButton(this, 'Discard', () => {
      this.session.discardHypothesis();
      this.board.sync();
      this.controller.persist();
    });
    this.keep = textButton(this, 'Keep', () => {
      this.board.addPulses(this.session.keepHypothesis());
      this.board.sync();
      this.controller.persist();
    });

    this.countText = addText(this, '', 22).setOrigin(0, 0.5);
    this.timerText = addText(this, '', 22).setOrigin(1, 0.5);
    this.acorns = [0, 1, 2].map(() => this.add.image(0, 0, 'acorn').setOrigin(0.5).setDepth(2));
    this.explainBg = this.add.graphics().setDepth(8);
    this.explainText = addText(this, '', 18).setDepth(9);
    this.explainPage = addText(this, '', 15).setOrigin(0.5, 0.5).setDepth(9);
    this.explainPrev = textButton(this, 'Back', () => {
      this.session.stepExplain(-1);
      this.refresh();
    });
    this.explainNext = textButton(this, 'Next', () => {
      this.session.stepExplain(1);
      this.refresh();
    });
    this.explainOk = textButton(this, 'OK', () => this.closeExplain());
    this.banner = addText(this, '', 32).setOrigin(0.5).setDepth(9).setAlign('center');
    this.banner.setShadow(0, 2, '#102017', 6, true, true);

    this.scale.on('resize', this.layout, this);
    this.unsubscribe = this.controller.subscribe(() => {
      this.dirty = true;
    });
    this.events.once('shutdown', () => {
      this.unsubscribe();
      this.scale.off('resize', this.layout, this);
      this.board.destroy();
      this.back.destroy();
      this.undoButton.destroy();
      this.suppose.destroy();
      this.discard.destroy();
      this.keep.destroy();
      this.explainOk.destroy();
      this.explainPrev.destroy();
      this.explainNext.destroy();
      for (const hint of this.hints) {
        hint.destroy();
      }
    });
    this.layout();
    if (session.status !== 'playing') {
      this.queueExit();
    }
  }

  /**
   * @param time scene time
   */
  update(time: number): void {
    if (!this.session) {
      return;
    }
    if (this.controller.screen !== 'puzzle') {
      this.leave('main');
      return;
    }
    if (this.controller.session !== this.session) {
      this.leave('puzzle');
      return;
    }
    this.board.update(time);
    if (this.controller.settings.showTimer && this.session.status === 'playing') {
      this.timerText.setText(formatTime(this.controller.elapsed()));
    }
    if (this.dirty) {
      this.dirty = false;
      this.refresh();
    }
    if (this.exitAt > 0 && time >= this.exitAt) {
      this.exitAt = 0;
      this.controller.showMain();
    }
  }

  private layout = (): void => {
    if (!this.session) {
      return;
    }
    const chrome: PuzzleChrome = this.session.explanation
      ? 'explain'
      : this.session.hypothesis ? 'hypothesis' : 'play';
    const placed = layoutPuzzle(this.scale.width, this.scale.height, readInsets(), chrome);
    this.board.layout({ x: placed.board.x, y: placed.board.y, size: placed.board.w });
    this.back.layout(placed.back);
    this.hints[0].layout(placed.hints[0]);
    this.hints[1].layout(placed.hints[1]);
    this.hints[2].layout(placed.hints[2]);
    this.undoButton.layout(placed.undo);
    this.suppose.layout(placed.hypothesis);
    this.discard.layout(placed.discard);
    this.keep.layout(placed.keep);
    this.countText.setPosition(placed.count.x, placed.count.y + placed.count.h / 2);
    this.timerText.setPosition(placed.timer.x + placed.timer.w, placed.timer.y + placed.timer.h / 2);

    const total = this.session.puzzle.silver ? 1 : 3;
    const icon = Math.min(34, placed.acorns.h);
    for (let index = 0; index < this.acorns.length; index++) {
      const image = this.acorns[index];
      if (!image) {
        continue;
      }
      image.setTexture(this.session.puzzle.silver ? 'silverAcorn' : 'acorn');
      image.setDisplaySize(icon, icon);
      const fromRight = total - 1 - index;
      image.setPosition(
        placed.acorns.x + placed.acorns.w - icon / 2 - Math.max(0, fromRight) * (icon + 4),
        placed.acorns.y + placed.acorns.h / 2,
      );
    }

    this.banner.setPosition(placed.board.x + placed.board.w / 2, placed.board.y + placed.board.h / 2);
    this.explainText.setWordWrapWidth(Math.max(40, placed.banner.w - 28));
    this.explainText.setPosition(placed.banner.x + 14, placed.banner.y + 14);
    const buttonY = placed.banner.y + placed.banner.h - 52;
    this.explainPrev.layout({ x: placed.banner.x + 12, y: buttonY, w: 84, h: 40 });
    this.explainNext.layout({ x: placed.banner.x + 104, y: buttonY, w: 84, h: 40 });
    this.explainOk.layout({ x: placed.banner.x + placed.banner.w - 98, y: buttonY, w: 86, h: 40 });
    this.explainPage.setPosition(placed.banner.x + placed.banner.w / 2, buttonY + 20);
    this.explainBg.clear();
    if (this.session.explanation) {
      this.explainBg.fillStyle(CHROME.ink, 0.96);
      this.explainBg.fillRoundedRect(placed.banner.x, placed.banner.y, placed.banner.w, placed.banner.h, 16);
    }
    this.refresh();
  };

  private refresh(): void {
    const session = this.session;
    const explaining = session.explanation !== null;
    const supposing = session.hypothesis;
    const chrome: PuzzleChrome = explaining ? 'explain' : supposing ? 'hypothesis' : 'play';
    if (chrome !== this.chrome) {
      this.chrome = chrome;
      this.layout();
      return;
    }
    this.countText.setText(`${session.revealedCount()}/${session.puzzle.size}`);
    this.timerText.setVisible(this.controller.settings.showTimer);
    this.timerText.setText(formatTime(this.controller.elapsed()));
    const total = session.puzzle.silver ? 1 : 3;
    this.acorns.forEach((image, index) => {
      image.setVisible(index < total);
      image.setAlpha(index < session.acornsLeft ? 1 : 0.28);
    });

    const playable = !explaining;
    for (const button of [this.back]) {
      button.setVisible(true);
    }
    this.hints[0].setVisible(playable);
    this.hints[1].setVisible(playable);
    this.hints[2].setVisible(playable);
    this.undoButton.setVisible(playable);
    this.suppose.setVisible(playable);
    this.discard.setVisible(playable && supposing);
    this.keep.setVisible(playable && supposing);
    this.hints[0].setUsed(session.hints.woodpecker);
    this.hints[1].setUsed(session.hints.owl);
    this.hints[2].setUsed(session.hints.squirrel);
    const hintsOn = session.hintsAvailable();
    this.hints[0].setEnabled(hintsOn && !session.hints.woodpecker);
    this.hints[1].setEnabled(hintsOn && !session.hints.owl);
    this.hints[2].setEnabled(hintsOn && !session.hints.squirrel);
    this.undoButton.setEnabled(session.canUndo());
    this.suppose.setSelected(supposing);
    this.suppose.setEnabled(session.status === 'playing' && !session.inputLocked && !explaining);
    const scratchOn = session.status === 'playing' && !session.inputLocked;
    this.discard.setEnabled(scratchOn);
    this.keep.setEnabled(scratchOn);

    const page = session.explainPage();
    const index = session.explainIndex();
    this.board.setHighlight(page?.cells ?? [], page?.focus ?? []);
    this.explainBg.setVisible(explaining);
    this.explainText.setVisible(explaining);
    this.explainText.setText(page?.text ?? '');
    this.explainPage.setVisible(explaining && (index?.total ?? 0) > 1);
    this.explainPage.setText(index ? `${index.page + 1} / ${index.total}` : '');
    this.explainPrev.setVisible(explaining && (index?.total ?? 0) > 1);
    this.explainNext.setVisible(explaining && (index?.total ?? 0) > 1);
    this.explainOk.setVisible(explaining);
    this.explainPrev.setEnabled((index?.page ?? 0) > 0);
    this.explainNext.setEnabled(index ? index.page < index.total - 1 : false);

    if (session.status === 'lost') {
      this.banner.setText('Stumped.');
    } else if (session.perfectlyMarked) {
      this.banner.setText('Perfectly Marked');
    } else {
      this.banner.setText('');
    }
  }

  private useWoodpecker(): void {
    const result = this.session.useWoodpecker();
    if (!result) {
      return;
    }
    this.board.addPulses(result.pulses);
    this.board.sync();
    this.controller.persist();
    this.afterReveal(result);
  }

  private useOwl(): void {
    if (!this.session.openOwl()) {
      return;
    }
    this.controller.persist();
    this.layout();
  }

  private useSquirrel(): void {
    const result = this.session.useSquirrel(() => Math.random());
    if (result.cells.length === 0) {
      return;
    }
    this.board.addPulses(result.pulses);
    this.board.sync();
    this.controller.persist();
  }

  private closeExplain(): void {
    const result = this.session.closeOwl();
    this.board.setHighlight([], []);
    if (result) {
      this.board.addPulses(result.pulses);
    }
    this.board.sync();
    this.controller.persist();
    this.layout();
    if (result) {
      this.afterReveal(result);
    }
  }

  private afterReveal(result: RevealResult): void {
    if (result.type === 'wrong' && result.lost) {
      this.banner.setText('Stumped.');
      this.queueExit();
      return;
    }
    if (result.won) {
      if (result.perfectlyMarked) {
        this.banner.setText('Perfectly Marked');
      }
      this.queueExit();
    }
  }

  private queueExit(): void {
    if (this.exitAt > 0) {
      return;
    }
    this.exitAt = this.time.now + (this.session.perfectlyMarked ? 1400 : 1000);
  }

  private leave(target: string): void {
    if (this.leaving) {
      return;
    }
    this.leaving = true;
    this.scene.start(target);
  }
}
