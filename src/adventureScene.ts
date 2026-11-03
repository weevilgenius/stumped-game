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
  /** Scene control centers in CSS pixels, exposed for pointer validation in development. */
  spots: Record<string, { x: number; y: number }> = {};

  constructor() { super('adventure-menu'); }

  init(options: AdventureSceneOptions): void {
    this.options = options;
    this.view = newAdventureScreen();
    const node = options.controller.adventure?.state.campaign?.map.find((node) => node.id === options.controller.adventure?.state.campaign?.node);
    this.view.mapColumn = Math.max(0, (node?.column ?? 0) - 1);
    if (options.controller.adventure?.state.campaign?.loot.length && !options.controller.adventure.state.encounter) this.view.panel = 'loot';
    else if (options.controller.adventure?.state.campaign?.active && node && ['shop', 'rest', 'event'].includes(node.kind)) this.view.panel = 'location';
    this.dirty = true;
    this.blockedUntil = 0;
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
    if (!control || control.view.disabled || performance.now() < this.blockedUntil || !this.sys.isActive()) return;
    // A second tap must not activate a different offer or destination that replaced this button.
    this.blockedUntil = performance.now() + 300;
    if (details) control.action.onHold?.();
    else control.action.onSelect();
    this.dirty = true;
  }

  private label(value: string, x: number, y: number, size: number, width: number, color = this.options.theme.cream): Phaser.GameObjects.Text {
    return this.add.text(x * this.u, y * this.u, value, { fontFamily: FONT, fontSize: `${size * this.u}px`, color: cssColor(color),
      wordWrap: { width: width * this.u, useAdvancedWrap: true }, lineSpacing: 2 * this.u });
  }

  private button(action: AdventureAction, x: number, y: number, width: number, height = 44, selected = false): void {
    const theme = this.options.theme;
    const disabled = !!action.disabled || this.options.controller.busy;
    const back = this.add.rectangle((x + width / 2) * this.u, (y + height / 2) * this.u, width * this.u, height * this.u,
      selected ? theme.cream : theme.woodDark).setRounded(8 * this.u);
    back.setStrokeStyle(this.u, theme.cream, selected ? 0.9 : 0.25);
    const text = this.label(action.label, x + 6, y + height / 2, this.height < 500 ? 12 : 14, width - 12,
      selected ? theme.background : theme.cream).setOrigin(0, 0.5);
    // Long action labels wrap within their own touch target.
    if (text.height > (height - 6) * this.u) text.setFontSize(11 * this.u);
    this.controls.set(action.name, { view: { name: action.name, label: action.label, bounds: [x, y, width, height], disabled }, action });
    this.spots[action.name] = { x: x + width / 2, y: y + height / 2 };
    if (disabled) { back.setAlpha(0.4); text.setAlpha(0.5); }
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
    const page = adventurePage(this.options.controller, this.view, this.options.selection, () => { this.dirty = true; });
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
    if (page.map) this.drawMap(page);
    else this.drawCards(page);
    if (page.secondary) this.button(page.secondary, this.left, this.height - 60, 92);
    if (page.primary) this.button(page.primary, this.left + (page.secondary ? 104 : 0), this.height - 60, this.contentWidth - (page.secondary ? 104 : 0), 46, true);
    const description = [page.status, ...page.cards.map((card) => `${card.title}. ${card.body}`)].join('\n');
    this.accessible?.render(page.title, description, [...this.controls.values()].map(({ view }) => view), page.selectedTab);
  }

  private drawCards(page: AdventurePage): void {
    const columns = this.contentWidth >= 760 ? 2 : 1;
    const width = (this.contentWidth - (columns - 1) * 16) / columns;
    const available = Math.max(130, this.bottom - this.contentTop);
    const desired = (page.cards.some((card) => (card.actions?.length ?? 0) > 2) ? 210 : 180);
    const rows = Math.max(1, Math.floor((available + 12) / (desired + 12)));
    const count = rows * columns;
    const pages = Math.max(1, Math.ceil(page.cards.length / count));
    this.view.page = Math.min(this.view.page, pages - 1);
    const cards = page.cards.slice(this.view.page * count, (this.view.page + 1) * count);
    const height = Math.min(260, (available - (rows - 1) * 12) / rows);
    cards.forEach((card, index) => this.drawCard(card, this.left + index % columns * (width + 16), this.contentTop + Math.floor(index / columns) * (height + 12), width, height));
    if (pages > 1) {
      this.button({ name: 'previous-page', label: 'Previous', disabled: this.view.page === 0, onSelect: () => { this.view.page--; } }, this.left, this.height - 116, 100, 40);
      this.label(`${this.view.page + 1} / ${pages}`, this.left + this.contentWidth / 2 - 25, this.height - 105, 14, 70);
      this.button({ name: 'next-page', label: 'Next', disabled: this.view.page >= pages - 1, onSelect: () => { this.view.page++; } }, this.left + this.contentWidth - 100, this.height - 116, 100, 40);
    }
  }

  private drawCard(card: AdventureCard, x: number, y: number, width: number, height: number): void {
    const theme = this.options.theme;
    const back = this.add.rectangle((x + width / 2) * this.u, (y + height / 2) * this.u, width * this.u, height * this.u, theme.ink).setRounded(12 * this.u)
      .setStrokeStyle(this.u, theme.cream, card.selected ? 0.8 : 0.18);
    if (card.press) {
      const action = card.press;
      this.controls.set(action.name, { view: { name: action.name, label: action.label, bounds: [x, y, width, height], disabled: false, details: !!action.onHold }, action });
      back.setInteractive({ useHandCursor: true });
      bindItemPress(back, this.u, () => this.activate(action.name), () => this.activate(action.name, true));
    }
    this.label(card.title, x + 12, y + 12, 16, width - 24);
    const actions = card.actions ?? [];
    const perRow = width >= 360 ? 3 : 2;
    const actionRows = Math.ceil(actions.length / perRow);
    const actionTop = y + height - 12 - actionRows * 48;
    const swatchY = actionTop - (card.colors?.length ? 28 : 0);
    const text = this.label(card.body, x + 12, y + 40, this.height < 500 ? 12 : 14, width - 24);
    const maxLines = Math.max(1, Math.floor((swatchY - y - 44) / (this.height < 500 ? 17 : 20)));
    const lines = text.getWrappedText(card.body);
    if (lines.length > maxLines) text.setText([...lines.slice(0, maxLines - 1), `${lines[maxLines - 1].replace(/\s+\S*$/, '')}…`].join('\n'));
    card.colors?.forEach((color, index) => {
      const cx = x + 12 + index * 27;
      this.add.rectangle((cx + 10) * this.u, (swatchY + 10) * this.u, 21 * this.u, 21 * this.u, theme.palette[color]).setRounded(4 * this.u);
      this.label(String(color + 1), cx, swatchY + 1, 12, 21, 0x17251b).setAlign('center');
    });
    const buttonWidth = (width - 24 - (Math.min(perRow, actions.length) - 1) * 6) / Math.max(1, Math.min(perRow, actions.length));
    actions.forEach((action, index) => this.button(action, x + 12 + index % perRow * (buttonWidth + 6), actionTop + Math.floor(index / perRow) * 48, buttonWidth));
  }

  private drawMap(page: AdventurePage): void {
    const theme = this.options.theme;
    const columns = this.contentWidth >= 700 ? 5 : 3;
    this.view.mapColumn = Phaser.Math.Clamp(this.view.mapColumn, 0, 15 - columns);
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
    this.label(`Trail ${this.view.mapColumn + 1}–${this.view.mapColumn + columns} / 15`, this.left + 100, this.height - 105, 13, this.contentWidth - 200);
    this.button({ name: 'next-route', label: 'Ahead', disabled: this.view.mapColumn >= 15 - columns, onSelect: () => { this.view.mapColumn = Math.min(15 - columns, this.view.mapColumn + columns); } }, this.left + this.contentWidth - 92, this.height - 116, 92, 40);
  }
}
