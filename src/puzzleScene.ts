import Phaser from 'phaser';
import { createAccessiblePuzzle } from './accessibility';
import type { AccessibleControl } from './accessibility';
import type { Conflict } from './engine';
import {
  applyExplanation, beginStroke, canHint, completedUnits, doubleTap, enterHypothesis, type ExplainPage, explain,
  explainPages, extendStroke, flaggedStumps, formatTime, type Game, type Hint, HINTS, HYPO_STUMP,
  isPerfectlyMarked, leaveHypothesis, MARK_X, type Result, resultOf, type RevealResult, squirrel, type StrokeMode, stumps, timeAward, undo,
  woodpecker,
} from './game';
import { cssColor, type Theme } from './theme';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/* ========================================================= *\
 *  Tuning                                                   *
\* ========================================================= */

/** Longest gap between two taps on a square that still counts as a double tap. */
const DOUBLE_TAP_MS = 350;

/**
 * Fraction of a square, at each corner, that a drag passes through without
 * marking it. Lets a diagonal stroke cut a corner without catching the
 * squares on either side.
 */
const CORNER_SLACK = 0.2;

/** How long the line to the conflicting stump shows before the red X lands. */
const CONFLICT_MS = 650;
/** How long input stays blocked once the red X lands. */
const WRONG_MS = 350;
/** How long the end-of-puzzle banner shows before returning to the main screen. */
const END_MS = 4000;
/**
 * How long button presses are ignored after one set of buttons replaces
 * another. Double tapping is the game's main gesture, and without this a
 * double tap on one button would also press whichever button took its place.
 */
const SWAP_GUARD_MS = 300;
/** Sharpest canvas scale used, in device pixels per CSS pixel. */
const MAX_PIXEL_RATIO = 3;
/** Size vector icons are drawn at before they are scaled down to fit a square. */
const VECTOR_ICON_PX = 512;

/* ========================================================= *\
 *  Scene                                                    *
\* ========================================================= */

/** What the puzzle screen shows and how it reports back. */
export interface PuzzleOptions {
  /** The game to play. The scene changes it in place. */
  readonly model: Game;
  /** Recorded times to compare with the completed play. */
  readonly results: readonly Result[];
  /** Whether to show the timer. Time is recorded either way. */
  readonly showTimer: boolean;
  /** Called after every change worth saving. */
  readonly onChange: () => void;
  /** Play time so far in milliseconds, read every frame. */
  readonly elapsed: () => number;
  /** Called when the screen closes: the back button, or the end of the puzzle. */
  readonly onExit: () => void;
  /** Called when the player asks how to play. The scene keeps running underneath. */
  readonly onHelp: () => void;
  /** Colors and art to draw with. */
  readonly theme: Theme;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Face = Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text | Phaser.GameObjects.Image;

type Paint = (ctx: CanvasRenderingContext2D, size: number) => void;

/** Texture for each normal-layer mark, indexed by MARK_NONE, MARK_X, MARK_RED, MARK_STUMP. */
const MARK_TEXTURES = ['', 'x', 'red', 'stump'];

/** Paints an X with round ends, over a wider outline if one is given. */
const cross = (color: string, outline?: string): Paint => (ctx, size) => {
  const near = size * 0.27;
  const far = size - near;
  const stroke = (style: string, width: number): void => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(near, near);
    ctx.lineTo(far, far);
    ctx.moveTo(far, near);
    ctx.lineTo(near, far);
    ctx.stroke();
  };
  if (outline) {
    stroke(outline, size * 0.19);
  }
  stroke(color, size * 0.1);
};

class PuzzleScene extends Phaser.Scene {
  private options!: PuzzleOptions;
  private model!: Game;
  private theme!: Theme;

  /** Device pixels per CSS pixel. Sizes are written in CSS pixels times this. */
  private u = 1;
  private boardX = 0;
  private boardY = 0;
  private cellSize = 0;
  private textureKey = '';

  private markSprites: (Phaser.GameObjects.Image | undefined)[] = [];
  private markKinds: string[] = [];
  private dimmers: { parts: Face[]; dim: () => boolean }[] = [];
  private acornIcons: Phaser.GameObjects.Image[] = [];
  private countText?: Phaser.GameObjects.Text;
  private timerText?: Phaser.GameObjects.Text;
  /** Button centers in CSS pixels, by name. Read by the end-to-end tests. */
  spots: Record<string, { x: number; y: number }> = {};

  private stroke: { id: number; mode: StrokeMode; cell: number; x: number; y: number } | null = null;
  private lastTap: { cell: number; time: number; changed: boolean } | null = null;
  private busyUntil = 0;
  private buttonsFrom = 0;
  private ended = false;
  private explanation: { pages: ExplainPage[]; index: number } | null = null;
  private complete = new Set<string>();
  private shownSeconds = -1;
  private accessible?: ReturnType<typeof createAccessiblePuzzle>;
  private controls = new Map<string, { view: AccessibleControl; onTap: () => void; dim?: () => boolean }>();
  private inputState = '';

  constructor() {
    super('puzzle');
  }

  init(options: PuzzleOptions): void {
    this.options = options;
    this.model = options.model;
    this.theme = options.theme;
    this.textureKey = '';
    this.stroke = null;
    this.lastTap = null;
    this.busyUntil = 0;
    this.buttonsFrom = 0;
    this.ended = false;
    // A relaunch with the explain hint open comes back to it.
    const { explaining } = this.model;
    this.explanation = explaining && { pages: explainPages(this.model, explaining, this.theme.piece), index: 0 };
    this.complete = new Set(completedUnits(this.model).keys());
    this.shownSeconds = -1;
  }

  preload(): void {
    // Each theme's art is loaded once, under its own keys, and kept for the next puzzle.
    for (const [key, url] of Object.entries(this.theme.icons)) {
      if (/\.svg($|\?)/.test(url)) {
        this.load.svg(this.rawKey(key), url, { width: VECTOR_ICON_PX, height: VECTOR_ICON_PX });
      } else {
        this.load.image(this.rawKey(key), url);
      }
    }
  }

  create(): void {
    const onUp = (pointer: Phaser.Input.Pointer): void => this.onPointerUp(pointer);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      this.onPointerDown(pointer, over);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.onPointerMove(pointer));
    this.input.on('pointerup', onUp);
    this.input.on('pointerupoutside', onUp);
    // The scale manager outlives the scene, so its listener is removed by hand.
    const rebuild = (): void => this.build();
    this.scale.on('resize', rebuild);
    this.events.once('shutdown', () => this.scale.off('resize', rebuild));
    this.game.canvas.setAttribute('aria-hidden', 'true');
    this.accessible = createAccessiblePuzzle(this.game.canvas.parentElement!, this.model,
      (cell) => { this.lastTap = null; this.stroke = null; this.markCell(cell); },
      (cell) => this.revealCell(cell), (name) => this.activateControl(name));
    this.events.once('shutdown', () => {
      this.accessible?.destroy();
      this.accessible = undefined;
    });
    this.build();
    this.accessible.focus();
    if (import.meta.env.DEV) {
      Object.assign(window, { stumped: this });
    }
  }

  /** Texture key for a theme's source art. */
  private rawKey(icon: string): string {
    return `raw-${this.theme.name}-${icon}`;
  }

  update(): void {
    const state = `${this.blocked()},${performance.now() < this.buttonsFrom}`;
    if (state !== this.inputState) {
      this.inputState = state;
      this.syncAccessible();
    }
    const elapsed = this.options.elapsed();
    const seconds = Math.floor(elapsed / 1000);
    if (seconds !== this.shownSeconds) {
      this.shownSeconds = seconds;
      this.timerText?.setText(formatTime(elapsed));
      this.options.onChange();
    }
  }

  /* ------------------------------------------------------- *\
   *  Layout: everything is rebuilt from the model on a      *
   *  resize or a change of mode. Marks alone are synced in  *
   *  place, so marking stays cheap.                         *
  \* ------------------------------------------------------- */

  private build(): void {
    this.tweens.killAll();
    [...this.children.list].forEach((child) => child.destroy());
    this.markSprites = [];
    this.markKinds = [];
    this.dimmers = [];
    this.acornIcons = [];
    this.spots = {};
    this.controls.clear();
    this.stroke = null;
    this.countText = undefined;
    this.timerText = undefined;

    this.cameras.main.setBackgroundColor(this.theme.background);
    const { width, height, zoom } = this.scale;
    const n = this.model.puzzle.size;
    const u = this.u = 1 / zoom;
    const pad = 8 * u;
    const bar = 52 * u;
    const below = 176 * u;
    const beside = 300 * u;

    // Controls go under the board or beside it, whichever leaves the board larger.
    const tall = Math.min(width - 2 * pad, height - bar - below - pad);
    const wide = Math.min(height - 2 * pad, width - beside - 3 * pad);
    const cell = this.cellSize = Math.max(8, Math.floor(Math.max(tall, wide) / n));
    const board = cell * n;
    let status: Rect;
    let controls: Rect;
    if (tall >= wide) {
      this.boardX = Math.round((width - board) / 2);
      this.boardY = Math.round(bar + (height - bar - board - below) / 2);
      status = { x: pad, y: 0, w: width - 2 * pad, h: bar };
      controls = { x: pad, y: this.boardY + board + 2 * pad, w: width - 2 * pad, h: below - 2 * pad };
    } else {
      const side = Math.min(width - board - 3 * pad, 420 * u);
      this.boardX = Math.round((width - board - side - pad) / 2);
      this.boardY = Math.round((height - board) / 2);
      status = { x: this.boardX + board + pad, y: pad, w: side, h: bar };
      controls = { x: status.x, y: bar + 3 * pad, w: side, h: height - bar - 4 * pad };
    }

    this.makeTextures();
    if (tall >= wide) {
      this.drawFlags(bar, this.boardY - 2 * pad);
    }
    this.drawBoard();
    this.drawStatus(status);
    if (this.explanation) {
      this.drawExplanation(controls);
    } else {
      this.drawControls(controls);
    }
    this.syncMarks(false);
    this.syncHud();
    this.syncAccessible();
    if (this.ended) {
      this.drawBanner(false);
    }
  }

  /** Rebuilds with a different set of buttons, which then ignore presses for a moment. */
  private swapControls(): void {
    this.buttonsFrom = performance.now() + SWAP_GUARD_MS;
    this.build();
  }

  /** Redraws the source art at the exact sizes on screen, so nothing is scaled at draw time. */
  private makeTextures(): void {
    const { cellSize: cell, u } = this;
    const key = `${cell}/${u}/${this.model.puzzle.silver}/${this.theme.name}`;
    if (key === this.textureKey) {
      return;
    }
    this.textureKey = key;
    const icon = (source: string, inset = 0): Paint => (ctx, size) => {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        this.textures.get(this.rawKey(source)).getSourceImage() as HTMLImageElement,
        inset, inset, size - 2 * inset, size - 2 * inset,
      );
    };
    const paint = (name: string, size: number, draw: Paint): void => {
      if (this.textures.exists(name)) {
        this.textures.remove(name);
      }
      const px = Math.round(size);
      const texture = this.textures.createCanvas(name, px, px);
      if (texture) {
        draw(texture.context, px);
        texture.refresh();
      }
    };
    paint('stump', cell * 0.86, icon('stump'));
    paint('tentative', cell * 0.52, icon('stump'));
    paint('flagged', cell * 0.66, (ctx, size) => {
      ctx.fillStyle = 'rgba(214, 40, 40, 0.4)';
      ctx.strokeStyle = '#d62828';
      ctx.lineWidth = size * 0.08;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      icon('stump', size * 0.12)(ctx, size);
    });
    paint('x', cell, cross('rgba(43, 29, 18, 0.8)'));
    paint('red', cell, cross('#d62828', '#ffffff'));
    paint('light', cell, cross('#ffffff', 'rgba(43, 29, 18, 0.85)'));
    paint('count', 30 * u, icon('stump'));
    paint('acorn', 26 * u, icon(this.model.puzzle.silver ? 'silver' : 'acorn'));
    for (const hint of HINTS) {
      paint(hint, 42 * u, icon(hint));
    }
  }

  private drawBoard(): void {
    const { cellSize: cell, boardX: x0, boardY: y0, u } = this;
    const { size: n, regions, colors } = this.model.puzzle;
    const board = cell * n;
    const { palette } = this.theme;
    const g = this.add.graphics();
    if (this.model.hypo) {
      // A gold ring marks hypothesis mode.
      const ring = 2 * u;
      g.lineStyle(3 * u, palette[0])
        .strokeRoundedRect(x0 - ring, y0 - ring, board + 2 * ring, board + 2 * ring, cell * 0.1 + ring);
    }
    regions.forEach((region, i) => {
      g.fillStyle(palette[colors[region]]);
      this.fillCell(g, i);
    });
  }

  /**
   * Strings papel picado across the empty space above the board, if the theme has flags and there is room.
   * @param top the top of the space
   * @param bottom the bottom of the space
   */
  private drawFlags(top: number, bottom: number): void {
    const { flags, background } = this.theme;
    const { u } = this;
    const flagH = Math.min(bottom - top - 12 * u, 52 * u);
    if (flags.length === 0 || flagH < 28 * u) {
      return;
    }
    const { width } = this.scale;
    const flagW = flagH * 0.82;
    const count = Math.max(3, Math.floor(width / (flagW * 1.25)));
    const step = width / count;
    const sag = flagH * 0.3;
    const y0 = top + 4 * u;
    const ropeY = (x: number): number => y0 + sag * 4 * (x / width) * (1 - x / width);
    const g = this.add.graphics().setDepth(-1);
    g.lineStyle(2 * u, this.theme.cream, 0.8);
    g.beginPath();
    for (let x = 0; x <= width; x += width / 32) {
      if (x === 0) {
        g.moveTo(x, ropeY(x));
      } else {
        g.lineTo(x, ropeY(x));
      }
    }
    g.strokePath();
    for (let i = 0; i < count; i++) {
      const cx = (i + 0.5) * step;
      const y = ropeY(cx);
      const left = cx - flagW / 2;
      // Each flag: a sheet with a zigzag hem, then holes cut in it, which show the background.
      const teeth = 6;
      const hem = flagH * 0.1;
      const points = [new Phaser.Math.Vector2(left, y), new Phaser.Math.Vector2(left + flagW, y)];
      for (let t = 0; t <= teeth; t++) {
        points.push(new Phaser.Math.Vector2(left + flagW - t * flagW / teeth, y + flagH - (t % 2 ? hem : 0)));
      }
      g.fillStyle(flags[i % flags.length]).fillPoints(points, true);
      g.fillStyle(background);
      const d = flagW * 0.16;
      const my = y + flagH * 0.4;
      g.fillTriangle(cx - d, my, cx, my - d * 1.3, cx + d, my).fillTriangle(cx - d, my, cx, my + d * 1.3, cx + d, my);
      for (const [dx, dy] of [[-0.3, 0.17], [0.3, 0.17], [-0.3, 0.66], [0.3, 0.66]]) {
        g.fillCircle(cx + dx * flagW, y + dy * flagH, flagW * 0.06);
      }
      g.fillRect(cx - flagW * 0.14, y + flagH * 0.7, flagW * 0.28, flagH * 0.05);
    }
  }

  /** Space between neighboring squares, where the background shows through. */
  private cellGap(): number {
    return Math.max(2, Math.min(Math.round(this.cellSize * 0.08), 10 * this.u));
  }

  /** Fills a square's rounded rectangle, inset from its grid slot by half the gap on each side. */
  private fillCell(g: Phaser.GameObjects.Graphics, i: number): void {
    const { x, y } = this.center(i);
    const size = this.cellSize - this.cellGap();
    g.fillRoundedRect(x - size / 2, y - size / 2, size, size, this.cellSize * 0.1);
  }

  private drawStatus(r: Rect): void {
    const { u, model } = this;
    const mid = r.y + r.h / 2;
    this.button('back', r.x + 42 * u, mid, 84 * u, 38 * u, '‹ Menu', () => this.exit());
    const helpSize = 38 * u;
    this.button('help', r.x + r.w - helpSize / 2, mid, helpSize, helpSize, '?', () => this.options.onHelp());
    const left = r.x + 96 * u;
    const right = r.x + r.w - helpSize - 10 * u;
    const span = right - left;

    const countX = left + span * 0.16;
    this.add.image(countX - 20 * u, mid, 'count');
    this.countText = this.add.text(countX - 2 * u, mid - 7 * u, '', this.textStyle(18)).setOrigin(0, 0.5);
    const { tier } = model.puzzle;
    this.add.text(countX - 2 * u, mid + 11 * u, `${tier[0].toUpperCase()}${tier.slice(1)}`, this.textStyle(12))
      .setOrigin(0, 0.5);

    const total = model.puzzle.silver ? 1 : 3;
    for (let i = 0; i < total; i++) {
      this.acornIcons.push(this.add.image(left + span * 0.57 + (i - (total - 1) / 2) * 27 * u, mid, 'acorn'));
    }
    if (this.options.showTimer) {
      this.timerText = this.add.text(right, mid, formatTime(model.elapsed), this.textStyle(18))
        .setOrigin(1, 0.5);
    }
  }

  private drawControls(r: Rect): void {
    const { model } = this;
    const noUndo = (): boolean => (model.hypo ? model.hypoUndo : model.undo).length === 0;
    const undoButton = ['undo', 'Undo', (): void => {
      if (undo(model)) {
        this.changed();
      }
    }, noUndo] as const;
    const leave = (keep: boolean) => (): void => {
      leaveHypothesis(model, keep);
      this.swapControls();
      this.changed();
    };
    const rowHeight = this.buttonRow(r, r.y, model.hypo
      ? [undoButton, ['discard', 'Discard', leave(false)], ['keep', 'Keep', leave(true)]]
      : [undoButton, ['hypothesis', 'What if?', (): void => {
        enterHypothesis(model);
        this.swapControls();
        this.options.onChange();
      }]]);
    this.buttonRow(r, r.y + rowHeight, HINTS.map((hint) => (
      [hint, hint, (): void => this.useHint(hint), (): boolean => !canHint(model, hint)] as const)));
  }

  private drawExplanation(r: Rect): void {
    const { u, cellSize: cell } = this;
    const explanation = this.explanation;
    if (!explanation) {
      return;
    }
    const { pages, index } = explanation;
    const page = pages[index];

    // On the board: dim what is not involved, outline the subject, show the marks being reasoned about.
    const g = this.add.graphics().setDepth(4);
    g.fillStyle(0x000000, 0.6);
    this.model.marks.forEach((_, i) => {
      if (!page.lit.includes(i)) {
        this.fillCell(g, i);
      }
    });
    g.lineStyle(3 * u, 0xffffff);
    for (const i of page.marked) {
      const { x, y } = this.center(i);
      g.strokeRoundedRect(x - cell / 2 + 3 * u, y - cell / 2 + 3 * u, cell - 6 * u, cell - 6 * u, cell * 0.08);
    }
    for (const i of page.xs) {
      const { x, y } = this.center(i);
      this.add.image(x, y, 'light').setDepth(5);
    }
    for (const i of page.stumps) {
      const { x, y } = this.center(i);
      this.add.image(x, y, 'tentative').setDepth(5);
    }

    // In place of the controls: the reasoning, and buttons to page through it and close.
    const many = pages.length > 1;
    const text = this.add.text(r.x + 4 * u, r.y, (many ? `${index + 1}/${pages.length}  ` : '') + page.text, {
      ...this.textStyle(15), fontStyle: 'normal', lineSpacing: 3 * u, wordWrap: { width: r.w - 8 * u },
    });
    const turn = (by: number) => (): void => {
      explanation.index = Phaser.Math.Clamp(index + by, 0, pages.length - 1);
      this.build();
    };
    const y = Math.min(text.y + text.height + 10 * u, r.y + r.h - 52 * u);
    this.buttonRow(r, y, [
      ...(many ? [
        ['previous', '‹', turn(-1), (): boolean => index === 0] as const,
        ['next', '›', turn(1), (): boolean => index === pages.length - 1] as const,
      ] : []),
      ['done', 'Done', (): void => this.closeExplanation()],
    ]);
  }

  /** Lays out one row of buttons, centered. Returns the height it takes up, gap included. */
  private buttonRow(
    r: Rect, y: number,
    items: readonly (readonly [name: string, content: string, onTap: () => void, dim?: () => boolean])[],
  ): number {
    const { u } = this;
    const gap = 10 * u;
    const h = 52 * u;
    const w = Math.min((r.w - gap * (items.length - 1)) / items.length, 132 * u);
    const x0 = r.x + (r.w - w * items.length - gap * (items.length - 1)) / 2 + w / 2;
    items.forEach(([name, content, onTap, dim], i) => {
      this.button(name, x0 + i * (w + gap), y + h / 2, w, h, content, onTap, dim);
    });
    return h + gap;
  }

  /** Adds a button showing a texture, if `content` names one, or else a label. */
  private button(
    name: string, x: number, y: number, w: number, h: number, content: string,
    onTap: () => void, dim?: () => boolean,
  ): void {
    const { u } = this;
    // Filled shapes avoid Phaser's rounded-outline stroke path, whose duplicate
    // corner points can produce invalid vertices and streaks on some mobile GPUs.
    const border = this.add.rectangle(x, y, w + 2 * u, h + 2 * u, this.theme.woodDark).setRounded(11 * u);
    const back = this.add.rectangle(x, y, w - 2 * u, h - 2 * u, this.theme.wood).setRounded(9 * u);
    const face = this.textures.exists(content)
      ? this.add.image(x, y, content)
      : this.add.text(x, y, content, this.textStyle(16)).setOrigin(0.5);
    const names = this.theme.hintNames;
    const labels: Record<string, string> = {
      back: 'Menu', help: 'How to play', hypothesis: 'What if?', woodpecker: `${names.woodpecker}: reveal a stump`,
      owl: `${names.owl}: explain a deduction`, squirrel: `${names.squirrel}: mark empty squares`,
      previous: 'Previous explanation page', next: 'Next explanation page',
    };
    this.controls.set(name, {
      view: { name, label: labels[name] ?? content, bounds: [(x - w / 2) / u, (y - h / 2) / u, w / u, h / u], disabled: false },
      onTap, dim,
    });
    back.setInteractive(new Phaser.Geom.Rectangle(-u, -u, w, h),
      (area: Phaser.Geom.Rectangle, px: number, py: number) => Phaser.Geom.Rectangle.Contains(area, px, py))
      .on('pointerdown', () => this.activateControl(name));
    if (dim) {
      this.dimmers.push({ parts: [border, back, face], dim });
    }
    const canvas = this.game.canvas.getBoundingClientRect();
    this.spots[name] = { x: canvas.x + x / u, y: canvas.y + y / u };
  }

  private textStyle(size: number): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: FONT, fontSize: `${Math.round(size * this.u)}px`, fontStyle: 'bold', color: cssColor(this.theme.cream) };
  }

  private center(cell: number): { x: number; y: number } {
    const n = this.model.puzzle.size;
    return {
      x: this.boardX + (cell % n + 0.5) * this.cellSize,
      y: this.boardY + (Math.floor(cell / n) + 0.5) * this.cellSize,
    };
  }

  /** Center of a square in CSS pixels. Used by the end-to-end tests. */
  cellSpot(cell: number): { x: number; y: number } {
    const canvas = this.game.canvas.getBoundingClientRect();
    const { x, y } = this.center(cell);
    return { x: canvas.x + x / this.u, y: canvas.y + y / this.u };
  }

  /* ------------------------------------------------------- *\
   *  Keeping the screen in step with the model              *
  \* ------------------------------------------------------- */

  /** Call after any change to the model: redraws what changed, then saves. */
  private changed(): void {
    this.refresh();
    this.syncAccessible();
    this.options.onChange();
  }

  private refresh(): void {
    this.syncMarks(true);
    this.syncHud();
    const done = completedUnits(this.model);
    for (const [key, cells] of done) {
      if (!this.complete.has(key)) {
        this.pulse(cells);
      }
    }
    this.complete = new Set(done.keys());
    if (this.model.status !== 'playing' && !this.ended) {
      this.finish();
    }
  }

  private syncMarks(animate: boolean): void {
    const { marks, hypo } = this.model;
    const flagged = flaggedStumps(this.model);
    marks.forEach((mark, cell) => {
      let kind = MARK_TEXTURES[mark];
      if (hypo?.[cell] === HYPO_STUMP) {
        kind = flagged.includes(cell) ? 'flagged' : 'tentative';
      } else if (hypo?.[cell] === MARK_X) {
        kind = 'hypoX';
      }
      if (kind === (this.markKinds[cell] ?? '')) {
        return;
      }
      this.markKinds[cell] = kind;
      const old = this.markSprites[cell];
      if (old && animate) {
        this.tweens.add({ targets: old, alpha: 0, scale: old.scale * 0.6, duration: 90, onComplete: () => old.destroy() });
      } else {
        old?.destroy();
      }
      this.markSprites[cell] = kind ? this.drawMark(cell, kind, animate) : undefined;
    });
  }

  private drawMark(cell: number, kind: string, animate: boolean): Phaser.GameObjects.Image {
    const { x, y } = this.center(cell);
    // Hypothesis X's are small and sit in the upper right, so they differ by more than color.
    const corner = kind === 'hypoX' ? this.cellSize * 0.24 : 0;
    const scale = kind === 'hypoX' ? 0.5 : 1;
    const sprite = this.add.image(x + corner, y - corner, kind === 'hypoX' ? 'light' : kind)
      .setScale(scale)
      .setDepth(kind === 'x' || kind === 'hypoX' ? 1 : 2);
    if (animate) {
      sprite.setScale(scale * 0.4);
      this.tweens.add({ targets: sprite, scale, duration: kind === 'stump' ? 280 : 120, ease: 'Back.easeOut' });
    }
    return sprite;
  }

  private syncHud(): void {
    const { model } = this;
    this.countText?.setText(`${stumps(model).length}/${model.puzzle.size}`);
    this.acornIcons.forEach((icon, i) => icon.setAlpha(i < model.acorns ? 1 : 0.25));
    for (const { parts, dim } of this.dimmers) {
      const alpha = dim() ? 0.4 : 1;
      parts.forEach((part) => part.setAlpha(alpha));
    }
  }

  /* ------------------------------------------------------- *\
   *  Input                                                  *
  \* ------------------------------------------------------- */

  private syncAccessible(): void {
    const explanation = this.explanation;
    const message = explanation
      ? `Explanation ${explanation.index + 1} of ${explanation.pages.length}. ${explanation.pages[explanation.index].text}`
      : this.model.status === 'won' ? `Solved! ${timeAward(resultOf(this.model), this.options.results) ?? ''}`.trim()
        : this.model.status === 'lost' ? 'Stumped.'
          : this.blocked() ? 'Wrong reveal. Wait for feedback to finish.' : '';
    this.accessible?.render(
      [this.boardX / this.u, this.boardY / this.u, this.cellSize * this.model.puzzle.size / this.u],
      [...this.controls.values()].map(({ view, dim }) => ({
        ...view, disabled: this.blocked() || performance.now() < this.buttonsFrom || !!dim?.(),
      })),
      this.blocked() || !!explanation || this.model.status !== 'playing', message,
    );
  }

  private activateControl(name: string): void {
    const control = this.controls.get(name);
    if (!control || this.blocked() || performance.now() < this.buttonsFrom || control.dim?.()) {
      return;
    }
    this.lastTap = null;
    this.stroke = null;
    control.onTap();
    this.syncAccessible();
  }

  private canActOnCell(cell: number): boolean {
    return Number.isInteger(cell) && cell >= 0 && cell < this.model.marks.length
      && this.model.status === 'playing' && !this.blocked() && !this.explanation;
  }

  private markCell(cell: number): StrokeMode {
    if (!this.canActOnCell(cell)) {
      return null;
    }
    const mode = beginStroke(this.model, cell);
    if (mode) {
      this.changed();
    }
    return mode;
  }

  private revealCell(cell: number, firstTapChanged = false): void {
    if (!this.canActOnCell(cell)) {
      return;
    }
    this.lastTap = null;
    this.stroke = null;
    this.onReveal(doubleTap(this.model, cell, firstTapChanged), cell);
    this.syncAccessible();
  }

  /** True while the wrong-reveal or end-of-puzzle animation holds input. */
  private blocked(): boolean {
    return this.ended || this.time.now < this.busyUntil;
  }

  /**
   * @param x pointer x in canvas pixels
   * @param y pointer y in canvas pixels
   * @param skipCorners treat the corners of each square as no square, for drags
   * @returns the cell under the point, or -1
   */
  private cellAt(x: number, y: number, skipCorners = false): number {
    const n = this.model.puzzle.size;
    const col = (x - this.boardX) / this.cellSize;
    const row = (y - this.boardY) / this.cellSize;
    if (col < 0 || row < 0 || col >= n || row >= n) {
      return -1;
    }
    const nearEdge = (v: number): boolean => Math.abs(v % 1 - 0.5) > 0.5 - CORNER_SLACK;
    if (skipCorners && nearEdge(col) && nearEdge(row)) {
      return -1;
    }
    return Math.floor(row) * n + Math.floor(col);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    const cell = this.cellAt(pointer.x, pointer.y);
    if (over.length > 0 || cell < 0 || this.blocked() || this.explanation) {
      return;
    }
    const now = performance.now();
    const tap = this.lastTap;
    if (tap?.cell === cell && now - tap.time <= DOUBLE_TAP_MS) {
      this.lastTap = null;
      this.revealCell(cell, tap.changed);
      return;
    }
    // A single tap acts at once. If a second tap follows, doubleTap takes this one back.
    const mode = this.markCell(cell);
    this.lastTap = { cell, time: now, changed: mode !== null };
    this.stroke = { id: pointer.id, mode, cell, x: pointer.x, y: pointer.y };
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const stroke = this.stroke;
    if (stroke?.id !== pointer.id || !this.canActOnCell(stroke.cell)) {
      return;
    }
    // Walk the whole segment since the last event, so a fast drag skips no squares.
    const dx = pointer.x - stroke.x;
    const dy = pointer.y - stroke.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (this.cellSize / 8)));
    let changed = false;
    for (let i = 1; i <= steps; i++) {
      const cell = this.cellAt(stroke.x + dx * i / steps, stroke.y + dy * i / steps, true);
      if (cell >= 0 && cell !== stroke.cell) {
        stroke.cell = cell;
        this.lastTap = null;
        changed = extendStroke(this.model, cell, stroke.mode) || changed;
      }
    }
    stroke.x = pointer.x;
    stroke.y = pointer.y;
    if (changed) {
      this.changed();
    }
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.stroke?.id === pointer.id) {
      this.stroke = null;
    }
  }

  private onReveal(result: RevealResult | null, cell: number): void {
    if (!result || result.correct) {
      this.changed();
      return;
    }
    // A wrong reveal: show the stump it conflicts with first, then land the red X. Input waits.
    const wait = result.conflict ? CONFLICT_MS : 0;
    if (result.conflict) {
      this.showConflict(cell, result.conflict);
    }
    this.busyUntil = this.time.now + wait + WRONG_MS;
    this.options.onChange();
    this.time.delayedCall(wait, () => {
      this.cameras.main.shake(160, 0.006);
      this.refresh();
    });
  }

  private showConflict(cell: number, conflict: Conflict): void {
    const from = this.center(cell);
    const to = this.center(conflict.stump);
    const g = this.add.graphics().setDepth(6);
    g.lineStyle(this.cellSize * 0.2, 0xffffff).lineBetween(from.x, from.y, to.x, to.y);
    g.lineStyle(this.cellSize * 0.1, 0xd62828).lineBetween(from.x, from.y, to.x, to.y);
    g.fillStyle(0xd62828).fillCircle(from.x, from.y, this.cellSize * 0.14);
    this.tweens.add({ targets: g, alpha: 0, delay: CONFLICT_MS, duration: WRONG_MS, onComplete: () => g.destroy() });
    this.tweens.add({
      targets: this.markSprites[conflict.stump], scale: 1.25, duration: CONFLICT_MS / 4, yoyo: true, repeat: 1,
    });
  }

  private useHint(hint: Hint): void {
    if (this.blocked() || this.explanation || !canHint(this.model, hint)) {
      return;
    }
    if (hint === 'owl') {
      const source = explain(this.model);
      if (source) {
        this.explanation = { pages: explainPages(this.model, source, this.theme.piece), index: 0 };
        this.options.onChange();
        this.swapControls();
      }
      return;
    }
    if (hint === 'woodpecker') {
      woodpecker(this.model);
    } else {
      squirrel(this.model);
    }
    this.changed();
  }

  /** Closes the explanation and makes its mark for the player. */
  private closeExplanation(): void {
    if (!this.explanation) {
      return;
    }
    this.explanation = null;
    this.swapControls();
    applyExplanation(this.model);
    this.changed();
  }

  private exit(): void {
    this.closeExplanation();
    if (!this.ended) {
      this.leave();
    }
  }

  private leave(): void {
    this.options.onChange();
    this.scene.stop();
    this.options.onExit();
  }

  /* ------------------------------------------------------- *\
   *  Feedback                                               *
  \* ------------------------------------------------------- */

  /** Pulses squares once: a stump's row, column, or region has just been fully marked. */
  private pulse(cells: readonly number[]): void {
    for (const cell of cells) {
      const flash = this.add.graphics().setDepth(3).fillStyle(0xffffff, 0.8);
      this.fillCell(flash, cell);
      this.tweens.add({ targets: flash, alpha: 0, duration: 500, ease: 'Quad.easeIn', onComplete: () => flash.destroy() });
    }
  }

  private finish(): void {
    this.ended = true;
    // Freeze and record the final play time before comparing it with history.
    this.options.onChange();
    if (this.model.status === 'won') {
      const hop = this.markSprites.filter((sprite, cell) => sprite && this.markKinds[cell] === 'stump');
      this.tweens.add({
        targets: hop, y: `-=${this.cellSize * 0.22}`, duration: 170, yoyo: true, ease: 'Quad.easeOut',
        delay: this.tweens.stagger(70, {}),
      });
    }
    this.drawBanner(true);
    this.time.delayedCall(END_MS, () => this.leave());
  }

  private drawBanner(animate: boolean): void {
    const { u, model } = this;
    const board = this.cellSize * model.puzzle.size;
    const won = model.status === 'won';
    const title = won ? (isPerfectlyMarked(model) ? 'Perfectly Marked' : 'Solved!') : 'Stumped.';
    const award = won ? timeAward(resultOf(model), this.options.results) : null;
    const height = award ? 176 : 104;
    const bannerW = Math.min(board * 0.94, 310 * u);
    const parts: Phaser.GameObjects.GameObject[] = [
      // Filled shapes, not an outline stroke, for the same reason as the buttons: see the control buttons above.
      this.add.rectangle(0, 0, bannerW, height * u, this.theme.cream).setRounded(16 * u),
      this.add.rectangle(0, 0, bannerW - 6 * u, (height - 6) * u, this.theme.ink).setRounded(13 * u),
      this.add.text(0, won ? (award ? -52 : -16) * u : 0, title, this.textStyle(30)).setOrigin(0.5),
    ];
    if (won) {
      parts.push(this.add.text(0, (award ? -12 : 24) * u, formatTime(model.elapsed), this.textStyle(20)).setOrigin(0.5));
    }
    if (award) {
      parts.push(this.add.text(0, 26 * u, award, this.textStyle(22)).setOrigin(0.5));
      const { size, tier } = model.puzzle;
      const details = `${size}x${size} ${tier[0].toUpperCase()}${tier.slice(1)}`;
      parts.push(this.add.text(0, 60 * u, details, this.textStyle(18)).setOrigin(0.5));
    }
    const banner = this.add.container(this.boardX + board / 2, this.boardY + board / 2, parts).setDepth(10);
    if (animate) {
      banner.setScale(0.5);
      this.tweens.add({ targets: banner, scale: 1, duration: 320, ease: 'Back.easeOut' });
    }
  }
}

/* ========================================================= *\
 *  Opening the puzzle screen                                *
\* ========================================================= */

let phaser: Phaser.Game | undefined;

/**
 * Shows a game on the puzzle screen. The Phaser game is created on first use
 * and kept; its canvas tracks the size of `parent` at device resolution.
 * @param parent the visible, sized element that holds the canvas
 * @param options the game to play and the callbacks to report through
 */
export function openPuzzle(parent: HTMLElement, options: PuzzleOptions): void {
  const size = (): { width: number; height: number; zoom: number } => {
    const ratio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    return {
      width: Math.floor(parent.clientWidth * ratio), height: Math.floor(parent.clientHeight * ratio), zoom: 1 / ratio,
    };
  };
  if (phaser) {
    // While the canvas was hidden the scale manager measured it as empty, and it only looks again
    // twice a second. Measure now, or taps land on no square until it does.
    phaser.scale.refresh();
    // Restart through the scene's own plugin: it queues behind the stop the scene asked for on leaving.
    const scene = phaser.scene.getScene('puzzle') as Phaser.Scene | null;
    if (scene) {
      scene.scene.restart(options);
    } else {
      phaser.scene.start('puzzle', options);
    }
    return;
  }
  const game = phaser = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: options.theme.background,
    banner: false,
    disableContextMenu: true,
    // Unused, and off so Phaser never listens for keys typed into the seed code box.
    input: { keyboard: false },
    scale: { mode: Phaser.Scale.NONE, expandParent: false, ...size() },
  });
  game.scene.add('puzzle', PuzzleScene, true, options);
  new ResizeObserver(() => {
    const { width, height, zoom } = size();
    // A hidden parent has no size: keep the last one until it is shown again.
    if (width > 0 && height > 0 && (width !== game.scale.width || height !== game.scale.height)) {
      if (zoom !== game.scale.zoom) {
        game.scale.setZoom(zoom);
      }
      game.scale.resize(width, height);
    }
  }).observe(parent);
}
