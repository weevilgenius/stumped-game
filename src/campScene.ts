import Phaser from 'phaser';
import { createAccessibleControls } from './accessibility';
import type { AccessibleControl } from './accessibility';
import {
  type AdventureState, type ColorId, type Goods, harvestColors, type ItemPlace, MAX_PACK, MAX_SLOTS, nextHit, type SlotState,
} from './adventure/engine';
import { choices, type RunCommand, sellPrice } from './adventure/campaign';
import { EVENTS, PRICES, REST_HEAL, STARTERS } from './adventure/content/campaign';
import { consumableDetails, encounterDetails, itemSummary, NODE_NAMES, NODE_SYMBOLS, titleOf } from './adventureText';
import type { DetailTarget } from './puzzleScene';
import { cssColor, type Theme } from './theme';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Widest the content column grows, in CSS pixels, so rows stay readable on tablets. */
const MAX_WIDTH_PX = 560;
/** Pointer travel, in CSS pixels, after which a press scrolls instead of tapping. */
const DRAG_PX = 8;
/** Map row spacing, in CSS pixels. */
const MAP_ROW_PX = 40;

/** Run outcomes as headlines. */
const OUTCOMES = { death: 'You were defeated', failed: 'Stumped', abandoned: 'You gave up', victory: 'Victory!' } as const;

/** Why a run command was refused, for the player. */
const REFUSALS: Readonly<Record<string, string>> = {
  'no-room': 'No room: drop, sell, or move an item first.',
  'no-supplies': 'Not enough supplies.',
  'no-target': 'There is nothing to use that on.',
};

/* ========================================================= *\
 *  Camp scene: the adventure between puzzles (the stop      *
 *  here, gear, and the map) and new-run character select.   *
 *  Placeholder art in theme colors; rebuilt whole from the  *
 *  run after every change, like the puzzle strip.           *
\* ========================================================= */

/** What the camp screen shows and how it reports back. */
export interface CampOptions {
  /** Character select for a new run, or the current run's camp. */
  readonly mode: 'select' | 'camp';
  /** Colors to draw with. */
  readonly theme: Theme;
  /** The run now, or null if there is none. */
  readonly state: () => Readonly<AdventureState> | null;
  /** Runs won, which unlock characters. */
  readonly wins: () => number;
  /** Whether the run needs a puzzle next. */
  readonly needsPuzzle: () => boolean;
  /** Applies a run command; returns why it was refused, or null. */
  readonly act: (command: RunCommand) => string | null;
  /** Starts a new run with a character. */
  readonly onStart: (starterId: string) => void;
  /** Plays the run's next puzzle. */
  readonly onPlay: () => void;
  /** Gives up the run. */
  readonly onAbandon: () => void;
  /** Opens character select. */
  readonly onSelect: () => void;
  /** Returns to the main screen. */
  readonly onExit: () => void;
  /** Opens the detail card for an item, the enemy, or the character. */
  readonly onDetails: (target: DetailTarget) => void;
}

type Tab = 'here' | 'gear' | 'map';

interface Control {
  readonly label: string;
  /** Bounds in device pixels: in screen space when fixed, otherwise in scrolled content space. */
  readonly bounds: readonly [number, number, number, number];
  readonly fixed: boolean;
  readonly disabled: boolean;
  readonly onTap: () => void;
}

/** Options for one button. */
interface ButtonStyle {
  /** Drawn on the fixed bars, not the scrolling content. */
  readonly fixed?: boolean;
  /** Shown but not pressable. */
  readonly disabled?: boolean;
  /** Drawn highlighted, for the main action or the current tab. */
  readonly accent?: boolean;
  /** Spoken label, when the text alone is not enough. */
  readonly label?: string;
}

class CampScene extends Phaser.Scene {
  private options!: CampOptions;
  private theme!: Theme;
  /** Device pixels per CSS pixel. */
  private u = 1;
  private tab: Tab | null = null;
  private moving: ItemPlace | null = null;
  private message = '';
  private controls = new Map<string, Control>();
  /** Text read before the buttons by screen readers. */
  private spoken: string[] = [];
  private contentTop = 0;
  private contentBottom = 0;
  private maxScroll = 0;
  /** Content y the view centers on when a new view opens (the map's current spot), or null. */
  private focusY: number | null = null;
  /** Which view the scroll belongs to, so a redraw of the same view keeps its scroll. */
  private viewKey = '';
  private press: { x: number; y: number; scroll: number; moved: boolean } | null = null;
  private accessible?: ReturnType<typeof createAccessibleControls>;

  constructor() {
    super('camp');
  }

  init(options: CampOptions): void {
    this.options = options;
    this.theme = options.theme;
    this.viewKey = '';
    this.tab = null;
    this.moving = null;
    this.message = '';
  }

  create(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.press = { x: p.x, y: p.y, scroll: this.cameras.main.scrollY, moved: false };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const press = this.press;
      if (!press || !p.isDown) return;
      if (Math.abs(p.y - press.y) > DRAG_PX * this.u) press.moved = true;
      if (press.moved) this.scrollTo(press.scroll - (p.y - press.y));
    });
    const up = (p: Phaser.Input.Pointer): void => {
      if (this.press && !this.press.moved) this.tapAt(p.x, p.y);
      this.press = null;
    };
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', () => (this.press = null));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.scrollTo(this.cameras.main.scrollY + dy));
    const rebuild = (): void => this.build();
    this.scale.on('resize', rebuild);
    this.events.once('shutdown', () => this.scale.off('resize', rebuild));
    this.accessible = createAccessibleControls(this.game.canvas.parentElement!, 'Adventure', (name) => this.activate(name));
    this.events.once('shutdown', () => {
      this.accessible?.destroy();
      this.accessible = undefined;
    });
    this.cameras.main.setScroll(0, 0);
    this.build();
    if (import.meta.env.DEV) {
      Object.assign(window, { camp: this });
    }
  }

  /** Redraws from the run, after the controller reports a change. */
  refresh(): void {
    this.build();
  }

  /** Button centers in CSS pixels relative to the page, by name. Read by the end-to-end tests. */
  spot(name: string): { x: number; y: number } | null {
    const control = this.controls.get(name);
    if (!control) return null;
    const [x, y, w, h] = control.bounds;
    const canvas = this.game.canvas.getBoundingClientRect();
    const scroll = control.fixed ? 0 : this.cameras.main.scrollY;
    return { x: canvas.x + (x + w / 2) / this.u, y: canvas.y + (y + h / 2 - scroll) / this.u };
  }

  /* ------------------------------------------------------- *\
   *  Input: taps are hit-tested against the controls, so a  *
   *  drag that scrolls never presses a button.              *
  \* ------------------------------------------------------- */

  private scrollTo(y: number): void {
    this.cameras.main.setScroll(0, Phaser.Math.Clamp(y, 0, this.maxScroll));
    this.syncAccessible();
  }

  private tapAt(x: number, y: number): void {
    const scroll = this.cameras.main.scrollY;
    const inContent = y >= this.contentTop && y < this.contentBottom;
    // Fixed bars are checked first, then the latest drawn, so a button wins over the panel it sits on.
    const hit = [...this.controls].reverse().sort(([, a], [, b]) => Number(b.fixed) - Number(a.fixed)).find(([, c]) => {
      const [cx, cy, cw, ch] = c.bounds;
      const py = c.fixed ? y : y + scroll;
      return (c.fixed || inContent) && x >= cx && x < cx + cw && py >= cy && py < cy + ch;
    });
    if (hit) this.activate(hit[0]);
  }

  private activate(name: string): void {
    const control = this.controls.get(name);
    if (control && !control.disabled) control.onTap();
  }

  private send(command: RunCommand): void {
    this.moving = null;
    const refused = this.options.act(command);
    this.message = refused ? REFUSALS[refused] ?? 'That cannot be done now.' : '';
    // An accepted command redraws through refresh(); a refused one changes nothing else.
    if (refused) this.build();
  }

  private syncAccessible(): void {
    const scroll = this.cameras.main.scrollY;
    const { u } = this;
    const controls: AccessibleControl[] = [];
    for (const [name, c] of this.controls) {
      const [x, y, w, h] = c.bounds;
      const top = c.fixed ? y : y - scroll;
      // Content scrolled under the bars is left out, so focus never lands on a hidden button.
      if (!c.fixed && (top + h <= this.contentTop || top >= this.contentBottom)) continue;
      controls.push({ name, label: c.label, bounds: [x / u, top / u, w / u, h / u], disabled: c.disabled });
    }
    this.accessible?.render(controls, this.spoken.join(' '));
  }

  /* ------------------------------------------------------- *\
   *  Drawing helpers                                        *
  \* ------------------------------------------------------- */

  private style(size: number, bold = true, color = this.theme.cream): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: FONT, fontSize: `${Math.round(size * this.u)}px`, fontStyle: bold ? 'bold' : 'normal', color: cssColor(color) };
  }

  /** Wrapped text at (x, y), also read by screen readers. Returns its height. */
  private text(x: number, y: number, w: number, content: string, size = 15, bold = false, fixed = false): number {
    const t = this.add.text(x, y, content, { ...this.style(size, bold), wordWrap: { width: w, useAdvancedWrap: true }, lineSpacing: 3 * this.u });
    if (fixed) t.setScrollFactor(0).setDepth(11);
    if (!fixed) this.spoken.push(content);
    return t.height;
  }

  private button(name: string, x: number, y: number, w: number, h: number, content: string, onTap: () => void, style: ButtonStyle = {}): void {
    const { u } = this;
    const parts = [
      this.add.rectangle(x + w / 2, y + h / 2, w, h, style.accent ? this.theme.cream : this.theme.woodDark).setRounded(9 * u),
      this.add.rectangle(x + w / 2, y + h / 2, w - 4 * u, h - 4 * u, this.theme.wood).setRounded(7 * u),
      this.add.text(x + w / 2, y + h / 2, content, this.style(14)).setOrigin(0.5),
    ];
    for (const part of parts) {
      if (style.fixed) part.setScrollFactor(0).setDepth(11);
      if (style.disabled) part.setAlpha(0.4);
    }
    this.controls.set(name, { label: style.label ?? content, bounds: [x, y, w, h], fixed: !!style.fixed, disabled: !!style.disabled, onTap });
  }

  private swatches(x: number, y: number, colors: readonly ColorId[]): number {
    const { u } = this;
    const g = this.add.graphics();
    const size = 12 * u;
    colors.forEach((color, i) => g.fillStyle(this.theme.palette[color]).fillRoundedRect(x + i * (size + 3 * u), y, size, size, 3 * u));
    return colors.length ? colors.length * (size + 3 * u) + 3 * u : 0;
  }

  /** A row panel that opens a detail card when tapped. Returns the panel height. */
  private panel(name: string, x: number, y: number, w: number, h: number, label: string, detail: DetailTarget | null, faded = false): void {
    this.add.rectangle(x + w / 2, y + h / 2, w, h, this.theme.ink, faded ? 0.35 : 0.7).setRounded(10 * this.u);
    if (detail) {
      this.controls.set(name, {
        label: `${label}, details`, bounds: [x, y, w, h], fixed: false, disabled: false, onTap: () => this.options.onDetails(detail),
      });
    }
  }

  /* ------------------------------------------------------- *\
   *  Layout                                                 *
  \* ------------------------------------------------------- */

  private build(): void {
    this.tweens.killAll();
    [...this.children.list].forEach((child) => child.destroy());
    this.controls.clear();
    this.spoken = [];
    const { width, height, zoom } = this.scale;
    const u = this.u = 1 / zoom;
    this.cameras.main.setBackgroundColor(this.theme.background);
    const pad = 12 * u;
    const w = Math.min(width - 2 * pad, MAX_WIDTH_PX * u);
    const x = (width - w) / 2;
    const state = this.options.state();
    const select = this.options.mode === 'select' || !state;

    // Top bar: back to the main screen, and the run at a glance.
    let top = pad;
    this.button('back', x, top, 48 * u, 40 * u, '‹', () => this.options.onExit(), { fixed: true, label: 'Menu' });
    const title = select ? 'New adventure'
      : `${STARTERS.find((s) => s.id === state.character)?.name ?? titleOf(state.character)}`;
    const stats = select || !state ? 'Choose a character'
      : `Health ${state.health}/${state.maxHealth} · Supplies ${state.resources.supplies ?? 0}${state.block ? ` · Block ${state.block}` : ''}${
        state.campaign?.at != null ? ` · Column ${state.campaign.nodes[state.campaign.at].column + 1}/${state.campaign.nodes.at(-1)!.column + 1}` : ''}`;
    this.text(x + 60 * u, top, w - 60 * u, title, 17, true, true);
    this.text(x + 60 * u, top + 22 * u, w - 60 * u, stats, 13, false, true);
    this.spoken.push(`${title}. ${stats}.`);
    top += 52 * u;

    // Tabs for the camp.
    if (!select && state.campaign && state.phase !== 'ended') {
      const tab = this.tab ??= this.defaultTab(state);
      const tw = (w - 2 * 8 * u) / 3;
      (['here', 'gear', 'map'] as const).forEach((name, i) => this.button(`tab-${name}`, x + i * (tw + 8 * u), top, tw, 36 * u,
        { here: 'Here', gear: 'Gear', map: 'Map' }[name], () => {
          this.tab = name;
          this.moving = null;
          this.cameras.main.setScroll(0, 0);
          this.build();
        }, { fixed: true, accent: tab === name, label: `${{ here: 'Here', gear: 'Gear', map: 'Map' }[name]} tab${tab === name ? ', selected' : ''}` }));
      top += 44 * u;
    }

    // Bottom bar: the run's main actions.
    const barH = 60 * u;
    let bottom = height;
    if (!select && state.phase !== 'ended') {
      bottom = height - barH;
      const bw = (w - 10 * u) / 2;
      this.button('abandon', x, bottom + 8 * u, bw, 44 * u, 'Give up', () => this.options.onAbandon(), { fixed: true });
      const puzzle = this.options.needsPuzzle();
      this.button('play', x + bw + 10 * u, bottom + 8 * u, bw, 44 * u, state.phase === 'round' ? 'Continue →' : 'Next puzzle →',
        () => this.options.onPlay(), { fixed: true, disabled: !puzzle, accent: puzzle });
    }
    this.contentTop = top;
    this.contentBottom = bottom;
    // The bars hide content scrolled beneath them.
    this.add.rectangle(width / 2, top / 2, width, top, this.theme.background).setScrollFactor(0).setDepth(10);
    this.add.rectangle(width / 2, (bottom + height) / 2, width, height - bottom, this.theme.background).setScrollFactor(0).setDepth(10);

    let y = top + 4 * u;
    this.focusY = null;
    if (this.message) {
      y += this.text(x, y, w, this.message, 14, true) + 10 * u;
    }
    if (select) {
      y = this.drawSelect(x, y, w);
    } else if (state.phase === 'ended' || !state.campaign) {
      y = this.drawEnded(state, x, y, w);
    } else if (this.tab === 'gear') {
      y = this.drawGear(state, x, y, w);
    } else if (this.tab === 'map') {
      y = this.drawMap(state, x, y, w);
    } else {
      y = this.drawHere(state, x, y, w);
    }
    this.maxScroll = Math.max(0, y + pad - bottom);
    const view = `${select ? 'select' : this.tab ?? 'here'}:${state?.campaign?.at ?? ''}`;
    const opened = view !== this.viewKey;
    this.viewKey = view;
    const centered = this.focusY === null ? 0 : this.focusY - (top + bottom) / 2;
    this.scrollTo(opened ? centered : this.cameras.main.scrollY);
  }

  /** Map when it is time to choose, otherwise the stop here. */
  private defaultTab(state: Readonly<AdventureState>): Tab {
    const campaign = state.campaign!;
    const busy = !!state.encounter || campaign.loot.length > 0 || !!campaign.shop || campaign.rest || !!campaign.event;
    return busy ? 'here' : 'map';
  }

  private drawSelect(x: number, y: number, w: number): number {
    const { u } = this;
    const wins = this.options.wins();
    for (const starter of STARTERS) {
      const locked = starter.unlockWins > wins;
      const inner = w - 24 * u;
      const lines = [
        `${starter.health} health · ${starter.loadout.map((item) => titleOf(item.id)).join(' → ')}`,
        starter.description,
      ];
      // Measured first, so the panel fits its text.
      const probe = this.add.text(0, 0, lines.join('\n'), { ...this.style(13, false), wordWrap: { width: inner, useAdvancedWrap: true }, lineSpacing: 3 * u });
      const h = 12 * u + 22 * u + probe.height + 10 * u + 40 * u + 12 * u;
      probe.destroy();
      this.panel(`starter-${starter.id}`, x, y, w, h, starter.name, null, locked);
      let ty = y + 12 * u;
      ty += this.text(x + 12 * u, ty, inner, starter.name, 17, true) + 4 * u;
      ty += this.text(x + 12 * u, ty, inner, lines.join('\n'), 13) + 10 * u;
      this.button(`start-${starter.id}`, x + 12 * u, ty, 140 * u, 40 * u, locked ? 'Win a run' : 'Start', () => this.options.onStart(starter.id),
        { disabled: locked, accent: !locked, label: locked ? `${starter.name}: win a run to unlock` : `Start a run as ${starter.name}` });
      y += h + 10 * u;
    }
    return y;
  }

  private drawEnded(state: Readonly<AdventureState>, x: number, y: number, w: number): number {
    const { u } = this;
    const outcome = state.outcome ? OUTCOMES[state.outcome] : 'Run in progress';
    y += this.text(x, y, w, outcome, 22, true) + 8 * u;
    y += this.text(x, y, w, `After ${state.rounds} ${state.rounds === 1 ? 'puzzle' : 'puzzles'}${
      state.campaign?.at != null ? `, column ${state.campaign.nodes[state.campaign.at].column + 1}` : ''}.`, 15) + 16 * u;
    this.button('new-run', x, y, 160 * u, 44 * u, 'New run', () => this.options.onSelect(), { accent: true });
    return y + 44 * u;
  }

  /** The stop here: the fight, loot, shop, rest, or event. */
  private drawHere(state: Readonly<AdventureState>, x: number, y: number, w: number): number {
    const { u } = this;
    const campaign = state.campaign!;
    const encounter = state.encounter;
    const supplies = state.resources.supplies ?? 0;
    const inner = w - 24 * u;
    const heading = (text: string): void => {
      y += this.text(x, y, w, text, 16, true) + 6 * u;
    };

    if (encounter) {
      const name = encounter.type === 'forage' ? 'Forage' : `${titleOf(encounter.def.id)}${encounter.type === 'enemy' && encounter.def.boss ? ' (boss)' : ''}`;
      const lines = encounterDetails(encounter).join('\n');
      const harvest = harvestColors(encounter);
      const probe = this.add.text(0, 0, lines, { ...this.style(13, false), wordWrap: { width: inner, useAdvancedWrap: true }, lineSpacing: 3 * u });
      const h = 12 * u + 24 * u + probe.height + (harvest ? 24 * u : 0) + 12 * u;
      probe.destroy();
      this.panel('enemy', x, y, w, h, name, { type: 'enemy' });
      let ty = y + 12 * u;
      ty += this.text(x + 12 * u, ty, inner, name, 17, true) + 6 * u;
      ty += this.text(x + 12 * u, ty, inner, lines, 13) + 6 * u;
      if (harvest) {
        this.add.text(x + 12 * u, ty, 'Harvest', this.style(12, false));
        this.swatches(x + 70 * u, ty + 2 * u, harvest);
      }
      y += h + 10 * u;
      if (encounter.type === 'enemy' && encounter.phase === 'active' && !encounter.def.boss) {
        this.button('flee', x, y, w, 40 * u, `Flee (take ${nextHit(encounter)} damage, no loot)`, () => this.send({ type: 'flee' }));
        y += 50 * u;
      }
    }
    if (campaign.loot.length) {
      heading('Loot');
      campaign.loot.forEach((goods, index) => {
        y = this.goodsRow(`loot-${index}`, x, y, w, goods, { type: 'loot', index }, [['Take', { type: 'take-loot', index }]]);
      });
    }
    if (campaign.shop) {
      heading('Shop');
      campaign.shop.stock.forEach((entry, index) => {
        if (entry) {
          y = this.goodsRow(`shop-${index}`, x, y, w, entry.goods, { type: 'shop', index },
            [[`Buy ${entry.price}`, supplies >= entry.price ? { type: 'buy', index } : null]]);
        }
      });
      const missing = state.maxHealth - state.health;
      y += this.text(x, y, w, `Healing costs ${PRICES.health} supplies per point.`, 13) + 6 * u;
      [1, 5].forEach((amount, i) => {
        const healed = Math.min(amount, missing);
        this.button(`heal-${amount}`, x + i * 110 * u, y, 100 * u, 40 * u, `Heal +${healed || amount}`, () => this.send({ type: 'buy-health', amount }),
          { disabled: healed <= 0 || supplies < healed * PRICES.health });
      });
      y += 50 * u;
    }
    if (campaign.rest) {
      heading('Rest');
      y += this.text(x, y, w, 'Heal, or upgrade one item from the Gear tab.', 13) + 6 * u;
      this.button('rest-heal', x, y, 160 * u, 40 * u, `Heal ${Math.ceil(state.maxHealth * REST_HEAL)}`, () => this.send({ type: 'rest', choice: 'heal' }), { accent: true });
      y += 50 * u;
    }
    const event = EVENTS.find((e) => e.id === campaign.event);
    if (event) {
      heading('Event');
      y += this.text(x, y, w, event.text, 15) + 8 * u;
      event.options.forEach((option, i) => {
        const able = (option.supplies ?? 0) <= supplies && state.health + Math.min(0, option.health ?? 0) > 0;
        this.button(`answer-${i}`, x, y, w, 40 * u, option.label, () => this.send({ type: 'answer', option: i }), { disabled: !able });
        y += 48 * u;
      });
    }
    if (!encounter && !campaign.loot.length && !campaign.shop && !campaign.rest && !event) {
      y += this.text(x, y, w, choices(state).length ? 'Nothing more here. Choose where to go next on the map.' : 'The way ahead is clear.', 15) + 10 * u;
      this.button('to-map', x, y, 160 * u, 40 * u, 'Map', () => {
        this.tab = 'map';
        this.build();
      }, { accent: true });
      y += 50 * u;
    }
    return y;
  }

  /** A row for loot or shop goods, with its action buttons. */
  private goodsRow(
    name: string, x: number, y: number, w: number, goods: Goods, detail: DetailTarget,
    actions: readonly (readonly [string, RunCommand | null])[],
  ): number {
    const { u } = this;
    const h = 64 * u;
    const label = titleOf(goods.item.id);
    this.panel(name, x, y, w, h, label, detail);
    const bw = 96 * u;
    const textW = w - 24 * u - actions.length * (bw + 8 * u);
    const sx = goods.kind === 'gear' ? this.swatches(x + 12 * u, y + 14 * u, goods.item.colors) : 0;
    this.text(x + 12 * u + sx, y + 10 * u, textW - sx, label, 15, true);
    this.text(x + 12 * u, y + 34 * u, textW, goods.kind === 'gear' ? itemSummary(goods.item, goods.slot) : consumableDetails(goods.item).split('.')[0], 12);
    actions.forEach(([text, command], i) => this.button(`${name}-${i}`, x + w - (i + 1) * (bw + 8 * u), y + 12 * u, bw, 40 * u, text,
      () => command && this.send(command), { disabled: !command, label: `${text} ${label}` }));
    return y + h + 8 * u;
  }

  /** Equipment in priority order, the pack, and consumables. */
  private drawGear(state: Readonly<AdventureState>, x: number, y: number, w: number): number {
    const { u } = this;
    const campaign = state.campaign!;
    const heading = (text: string): void => {
      y += this.text(x, y, w, text, 16, true) + 6 * u;
    };
    const itemRow = (slot: SlotState, place: ItemPlace): void => {
      const name = `${place.area}-${place.index}`;
      const label = `${titleOf(slot.item.id)}${slot.level ? ` +${slot.level}` : ''}`;
      const here = this.moving?.area === place.area && this.moving.index === place.index;
      const h = 100 * u;
      this.panel(name, x, y, w, h, label, place.area === 'slots' ? { type: 'slot', index: place.index } : { type: 'pack', index: place.index },
        place.area === 'slots' && !slot.ready);
      const sx = this.swatches(x + 12 * u, y + 14 * u, slot.item.colors);
      this.text(x + 12 * u + sx, y + 10 * u, w - 24 * u - sx, `${place.area === 'slots' ? `${place.index + 1}. ` : ''}${label}${here ? ' (moving)' : ''}`, 15, true);
      this.text(x + 12 * u, y + 32 * u, w - 24 * u, itemSummary(slot.item, slot), 12);
      const actions: [string, () => void, string][] = [];
      if (this.moving) {
        actions.push(here ? ['Cancel', () => this.cancelMove(), `Cancel moving ${label}`]
          : ['Here', () => this.send({ type: 'move-item', from: this.moving!, to: place }), `Swap with ${label}`]);
      } else {
        actions.push(['Move', () => this.startMove(place), `Move ${label}`]);
      }
      if (place.area === 'slots') {
        actions.push([slot.ready ? 'Unready' : 'Ready', () => this.send({ type: 'set-ready', slot: place.index, ready: !slot.ready }),
          `${slot.ready ? 'Unready' : 'Ready'} ${label}`]);
      }
      if (campaign.rest) actions.push(['Upgrade', () => this.send({ type: 'rest', choice: 'upgrade', from: place }), `Upgrade ${label}`]);
      actions.push(campaign.shop ? [`Sell ${sellPrice(slot.item)}`, () => this.send({ type: 'sell', from: place }), `Sell ${label} for ${sellPrice(slot.item)}`]
        : ['Drop', () => this.send({ type: 'drop-item', from: place }), `Drop ${label}`]);
      const bw = Math.min(96 * u, (w - 24 * u - (actions.length - 1) * 8 * u) / actions.length);
      actions.forEach(([text, onTap, spoken], i) => this.button(`${name}-${text.split(' ')[0].toLowerCase()}`,
        x + 12 * u + i * (bw + 8 * u), y + 52 * u, bw, 38 * u, text, onTap, { label: spoken }));
      y += h + 8 * u;
    };
    const empty = (area: ItemPlace['area'], count: number, max: number): void => {
      if (!this.moving || count >= max) return;
      this.button(`${area}-empty`, x, y, w, 40 * u, 'Move here (empty)', () => this.send({ type: 'move-item', from: this.moving!, to: { area, index: count } }),
        { label: `Move to an empty ${area === 'slots' ? 'equipment slot' : 'pack space'}` });
      y += 48 * u;
    };
    heading(`Equipped (${state.slots.length}/${MAX_SLOTS})`);
    y += this.text(x, y, w, 'Each color goes to the first readied item that takes it.', 12) + 8 * u;
    state.slots.forEach((slot, index) => itemRow(slot, { area: 'slots', index }));
    empty('slots', state.slots.length, MAX_SLOTS);
    const pack = state.pack ?? [];
    heading(`Pack (${pack.length}/${MAX_PACK})`);
    pack.forEach((slot, index) => itemRow(slot, { area: 'pack', index }));
    empty('pack', pack.length, MAX_PACK);
    const consumables = state.consumables ?? [];
    if (consumables.length) {
      heading('Consumables');
      consumables.forEach((item, index) => {
        const h = 56 * u;
        this.panel(`consumable-${index}`, x, y, w, h, titleOf(item.id), null);
        this.text(x + 12 * u, y + 8 * u, w - 140 * u, titleOf(item.id), 15, true);
        this.text(x + 12 * u, y + 30 * u, w - 140 * u, consumableDetails(item).split('.')[0], 12);
        const usable = item.effect !== 'attack' || state.encounter?.type === 'enemy';
        this.button(`consumable-${index}-use`, x + w - 108 * u, y + 8 * u, 96 * u, 40 * u, 'Use', () => this.send({ type: 'use-consumable', index }),
          { disabled: !usable, label: `Use ${titleOf(item.id)}` });
        y += h + 8 * u;
      });
    }
    return y;
  }

  private startMove(place: ItemPlace): void {
    this.moving = place;
    this.build();
  }

  private cancelMove(): void {
    this.moving = null;
    this.build();
  }

  /** The map, boss at the top; reachable nodes are buttons. */
  private drawMap(state: Readonly<AdventureState>, x: number, y: number, w: number): number {
    const { u } = this;
    const campaign = state.campaign!;
    const reachable = choices(state);
    y += this.text(x, y, w, reachable.length ? 'Choose where to go next.' : state.encounter ? 'Finish this fight first.' : '', 14) + 8 * u;
    const columns = Math.max(...campaign.nodes.map((n) => n.column)) + 1;
    const row = MAP_ROW_PX * u;
    const top = y;
    const nx = (lane: number, lanes: number): number => x + 24 * u + ((lane + 0.5) / lanes) * (w - 48 * u);
    const ny = (column: number): number => top + (columns - 1 - column) * row + row / 2;
    const g = this.add.graphics().lineStyle(2 * u, this.theme.woodDark);
    for (const node of campaign.nodes) {
      for (const n of node.next) {
        const to = campaign.nodes[n];
        g.lineBetween(nx(node.lane, node.lanes), ny(node.column), nx(to.lane, to.lanes), ny(to.column));
      }
    }
    const r = 15 * u;
    campaign.nodes.forEach((node, i) => {
      const cx = nx(node.lane, node.lanes);
      const cy = ny(node.column);
      const go = reachable.includes(i);
      const here = i === campaign.at;
      const visited = campaign.visited.includes(i);
      if (go || here) this.add.circle(cx, cy, r + 3 * u, this.theme.cream);
      this.add.circle(cx, cy, r, visited || here ? this.theme.woodDark : this.theme.wood).setAlpha(go || here || visited ? 1 : 0.6);
      const danger = node.kind === 'fight' || node.kind === 'elite';
      this.add.text(cx, cy, `${NODE_SYMBOLS[node.kind]}${danger ? node.tier : ''}`, this.style(12)).setOrigin(0.5);
      // The lowest reachable node, or where the player stands, is the one to show.
      if (go || (here && this.focusY === null)) this.focusY = Math.max(this.focusY ?? 0, cy);
      if (go) {
        const label = `${NODE_NAMES[node.kind]}${danger ? `, danger ${node.tier}` : ''}`;
        this.controls.set(`node-${i}`, {
          label: `Travel to ${label}`, bounds: [cx - r - 6 * u, cy - r - 6 * u, 2 * r + 12 * u, 2 * r + 12 * u], fixed: false, disabled: false,
          onTap: () => {
            this.tab = null;
            this.send({ type: 'move', node: i });
          },
        });
      }
    });
    y = top + columns * row + 8 * u;
    const legend = Object.entries(NODE_SYMBOLS).map(([kind, symbol]) => `${symbol} ${NODE_NAMES[kind as keyof typeof NODE_NAMES]}`).join(' · ');
    y += this.text(x, y, w, `${legend}. Numbers show danger.`, 12) + 8 * u;
    return y;
  }
}

export { CampScene };
