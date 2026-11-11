import type Phaser from 'phaser';
import { FONT_BODY, FONT_DISPLAY, textResolution, THEME } from './theme';

/** Visual style variant for a UI button. */
export type ButtonVariant = 'primary' | 'secondary' | 'gold' | 'danger' | 'ghost';

/** Configuration options for creating a {@link UiButton}. */
export interface UiButtonConfig {
  /** Phaser scene owning the button. */
  readonly scene: Phaser.Scene;
  /** Primary button label. */
  readonly label: string;
  /** Optional secondary sub-label or badge text. */
  readonly subLabel?: string;
  /** Optional texture key for an icon displayed inside the button. */
  readonly iconKey?: string;
  /** Visual variant. Defaults to `'secondary'`. */
  readonly variant?: ButtonVariant;
  /** Layout orientation of icon + text inside the button. Defaults to `'horizontal'`. */
  readonly iconLayout?: 'horizontal' | 'vertical';
  /** Accessible aria-label override (defaults to `label`). */
  readonly ariaLabel?: string;
  /** Optional data-testid attribute for automated testing. */
  readonly testId?: string;
  /** Click callback invoked when the button is activated. */
  readonly onClick: () => void;
}

/**
 * Reusable Phaser 4 button component with woodland styling, icon/badge support,
 * hover/press states, and a synchronized accessible DOM `<button>` overlay.
 */
export class UiButton {
  private readonly scene: Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly labelText: Phaser.GameObjects.Text;
  private readonly subLabelText: Phaser.GameObjects.Text | null;
  private readonly iconImage: Phaser.GameObjects.Image | null;
  private readonly domBtn: HTMLButtonElement;
  private readonly onClick: () => void;

  private label: string;
  private subLabel: string;
  private variant: ButtonVariant;
  private readonly iconLayout: 'horizontal' | 'vertical';
  private x = 0;
  private y = 0;
  private width = 120;
  private height = 44;
  private enabled = true;
  private visible = true;
  private activeToggle = false;
  private hovered = false;
  private pressed = false;
  private lastInvokeMs = 0;

  constructor(config: UiButtonConfig) {
    this.scene = config.scene;
    this.label = config.label;
    this.subLabel = config.subLabel ?? '';
    this.variant = config.variant ?? 'secondary';
    this.iconLayout = config.iconLayout ?? 'horizontal';
    this.onClick = config.onClick;

    const res = textResolution();
    this.bg = this.scene.add.graphics();
    this.labelText = this.scene.add.text(0, 0, this.label, {
      fontFamily: this.variant === 'primary' || this.variant === 'gold' ? FONT_DISPLAY : FONT_BODY,
      fontSize: '16px',
      fontStyle: 'bold',
      color: '#F8F4E8',
      align: 'center',
      resolution: res,
    }).setOrigin(0.5);

    this.subLabelText = config.subLabel !== undefined
      ? this.scene.add.text(0, 0, this.subLabel, {
        fontFamily: FONT_BODY,
        fontSize: '11px',
        fontStyle: '600',
        color: '#DCCB9E',
        align: 'center',
        resolution: res,
      }).setOrigin(0.5)
      : null;

    this.iconImage = config.iconKey !== undefined && this.scene.textures.exists(config.iconKey)
      ? this.scene.add.image(0, 0, config.iconKey).setOrigin(0.5)
      : null;

    const children: Phaser.GameObjects.GameObject[] = [this.bg];
    if (this.iconImage) {
      children.push(this.iconImage);
    }
    children.push(this.labelText);
    if (this.subLabelText) {
      children.push(this.subLabelText);
    }

    this.container = this.scene.add.container(0, 0, children);

    // Synchronized accessible DOM button in #a11y-layer
    this.domBtn = document.createElement('button');
    this.domBtn.type = 'button';
    this.domBtn.className = 'a11y-btn';
    this.domBtn.textContent = this.subLabel ? `${this.label} (${this.subLabel})` : this.label;
    if (config.ariaLabel) {
      this.domBtn.setAttribute('aria-label', config.ariaLabel);
    }
    if (config.testId) {
      this.domBtn.setAttribute('data-testid', config.testId);
    }

    this.domBtn.addEventListener('pointerenter', () => {
      if (!this.enabled) {
        return;
      }
      this.hovered = true;
      this.redraw();
    });
    this.domBtn.addEventListener('pointerleave', () => {
      this.hovered = false;
      this.pressed = false;
      this.redraw();
    });
    this.domBtn.addEventListener('pointerdown', () => {
      if (!this.enabled) {
        return;
      }
      this.pressed = true;
      this.redraw();
    });
    this.domBtn.addEventListener('pointerup', () => {
      this.pressed = false;
      this.redraw();
    });
    this.domBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.trigger();
    });

    const a11yRoot = document.getElementById('a11y-layer');
    a11yRoot?.appendChild(this.domBtn);

    // Ensure DOM button is cleaned up when scene shuts down
    this.scene.events.once('shutdown', () => {
      this.domBtn.remove();
    });
    this.scene.events.once('destroy', () => {
      this.domBtn.remove();
    });
  }

  /**
   * Positions and sizes the button in screen coordinates.
   * @param x top-left X coordinate
   * @param y top-left Y coordinate
   * @param width button width in pixels
   * @param height button height in pixels
   * @param fontSizePx optional explicit label font size in pixels
   */
  setBounds(x: number, y: number, width: number, height: number, fontSizePx?: number): this {
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.width = Math.max(24, Math.round(width));
    this.height = Math.max(24, Math.round(height));

    this.container.setPosition(this.x, this.y);
    this.syncDomBounds();
    this.layoutInternals(fontSizePx);
    this.redraw();
    return this;
  }

  /**
   * Updates the primary button text.
   * @param label new label string
   */
  setLabel(label: string): this {
    if (this.label !== label) {
      this.label = label;
      this.labelText.setText(label);
      this.syncDomLabel();
      this.layoutInternals();
      this.redraw();
    }
    return this;
  }

  /**
   * Updates the secondary sub-label or badge text.
   * @param subLabel new sub-label string
   */
  setSubLabel(subLabel: string): this {
    if (this.subLabel !== subLabel) {
      this.subLabel = subLabel;
      this.subLabelText?.setText(subLabel);
      this.syncDomLabel();
      this.layoutInternals();
      this.redraw();
    }
    return this;
  }

  /**
   * Updates the visual variant of the button.
   * @param variant new variant
   */
  setVariant(variant: ButtonVariant): this {
    if (this.variant !== variant) {
      this.variant = variant;
      this.redraw();
    }
    return this;
  }

  /**
   * Sets whether the button is enabled and interactive.
   * @param enabled true to enable, false to disable
   */
  setEnabled(enabled: boolean): this {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.domBtn.disabled = !enabled;
      if (!enabled) {
        this.hovered = false;
        this.pressed = false;
      }
      this.redraw();
    }
    return this;
  }

  /**
   * Sets whether the button is shown as toggled/active.
   * @param active true if active
   */
  setActiveToggle(active: boolean): this {
    if (this.activeToggle !== active) {
      this.activeToggle = active;
      this.domBtn.setAttribute('aria-pressed', String(active));
      this.redraw();
    }
    return this;
  }

  /**
   * Shows or hides both the Phaser container and its synchronized DOM button.
   * @param visible true to show, false to hide
   */
  setVisible(visible: boolean): this {
    this.visible = visible;
    this.container.setVisible(visible);
    this.domBtn.style.display = visible ? 'block' : 'none';
    return this;
  }

  /**
   * Sets the Phaser depth of the button container.
   * @param depth render depth
   */
  setDepth(depth: number): this {
    this.container.setDepth(depth);
    return this;
  }

  /**
   * Destroys the Phaser objects and removes the synchronized DOM button.
   */
  destroy(): void {
    this.domBtn.remove();
    this.container.destroy(true);
  }

  private trigger(): void {
    if (!this.enabled || !this.visible) {
      return;
    }
    const now = performance.now();
    if (now - this.lastInvokeMs < 60) {
      return;
    }
    this.lastInvokeMs = now;
    this.onClick();
  }

  private syncDomLabel(): void {
    if (!this.domBtn.hasAttribute('aria-label')) {
      this.domBtn.textContent = this.subLabel ? `${this.label} (${this.subLabel})` : this.label;
    }
  }

  private syncDomBounds(): void {
    this.domBtn.style.left = `${this.x}px`;
    this.domBtn.style.top = `${this.y}px`;
    this.domBtn.style.width = `${this.width}px`;
    this.domBtn.style.height = `${this.height}px`;
    this.domBtn.style.display = this.visible ? 'block' : 'none';
  }

  private layoutInternals(explicitFontPx?: number): void {
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2;

    if (this.iconLayout === 'vertical' && this.iconImage) {
      const hasSub = Boolean(this.subLabelText && this.subLabel.length > 0);
      const iconSize = Math.min(w * 0.48, h * (hasSub ? 0.42 : 0.48));
      this.iconImage.setDisplaySize(iconSize, iconSize);
      this.iconImage.setPosition(cx, hasSub ? h * 0.31 : h * 0.36);

      const labelPx = explicitFontPx ?? Math.max(11, Math.min(15, Math.round(h * 0.19)));
      this.labelText.setFontSize(labelPx);
      this.labelText.setPosition(cx, hasSub ? h * 0.67 : h * 0.76);

      if (this.subLabelText) {
        this.subLabelText.setVisible(hasSub);
        const subPx = Math.max(9, Math.min(12, Math.round(h * 0.14)));
        this.subLabelText.setFontSize(subPx);
        this.subLabelText.setPosition(cx, h * 0.85);
      }
      return;
    }

    const fontPx = explicitFontPx ?? Math.max(12, Math.min(19, Math.round(h * 0.38)));
    this.labelText.setFontSize(fontPx);

    if (this.iconImage) {
      const iconSize = Math.min(h * 0.62, w * 0.28);
      this.iconImage.setDisplaySize(iconSize, iconSize);
      const gap = Math.max(6, Math.round(h * 0.14));
      const totalW = iconSize + gap + this.labelText.width;
      const startX = (w - totalW) / 2;
      this.iconImage.setPosition(startX + iconSize / 2, cy);
      this.labelText.setPosition(startX + iconSize + gap + this.labelText.width / 2, cy);
    } else if (this.subLabelText && this.subLabel.length > 0) {
      this.subLabelText.setVisible(true);
      this.labelText.setPosition(cx, h * 0.38);
      const subPx = Math.max(10, Math.min(13, Math.round(h * 0.24)));
      this.subLabelText.setFontSize(subPx);
      this.subLabelText.setPosition(cx, h * 0.72);
    } else {
      if (this.subLabelText) {
        this.subLabelText.setVisible(false);
      }
      this.labelText.setPosition(cx, cy);
    }
  }

  private redraw(): void {
    this.bg.clear();
    const w = this.width;
    const h = this.height;
    const radius = Math.min(12, Math.round(h * 0.26));

    let fillColor: number;
    let strokeColor: number;
    let textColor: string;

    if (!this.enabled) {
      fillColor = THEME.DISABLED_BTN_FILL;
      strokeColor = THEME.PANEL_STROKE;
      textColor = '#8E7D67';
    } else if (this.activeToggle || this.variant === 'gold') {
      fillColor = this.hovered ? THEME.GOLD_BTN_HOVER : THEME.GOLD_BTN_FILL;
      strokeColor = THEME.GOLD_BTN_STROKE;
      textColor = THEME.GOLD_BTN_TEXT;
    } else if (this.variant === 'primary') {
      fillColor = this.hovered ? THEME.PRIMARY_BTN_HOVER : THEME.PRIMARY_BTN_FILL;
      strokeColor = THEME.PRIMARY_BTN_STROKE;
      textColor = THEME.TEXT_CREAM;
    } else if (this.variant === 'danger') {
      fillColor = this.hovered ? 0xA83232 : 0x8F2828;
      strokeColor = 0x5E1616;
      textColor = THEME.TEXT_CREAM;
    } else if (this.variant === 'ghost') {
      fillColor = this.hovered ? THEME.SECONDARY_BTN_FILL : THEME.TOP_BAR_BG;
      strokeColor = THEME.PANEL_STROKE;
      textColor = THEME.TEXT_MUTED;
    } else {
      fillColor = this.hovered ? THEME.SECONDARY_BTN_HOVER : THEME.SECONDARY_BTN_FILL;
      strokeColor = THEME.SECONDARY_BTN_STROKE;
      textColor = THEME.TEXT_CREAM;
    }

    const offsetY = this.pressed && this.enabled ? 1.5 : 0;

    // Subtle bottom shadow for depth
    if (this.enabled && !this.pressed) {
      this.bg.fillStyle(0x120B06, 0.45);
      this.bg.fillRoundedRect(0, 2, w, h, radius);
    }

    this.bg.fillStyle(fillColor, 1);
    this.bg.fillRoundedRect(0, offsetY, w, h, radius);
    this.bg.lineStyle(2, strokeColor, 1);
    this.bg.strokeRoundedRect(0, offsetY, w, h, radius);

    this.labelText.setColor(textColor);
    if (this.subLabelText) {
      this.subLabelText.setColor(
        !this.enabled
          ? '#756654'
          : (this.activeToggle || this.variant === 'gold' ? '#4A3208' : THEME.TEXT_GOLD),
      );
    }
    if (this.iconImage) {
      this.iconImage.setAlpha(this.enabled ? 1 : 0.42);
    }
  }
}
