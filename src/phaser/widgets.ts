import type Phaser from 'phaser';
import { CHROME } from '../game/palette';
import type { Box } from './layout';

/** Font stack that stays available offline. */
export const FONT = 'Georgia, "Iowan Old Style", Palatino, "Palatino Linotype", serif';

/** A control the scenes can move and restyle without rebuilding it. */
export interface UiButton {
  /**
   * Moves the button into a box.
   * @param box the box
   */
  layout(box: Box): void;
  /**
   * @param text the label
   */
  setLabel(text: string): void;
  /**
   * @param on whether the button accepts presses
   */
  setEnabled(on: boolean): void;
  /**
   * @param on whether the button is the active mode
   */
  setSelected(on: boolean): void;
  /**
   * @param on whether the button is shown
   */
  setVisible(on: boolean): void;
  /**
   * @param depth display depth
   */
  setDepth(depth: number): void;
  /** Removes the button. */
  destroy(): void;
}

/**
 * Creates a text object in the woodland type.
 * @param scene the scene
 * @param content the text
 * @param size font size in pixels
 * @param color CSS color
 * @returns the text, origin at the top left
 */
export function addText(
  scene: Phaser.Scene, content: string, size: number, color = '#F4EBD4',
): Phaser.GameObjects.Text {
  return scene.add.text(0, 0, content, {
    fontFamily: FONT,
    fontSize: `${size}px`,
    color,
    resolution: Math.min(2, window.devicePixelRatio || 1),
  });
}

/**
 * A rounded walnut button. Presses that were really scrolls are ignored.
 * @param scene the scene
 * @param label the label
 * @param onClick called on a completed press
 * @returns the button
 */
export function textButton(scene: Phaser.Scene, label: string, onClick: () => void): UiButton {
  const graphics = scene.add.graphics();
  const text = addText(scene, label, 20).setOrigin(0.5);
  const zone = scene.add.zone(0, 0, 10, 10).setOrigin(0.5);
  zone.setData('ui', true);
  let enabled = true;
  let selected = false;
  let box: Box = { x: 0, y: 0, w: 10, h: 10 };

  const draw = (): void => {
    graphics.clear();
    if (!zone.visible) {
      return;
    }
    graphics.fillStyle(selected ? CHROME.gold : CHROME.walnut, enabled ? 1 : 0.4);
    const radius = Math.min(14, box.h / 2);
    graphics.fillRoundedRect(box.x, box.y, box.w, box.h, radius);
  };

  const arm = (): void => {
    if (enabled && zone.visible) {
      zone.setInteractive({ useHandCursor: true });
    } else {
      zone.disableInteractive();
    }
  };

  zone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    if (!enabled || pointer.getDistance() > 16) {
      return;
    }
    onClick();
  });

  return {
    layout(next) {
      box = next;
      zone.setPosition(next.x + next.w / 2, next.y + next.h / 2);
      zone.setSize(next.w, next.h);
      arm();
      text.setPosition(next.x + next.w / 2, next.y + next.h / 2);
      text.setFontSize(Math.max(13, Math.min(22, next.h * 0.36)));
      text.setScale(1);
      const available = Math.max(8, next.w - 12);
      if (text.width > available) {
        text.setScale(available / text.width);
      }
      draw();
    },
    setLabel(value) {
      text.setText(value);
    },
    setEnabled(on) {
      enabled = on;
      text.setAlpha(on ? 1 : 0.55);
      arm();
      draw();
    },
    setSelected(on) {
      selected = on;
      text.setColor(on ? '#2A1C12' : '#F4EBD4');
      draw();
    },
    setVisible(on) {
      graphics.setVisible(on);
      text.setVisible(on);
      zone.setVisible(on);
      arm();
      draw();
    },
    setDepth(depth) {
      graphics.setDepth(depth);
      text.setDepth(depth + 1);
      zone.setDepth(depth + 2);
    },
    destroy() {
      graphics.destroy();
      text.destroy();
      zone.destroy();
    },
  };
}

/** An icon button, used for the three hints. */
export interface IconButton extends UiButton {
  /**
   * Dims the icon once its hint has been used.
   * @param used whether the hint is spent
   */
  setUsed(used: boolean): void;
}

/**
 * A square icon button.
 * @param scene the scene
 * @param texture texture key
 * @param onClick called on a completed press
 * @returns the button
 */
export function iconButton(scene: Phaser.Scene, texture: string, onClick: () => void): IconButton {
  const button = textButton(scene, '', onClick);
  const icon = scene.add.image(0, 0, texture).setOrigin(0.5);
  const base = button.layout.bind(button);
  let used = false;
  return {
    layout(box) {
      base(box);
      const side = Math.min(box.w, box.h) * 0.62;
      icon.setDisplaySize(side, side);
      icon.setPosition(box.x + box.w / 2, box.y + box.h / 2);
    },
    setLabel(text) {
      button.setLabel(text);
    },
    setEnabled(on) {
      button.setEnabled(on);
      icon.setAlpha(on && !used ? 1 : 0.4);
    },
    setSelected(on) {
      button.setSelected(on);
    },
    setVisible(on) {
      button.setVisible(on);
      icon.setVisible(on);
    },
    setDepth(depth) {
      button.setDepth(depth);
      icon.setDepth(depth + 1);
    },
    setUsed(next) {
      used = next;
      icon.setAlpha(next ? 0.4 : 1);
    },
    destroy() {
      icon.destroy();
      button.destroy();
    },
  };
}
