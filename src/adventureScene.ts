import Phaser from 'phaser';
import { bindItemPress } from './itemPress';
import type { Controller } from './controller';
import type { AccessibleControl } from './accessibility';
import { createAccessibleAdventure } from './adventureAccessibility';
import { adventureName, adventurePage, newAdventureScreen } from './adventureScreens';
import type { AdventureAction, AdventureCard, AdventurePage, AdventureScreenState } from './adventureScreens';
import { cssColor } from './theme';
import type { Theme } from './theme';

/** Parameters for either adventure selection or run management. */
export interface AdventureSceneOptions {
  /** App navigation and saved run actions. */
  controller: Controller;
  /** True on new-run selection. */
  selection: boolean;
  /** Current palette and presentation. */
  theme: Theme;
}
interface SceneControl {
  /** Semantic hit target. */
  view: AccessibleControl;
  /** Shared pointer and keyboard action. */
  action: AdventureAction;
  /** Fixed navigation or scrolling content. */
  fixed: boolean;
}
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Phaser presentation for campaign selection, route, equipment and quiet locations. */
export class AdventureScene extends Phaser.Scene {
  private options!: AdventureSceneOptions;
  private view: AdventureScreenState = newAdventureScreen();
  private accessible?: ReturnType<typeof createAccessibleAdventure>;
  private controls = new Map<string, SceneControl>();
  private dirty = true;
  private blockedUntil = 0;
  private u = 1;
  private width = 0;
  private height = 0;
  private left = 0;
  private contentWidth = 0;
  private contentTop = 0;
  private bottom = 0;
  private maxScroll = 0;
  private viewKey = '';
  private page?: AdventurePage;
  private press: { y: number; scroll: number } | null = null;
  /** Scene control centers in CSS pixels, exposed for pointer validation in development. */
  spots: Record<string, { x: number; y: number }> = {};

  constructor() { super('adventure-menu'); }

  init(options: AdventureSceneOptions): void {
    this.options = options;
    this.view = newAdventureScreen();
    const node = options.controller.adventure?.state.campaign?.map.find((node) => node.id === options.controller.adventure?.state.campaign?.node);
    this.view.mapColumn = node?.column ?? 0;
    if (options.controller.adventure?.state.encounter) this.view.panel = 'here';
    else if (options.controller.adventure?.state.campaign?.loot.length && !options.controller.adventure.state.encounter) this.view.panel = 'here';
    else if (options.controller.adventure?.state.campaign?.active && node && ['shop', 'rest', 'event'].includes(node.kind)) this.view.panel = 'here';
    this.dirty = true;
    this.blockedUntil = 0;
    this.viewKey = '';
    this.press = null;
    this.cameras.main.setScroll(0, 0);
  }

  create(): void {
    const resize = (): void => { this.dirty = true; };
    this.scale.on(Phaser.Scale.Events.RESIZE, resize);
    this.game.canvas.setAttribute('aria-hidden', 'true');
    this.accessible = createAccessibleAdventure(this.game.canvas.parentElement!, (name, details) => this.activate(name, details));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, resize);
      this.accessible?.destroy(); this.accessible = undefined;
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.y / this.u >= this.contentTop && pointer.y / this.u < this.bottom) this.press = { y: pointer.y, scroll: this.cameras.main.scrollY };
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.press && pointer.isDown && Math.abs(pointer.y - this.press.y) > 12 * this.u) this.scrollTo((this.press.scroll + this.press.y - pointer.y) / this.u);
    });
    const cancel = (): void => { this.press = null; };
    this.input.on('pointerup', cancel).on('pointerupoutside', cancel).on('gameout', cancel);
    this.input.on('wheel', (_pointer: unknown, _objects: unknown, _dx: number, dy: number) => this.scrollTo(this.cameras.main.scrollY / this.u + dy));
    this.build();
    this.accessible.focus();
    if (import.meta.env.DEV) Object.assign(window, { adventureScene: this });
  }

  /** Update a visible scene without restarting it or losing its current tab. */
  configure(options: AdventureSceneOptions): void {
    if (options.selection !== this.options.selection) this.view = newAdventureScreen();
    this.options = options;
    this.dirty = true;
  }

  update(): void { if (this.dirty) this.build(); }

  private activate(name: string, details = false): void {
    const control = this.controls.get(name);
    if (!control || control.view.disabled || performance.now() < this.blockedUntil || !this.sys.isActive() || document.querySelector('dialog[open]')) return;
    // A second tap must not activate a different offer or destination that replaced this button.
    this.blockedUntil = performance.now() + 300;
    if (details) control.action.onHold?.();
    else control.action.onSelect();
    this.dirty = true;
  }

  private label(value: string, x: number, y: number, size: number, width: number, color = this.options.theme.cream, fixed = true): Phaser.GameObjects.Text {
    return this.add.text(x * this.u, y * this.u, value, { fontFamily: FONT, fontSize: `${size * this.u}px`, color: cssColor(color),
      wordWrap: { width: width * this.u, useAdvancedWrap: true }, lineSpacing: 2 * this.u }).setScrollFactor(fixed ? 0 : 1).setDepth(fixed ? 11 : 0);
  }

  private button(action: AdventureAction, x: number, y: number, width: number, height = 44, selected = false, fixed = true): void {
    const theme = this.options.theme;
    const disabled = !!action.disabled || this.options.controller.busy;
    const back = this.add.rectangle((x + width / 2) * this.u, (y + height / 2) * this.u, width * this.u, height * this.u,
      selected ? theme.cream : theme.woodDark).setRounded(8 * this.u).setScrollFactor(fixed ? 0 : 1).setDepth(fixed ? 11 : 0);
    back.setStrokeStyle(this.u, theme.cream, selected ? 0.9 : 0.25);
    const text = this.label(action.label, x + 6, y + height / 2, this.height < 500 ? 12 : 14, width - 12,
      selected && !disabled ? theme.background : theme.cream, fixed).setOrigin(0, 0.5);
    // Long action labels wrap within their own touch target.
    if (text.height > (height - 6) * this.u) text.setFontSize(11 * this.u);
    if (action.ariaLabel) text.setX((x + width / 2) * this.u).setOrigin(0.5);
    this.controls.set(action.name, { view: { name: action.name, label: action.ariaLabel ?? action.label, bounds: [x, y, width, height], disabled }, action, fixed });
    this.spots[action.name] = { x: x + width / 2, y: y + height / 2 };
    // A selected but disabled button (the current map stop) keeps full-strength text against the dark fill.
    if (disabled) { back.setFillStyle(theme.ink); text.setAlpha(selected ? 1 : 0.5); }
    else {
      back.setInteractive({ useHandCursor: true });
      bindItemPress(back, this.u, () => this.activate(action.name));
    }
  }

  private build(): void {
    this.dirty = false;
    this.tweens.killAll();
    [...this.children.list].forEach((child) => child.destroy());
    this.controls.clear(); this.spots = {};
    const parent = this.game.canvas.parentElement!;
    this.width = parent.clientWidth; this.height = parent.clientHeight;
    this.u = this.scale.width / Math.max(1, this.width);
    this.contentWidth = Math.min(1060, this.width - 32);
    this.left = (this.width - this.contentWidth) / 2;
    this.cameras.main.setBackgroundColor(this.options.theme.background);
    const page = this.page = adventurePage(this.options.controller, this.view, this.options.selection, () => { this.dirty = true; });
    const key = `${this.options.selection}:${this.view.panel}:${JSON.stringify(this.view.detail)}:${page.current ?? ''}`;
    if (key !== this.viewKey) this.cameras.main.setScroll(0, 0);
    this.viewKey = key;
    const compact = this.height < 500;
    this.button(page.back, this.left, 12, 68);
    this.label(page.title, this.left + 82, compact ? 18 : 16, compact ? 20 : 24, this.contentWidth - 82);
    if (!compact) this.label(page.status, this.left, 65, 13, this.contentWidth);
    const tabY = compact ? 62 : 94;
    if (page.tabs.length) {
      const gap = 5;
      const width = (this.contentWidth - gap * (page.tabs.length - 1)) / page.tabs.length;
      page.tabs.forEach((action, index) => this.button(action, this.left + index * (width + gap), tabY, width, 40, page.selectedTab === action.name));
    }
    this.contentTop = page.tabs.length ? tabY + 52 : compact ? 70 : 96;
    this.bottom = this.height - 124;
    this.maxScroll = 0;
    if (page.map) this.drawMap(page);
    else this.drawCards(page);
    if (page.secondary) this.button(page.secondary, this.left, this.height - 60, 92);
    if (page.primary) this.button(page.primary, this.left + (page.secondary ? 104 : 0), this.height - 60, this.contentWidth - (page.secondary ? 104 : 0), 46, true);
    this.add.rectangle(this.width / 2 * this.u, this.contentTop / 2 * this.u, this.width * this.u, this.contentTop * this.u, this.options.theme.background).setScrollFactor(0).setDepth(10).setInteractive();
    this.add.rectangle(this.width / 2 * this.u, (this.bottom + this.height) / 2 * this.u, this.width * this.u, (this.height - this.bottom) * this.u, this.options.theme.background).setScrollFactor(0).setDepth(10).setInteractive();
    this.scrollTo(this.cameras.main.scrollY / this.u);
  }

  private scrollTo(y: number): void {
    this.cameras.main.setScroll(0, Phaser.Math.Clamp(y, 0, this.maxScroll) * this.u);
    const page = this.page;
    if (!page) return;
    const scroll = this.cameras.main.scrollY / this.u;
    const controls: AccessibleControl[] = [];
    for (const { view, fixed } of this.controls.values()) {
      const [x, y, width, height] = view.bounds;
      const top = fixed ? y : y - scroll;
      if (!fixed && (top + height <= this.contentTop || top >= this.bottom)) continue;
      const clipped = fixed ? top : Math.max(top, this.contentTop);
      controls.push({ ...view, bounds: [x, clipped, width, fixed ? height : Math.min(top + height, this.bottom) - clipped] });
      this.spots[view.name] = { x: x + width / 2, y: clipped + (fixed ? height : Math.min(top + height, this.bottom) - clipped) / 2 };
    }
    const description = [page.status, ...page.cards.map((card) => `${card.title}. ${card.body}`)].join('\n');
    this.accessible?.render(page.title, description, controls, page.selectedTab);
  }

  private drawCards(page: AdventurePage): void {
    const columns = this.contentWidth >= 760 ? 2 : 1;
    const width = (this.contentWidth - (columns - 1) * 16) / columns;
    let y = this.contentTop;
    for (let start = 0; start < page.cards.length; start += columns) {
      let height = 0;
      page.cards.slice(start, start + columns).forEach((card, index) => {
        height = Math.max(height, this.drawCard(card, this.left + index * (width + 16), y, width));
      });
      y += height + 12;
    }
    this.maxScroll = Math.max(0, y - this.bottom);
    if (this.maxScroll) {
      this.button({ name: 'scroll-up', label: 'Scroll up', onSelect: () => this.scrollTo(this.cameras.main.scrollY / this.u - (this.bottom - this.contentTop) * 0.8) }, this.left, this.height - 116, 100, 40);
      this.button({ name: 'scroll-down', label: 'Scroll down', onSelect: () => this.scrollTo(this.cameras.main.scrollY / this.u + (this.bottom - this.contentTop) * 0.8) }, this.left + this.contentWidth - 100, this.height - 116, 100, 40);
    }
  }

  private drawCard(card: AdventureCard, x: number, y: number, width: number): number {
    const theme = this.options.theme;
    const title = this.label(card.title, x + 12, y + 12, 16, width - 24, theme.cream, false);
    const bodyY = y + 18 + title.height / this.u;
    const body = this.label(card.body, x + 12, bodyY, 14, width - 24, theme.cream, false);
    const swatchY = bodyY + body.height / this.u + 10;
    const actions = card.actions ?? [];
    const perRow = card.gearActions ? 4 : width >= 360 ? 3 : 2;
    const actionTop = swatchY + (card.colors?.length ? 30 : 0);
    const height = actionTop - y + Math.ceil(actions.length / perRow) * 48 + 12;
    const back = this.add.rectangle((x + width / 2) * this.u, (y + height / 2) * this.u, width * this.u, height * this.u, theme.ink).setRounded(12 * this.u)
      .setStrokeStyle(this.u, theme.cream, card.selected ? 0.8 : 0.18).setDepth(-1);
    if (card.press) {
      const action = card.press;
      this.controls.set(action.name, { view: { name: action.name, label: action.label, bounds: [x, y, width, height], disabled: false, details: !!action.onHold }, action, fixed: false });
      back.setInteractive({ useHandCursor: true });
      bindItemPress(back, this.u, () => this.activate(action.name), () => this.activate(action.name, true));
    }
    card.colors?.forEach((color, index) => {
      const cx = x + 12 + index * 27;
      this.add.rectangle((cx + 10) * this.u, (swatchY + 10) * this.u, 21 * this.u, 21 * this.u, theme.palette[color]).setRounded(4 * this.u);
      this.label(String(color + 1), cx, swatchY + 1, 12, 21, 0x17251b, false).setAlign('center');
    });
    const buttonWidth = (width - 24 - (Math.min(perRow, actions.length) - 1) * 6) / Math.max(1, Math.min(perRow, actions.length));
    if (card.gearActions) {
      // Icon buttons sit flush right so every card's remove button lines up.
      const detailsWidth = width - 24 - (actions.length - 1) * 50;
      actions.forEach((action, index) => this.button(action, x + 12 + (index ? detailsWidth + 6 + (index - 1) * 50 : 0), actionTop, index ? 44 : detailsWidth, 44, false, false));
    } else actions.forEach((action, index) => this.button(action, x + 12 + index % perRow * (buttonWidth + 6), actionTop + Math.floor(index / perRow) * 48, buttonWidth, 44, false, false));
    return height;
  }

  private drawMap(page: AdventurePage): void {
    const theme = this.options.theme;
    const lastColumn = Math.max(...page.map!.map((node) => node.column));
    const columns = Math.min(lastColumn + 1, this.contentWidth >= 700 ? 5 : 3);
    this.view.mapColumn = Phaser.Math.Clamp(this.view.mapColumn, 0, lastColumn - columns + 1);
    const columnWidth = this.contentWidth / columns;
    const top = this.contentTop + 28;
    const rowHeight = Math.min(56, Math.max(45, (this.bottom - top) / 3));
    const nodes = page.map!.filter((node) => node.column >= this.view.mapColumn && node.column < this.view.mapColumn + columns);
    const position = (column: number, lane: number): { x: number; y: number } => ({ x: this.left + (column - this.view.mapColumn) * columnWidth + columnWidth / 2, y: top + lane * rowHeight + 22 });
    const lines = this.add.graphics().lineStyle(2 * this.u, theme.cream, 0.3);
    for (const node of nodes) for (const id of node.next) {
      const next = nodes.find((entry) => entry.id === id);
      if (!next) continue;
      const a = position(node.column, node.lane); const b = position(next.column, next.lane);
      lines.lineBetween(a.x * this.u, a.y * this.u, b.x * this.u, b.y * this.u);
    }
    for (let column = 0; column < columns; column++) this.label(String(this.view.mapColumn + column + 1), this.left + column * columnWidth + 8, this.contentTop, 14, columnWidth);
    nodes.forEach((node) => {
      const { x, y } = position(node.column, node.lane);
      const visited = page.visited?.includes(node.id);
      const kind = node.hidden && !visited && page.current !== node.id ? 'Unknown' : adventureName(node.kind);
      const label = `${kind}${['fight', 'elite', 'boss'].includes(node.kind) ? ` ${node.tier}` : ''}${visited ? ' ✓' : ''}`;
      this.button({ name: `travel-${node.id}`, label, disabled: !page.reachable?.includes(node.id), onSelect: () => page.travel?.(node) }, x - columnWidth * 0.43, y - 22, columnWidth * 0.86, 44, node.id === page.current);
    });
    this.button({ name: 'previous-route', label: 'Earlier', disabled: this.view.mapColumn === 0, onSelect: () => { this.view.mapColumn = Math.max(0, this.view.mapColumn - columns); } }, this.left, this.height - 116, 92, 40);
    this.label(`Trail ${this.view.mapColumn + 1}–${this.view.mapColumn + columns} / ${lastColumn + 1}`, this.left + 100, this.height - 105, 13, this.contentWidth - 200);
    this.button({ name: 'next-route', label: 'Ahead', disabled: this.view.mapColumn >= lastColumn - columns + 1, onSelect: () => { this.view.mapColumn = Math.min(lastColumn - columns + 1, this.view.mapColumn + columns); } }, this.left + this.contentWidth - 92, this.height - 116, 92, 40);
  }
}
