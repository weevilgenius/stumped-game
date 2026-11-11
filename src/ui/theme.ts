import type Phaser from 'phaser';

/* ========================================================= *\
 *  Woodland theme palette and styling constants             *
\* ========================================================= */

/** Theme colors used across Phaser scenes and overlays. */
export const THEME = {
  /** Deep woodland background green. */
  BG_HEX: '#1D3324',
  /** Numeric deep woodland background green. */
  BG_NUM: 0x1D3324,
  /** Darker forest card background. */
  PANEL_BG_NUM: 0x26402E,
  /** Primary gold button fill. */
  GOLD_BTN_FILL: 0xE4BB49,
  /** Primary gold button hover fill. */
  GOLD_BTN_HOVER: 0xECC965,
  /** Primary gold button border. */
  GOLD_BTN_STROKE: 0x8F6B1C,
  /** Primary gold button text color. */
  GOLD_BTN_TEXT: '#24170D',
  /** Secondary brown button fill. */
  BROWN_BTN_FILL: 0x8B5A2B,
  /** Secondary brown button hover fill. */
  BROWN_BTN_HOVER: 0x9E6834,
  /** Secondary brown button border. */
  BROWN_BTN_STROKE: 0x4E3015,
  /** Active/toggled button fill (e.g. Hypothesis active). */
  ACTIVE_BTN_FILL: 0x48B5B2,
  /** Active/toggled button border. */
  ACTIVE_BTN_STROKE: 0x246967,
  /** Disabled button fill. */
  DISABLED_BTN_FILL: 0x4A4A38,
  /** Disabled button border. */
  DISABLED_BTN_STROKE: 0x363628,
  /** Disabled button text color. */
  DISABLED_BTN_TEXT: '#8E8E7A',
  /** Light cream text color. */
  TEXT_LIGHT: '#F8F4E8',
  /** Muted cream text color. */
  TEXT_MUTED: '#C6D1C3',
  /** Board dark brown border color. */
  BOARD_BORDER: 0x2B1810,
  /** Red X and conflict warning color. */
  DANGER_RED: 0xE53935,
  /** Hypothesis X tint color. */
  HYP_X_FILL: 0xFFE680,
  /** Warm woodland dark background gradient top. */
  BG_WOOD_LIGHT: 0x2F1E12,
  /** Warm woodland dark background gradient bottom. */
  BG_WOOD_DARK: 0x1D120A,
  /** Panel fill color. */
  PANEL_BG: 0x362214,
  /** Panel border color. */
  PANEL_STROKE: 0x6E4828,
  /** Top bar background color. */
  TOP_BAR_BG: 0x2B1B0F,
  /** Primary green action button fill. */
  PRIMARY_BTN_FILL: 0x4E8C45,
  /** Primary green action button hover fill. */
  PRIMARY_BTN_HOVER: 0x5CA152,
  /** Primary green action button stroke. */
  PRIMARY_BTN_STROKE: 0x2B5425,
  /** Secondary wood button fill. */
  SECONDARY_BTN_FILL: 0x593A22,
  /** Secondary wood button hover fill. */
  SECONDARY_BTN_HOVER: 0x6B4629,
  /** Secondary wood button stroke. */
  SECONDARY_BTN_STROKE: 0x825836,
  /** Cream text color. */
  TEXT_CREAM: '#F8F4E8',
  /** Warm gold text color. */
  TEXT_GOLD: '#F5C542',
} as const;

/** Standard system font stack. */
export const FONT_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** Display heading font stack. */
export const FONT_DISPLAY = '"Trebuchet MS", "Avenir Next", system-ui, -apple-system, sans-serif';

/** Body text font stack. */
export const FONT_BODY = FONT_STACK;

/**
 * Computes device pixel resolution for crisp Phaser Text rendering.
 * @returns resolution multiplier (at least 2)
 */
export function textResolution(): number {
  return Math.min(3, Math.max(2, typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2));
}

/**
 * Draws a crisp outlined X centered at `(cx, cy)` with half-span `radius`.
 * @param gfx Phaser Graphics instance
 * @param cx center X
 * @param cy center Y
 * @param radius half-width/height of the X arms
 * @param fillColor inner stroke color
 * @param outlineColor outer stroke color
 * @param thicknessFactor stroke thickness relative to radius
 * @param alpha opacity (0 to 1)
 */
export function drawOutlinedX(
  gfx: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  radius: number,
  fillColor: number,
  outlineColor = THEME.BOARD_BORDER,
  thicknessFactor = 0.36,
  alpha = 1,
): void {
  const outerW = Math.max(3, radius * (thicknessFactor + 0.24));
  const innerW = Math.max(1.5, radius * thicknessFactor);
  const x0 = cx - radius;
  const y0 = cy - radius;
  const x1 = cx + radius;
  const y1 = cy + radius;

  // Outer outline
  gfx.lineStyle(outerW, outlineColor, alpha);
  gfx.lineBetween(x0, y0, x1, y1);
  gfx.lineBetween(x0, y1, x1, y0);
  gfx.fillStyle(outlineColor, alpha);
  const outerCap = outerW * 0.5;
  gfx.fillCircle(x0, y0, outerCap);
  gfx.fillCircle(x1, y1, outerCap);
  gfx.fillCircle(x0, y1, outerCap);
  gfx.fillCircle(x1, y0, outerCap);

  // Inner fill
  gfx.lineStyle(innerW, fillColor, alpha);
  gfx.lineBetween(x0, y0, x1, y1);
  gfx.lineBetween(x0, y1, x1, y0);
  gfx.fillStyle(fillColor, alpha);
  const innerCap = innerW * 0.5;
  gfx.fillCircle(x0, y0, innerCap);
  gfx.fillCircle(x1, y1, innerCap);
  gfx.fillCircle(x0, y1, innerCap);
  gfx.fillCircle(x1, y0, innerCap);
}

/**
 * Draws a 5-pointed star icon at `(cx, cy)` for clean solves.
 * @param gfx Phaser Graphics instance
 * @param cx center X
 * @param cy center Y
 * @param outerRadius outer tip radius
 * @param fillColor star fill color
 * @param strokeColor star outline color
 */
export function drawStarIcon(
  gfx: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  outerRadius: number,
  fillColor = 0xF5C542,
  strokeColor = 0x5A3D0C,
): void {
  const innerRadius = outerRadius * 0.45;
  gfx.fillStyle(fillColor, 1);
  gfx.lineStyle(Math.max(1.5, outerRadius * 0.14), strokeColor, 1);
  gfx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) {
      gfx.moveTo(px, py);
    } else {
      gfx.lineTo(px, py);
    }
  }
  gfx.closePath();
  gfx.fillPath();
  gfx.strokePath();
}

/**
 * Draws a circular repeat-play arrow icon at `(cx, cy)`.
 * @param gfx Phaser Graphics instance
 * @param cx center X
 * @param cy center Y
 * @param radius icon radius
 * @param color stroke/fill color
 */
export function drawRepeatIcon(
  gfx: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  radius: number,
  color = 0xF8F4E8,
): void {
  const strokeW = Math.max(2, radius * 0.24);
  gfx.lineStyle(strokeW, color, 1);
  gfx.beginPath();
  gfx.arc(cx, cy, radius * 0.72, -Math.PI * 0.75, Math.PI * 0.65, false);
  gfx.strokePath();

  // Arrowhead at the end of the arc
  const tipAngle = Math.PI * 0.65;
  const tx = cx + Math.cos(tipAngle) * radius * 0.72;
  const ty = cy + Math.sin(tipAngle) * radius * 0.72;
  const head = radius * 0.42;
  gfx.fillStyle(color, 1);
  gfx.fillTriangle(
    tx + head * 0.4,
    ty - head * 0.7,
    tx - head * 0.8,
    ty - head * 0.2,
    tx + head * 0.2,
    ty + head * 0.6,
  );
}
