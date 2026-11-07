import { BOSS, CONTENT_VERSION, ELITE_HEALTH, ENEMIES, FIERCE_DAMAGE, FIERCE_ELITES, EVENTS, ITEMS, MAX_ITEM_LEVEL, POTIONS, STARTERS } from '../content/campaign';
import type { AdventureEvent, AdventureState, EncounterDef, ItemDef, RejectReason, SlotState } from './types';
import { currentNode, type CampaignCommand, type CampaignState, type Offer, type RouteNode } from './campaignTypes';

/** Stable independent seed derivation for map, loot, and puzzles. */
export function deriveSeed(seed: number, key: string): number {
  let result = seed >>> 0;
  for (const char of key) result = Math.imul(result ^ char.charCodeAt(0), 16777619) >>> 0;
  return result;
}
const random = (campaign: CampaignState): number => {
  campaign.rng = (campaign.rng + 0x6D2B79F5) >>> 0;
  let n = campaign.rng;
  n = Math.imul(n ^ n >>> 15, n | 1);
  n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
};
const roll = (campaign: CampaignState, n: number): number => Math.floor(random(campaign) * n);

/** Generate a layered, crossing, merging route from one seed. Every path reaches the boss. */
export function createCampaign(seed: number): CampaignState {
  const campaign: CampaignState = {
    version: CONTENT_VERSION, seed: seed >>> 0, rng: deriveSeed(seed, 'map'), map: [], node: null, visited: [], active: false,
    pack: [], potions: [], loot: [], stock: [], encounterRounds: 0, victory: false, leveled: [],
    earned: 0, spent: 0, wins: 0, fled: 0, gear: 0, upgrades: 0,
  };
  const kinds: RouteNode['kind'][] = ['fight', 'fight', 'forage', 'shop', 'fight', 'event', 'fight', 'fight', 'fight', 'forage', 'elite', 'shop', 'fight', 'rest', 'fight', 'fight', 'fight', 'forage', 'fight', 'elite', 'fight', 'rest', 'boss'];
  for (let column = 0; column < kinds.length; column++) {
    const count = column === kinds.length - 1 ? 1 : 2 + roll(campaign, 2);
    for (let lane = 0; lane < count; lane++) {
      let kind = kinds[column];
      if (lane > 0 && ['fight', 'elite'].includes(kind) && column > 0) kind = roll(campaign, 3) ? 'fight' : 'elite';
      // Optional risk/recovery choices without increasing the two-forage budget.
      if (lane > 0 && kind === 'rest') kind = 'event';
      campaign.map.push({ id: `${column}-${lane}`, column, lane, kind, hidden: kind === 'event' && roll(campaign, 2) === 0,
        tier: Math.min(3, 1 + Math.floor(column / 8) + Number(kind === 'elite')), next: [] });
    }
  }
  for (const node of campaign.map) {
    const next = campaign.map.filter((entry) => entry.column === node.column + 1);
    node.next = next.filter((entry) => Math.abs(entry.lane - node.lane) <= 1 || next.length === 1).map((entry) => entry.id);
  }
  campaign.rng = deriveSeed(seed, 'loot');
  return campaign;
}

/** Locations legally reachable now; no revisits or movement during unfinished fights. */
export function routeChoices(state: AdventureState): readonly RouteNode[] {
  const campaign = state.campaign;
  if (!campaign || campaign.active || state.phase !== 'between') return [];
  const current = currentNode(state);
  return campaign.map.filter((node) => current ? current.next.includes(node.id) : node.column === 0);
}

/** A unique gear roll; unrelated map generation never consumes this stream. */
export function rollOffer(campaign: CampaignState, tier: number, price = 0, potion = false): Offer {
  const id = `${campaign.node}/${campaign.rng}`;
  if (potion) return { id, price, item: null, potion: structuredClone(POTIONS[roll(campaign, POTIONS.length)]) };
  const at = random(campaign) < 0.6 ? tier : Math.max(1, tier - 1);
  const templates = ITEMS.filter((entry) => entry.item.tier === at);
  const template = templates[roll(campaign, templates.length)];
  const base = template.item;
  const count = template.colors[0] + roll(campaign, template.colors[1] - template.colors[0] + 1);
  const colors = Array.from({ length: 9 }, (_, color) => color);
  for (let i = colors.length - 1; i > 0; i--) {
    const j = roll(campaign, i + 1);
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  const item: ItemDef = { ...base, instance: id, price: 25 + (at - 1) * 10,
    colors: colors.slice(0, count).sort((a, b) => a - b) };
  return { id, price: price ? item.price! : 0, item, potion: null };
}
const slotOf = (item: ItemDef): SlotState => ({ item, ready: true, readyAt: 0, charged: [], chargedAmount: 0, level: 0, experience: 0 });

/** Upgrade band effects once; caps keep equipment and the enrage budget bounded. */
export function levelItem(state: AdventureState, slot: SlotState, events: AdventureEvent[]): void {
  if ((slot.level ?? 0) >= MAX_ITEM_LEVEL) return;
  slot.level = (slot.level ?? 0) + 1;
  slot.experience = 0;
  if (state.campaign) state.campaign.upgrades++;
  events.push({ type: 'item-leveled', item: slot.item.id, level: slot.level });
}

/** Kill hook: roll rewards immediately, independently of reload or collection timing. */
export function campaignKill(state: AdventureState, events: AdventureEvent[]): void {
  const campaign = state.campaign;
  if (!campaign) return;
  const node = currentNode(state)!;
  campaign.wins++;
  const count = node.kind === 'elite' || node.kind === 'boss' ? 3 + roll(campaign, 2) : 2 + roll(campaign, 3);
  campaign.loot = Array.from({ length: count }, () => rollOffer(campaign, node.tier));
  // Each enemy also drops a consumable; gear count remains two to four.
  campaign.loot.push(rollOffer(campaign, node.tier, 0, true));
  const amount = Math.round(templateAt(campaign, node).supplies * (node.kind === 'elite' ? 1.5 : 1));
  state.resources.supplies = (state.resources.supplies ?? 0) + amount;
  campaign.earned += amount;
  events.push({ type: 'resource-changed', resource: 'supplies', amount, total: state.resources.supplies, band: 0 });
  events.push({ type: 'loot-created', offers: campaign.loot });
  if (node.kind === 'boss') {
    campaign.victory = true;
    events.push({ type: 'victory-secured' });
  }
}

const finishNode = (state: AdventureState): void => {
  const campaign = state.campaign!;
  if (campaign.node && !campaign.visited.includes(campaign.node)) campaign.visited.push(campaign.node);
  campaign.active = false;
};

/** Round boundary: reset packed item timers too, escalate or end the current encounter. */
export function campaignRoundEnd(state: AdventureState, events: AdventureEvent[]): void {
  const campaign = state.campaign;
  if (!campaign) return;
  for (const slot of campaign.pack) {
    slot.readyAt = 0;
    slot.charged = [];
    slot.chargedAmount = 0;
  }
  campaign.encounterRounds++;
  const encounter = state.encounter;
  if (encounter?.type === 'enemy' && encounter.phase === 'active') {
    const { budget } = encounter.def;
    if (budget?.fleeAfter && campaign.encounterRounds >= budget.fleeAfter) {
      state.encounter = null;
      campaign.fled++;
      events.push({ type: 'encounter-transitioned', encounter: encounter.def.id, to: 'ended', outcome: 'failed' });
    } else if (budget?.enrage) {
      Object.assign(encounter, { def: { ...encounter.def, intents: encounter.def.intents.map((intent) => ({ ...intent, damage: intent.damage + budget.enrage! })) } });
      events.push({ type: 'enemy-escalated', damage: encounter.def.intents[encounter.intent].damage });
    }
  }
  if (!state.encounter) finishNode(state);
  if (campaign.victory) {
    state.phase = 'ended';
    state.outcome = 'victory';
    events.push({ type: 'run-ended', outcome: 'victory' });
  }
}

const templateAt = (campaign: CampaignState, node: RouteNode) => {
  if (node.kind === 'boss') return BOSS;
  const stream = { ...campaign, rng: deriveSeed(campaign.seed, `enemy/${node.id}`) };
  const templates = ENEMIES.filter((entry) => entry.tier === node.tier);
  return templates[roll(stream, templates.length)];
};

const makeEncounter = (campaign: CampaignState, node: RouteNode): EncounterDef => {
  const template = templateAt(campaign, node);
  const stream = { ...campaign, rng: deriveSeed(campaign.seed, `harvest/${node.id}`) };
  const colors = Array.from({ length: 9 }, (_, color) => color);
  for (let i = colors.length - 1; i > 0; i--) {
    const j = roll(stream, i + 1);
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  const fierce = node.kind === 'elite' && random({ ...campaign, rng: deriveSeed(campaign.seed, `elite/${node.id}`) }) < FIERCE_ELITES;
  return { type: 'enemy', id: template.id,
    health: Math.round(template.health * (node.kind === 'elite' ? ELITE_HEALTH : 1)),
    intents: fierce ? template.intents.map((intent) => ({ ...intent, damage: Math.ceil(intent.damage * FIERCE_DAMAGE) })) : template.intents,
    budget: { fleeAfter: template.flee, enrage: template.enrage, boss: template.boss },
    scavenge: [{ colors: colors.slice(0, node.kind === 'elite' || node.kind === 'boss' ? 3 : 2), resource: 'supplies',
      bands: [{ min: 1, value: 1 }, { min: 8, value: 2 }, { min: 15, value: 3 }] }],
  };
};

/** The seeded text event at the current stop, shared by engine and screens. */
export function eventAt(state: AdventureState): typeof EVENTS[number] | null {
  const campaign = state.campaign;
  const node = currentNode(state);
  if (!campaign || node?.kind !== 'event') return null;
  if (campaign.event) return EVENTS.find((event) => event.id === campaign.event) ?? null;
  const stream = { ...campaign, rng: deriveSeed(campaign.seed, `event/${node.id}`) };
  return EVENTS[roll(stream, EVENTS.length)];
}

/** Apply a progression command to the already-cloned state; a reason rolls back the entire command. */
export function applyCampaign(state: AdventureState, command: CampaignCommand, events: AdventureEvent[]): RejectReason | null {
  if (command.type === 'abandon') {
    state.phase = 'ended';
    state.outcome = state.campaign?.victory ? 'victory' : 'abandoned';
    state.round = null;
    events.push({ type: 'run-ended', outcome: state.outcome });
    return null;
  }
  const campaign = state.campaign;
  if (!campaign) return 'wrong-phase';
  campaign.version = CONTENT_VERSION;
  const node = currentNode(state);
  const between = state.phase === 'between';
  const safe = between && !state.encounter;
  const shop = safe && campaign.active && node?.kind === 'shop';
  const supplies = state.resources.supplies ?? 0;
  const pay = (amount: number): boolean => {
    if (supplies < amount) return false;
    state.resources.supplies = supplies - amount;
    campaign.spent += amount;
    events.push({ type: 'resource-changed', resource: 'supplies', amount: -amount, total: state.resources.supplies, band: 0 });
    return true;
  };
  const heal = (amount: number): void => {
    const actual = Math.min(amount, state.maxHealth - state.health);
    state.health += actual;
    events.push({ type: 'healed', amount: actual, health: state.health });
  };
  const hurt = (amount: number): void => {
    const blocked = Math.min(state.block, amount);
    state.block = 0;
    state.health -= amount - blocked;
    events.push({ type: 'damage-applied', target: 'character', amount, blocked, health: state.health });
    if (state.health <= 0) {
      state.phase = 'ended'; state.outcome = 'death'; state.round = null;
      events.push({ type: 'run-ended', outcome: 'death' });
    }
  };
  switch (command.type) {
  case 'travel': {
    const target = routeChoices(state).find((entry) => entry.id === command.node);
    if (!target) return 'bad-choice';
    campaign.node = target.id;
    campaign.event = undefined;
    campaign.rng = deriveSeed(campaign.seed, `loot/${target.id}`);
    campaign.active = true;
    campaign.loot = []; campaign.stock = []; campaign.leveled = []; campaign.encounterRounds = 0;
    events.push({ type: 'travelled', node: target.id });
    if (['fight', 'elite', 'boss'].includes(target.kind)) {
      const def = makeEncounter(campaign, target);
      if (def.type !== 'enemy') return 'bad-choice';
      state.encounter = { type: 'enemy', def, phase: 'active', health: def.health, intent: 0, countdown: def.intents[0].delay };
      events.push({ type: 'encounter-started', encounter: def.id });
    } else if (target.kind === 'forage') {
      const def: EncounterDef = { type: 'objective', id: 'treasure-grove', goal: 1, accepts: [], deadline: 100, failDamage: 0,
        scavenge: [{ colors: [0, 1, 2, 3, 4, 5, 6, 7, 8], resource: 'supplies', bands: [{ min: 1, value: 1 }, { min: 8, value: 2 }] }] };
      state.encounter = { type: 'objective', def, phase: 'scavenge', progress: 1, countdown: 100 };
    } else if (target.kind === 'shop') {
      campaign.stock = [1, 2, 3].map(() => rollOffer(campaign, target.tier, 25 + (target.tier - 1) * 10));
      campaign.stock.push(...POTIONS.map((potion, index) => ({ id: `potion-${index}`, price: index ? 15 : 10, item: null, potion })));
    }
    return null;
  }
  case 'choose': {
    if (!safe || !campaign.active || !node || !['rest', 'event', 'shop'].includes(node.kind)) return 'wrong-phase';
    if (command.choice === 'leave') { finishNode(state); return null; }
    if (node.kind === 'rest' && command.choice === 'rest') heal(Math.ceil(state.maxHealth / 3));
    else if (node.kind === 'rest' && command.choice === 'upgrade') {
      const slot = state.slots[command.slot ?? -1];
      if (!slot || (slot.level ?? 0) >= MAX_ITEM_LEVEL) return 'bad-slot';
      levelItem(state, slot, events);
    } else if (node.kind === 'event' && command.choice === 'event') {
      const option = eventAt(state)?.options[command.option ?? -1];
      if (!option) return 'bad-choice';
      if (!pay(option.supplies ?? 0)) return 'insufficient-supplies';
      if (option.health && option.health < 0) hurt(-option.health);
      else if (option.health) heal(option.health);
      if (option.earn) {
        state.resources.supplies = (state.resources.supplies ?? 0) + option.earn;
        campaign.earned += option.earn;
        events.push({ type: 'resource-changed', resource: 'supplies', amount: option.earn, total: state.resources.supplies, band: 0 });
      }
      if (state.phase !== 'ended' && option.gain) campaign.loot = [rollOffer(campaign, node.tier, 0, option.gain === 'consumable')];
    } else return 'bad-choice';
    finishNode(state);
    return null;
  }
  case 'take-loot':
  case 'buy': {
    if (!safe || (command.type === 'buy' && !shop)) return 'wrong-phase';
    const offers = command.type === 'buy' ? campaign.stock : campaign.loot;
    const index = offers.findIndex((offer) => offer.id === command.offer);
    const offer = offers[index];
    if (!offer) return 'bad-choice';
    if (offer.potion) {
      if (campaign.potions.length >= 3) return 'inventory-full';
      campaign.potions.push(offer.potion);
    } else if (offer.item) {
      const slot = offer.slot ?? slotOf(offer.item);
      const replacement = command.replace;
      if (replacement !== undefined) {
        if (!state.slots[replacement]) return 'bad-slot';
        const old = state.slots[replacement];
        state.slots[replacement] = slot;
        campaign.loot.push({ id: `drop/${old.item.instance ?? old.item.id}/${state.rounds}/${campaign.loot.length}`, price: 0, item: old.item, potion: null, slot: old });
      } else if (state.slots.length < 4) state.slots.push(slot);
      else if (campaign.pack.length < 3) campaign.pack.push(slot);
      else return 'inventory-full';
      if (!offer.slot) campaign.gear++;
      events.push({ type: 'gear-changed', item: offer.item.id });
    }
    if (!pay(offer.price)) return 'insufficient-supplies';
    offers.splice(index, 1);
    return null;
  }
  case 'equip': {
    if (!between) return 'wrong-phase';
    const packed = campaign.pack[command.pack];
    if (!packed || !Number.isInteger(command.slot) || command.slot < 0 || command.slot > state.slots.length || command.slot >= 4) return 'bad-slot';
    const old = state.slots[command.slot];
    state.slots[command.slot] = packed;
    if (old) campaign.pack[command.pack] = old;
    else campaign.pack.splice(command.pack, 1);
    events.push({ type: 'gear-changed', item: packed.item.id });
    return null;
  }
  case 'unequip': {
    if (!between) return 'wrong-phase';
    if (!state.slots[command.slot]) return 'bad-slot';
    if (campaign.pack.length >= 3) return 'inventory-full';
    campaign.pack.push(...state.slots.splice(command.slot, 1));
    events.push({ type: 'gear-changed', item: campaign.pack.at(-1)!.item.id });
    return null;
  }
  case 'move-gear': {
    if (!between) return 'wrong-phase';
    const area = command.pack ? campaign.pack : state.slots;
    const slot = area[command.slot];
    if (!slot || !Number.isInteger(command.slot) || ![-1, 1].includes(command.direction)) return 'bad-slot';
    const target = command.slot + command.direction;
    if (target >= 0 && target < area.length) {
      [area[command.slot], area[target]] = [area[target], slot];
    } else if (command.pack && command.direction === -1 && command.slot === 0) {
      if (state.slots.length < 4) state.slots.push(...campaign.pack.splice(0, 1));
      else [state.slots[3], campaign.pack[0]] = [slot, state.slots[3]];
    } else if (!command.pack && command.direction === 1 && command.slot === state.slots.length - 1) {
      if (campaign.pack.length) [state.slots[command.slot], campaign.pack[0]] = [campaign.pack[0], slot];
      else campaign.pack.push(...state.slots.splice(command.slot, 1));
    } else return 'bad-slot';
    events.push({ type: 'gear-changed', item: slot.item.id });
    return null;
  }
  case 'drop': {
    if (!between) return 'wrong-phase';
    const area = command.pack ? campaign.pack : state.slots;
    const slot = area[command.slot];
    if (!slot) return 'bad-slot';
    area.splice(command.slot, 1);
    campaign.loot.push({ id: `drop/${slot.item.instance ?? slot.item.id}/${state.rounds}/${campaign.loot.length}`, price: 0, item: slot.item, potion: null, slot });
    events.push({ type: 'gear-changed', item: slot.item.id });
    return null;
  }
  case 'sell': {
    if (!shop) return 'wrong-phase';
    const area = command.pack === undefined ? state.slots : campaign.pack;
    const index = command.pack ?? command.slot;
    const slot = area[index];
    if (!slot) return 'bad-slot';
    const amount = Math.floor((slot.item.price ?? 25) / 2);
    state.resources.supplies = supplies + amount;
    campaign.earned += amount;
    area.splice(index, 1);
    events.push({ type: 'resource-changed', resource: 'supplies', amount, total: state.resources.supplies, band: 0 });
    return null;
  }
  case 'shop-heal': {
    if (!shop) return 'wrong-phase';
    const amount = Math.min(state.maxHealth - state.health, Math.floor(supplies / 2));
    if (amount <= 0) return 'insufficient-supplies';
    pay(amount * 2); heal(amount);
    return null;
  }
  case 'use-potion': {
    const potion = campaign.potions[command.potion];
    if (!potion) return 'bad-slot';
    if (potion.id === 'healing-potion') heal(potion.value);
    else {
      const encounter = state.encounter;
      if (encounter?.type !== 'enemy' || encounter.phase !== 'active') return 'wrong-phase';
      if (potion.id === 'block-potion') {
        state.block += potion.value;
        events.push({ type: 'block-changed', block: state.block });
      } else {
        encounter.health -= potion.value;
        events.push({ type: 'damage-applied', target: 'enemy', amount: potion.value, blocked: 0, health: encounter.health });
        if (encounter.health <= 0) {
          encounter.phase = 'scavenge';
          events.push({ type: 'encounter-transitioned', encounter: encounter.def.id, to: 'scavenge', outcome: 'defeated' });
          campaignKill(state, events);
          // Between-puzzle potion kills still get one final harvest puzzle.
        }
      }
    }
    campaign.potions.splice(command.potion, 1);
    events.push({ type: 'potion-used', potion: potion.id });
    return null;
  }
  case 'flee': {
    const encounter = state.encounter;
    if (!between || encounter?.type !== 'enemy' || encounter.phase !== 'active' || encounter.def.budget?.boss) return 'wrong-phase';
    hurt(encounter.def.intents[encounter.intent].damage);
    state.encounter = null;
    campaign.fled++;
    finishNode(state);
    events.push({ type: 'encounter-transitioned', encounter: encounter.def.id, to: 'ended', outcome: 'failed' });
    return null;
  }
  }
}

/**
 * Apply current catalog balance to an older active campaign. Random colors,
 * instance ids, levels, cooldowns, charges and encounter countdowns survive.
 * Sandbox definitions stay as recorded for the earlier concept experiments.
 */
export function refreshCampaignContent(state: AdventureState): void {
  const campaign = state.campaign;
  if (!campaign || state.phase === 'ended' || campaign.version === CONTENT_VERSION) return;
  const refresh = (item: ItemDef): ItemDef => {
    const catalog = ITEMS.find((entry) => entry.item.id === item.id && entry.item.tier === item.tier)?.item
      ?? STARTERS.flatMap((starter) => starter.loadout).find((entry) => entry.id === item.id);
    if (!catalog) return item;
    return { ...item, bands: catalog.bands, cooldown: catalog.cooldown, charge: catalog.charge };
  };
  for (const slot of [...state.slots, ...campaign.pack]) Object.assign(slot, { item: refresh(slot.item) });
  for (const offer of [...campaign.loot, ...campaign.stock]) {
    if (offer.slot) {
      Object.assign(offer.slot, { item: refresh(offer.slot.item) });
      offer.item = offer.slot.item;
    } else if (offer.item) offer.item = refresh(offer.item);
  }
  const node = currentNode(state);
  const encounter = state.encounter;
  if (node && encounter?.type === 'enemy') {
    const definition = makeEncounter(campaign, node);
    if (definition.type === 'enemy') {
      const enrage = definition.budget?.enrage ?? 0;
      const damageTaken = encounter.def.health - encounter.health;
      Object.assign(encounter, { def: { ...definition, intents: definition.intents.map((intent) => ({ ...intent, damage: intent.damage + enrage * campaign.encounterRounds })) } });
      encounter.health = Math.max(encounter.phase === 'active' ? 1 : 0, definition.health - damageTaken);
      encounter.intent %= definition.intents.length;
    }
  }
  campaign.version = CONTENT_VERSION;
}
