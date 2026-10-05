/* ========================================================= *\
 *  Interactive UI Button for Phaser 4                        *
\* ========================================================= */

import Phaser from 'phaser';
import { getActiveTheme } from './theme';

export interface ButtonOptions {
  scene: Phaser.Scene;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  icon?: string;
  iconScale?: number;
  primary?: boolean;
  fontSize?: number;
  onClick: () => void;
}

/**
 * Reusable rounded button with hover and active states.
 */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private labelText?: Phaser.GameObjects.Text;
  private iconImage?: Phaser.GameObjects.Image;
  private isEnabled: boolean = true;
  private isPrimary: boolean;
  private baseColor: number;
  private hoverColor: number;
  private textColor: string;

  constructor(options: ButtonOptions) {
    super(options.scene, options.x, options.y);
    const theme = getActiveTheme();

    this.isPrimary = options.primary ?? false;
    this.baseColor = this.isPrimary ? theme.buttonPrimary : theme.buttonSecondary;
    this.hoverColor = this.isPrimary ? theme.buttonPrimaryHover : theme.buttonSecondaryHover;
    this.textColor = this.isPrimary ? theme.buttonText : theme.textPrimary;

    this.setSize(options.width, options.height);

    // Background rectangle
    this.bg = options.scene.add.rectangle(0, 0, options.width, options.height, this.baseColor);
    this.bg.setStrokeStyle(1.5, theme.border);
    this.add(this.bg);

    let contentWidth = 0;
    const padding = 8;

    // Optional icon
    if (options.icon) {
      this.iconImage = options.scene.add.image(0, 0, options.icon);
      const iconScale = options.iconScale ?? Math.min((options.height - 12) / this.iconImage.height, 1);
      this.iconImage.setScale(iconScale);
      this.add(this.iconImage);
      contentWidth += this.iconImage.displayWidth + padding;
    }

    // Optional label text
    if (options.text) {
      const fontSize = options.fontSize ?? Math.round(options.height * 0.38);
      this.labelText = options.scene.add.text(0, 0, options.text, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: `${fontSize}px`,
        color: this.textColor,
        fontStyle: '600',
      });
      this.labelText.setOrigin(0.5, 0.5);
      this.add(this.labelText);
      contentWidth += this.labelText.displayWidth;
    }

    // Position icon and text horizontally centered
    if (this.iconImage && this.labelText) {
      const startX = -contentWidth / 2;
      this.iconImage.setX(startX + this.iconImage.displayWidth / 2);
      this.labelText.setX(startX + this.iconImage.displayWidth + padding + this.labelText.displayWidth / 2);
    } else if (this.iconImage) {
      this.iconImage.setX(0);
    } else if (this.labelText) {
      this.labelText.setX(0);
    }

    // Interactive setup
    const hitRect = new Phaser.Geom.Rectangle(-options.width / 2, -options.height / 2, options.width, options.height);
    this.setInteractive(
      hitRect,
      (_hitArea: unknown, x: number, y: number): boolean =>
        x >= hitRect.x && x <= hitRect.right && y >= hitRect.y && y <= hitRect.bottom,
    );

    this.on('pointerover', () => {
      if (this.isEnabled) {
        this.bg.setFillStyle(this.hoverColor);
      }
    });

    this.on('pointerout', () => {
      if (this.isEnabled) {
        this.bg.setFillStyle(this.baseColor);
      }
    });

    this.on('pointerdown', () => {
      if (this.isEnabled) {
        this.setScale(0.97);
      }
    });

    this.on('pointerup', () => {
      this.setScale(1);
      if (this.isEnabled) {
        options.onClick();
      }
    });

    options.scene.add.existing(this);
  }

  /**
   * Sets whether the button is clickable and adjusts visual opacity.
   * @param enabled whether button is active
   */
  public setEnabled(enabled: boolean): this {
    this.isEnabled = enabled;
    this.setAlpha(enabled ? 1 : 0.45);
    if (!enabled) {
      this.bg.setFillStyle(this.baseColor);
    }
    return this;
  }

  /**
   * Updates button label text.
   * @param text new text
   */
  public setText(text: string): this {
    if (this.labelText) {
      this.labelText.setText(text);
    }
    return this;
  }
}
