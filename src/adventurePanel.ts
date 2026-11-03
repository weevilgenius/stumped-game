import type { AdventureState, ColorId, ConsumableDef, EncounterState, Goods, ItemDef, ItemPlace, NodeKind, SlotState } from './adventure/engine';
import { bandOf, harvestColors, MAX_PACK, MAX_SLOTS, nextHit, XP_PER_LEVEL } from './adventure/engine';
import { choices, type RunCommand, sellPrice } from './adventure/campaign';
import { EVENTS, PRICES, REST_HEAL } from './adventure/content/campaign';

/* ========================================================= *\
 *  Adventure text and the between-round panel: the map, the *
 *  stop here (fight, loot, shop, rest, event), and gear.    *
 *  Built as HTML strings; every button carries the run      *
 *  command it sends in data-command.                        *
\* ========================================================= */

/** Node names, for the map and its legend. */
export const NODE_NAMES: Readonly<Record<NodeKind, string>> = {
  fight: 'Fight', elite: 'Elite', boss: 'Boss', shop: 'Shop', rest: 'Rest', event: 'Event', forage: 'Forage',
};

/** One-letter map symbols. */
const NODE_SYMBOLS: Readonly<Record<NodeKind, string>> = {
  fight: 'F', elite: 'E', boss: 'B', shop: '$', rest: 'R', event: '?', forage: 'H',
};

const EFFECT_NAMES = { attack: 'Attack', block: 'Block', heal: 'Heal', forage: 'Supplies' } as const;

/**
 * A content identifier as a display name.
 * @param id identifier, such as 'tower shield'
 * @returns 'Tower shield'
 */
export function titleOf(id: string): string {
  return `${id[0]?.toUpperCase() ?? ''}${id.slice(1)}`;
}

const escape = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A button that sends a run command, or a disabled one for null. */
export const button = (label: string, command: RunCommand | null, extra = ''): string => `<button type="button" class="text-button"${
  command ? ` data-command="${escape(JSON.stringify(command))}"` : ' disabled'} ${extra}>${label}</button>`;

/**
 * Color swatches, as HTML.
 * @param colors palette indexes
 * @param color CSS color of a palette index
 * @returns HTML
 */
export const swatches = (colors: readonly ColorId[], color: (c: ColorId) => string): string => `<span class="swatches">${
  colors.map((c) => `<i style="background:${color(c)}"></i>`).join('')}</span>`;

/**
 * An item's exact values: effect, colors, bands at its level, cooldown or charge, and level progress.
 * @param item the item
 * @param slot its state, if equipped or packed
 * @returns plain sentences
 */
export function itemDetails(item: ItemDef, slot?: SlotState): string[] {
  const level = slot?.level ?? 0;
  const values = item.bands.map((band, i) => {
    const next = item.bands[i + 1];
    const range = next ? `${band.min}-${next.min - 1}` : `${band.min}+`;
    return `${range}: ${bandOf(item.bands, band.min, level).value}`;
  });
  const lines = [`${EFFECT_NAMES[item.effect]} by ${item.charge ? 'total charged squares' : 'color size'}: ${values.join(', ')}.`];
  if (item.charge) lines.push(`Charges: fires once it has taken all ${item.colors.length} of its colors in one puzzle.`);
  if (item.cooldown) lines.push(`Cooldown: skipped for ${item.cooldown} turns after it fires.`);
  if (slot && item.effect !== 'heal' && item.effect !== 'forage') {
    lines.push(`Level ${level}: ${slot.xp ?? 0}/${XP_PER_LEVEL} harvested squares toward the next (one level per fight).`);
  } else if (level) {
    lines.push(`Level ${level}.`);
  }
  return lines;
}

/**
 * An encounter's exact values: health, next hit and its timing, attack cycle, enrage or flee, and harvest colors.
 * @param encounter the encounter
 * @returns plain sentences, without harvest colors (shown as swatches)
 */
export function encounterDetails(encounter: EncounterState): string[] {
  if (encounter.type === 'forage') return ['No enemy: every color harvests as experience or supplies.'];
  if (encounter.type === 'objective') {
    return [`Progress ${encounter.progress}/${encounter.def.goal}. Deadline in ${encounter.countdown} turns, or ${encounter.def.failDamage} damage.`];
  }
  const { def } = encounter;
  if (encounter.phase === 'scavenge') return ['Defeated. Harvest colors level up readied items or become supplies.'];
  const lines = [
    `Health ${encounter.health}/${def.health}.`,
    `Next hit: ${nextHit(encounter)} damage ${encounter.countdown <= 1 ? 'this turn' : `in ${encounter.countdown} turns`}.`,
    `Attack cycle: ${def.intents.map((intent) => `${intent.damage + (encounter.rage ?? 0)} damage after ${intent.delay} turns`).join(', then ')}.`,
  ];
  const fought = encounter.rounds ?? 0;
  if (def.flee) lines.push(`Flees with its loot after ${def.flee} ${def.flee === 1 ? 'puzzle' : 'puzzles'} (${Math.max(0, def.flee - fought)} left).`);
  if (def.enrage) lines.push(`Enrages: +${def.enrage} damage for each new puzzle (now +${encounter.rage ?? 0}).`);
  if (def.boss) lines.push('Boss: no fleeing. Defeat it to win the run.');
  return lines;
}

/**
 * A consumable's effect.
 * @param item the consumable
 * @returns one sentence
 */
export function consumableDetails(item: ConsumableDef): string {
  const what = { heal: `Heals ${item.value}`, block: `Blocks ${item.value}`, attack: `Deals ${item.value} damage` }[item.effect];
  return `${what}. Free to use at any time, even mid-puzzle.`;
}

const goodsLine = (goods: Goods, color: (c: ColorId) => string): string => (goods.kind === 'gear'
  ? `${swatches(goods.item.colors, color)} <b>${titleOf(goods.item.id)}</b> <small>${itemDetails(goods.item).join(' ')}</small>`
  : `<b>${titleOf(goods.item.id)}</b> <small>${consumableDetails(goods.item)}</small>`);

/** What the panel draws with. */
export interface PanelView {
  /** The run. */
  readonly state: Readonly<AdventureState>;
  /** CSS color of a palette index. */
  readonly color: (c: ColorId) => string;
  /** The item picked up to move, if any. */
  readonly moving: ItemPlace | null;
}

/**
 * The between-round panel for a campaign run: stop, gear, and map.
 * @param view what to draw
 * @returns HTML
 */
export function panelHtml({ state, color, moving }: PanelView): string {
  const campaign = state.campaign;
  if (!campaign || state.phase !== 'between') return '';
  const parts: string[] = [];
  const encounter = state.encounter;
  const supplies = state.resources.supplies ?? 0;

  // The stop here.
  if (encounter) {
    const name = encounter.type === 'forage' ? 'Forage' : titleOf(encounter.def.id);
    const harvest = harvestColors(encounter);
    parts.push(`<p><b>${name}</b> ${encounter.type === 'enemy' && encounter.def.boss ? '(boss)' : ''}</p>`,
      `<p class="detail">${encounterDetails(encounter).join(' ')}${harvest ? ` Harvest: ${swatches(harvest, color)}` : ''}</p>`);
    if (encounter.type === 'enemy' && encounter.phase === 'active' && !encounter.def.boss) {
      parts.push(`<p>${button(`Flee (take ${nextHit(encounter)} damage, no loot)`, { type: 'flee' })}</p>`);
    }
  }
  if (campaign.loot.length) {
    parts.push('<p><b>Loot</b></p><ul class="goods">', ...campaign.loot.map((goods, index) => `<li>${goodsLine(goods, color)} ${button('Take', { type: 'take-loot', index })}</li>`), '</ul>');
  }
  if (campaign.shop) {
    const missing = state.maxHealth - state.health;
    parts.push(`<p><b>Shop</b> (items sell for half price)</p><ul class="goods">`,
      ...campaign.shop.stock.map((entry, index) => (entry
        ? `<li>${goodsLine(entry.goods, color)} ${button(`Buy for ${entry.price}`, supplies >= entry.price ? { type: 'buy', index } : null)}</li>`
        : '<li class="sold">Sold</li>')),
      `<li>Healing, ${PRICES.health} supplies each: ${[1, 5].map((amount) => button(`+${Math.min(amount, missing)}`,
        missing > 0 && supplies >= Math.min(amount, missing) * PRICES.health ? { type: 'buy-health', amount } : null)).join(' ')}</li></ul>`);
  }
  if (campaign.rest) {
    parts.push(`<p><b>Rest</b>: ${button(`Heal ${Math.ceil(state.maxHealth * REST_HEAL)}`, { type: 'rest', choice: 'heal' })} or upgrade one item below.</p>`);
  }
  const event = EVENTS.find((e) => e.id === campaign.event);
  if (event) {
    parts.push(`<p>${event.text}</p><p>${event.options.map((option, i) => button(option.label,
      (option.supplies ?? 0) <= supplies && state.health + Math.min(0, option.health ?? 0) > 0 ? { type: 'answer', option: i } : null)).join(' ')}</p>`);
  }

  // Gear: equipped in priority order, the pack, and consumables.
  const row = (slot: SlotState, place: ItemPlace): string => {
    const here = moving?.area === place.area && moving.index === place.index;
    const actions = [
      moving ? (here ? button('Cancel', null, 'data-move="cancel"') : button('Here', { type: 'move-item', from: moving, to: place }))
        : `<button type="button" class="text-button" data-move="${place.area}:${place.index}">Move</button>`,
      place.area === 'slots' ? button(slot.ready ? 'Unready' : 'Ready', { type: 'set-ready', slot: place.index, ready: !slot.ready }) : '',
      campaign.rest ? button('Upgrade', { type: 'rest', choice: 'upgrade', from: place }) : '',
      campaign.shop ? button(`Sell for ${sellPrice(slot.item)}`, { type: 'sell', from: place }) : button('Drop', { type: 'drop-item', from: place }),
    ];
    return `<li class="${slot.ready || place.area === 'pack' ? '' : 'unready'}${here ? ' moving' : ''}">${swatches(slot.item.colors, color)} <b>${titleOf(slot.item.id)}${
      slot.level ? ` +${slot.level}` : ''}</b> <small>${itemDetails(slot.item, slot).join(' ')}</small> ${actions.join(' ')}</li>`;
  };
  const empty = (area: ItemPlace['area'], count: number, max: number): string => (moving && count < max
    ? `<li class="empty">Empty ${button('Here', { type: 'move-item', from: moving, to: { area, index: count } })}</li>` : '');
  const pack = state.pack ?? [];
  parts.push(`<p><b>Equipped</b> (first readied item that takes a color gets it)</p><ol class="goods">`,
    ...state.slots.map((slot, index) => row(slot, { area: 'slots', index })), empty('slots', state.slots.length, MAX_SLOTS), '</ol>',
    `<p><b>Pack</b> (${pack.length}/${MAX_PACK})</p><ul class="goods">`,
    ...pack.map((slot, index) => row(slot, { area: 'pack', index })), empty('pack', pack.length, MAX_PACK), '</ul>');
  const consumables = state.consumables ?? [];
  if (consumables.length) {
    parts.push('<p><b>Consumables</b></p><ul class="goods">', ...consumables.map((item, index) => `<li><b>${titleOf(item.id)}</b> <small>${
      consumableDetails(item)}</small> ${button('Use', item.effect === 'attack' && encounter?.type !== 'enemy' ? null : { type: 'use-consumable', index })}</li>`), '</ul>');
  }

  // The map, boss at the top.
  const reachable = choices(state);
  const columns = Math.max(...campaign.nodes.map((n) => n.column)) + 1;
  const ROW = 34;
  const x = (lane: number, lanes: number): number => ((lane + 0.5) / lanes) * 100;
  const y = (column: number): number => (columns - 1 - column) * ROW + ROW / 2;
  const lines = campaign.nodes.flatMap((node) => node.next.map((n) => {
    const to = campaign.nodes[n];
    return `<line x1="${x(node.lane, node.lanes)}" y1="${y(node.column)}" x2="${x(to.lane, to.lanes)}" y2="${y(to.column)}" />`;
  }));
  const nodes = campaign.nodes.map((node, i) => {
    const label = `${NODE_NAMES[node.kind]}${node.kind === 'fight' || node.kind === 'elite' ? `, danger ${node.tier}` : ''}`;
    const state_ = i === campaign.at ? ' here' : campaign.visited.includes(i) ? ' visited' : '';
    const go = reachable.includes(i);
    return `<button type="button" class="node ${node.kind}${state_}${go ? ' go' : ''}" style="left:${x(node.lane, node.lanes)}%;top:${y(node.column)}px"${
      go ? ` data-command="${escape(JSON.stringify({ type: 'move', node: i }))}"` : ' disabled'} aria-label="${label}${go ? ', travel here' : ''}" title="${label}">${
      NODE_SYMBOLS[node.kind]}${node.kind === 'fight' || node.kind === 'elite' ? `<sub>${node.tier}</sub>` : ''}</button>`;
  });
  parts.push(`<p><b>Map</b> ${reachable.length ? '(choose where to go next)' : encounter ? '(finish this fight first)' : ''}</p>`,
    `<div class="map" style="height:${columns * ROW}px"><svg viewBox="0 0 100 ${columns * ROW}" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>${nodes.join('')}</div>`,
    `<p class="detail">${Object.entries(NODE_SYMBOLS).map(([kind, symbol]) => `${symbol} ${NODE_NAMES[kind as NodeKind]}`).join(' · ')}. Numbers are danger.</p>`);
  return parts.join('');
}
