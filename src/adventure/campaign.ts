import mulberry32 from '../utils/mulberry';
import {
  type AdventureCommand, type AdventureEvent, type AdventureState, type CampaignState, type ColorId, type EncounterDef,
  type EngineResult, type Goods, type ItemDef, type ItemPlace, type MapNode, MAX_CONSUMABLES, MAX_PACK, MAX_SLOTS, type NodeKind,
  type RejectReason, slotOf, startRun, step,
} from './engine';
import {
  BOSS, COLORS, CONSUMABLES, ELITE_HEALTH, ENEMIES, type EnemyTemplate, EVENTS, type ItemTemplate, ITEMS, MAP_COLUMNS, PRICES,
  REST_HEAL, type Starter,
} from './content/campaign';

/* ========================================================= *\
 *  Campaign rules: the seeded map, the stop at each node    *
 *  (fight, shop, rest, event, forage), and loot. Combat is  *
 *  the engine's step(); advance() wraps it so one command   *
 *  log replays a whole run. See docs/adventure-mode-plan.md *
 *  phase 7.                                                 *
\* ========================================================= */

/** Commands for the run between fights. Everything else goes to the engine. */
export type CampaignCommand =
  | {
    /** Travels to a node the current one leads to. Only once the fight here is over. */
    readonly type: 'move';
    readonly node: number;
  }
  | {
    /** Picks up one of the last kill's drops. */
    readonly type: 'take-loot';
    readonly index: number;
  }
  | {
    /** Buys one of the shop's goods. */
    readonly type: 'buy';
    readonly index: number;
  }
  | {
    /** Pays the shop for healing. */
    readonly type: 'buy-health';
    readonly amount: number;
  }
  | {
    /** Sells an item to the shop for half its price. */
    readonly type: 'sell';
    readonly from: ItemPlace;
  }
  | {
    /** Uses the rest here: heal, or level up one item. */
    readonly type: 'rest';
    readonly choice: 'heal' | 'upgrade';
    /** The item to upgrade. */
    readonly from?: ItemPlace;
  }
  | {
    /** Answers the event here. */
    readonly type: 'answer';
    readonly option: number;
  };

/** Any command a campaign run accepts. */
export type RunCommand = AdventureCommand | CampaignCommand;

class Rejected extends Error {
  constructor(readonly reason: RejectReason) {
    super(reason);
  }
}

const reject = (reason: RejectReason): never => {
  throw new Rejected(reason);
};

/** A random source for one purpose, derived from the run's seed so every draw replays exactly. */
const rng = (seed: number, ...salts: readonly number[]): () => number => mulberry32(
  salts.reduce((h, salt) => Math.imul(h ^ (salt + 0x9e3779b9), 0x85ebca6b) >>> 0, seed >>> 0),
);

const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)];

const shuffled = <T>(random: () => number, list: readonly T[]): T[] => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const ALL_COLORS: readonly ColorId[] = Array.from({ length: COLORS }, (_, i) => i);

/** Danger tier of a column: early, middle, or late. */
const columnTier = (column: number): number => (column < 5 ? 1 : column < 10 ? 2 : 3);

/* ------------------------------------------------------- *\
 *  Map                                                    *
\* ------------------------------------------------------- */

/**
 * Builds a run's layered map: 2 or 3 nodes per column, paths that cross and merge,
 * a guaranteed shop in columns 3 to 5, rests before the boss, and the boss last.
 * @param seed the run's seed
 * @returns every node, column by column
 */
export function generateMap(seed: number): MapNode[] {
  const random = rng(seed, 1);
  const counts = Array.from({ length: MAP_COLUMNS }, (_, c) => (c === MAP_COLUMNS - 1 ? 1 : c === 0 ? 3 : 2 + Math.floor(random() * 2)));
  const starts = counts.map((_, c) => counts.slice(0, c).reduce((a, b) => a + b, 0));
  const shopColumn = 3 + Math.floor(random() * 3);
  const shopLane = Math.floor(random() * counts[shopColumn]);
  const kindAt = (column: number, lane: number): NodeKind => {
    if (column === MAP_COLUMNS - 1) return 'boss';
    if (column === MAP_COLUMNS - 2) return 'rest';
    if (column <= 1) return 'fight';
    if (column === shopColumn && lane === shopLane) return 'shop';
    const roll = random();
    const weights: [NodeKind, number][] = [
      ['elite', column >= 5 ? 0.12 : 0], ['event', 0.13], ['forage', 0.13], ['rest', column >= 6 ? 0.1 : 0], ['shop', column >= 7 ? 0.07 : 0],
    ];
    let total = 0;
    for (const [kind, weight] of weights) {
      total += weight;
      if (roll < total) return kind;
    }
    return 'fight';
  };
  const next: number[][] = counts.flatMap((n) => Array.from({ length: n }, () => []));
  const nearest = (lane: number, from: number, to: number): number => Math.min(to - 1, Math.max(0, Math.round((lane + 0.5) / from * to - 0.5)));
  for (let c = 0; c < MAP_COLUMNS - 1; c++) {
    const [n, m] = [counts[c], counts[c + 1]];
    for (let lane = 0; lane < n; lane++) {
      const j = nearest(lane, n, m);
      const out = next[starts[c] + lane];
      out.push(starts[c + 1] + j);
      // Sometimes a second path to a neighbor, so routes cross and merge.
      const side = j + (random() < 0.5 ? -1 : 1);
      if (random() < 0.45 && side >= 0 && side < m) out.push(starts[c + 1] + side);
    }
    // Every node is reachable.
    for (let j = 0; j < m; j++) {
      const id = starts[c + 1] + j;
      if (!next.slice(starts[c], starts[c] + n).some((out) => out.includes(id))) next[starts[c] + nearest(j, m, n)].push(id);
    }
  }
  return counts.flatMap((lanes, column) => Array.from({ length: lanes }, (_, lane): MapNode => {
    const kind = kindAt(column, lane);
    const tier = Math.min(3, columnTier(column) + (kind === 'elite' ? 1 : 0));
    return { column, lane, lanes, kind, tier, next: next[starts[column] + lane].sort((a, b) => a - b) };
  }));
}

/**
 * A new campaign run, before the first move.
 * @param starter the starting character
 * @param seed seed for the map, enemies, loot, shops, and events
 * @returns the run's starting state
 */
export function newCampaign(starter: Starter, seed: number): AdventureState {
  const { name: _name, description: _description, unlockWins: _unlock, ...character } = starter;
  const state = startRun(character);
  state.campaign = { seed: seed >>> 0, nodes: generateMap(seed), at: null, visited: [], loot: [], shop: null, event: null, rest: false };
  return state;
}

/**
 * Nodes the player can travel to next, or none while a fight is under way.
 * @param state the run
 * @returns node indexes
 */
export function choices(state: Readonly<AdventureState>): readonly number[] {
  const campaign = state.campaign;
  if (!campaign || state.phase !== 'between' || state.encounter) return [];
  if (campaign.at === null) return campaign.nodes.flatMap((node, i) => (node.column === 0 ? [i] : []));
  return campaign.nodes[campaign.at].next;
}

/* ------------------------------------------------------- *\
 *  Goods and prices                                       *
\* ------------------------------------------------------- */

const makeItem = (random: () => number, { item, colors: [fewest, most] }: ItemTemplate): ItemDef => {
  const count = fewest + Math.floor(random() * (most - fewest + 1));
  return { ...item, colors: shuffled(random, ALL_COLORS).slice(0, count).sort((a, b) => a - b) };
};

/** Gear of about a tier: the tier itself more often than the one below. */
const rollGear = (random: () => number, tier: number): Goods => {
  const at = random() < 0.6 ? tier : Math.max(1, tier - 1);
  return { kind: 'gear', item: makeItem(random, pick(random, ITEMS.filter((t) => t.item.tier === at))) };
};

const rollConsumable = (random: () => number): Goods => ({ kind: 'consumable', item: pick(random, CONSUMABLES) });

const rollGoods = (random: () => number, tier: number): Goods => (random() < 0.7 ? rollGear(random, tier) : rollConsumable(random));

/**
 * What an item costs at a shop.
 * @param goods the gear or consumable
 * @returns its price in supplies
 */
export function priceOf(goods: Goods): number {
  return goods.kind === 'gear' ? PRICES.gear[goods.item.tier ?? 1] ?? PRICES.gear[1] : PRICES.consumable[goods.item.id] ?? 10;
}

/**
 * What a shop pays for an item: half its price.
 * @param item the item
 * @returns supplies
 */
export function sellPrice(item: ItemDef): number {
  return Math.floor(priceOf({ kind: 'gear', item }) / 2);
}

/* ------------------------------------------------------- *\
 *  Stops                                                  *
\* ------------------------------------------------------- */

const enemyFor = (template: EnemyTemplate, random: () => number, elite: boolean): EncounterDef => {
  const { tier: _tier, supplies: _supplies, ...def } = template;
  return {
    ...def, type: 'enemy', scavenge: [],
    health: Math.round(template.health * (elite ? ELITE_HEALTH : 1)),
    harvest: shuffled(random, ALL_COLORS).slice(0, 2 + Math.floor(random() * 2)).sort((a, b) => a - b),
  };
};

/** The enemy template at a fight node. */
const templateAt = (campaign: CampaignState, index: number): EnemyTemplate => {
  const node = campaign.nodes[index];
  return node.kind === 'boss' ? BOSS : pick(rng(campaign.seed, 2, index), ENEMIES.filter((e) => e.tier === node.tier));
};

const rollLoot = (campaign: CampaignState, index: number): { loot: Goods[]; supplies: number } => {
  const node = campaign.nodes[index];
  const random = rng(campaign.seed, 3, index);
  const elite = node.kind === 'elite';
  const count = elite || node.tier === 3 ? 3 + Math.floor(random() * 2) : node.tier === 2 ? 2 + Math.floor(random() * 3) : 2 + Math.floor(random() * 2);
  const loot = Array.from({ length: count }, () => rollGoods(random, node.tier));
  const supplies = Math.round(templateAt(campaign, index).supplies * (elite ? 1.5 : 1));
  return { loot, supplies };
};

/**
 * Applies one command to a campaign run: map moves and stops here, the rest through the
 * engine. The same state and commands always give the same result, and an invalid
 * command changes nothing and returns one `command-rejected` event.
 * @param state the current run, which is not modified
 * @param command what happened
 * @returns the new state and the events, in order
 */
export function advance(state: AdventureState, command: RunCommand): EngineResult {
  let next = structuredClone(state);
  const events: AdventureEvent[] = [];
  /** Runs an engine command on the working state. */
  const engine = (sub: AdventureCommand): void => {
    const result = step(next, sub);
    if (result.events[0]?.type === 'command-rejected') reject(result.events[0].reason);
    next = result.state;
    events.push(...result.events);
  };
  try {
    if (next.phase === 'ended') reject('run-ended');
    if (!isCampaignCommand(command)) {
      const dropped = command.type === 'drop-item' ? (command.from.area === 'pack' ? next.pack : next.slots)?.[command.from.index] : undefined;
      engine(command);
      // A dropped item stays here as loot until the player moves on.
      if (dropped && next.campaign) next.campaign.loot.push({ kind: 'gear', item: dropped.item, slot: dropped });
    } else {
      const campaign = next.campaign ?? reject('wrong-phase');
      if (next.phase !== 'between') reject('wrong-phase');
      campaignCommand(next, campaign, command, events, engine);
    }
    // A kill drops its loot at once, from the run's seed, so a reload cannot reroll it.
    const campaign = next.campaign;
    if (campaign?.at != null && events.some((e) => e.type === 'encounter-transitioned' && e.outcome === 'defeated')
      && campaign.nodes[campaign.at].kind !== 'boss') {
      const { loot, supplies } = rollLoot(campaign, campaign.at);
      campaign.loot = loot;
      addSupplies(next, events, supplies);
      events.push({ type: 'loot-dropped', loot, supplies });
    }
  } catch (error) {
    if (!(error instanceof Rejected)) throw error;
    return { state, events: [{ type: 'command-rejected', command: command.type, reason: error.reason }] };
  }
  return { state: next, events };
}

const CAMPAIGN_COMMANDS: readonly string[] = ['move', 'take-loot', 'buy', 'buy-health', 'sell', 'rest', 'answer'] satisfies CampaignCommand['type'][];
const isCampaignCommand = (command: RunCommand): command is CampaignCommand => CAMPAIGN_COMMANDS.includes(command.type);

const addSupplies = (state: AdventureState, events: AdventureEvent[], amount: number): void => {
  if (amount === 0) return;
  const total = (state.resources.supplies ?? 0) + amount;
  if (total < 0) reject('no-supplies');
  state.resources.supplies = total;
  events.push({ type: 'resource-changed', resource: 'supplies', amount, total, band: 0 });
};

/** Puts goods into the first free slot, then the pack, or the consumables. */
const stow = (state: AdventureState, goods: Goods): void => {
  if (goods.kind === 'consumable') {
    const consumables = state.consumables ??= [];
    if (consumables.length >= MAX_CONSUMABLES) reject('no-room');
    consumables.push(goods.item);
    return;
  }
  const pack = state.pack ??= [];
  const slot = goods.slot ?? slotOf(goods.item);
  if (state.slots.length < MAX_SLOTS) state.slots.push(slot);
  else if (pack.length < MAX_PACK) pack.push(slot);
  else reject('no-room');
};

const heal = (state: AdventureState, events: AdventureEvent[], amount: number): void => {
  const healed = Math.min(amount, state.maxHealth - state.health);
  state.health += healed;
  events.push({ type: 'healed', amount: healed, health: state.health });
};

const itemAt = (state: AdventureState, from: ItemPlace | undefined): { area: AdventureState['slots']; index: number } => {
  const area = from?.area === 'pack' ? state.pack ?? [] : state.slots;
  if (!from || !area[from.index]) reject('bad-slot');
  return { area, index: from!.index };
};

const campaignCommand = (
  state: AdventureState, campaign: CampaignState, command: CampaignCommand, events: AdventureEvent[],
  engine: (sub: AdventureCommand) => void,
): void => {
  switch (command.type) {
  case 'move': {
    if (!choices(state).includes(command.node)) reject('bad-node');
    const node = campaign.nodes[command.node];
    Object.assign(campaign, { at: command.node, loot: [], shop: null, event: null, rest: false });
    campaign.visited.push(command.node);
    events.push({ type: 'moved', node: command.node, kind: node.kind });
    if (node.kind === 'fight' || node.kind === 'elite' || node.kind === 'boss') {
      const random = rng(campaign.seed, 5, command.node);
      engine({ type: 'begin-encounter', encounter: enemyFor(templateAt(campaign, command.node), random, node.kind === 'elite') });
    } else if (node.kind === 'forage') {
      engine({ type: 'begin-encounter', encounter: { type: 'forage', id: 'forage', harvest: ALL_COLORS } });
    } else if (node.kind === 'shop') {
      const random = rng(campaign.seed, 4, command.node);
      const goods = [
        ...Array.from({ length: 3 }, () => rollGear(random, node.tier)),
        ...shuffled(random, CONSUMABLES).slice(0, 3).map((item): Goods => ({ kind: 'consumable', item })),
      ];
      campaign.shop = { stock: goods.map((entry) => ({ goods: entry, price: priceOf(entry) })) };
    } else if (node.kind === 'rest') {
      campaign.rest = true;
    } else {
      campaign.event = pick(rng(campaign.seed, 6, command.node), EVENTS).id;
    }
    return;
  }
  case 'take-loot': {
    const goods = campaign.loot[command.index] ?? reject('bad-slot');
    stow(state, goods);
    campaign.loot.splice(command.index, 1);
    events.push({ type: 'goods-taken', item: goods.item.id, price: 0 });
    return;
  }
  case 'buy': {
    const entry = campaign.shop?.stock[command.index] ?? reject('unavailable');
    addSupplies(state, events, -entry.price);
    stow(state, entry.goods);
    campaign.shop!.stock[command.index] = null;
    events.push({ type: 'goods-taken', item: entry.goods.item.id, price: entry.price });
    return;
  }
  case 'buy-health': {
    if (!campaign.shop) reject('unavailable');
    const amount = Math.min(command.amount, state.maxHealth - state.health);
    if (!Number.isInteger(amount) || amount <= 0) reject('unavailable');
    addSupplies(state, events, -amount * PRICES.health);
    heal(state, events, amount);
    return;
  }
  case 'sell': {
    if (!campaign.shop) reject('unavailable');
    const { area, index } = itemAt(state, command.from);
    const [slot] = area.splice(index, 1);
    const price = sellPrice(slot.item);
    addSupplies(state, events, price);
    events.push({ type: 'item-sold', item: slot.item.id, price });
    return;
  }
  case 'rest': {
    if (!campaign.rest) reject('unavailable');
    if (command.choice === 'heal') {
      heal(state, events, Math.ceil(state.maxHealth * REST_HEAL));
    } else {
      const { area, index } = itemAt(state, command.from);
      const slot = area[index];
      slot.level = (slot.level ?? 0) + 1;
      events.push({ type: 'item-leveled', item: slot.item.id, level: slot.level });
    }
    campaign.rest = false;
    events.push({ type: 'rested', choice: command.choice });
    return;
  }
  case 'answer': {
    const event = EVENTS.find((e) => e.id === campaign.event) ?? reject('unavailable');
    const option = event.options[command.option] ?? reject('bad-slot');
    if (option.health && state.health + option.health <= 0) reject('unavailable');
    if (option.supplies) addSupplies(state, events, -option.supplies);
    if (option.health && option.health > 0) heal(state, events, option.health);
    if (option.health && option.health < 0) {
      state.health += option.health;
      events.push({ type: 'damage-applied', target: 'character', amount: -option.health, blocked: 0, health: state.health });
    }
    if (option.earn) addSupplies(state, events, option.earn);
    if (option.gain) {
      const random = rng(campaign.seed, 7, campaign.at ?? 0);
      campaign.loot = [option.gain === 'gear' ? rollGear(random, campaign.nodes[campaign.at ?? 0].tier) : rollConsumable(random)];
    }
    campaign.event = null;
    events.push({ type: 'event-answered', event: event.id, option: command.option });
  }
  }
};
