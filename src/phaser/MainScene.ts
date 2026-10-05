import Phaser from 'phaser';
import { MAX_SIZE, MIN_SIZE, TIERS } from '../engine';
import { CHROME } from '../game/palette';
import { bestTimes, formatTime, type HintName } from '../game/records';
import type { Session } from '../game/session';
import {
  cycleLevel, cycleSize, cycleTier, FREEBIE_LABELS, SHAPE_LABELS, SIZE_MIX_LABELS,
} from '../game/settings';
import { paintBoard } from './drawBoard';
import { controllerOf } from './controllerOf';
import {
  layoutMain, readInsets, type Box,
} from './layout';
import { addText, textButton, type UiButton } from './widgets';

/**
 * The main screen: a new puzzle, the current one, seed codes, best times, and settings.
 */
export class MainScene extends Phaser.Scene {
  private controller!: ReturnType<typeof controllerOf>;

  private unsubscribe = (): void => undefined;

  private trash: { destroy(): void }[] = [];

  private scroll = 0;

  private dragY: number | null = null;

  private dirty = false;

  private leaving = false;

  private noticeTimer: Phaser.Time.TimerEvent | null = null;

  private timesPage = 0;

  private position = (): void => undefined;

  constructor() {
    super('main');
  }

  create(): void {
    this.controller = controllerOf(this);
    this.scale.on('resize', this.markDirty, this);
    this.unsubscribe = this.controller.subscribe(this.markDirty);
    this.input.on('wheel', this.onWheel, this);
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.events.once('shutdown', () => {
      this.unsubscribe();
      this.scale.off('resize', this.markDirty, this);
      this.input.off('wheel', this.onWheel, this);
      this.input.off('pointerdown', this.onPointerDown, this);
      this.input.off('pointermove', this.onPointerMove, this);
      this.input.off('pointerup', this.onPointerUp, this);
      this.clear();
    });
    this.rebuild();
  }

  update(): void {
    if (this.controller.screen === 'puzzle') {
      if (!this.leaving) {
        this.leaving = true;
        this.scene.start('puzzle');
      }
      return;
    }
    if (this.dirty) {
      this.dirty = false;
      this.rebuild();
    }
  }

  private markDirty = (): void => {
    this.dirty = true;
  };

  private onWheel = (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void => {
    this.scroll += dy;
    this.position();
  };

  private onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    this.dragY = pointer.y;
  };

  private onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (!pointer.isDown || this.dragY === null || pointer.getDistance() < 8) {
      return;
    }
    this.scroll -= pointer.y - this.dragY;
    this.dragY = pointer.y;
    this.position();
  };

  private onPointerUp = (): void => {
    this.dragY = null;
  };

  private rebuild(): void {
    this.clear();
    const panel = this.controller.panel;
    if (panel === 'settings') {
      this.buildSettings();
    } else if (panel === 'times') {
      this.buildTimes();
    } else {
      this.buildMenu();
    }
    if (panel === 'confirm-new' || panel === 'confirm-retry') {
      this.buildConfirm(panel);
    }
    this.position();
    this.armNotice();
  }

  private buildMenu(): void {
    const controller = this.controller;
    const session = controller.session;
    const logo = this.track(this.add.image(0, 0, 'logo').setOrigin(0, 0));
    const source = this.textures.get('logo').getSourceImage() as { width: number; height: number };
    const aspect = source.height / Math.max(1, source.width);
    const newButton = this.track(textButton(this, controller.growing ? 'Growing…' : 'New puzzle', () => {
      void controller.requestNewPuzzle();
    }));
    newButton.setEnabled(!controller.growing);
    const seed = this.track(textButton(this, 'Enter a seed code', () => controller.showPanel('seed')));
    const times = this.track(textButton(this, 'Best times', () => controller.showPanel('times')));
    const settings = this.track(textButton(this, 'Settings', () => controller.showPanel('settings')));

    let share: UiButton | null = null;
    let retry: UiButton | null = null;
    let card: Phaser.GameObjects.Graphics | null = null;
    let board: Phaser.GameObjects.Graphics | null = null;
    let cardZone: Phaser.GameObjects.Zone | null = null;
    const lines: Phaser.GameObjects.Text[] = [];
    const icons: Phaser.GameObjects.Image[] = [];
    const star = this.track(this.add.graphics());
    let again: Phaser.GameObjects.Text | null = null;
    let acornCount: Phaser.GameObjects.Text | null = null;
    if (session) {
      card = this.track(this.add.graphics());
      board = this.track(this.add.graphics());
      share = this.track(textButton(this, 'Share', () => {
        void controller.share();
      }));
      retry = this.track(textButton(this, 'Retry', () => controller.requestRetry()));
      cardZone = this.track(this.add.zone(0, 0, 10, 10).setOrigin(0, 0));
      cardZone.setData('ui', true);
      if (session.status === 'playing') {
        cardZone.setInteractive({ useHandCursor: true });
        cardZone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
          if (pointer.getDistance() <= 16) {
            controller.resume();
          }
        });
      }
      const title = session.status === 'won'
        ? formatTime(session.elapsedMs)
        : session.status === 'lost' ? 'Stumped.' : 'In progress';
      lines.push(this.track(addText(this, title, 26)));
      if (session.status === 'playing') {
        lines.push(this.track(addText(this, formatTime(session.elapsedMs), 18, '#D9CDB4')));
      }
      lines.push(this.track(addText(this, session.puzzle.code, 16, '#D9CDB4')));
      if (session.status === 'won') {
        const notes = this.addOutcome(session, icons);
        again = notes.again;
        acornCount = notes.count;
      }
    }

    const notice = controller.notice ? this.track(addText(this, controller.notice, 18).setOrigin(0.5)) : null;

    this.position = () => {
      const placed = layoutMain(this.scale.width, this.scale.height, readInsets(), session !== null, aspect);
      const maxScroll = Math.max(0, placed.contentHeight - this.scale.height);
      this.scroll = Phaser.Math.Clamp(this.scroll, 0, maxScroll);
      const at = (box: Box): Box => ({ ...box, y: box.y - this.scroll });
      const logoBox = at(placed.logo);
      logo.setPosition(logoBox.x, logoBox.y);
      logo.setDisplaySize(logoBox.w, logoBox.h);
      newButton.layout(at(placed.newPuzzle));
      seed.layout(at(placed.seed));
      times.layout(at(placed.times));
      settings.layout(at(placed.settings));
      if (session && placed.card && card && board && cardZone && placed.share && placed.retry && share && retry) {
        const cardBox = at(placed.card);
        card.clear();
        card.fillStyle(CHROME.walnut, 1);
        card.fillRoundedRect(cardBox.x, cardBox.y, cardBox.w, cardBox.h, 16);
        const boardSize = Math.min(148, cardBox.h - 24);
        const frame = {
          x: cardBox.x + 12,
          y: cardBox.y + (cardBox.h - boardSize) / 2,
          size: boardSize,
        };
        paintBoard(board, {
          puzzle: session.puzzle,
          marks: session.marks,
          frame,
          hypoX: session.hypoX,
          hypoStump: session.hypoStump,
          stumpDisks: true,
        });
        cardZone.setPosition(cardBox.x, cardBox.y);
        cardZone.setSize(cardBox.w, cardBox.h);
        const textX = frame.x + boardSize + 16;
        let textY = cardBox.y + 18;
        lines.forEach((line, index) => {
          line.setPosition(textX, textY);
          textY += index === 0 ? 34 : 24;
        });
        let iconX = textX;
        const iconY = cardBox.y + cardBox.h - 28;
        star.clear();
        icons.forEach((icon) => {
          icon.setPosition(iconX + 13, iconY);
          icon.setDisplaySize(26, 26);
          iconX += 32;
        });
        if (acornCount) {
          acornCount.setPosition(iconX, iconY);
          iconX += acornCount.width + 8;
        }
        if (again) {
          again.setPosition(iconX, iconY);
          iconX += again.width + 8;
        }
        if (session.status === 'won' && isClean(session)) {
          drawStar(star, iconX + 12, iconY, 11);
        }
        share.layout(at(placed.share));
        retry.layout(at(placed.retry));
      }
      if (notice) {
        notice.setPosition(this.scale.width / 2, this.scale.height - readInsets().bottom - 28);
      }
    };
  }

  private buildSettings(): void {
    const controller = this.controller;
    const settings = controller.settings;
    const title = this.track(addText(this, 'Settings', 32).setOrigin(0.5, 0));
    const rows: { button: UiButton; label: () => string }[] = [
      { button: textButton(this, '', () => controller.updateSettings({ showTimer: !settings.showTimer })), label: () => `Timer: ${settings.showTimer ? 'Shown' : 'Hidden'}` },
      { button: textButton(this, '', () => controller.updateSettings({ size: cycleSize(settings.size) })), label: () => `Size: ${settings.size ?? 'Random'}` },
      { button: textButton(this, '', () => controller.updateSettings({ tier: cycleTier(settings.tier) })), label: () => `Difficulty: ${settings.tier ? labelOf(settings.tier) : 'Random'}` },
      { button: textButton(this, '', () => controller.updateSettings({ silver: !settings.silver })), label: () => `Silver acorn: ${settings.silver ? 'On' : 'Off'}` },
      { button: textButton(this, '', () => controller.updateSettings({ sizeMix: cycleLevel(settings.sizeMix) })), label: () => `Regions: ${settings.sizeMix === null ? 'Random' : SIZE_MIX_LABELS[settings.sizeMix]}` },
      { button: textButton(this, '', () => controller.updateSettings({ shape: cycleLevel(settings.shape) })), label: () => `Shapes: ${settings.shape === null ? 'Random' : SHAPE_LABELS[settings.shape]}` },
      { button: textButton(this, '', () => controller.updateSettings({ freebies: cycleLevel(settings.freebies) })), label: () => `Freebies: ${settings.freebies === null ? 'Random' : FREEBIE_LABELS[settings.freebies]}` },
    ];
    for (const row of rows) {
      this.track(row.button);
      row.button.setLabel(row.label());
    }
    const close = this.track(textButton(this, 'Close', () => controller.cancelPanel()));
    this.position = () => {
      const width = Math.min(460, this.scale.width - 28);
      const x = (this.scale.width - width) / 2;
      const insets = readInsets();
      const contentHeight = insets.top + 20 + 52 + rows.length * 62 + 52 + insets.bottom + 20;
      this.scroll = Phaser.Math.Clamp(this.scroll, 0, Math.max(0, contentHeight - this.scale.height));
      let y = insets.top + 20 - this.scroll;
      title.setPosition(this.scale.width / 2, y);
      y += 52;
      for (const row of rows) {
        row.button.layout({ x, y, w: width, h: 52 });
        y += 62;
      }
      close.layout({ x, y, w: width, h: 52 });
    };
  }

  private buildTimes(): void {
    const controller = this.controller;
    const title = this.track(addText(this, 'Best times', 32).setOrigin(0.5, 0));
    const sizeButton = this.track(textButton(this, `Size ${controller.timesSize}`, () => {
      controller.timesSize = controller.timesSize >= MAX_SIZE ? MIN_SIZE : controller.timesSize + 1;
      this.timesPage = 0;
      this.dirty = true;
    }));
    const tierButton = this.track(textButton(this, labelOf(controller.timesTier), () => {
      const index = TIERS.indexOf(controller.timesTier);
      controller.timesTier = TIERS[(index + 1) % TIERS.length] ?? 'easy';
      this.timesPage = 0;
      this.dirty = true;
    }));
    const listed = bestTimes(controller.records, controller.timesSize, controller.timesTier);
    const pageSize = 8;
    const pages = Math.max(1, Math.ceil(listed.length / pageSize));
    this.timesPage = Math.min(this.timesPage, pages - 1);
    const slice = listed.slice(this.timesPage * pageSize, (this.timesPage + 1) * pageSize);
    const rows = slice.map((record) => this.track(addText(this, formatRecord(record), 18)));
    const empty = slice.length === 0 ? this.track(addText(this, 'No times yet.', 20)) : null;
    const prev = this.track(textButton(this, 'Previous', () => {
      this.timesPage = Math.max(0, this.timesPage - 1);
      this.dirty = true;
    }));
    const next = this.track(textButton(this, 'Next', () => {
      this.timesPage = Math.min(pages - 1, this.timesPage + 1);
      this.dirty = true;
    }));
    prev.setEnabled(this.timesPage > 0);
    next.setEnabled(this.timesPage < pages - 1);
    const close = this.track(textButton(this, 'Close', () => controller.cancelPanel()));
    this.position = () => {
      const width = Math.min(460, this.scale.width - 28);
      const x = (this.scale.width - width) / 2;
      const insets = readInsets();
      const contentHeight = insets.top + 20 + 52 + 64 + rows.length * 32 + (empty ? 40 : 0) + 8 + 60 + 52 + insets.bottom + 20;
      this.scroll = Phaser.Math.Clamp(this.scroll, 0, Math.max(0, contentHeight - this.scale.height));
      let y = insets.top + 20 - this.scroll;
      title.setPosition(this.scale.width / 2, y);
      y += 52;
      const half = (width - 10) / 2;
      sizeButton.layout({ x, y, w: half, h: 48 });
      tierButton.layout({ x: x + half + 10, y, w: half, h: 48 });
      y += 64;
      if (empty) {
        empty.setPosition(x, y);
        y += 40;
      }
      for (const row of rows) {
        row.setPosition(x, y);
        y += 32;
      }
      y += 8;
      prev.layout({ x, y, w: half, h: 48 });
      next.layout({ x: x + half + 10, y, w: half, h: 48 });
      y += 60;
      close.layout({ x, y, w: width, h: 52 });
    };
  }

  private buildConfirm(panel: 'confirm-new' | 'confirm-retry'): void {
    const controller = this.controller;
    const scrim = this.track(this.add.rectangle(0, 0, 10, 10, CHROME.scrim, 0.72).setOrigin(0, 0).setDepth(20));
    const blocker = this.track(this.add.zone(0, 0, 10, 10).setOrigin(0, 0).setDepth(20));
    blocker.setInteractive();
    const card = this.track(this.add.graphics().setDepth(21));
    const message = panel === 'confirm-new'
      ? 'A puzzle is in progress. Start a new one?'
      : 'Start this puzzle over from a blank board?';
    const text = this.track(addText(this, message, 22).setAlign('center').setDepth(22));
    const cancel = this.track(textButton(this, panel === 'confirm-new' ? 'Keep playing' : 'Cancel', () => {
      controller.cancelPanel();
    }));
    const confirm = this.track(textButton(
      this,
      panel === 'confirm-new' ? 'New puzzle' : 'Retry',
      () => {
        if (panel === 'confirm-new') {
          void controller.confirmNewPuzzle();
        } else {
          controller.confirmRetry();
        }
      },
    ));
    cancel.setDepth(23);
    confirm.setDepth(23);
    const previous = this.position;
    this.position = () => {
      previous();
      scrim.setPosition(0, 0);
      scrim.setSize(this.scale.width, this.scale.height);
      blocker.setPosition(0, 0);
      blocker.setSize(this.scale.width, this.scale.height);
      const width = Math.min(420, this.scale.width - 36);
      const height = 210;
      const x = (this.scale.width - width) / 2;
      const y = (this.scale.height - height) / 2;
      card.clear();
      card.fillStyle(CHROME.ink, 1);
      card.fillRoundedRect(x, y, width, height, 16);
      text.setWordWrapWidth(width - 36);
      text.setPosition(x + 18, y + 24);
      const buttonW = (width - 36 - 10) / 2;
      cancel.layout({ x: x + 18, y: y + height - 68, w: buttonW, h: 48 });
      confirm.layout({ x: x + 18 + buttonW + 10, y: y + height - 68, w: buttonW, h: 48 });
    };
  }

  private addOutcome(
    session: Session, icons: Phaser.GameObjects.Image[],
  ): { again: Phaser.GameObjects.Text | null; count: Phaser.GameObjects.Text | null } {
    const push = (texture: string): void => {
      icons.push(this.track(this.add.image(0, 0, texture).setOrigin(0.5)));
    };
    if (session.hints.woodpecker) {
      push('woodpecker');
    }
    if (session.hints.owl) {
      push('owl');
    }
    if (session.hints.squirrel) {
      push('squirrel');
    }
    const lost = (session.puzzle.silver ? 1 : 3) - session.acornsLeft;
    if (lost > 0) {
      push(session.puzzle.silver ? 'silverAcorn' : 'acorn');
    } else if (session.puzzle.silver) {
      push('silverAcorn');
    }
    const count = lost > 0
      ? this.track(addText(this, String(lost), 16).setOrigin(0, 0.5))
      : null;
    const again = session.isRepeat
      ? this.track(addText(this, 'Again', 16).setOrigin(0, 0.5))
      : null;
    return { again, count };
  }

  private armNotice(): void {
    if (!this.controller.notice || this.noticeTimer) {
      return;
    }
    this.noticeTimer = this.time.delayedCall(1600, () => {
      this.controller.notice = null;
      this.noticeTimer = null;
      this.dirty = true;
    });
  }

  private clear(): void {
    for (const node of this.trash) {
      node.destroy();
    }
    this.trash = [];
    this.position = () => undefined;
  }

  private track<T extends { destroy(): void }>(node: T): T {
    this.trash.push(node);
    return node;
  }
}

/**
 * @param session a finished session
 * @returns true when the win qualifies as clean
 */
function isClean(session: Session): boolean {
  const lost = (session.puzzle.silver ? 1 : 3) - session.acornsLeft;
  return session.status === 'won' && !session.helped() && lost === 0 && !session.isRepeat;
}

/**
 * @param record one stored time
 * @returns a single line for the best-times list
 */
function formatRecord(record: { elapsedMs: number; clean: boolean; hints: readonly HintName[]; acornsLost: number; silver: boolean; repeat: boolean }): string {
  const marks = [
    record.clean ? 'Clean' : '',
    formatTime(record.elapsedMs),
    record.hints.join(' '),
    record.acornsLost > 0 ? `${record.acornsLost} acorn${record.acornsLost === 1 ? '' : 's'}` : '',
    record.silver ? 'silver' : '',
    record.repeat ? 'again' : '',
  ];
  return marks.filter((mark) => mark).join('  ');
}

/**
 * @param graphics the surface
 * @param x center x
 * @param y center y
 * @param radius outer radius
 */
function drawStar(graphics: Phaser.GameObjects.Graphics, x: number, y: number, radius: number): void {
  graphics.fillStyle(CHROME.gold, 1);
  graphics.beginPath();
  for (let point = 0; point < 10; point++) {
    const distance = point % 2 === 0 ? radius : radius * 0.45;
    const angle = -Math.PI / 2 + point * Math.PI / 5;
    const px = x + Math.cos(angle) * distance;
    const py = y + Math.sin(angle) * distance;
    if (point === 0) {
      graphics.moveTo(px, py);
    } else {
      graphics.lineTo(px, py);
    }
  }
  graphics.closePath();
  graphics.fillPath();
}

/**
 * @param tier a difficulty
 * @returns the tier with a capital first letter
 */
function labelOf(tier: string): string {
  return tier.slice(0, 1).toUpperCase() + tier.slice(1);
}
