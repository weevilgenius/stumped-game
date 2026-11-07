import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, ELITE_HEALTH, ENEMIES, MAX_ITEM_LEVEL, STARTERS } from '../content/campaign';
import { createCampaign, deriveSeed, levelItem, routeChoices } from './campaign';
import { currentNode } from './campaignTypes';
import { bandOf, startRun, step } from './step';
import type { AdventureCommand, AdventureEvent, AdventureState, RoundManifest } from './types';

const start = (seed = 7): AdventureState => ({ ...startRun(STARTERS[0]), campaign: createCampaign(seed) });
const issue = (state: AdventureState, command: AdventureCommand): AdventureState => {
  const result = step(state, command);
  expect(result.events.find((event) => event.type === 'command-rejected'), JSON.stringify(command)).toBeUndefined();
  return result.state;
};
const manifest = (id = 'puzzle'): RoundManifest => ({ id, size: 9, collections: Array.from({ length: 9 }, (_, color) => ({ color, amount: 9 })), givenColors: [] });
const enter = (seed = 7): AdventureState => {
  const state = start(seed);
  return issue(state, { type: 'travel', node: routeChoices(state)[0].id });
};
const strong = (state: AdventureState): AdventureState => {
  state.health = 1000;
  Object.assign(state.slots[0], { item: { ...state.slots[0].item, colors: [0, 1, 2, 3, 4, 5, 6, 7, 8], bands: [{ min: 1, value: 1000 }] } });
  return state;
};
const solve = (state: AdventureState, id = 'puzzle'): AdventureState => {
  state = issue(state, { type: 'begin-round', round: manifest(id) });
  for (const collect of manifest().collections) state = issue(state, { type: 'turn', collect });
  return issue(state, { type: 'end-round', outcome: 'completed' });
};

describe('seeded route contracts', () => {
  it('moves whole items in both directions within and across equipment and pack, including full inventories', () => {
    let state = start();
    state.slots = Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(state.slots[0]),
      item: { ...state.slots[0].item, instance: `item-${index}` }, level: index % 3, experience: index, readyAt: index + 1, charged: [index], chargedAmount: index * 2 }));
    state.campaign!.pack = Array.from({ length: 3 }, (_, index) => ({ ...structuredClone(state.slots[index]), item: { ...state.slots[index].item, instance: `pack-${index}` } }));
    const original = structuredClone(state);
    state = issue(state, { type: 'move-gear', slot: 3, direction: 1 });
    expect(state.slots[3]).toEqual(original.campaign!.pack[0]);
    expect(state.campaign!.pack[0]).toEqual(original.slots[3]);
    state = issue(state, { type: 'move-gear', slot: 0, pack: true, direction: -1 });
    expect(state).toEqual(original);
    state = issue(state, { type: 'move-gear', slot: 0, direction: 1 });
    expect(state.slots.slice(0, 2)).toEqual([original.slots[1], original.slots[0]]);
    state = issue(state, { type: 'move-gear', slot: 0, pack: true, direction: 1 });
    expect(state.campaign!.pack.slice(0, 2)).toEqual([original.campaign!.pack[1], original.campaign!.pack[0]]);
    expect(step(state, { type: 'move-gear', slot: 0, direction: -1 }).state).toBe(state);
    expect(step(state, { type: 'move-gear', slot: 2, pack: true, direction: 1 }).state).toBe(state);
    state.campaign!.pack = [];
    const last = structuredClone(state.slots[3]);
    state = issue(state, { type: 'move-gear', slot: 3, direction: 1 });
    expect(state.slots).toHaveLength(3);
    expect(state.campaign!.pack).toEqual([last]);
    state = issue(state, { type: 'move-gear', slot: 0, pack: true, direction: -1 });
    expect(state.slots[3]).toEqual(last);
    expect(state.campaign!.pack).toHaveLength(0);
    state = issue(state, { type: 'travel', node: '0-0' });
    state = issue(state, { type: 'begin-round', round: manifest() });
    expect(step(state, { type: 'move-gear', slot: 0, direction: 1 }).state).toBe(state);
  });

  it('sells equipped gear at its displayed value only while shopping', () => {
    let state = start();
    expect(step(state, { type: 'sell', slot: 0 }).state).toBe(state);
    state.campaign!.node = '2-0';
    state = issue(state, { type: 'travel', node: '3-0' });
    const [sold, remaining] = structuredClone(state.slots);
    const supplies = state.resources.supplies ?? 0;
    state = issue(state, { type: 'sell', slot: 0 });
    expect(state.slots).toEqual([remaining]);
    expect(state.resources.supplies).toBe(supplies + Math.floor((sold.item.price ?? 25) / 2));
    expect(state.campaign!.loot).toHaveLength(0);
  });

  it('every generated path reaches the boss, crosses a guaranteed first shop, and has three forage puzzles', () => {
    for (let seed = 0; seed < 100; seed++) {
      const campaign = createCampaign(seed);
      expect(campaign).toEqual(createCampaign(seed));
      const map = campaign.map;
      for (const node of map) {
        if (node.column === Math.max(...map.map((entry) => entry.column))) { expect(node.kind).toBe('boss'); expect(node.next).toEqual([]); }
        else {
          expect(node.next.length).toBeGreaterThan(0);
          for (const id of node.next) expect(map.find((entry) => entry.id === id)?.column).toBe(node.column + 1);
        }
      }
      expect(map.filter((node) => node.column === 3).every((node) => node.kind === 'shop')).toBe(true);
      expect(new Set(map.filter((node) => node.kind === 'forage').map((node) => node.column)).size).toBe(3);
    }
  });

  it('cannot move backwards, skip a column, or navigate during a fight', () => {
    const state = enter();
    for (const node of ['0-0', '2-0', '14-0']) {
      expect(step(state, { type: 'travel', node }).state).toBe(state);
    }
    expect(routeChoices(state)).toEqual([]);
    expect(step(state, { type: 'begin-encounter', encounter: state.encounter!.def }).state).toBe(state);
  });

  it('node loot is stable across unrelated previous random draws and save round trips', () => {
    const a = enter(4);
    const before = start(4);
    before.campaign!.rng = 12345;
    const b = issue(JSON.parse(JSON.stringify(before)) as AdventureState, { type: 'travel', node: routeChoices(before)[0].id });
    const wonA = solve(strong(a));
    const wonB = solve(strong(b));
    expect(wonA.campaign!.loot).toEqual(wonB.campaign!.loot);
    const gear = wonA.campaign!.loot.filter((offer) => offer.item);
    expect(gear.length).toBeGreaterThanOrEqual(2);
    expect(gear.length).toBeLessThanOrEqual(4);
    expect(new Set(gear.map((offer) => offer.id)).size).toBe(gear.length);
  });
});

describe('campaign transitions and finite rewards', () => {
  it('rolls loot exactly once on the kill, grants it only after the puzzle, and replays exactly', () => {
    let state = strong(enter());
    const initial = structuredClone(state);
    const log: AdventureCommand[] = [];
    const apply = (command: AdventureCommand): readonly AdventureEvent[] => {
      const result = step(state, command);
      expect(result.events.some((event) => event.type === 'command-rejected')).toBe(false);
      state = result.state; log.push(command); return result.events;
    };
    apply({ type: 'begin-round', round: manifest() });
    const events = apply({ type: 'turn', collect: { color: 0, amount: 9 } });
    expect(events.filter((event) => event.type === 'loot-created')).toHaveLength(1);
    const offer = state.campaign!.loot[0];
    expect(step(state, { type: 'take-loot', offer: offer.id }).state).toBe(state);
    const rolled = structuredClone(state.campaign!.loot);
    for (const collect of manifest().collections.slice(1)) apply({ type: 'turn', collect });
    apply({ type: 'end-round', outcome: 'completed' });
    expect(state.campaign!.loot).toEqual(rolled);
    apply({ type: 'take-loot', offer: offer.id });
    expect(step(state, { type: 'take-loot', offer: offer.id }).state).toBe(state);
    expect(log.reduce((current, command) => step(current, command).state, initial)).toEqual(state);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('preserves enemy countdowns, escalates across puzzles, resets packed timers, and prevents safe shopping', () => {
    let state = enter(7);
    // Use a known bounded enemy so this tests enrage rather than random escape.
    if (state.encounter?.type === 'enemy') Object.assign(state.encounter, { def: { ...state.encounter.def, health: 1000, intents: [{ delay: 3, damage: 2 }], budget: { enrage: 6 } }, health: 1000, countdown: 3 });
    state.slots.forEach((slot) => { slot.ready = false; });
    state.campaign!.pack.push({ ...structuredClone(state.slots[0]), readyAt: 4, charged: [0], chargedAmount: 10 });
    const oldDamage = state.encounter?.type === 'enemy' ? state.encounter.def.intents[0].damage : 0;
    state = solve(state);
    expect(state.encounter?.countdown).toBe(3);
    expect(state.encounter?.type === 'enemy' && state.encounter.def.intents[0].damage).toBe(oldDamage + 6);
    expect(state.campaign!.pack[0]).toMatchObject({ readyAt: 0, charged: [], chargedAmount: 0 });
    expect(step(state, { type: 'shop-heal' }).state).toBe(state);
    const countdown = state.encounter!.countdown;
    state = issue(state, { type: 'equip', pack: 0, slot: 1 });
    state = issue(state, { type: 'set-priority', slots: [1, 0] });
    expect(state.encounter!.countdown).toBe(countdown);
    // Gear moves retain exact state; swapping never implements its own reset.
    state.campaign!.pack[0].readyAt = 99;
    state = issue(state, { type: 'equip', pack: 0, slot: 0 });
    expect(state.slots[0].readyAt).toBe(99);
  });

  it('permits emergency potions before a carried hit without advancing time; fleeing loses loot and takes the hit', () => {
    let state = enter();
    state.health = 5;
    state.campaign!.potions = [{ id: 'healing-potion', value: 9 }, { id: 'block-potion', value: 10 }];
    const countdown = state.encounter!.countdown;
    state = issue(state, { type: 'use-potion', potion: 0 });
    expect(state.health).toBe(14);
    state = issue(state, { type: 'use-potion', potion: 0 });
    expect(state.block).toBe(10);
    expect(state.encounter!.countdown).toBe(countdown);
    state = issue(state, { type: 'flee' });
    expect(state.health).toBe(14);
    expect(state.campaign).toMatchObject({ loot: [], fled: 1, active: false });
    expect(state.encounter).toBeNull();
  });

  it('an escaping enemy grants no drops; enrage eventually defeats a stalling build', () => {
    let state = enter();
    state.health = 1000;
    state.slots = [];
    if (state.encounter?.type === 'enemy') Object.assign(state.encounter, { def: { ...state.encounter.def, budget: { fleeAfter: 2 } } });
    state = solve(state, 'first'); state = solve(state, 'second');
    expect(state.encounter).toBeNull();
    expect(state.campaign).toMatchObject({ loot: [], wins: 0, fled: 1 });
    state = enter(); state.slots = [];
    if (state.encounter?.type === 'enemy') Object.assign(state.encounter, { def: { ...state.encounter.def, budget: { enrage: 20 } } });
    state = solve(state);
    state = issue(state, { type: 'begin-round', round: manifest('second') });
    for (const collect of manifest().collections) {
      if (state.phase === 'ended') break;
      state = issue(state, { type: 'turn', collect });
    }
    expect(state.outcome).toBe('death');
  });

  it('postcombat chooses experience, healing, supplies or fizzle; leveling is capped once per fight', () => {
    let state = strong(enter());
    state = issue(state, { type: 'begin-round', round: manifest() });
    state = issue(state, { type: 'turn', collect: { color: 0, amount: 9 } });
    for (const collect of manifest().collections.slice(1, 7)) state = issue(state, { type: 'turn', collect });
    expect(state.slots[0].level).toBe(1);
    expect(state.campaign!.upgrades).toBe(1);
    state = issue(state, { type: 'set-ready', slot: 0, ready: false });
    const colors = state.encounter!.def.scavenge[0].colors;
    const remaining = manifest().collections.slice(7);
    for (const collect of remaining) {
      const events = step(state, { type: 'turn', collect }).events;
      expect(events.some((event) => event.type === 'resource-changed')).toBe(colors.includes(collect.color));
      state = issue(state, { type: 'turn', collect });
    }
  });

  it('shops have fixed finite stock; inventory limits, price and selling enforce atomic choices', () => {
    let state = start();
    // Enter a genuine shop through the same travel command with a legal preceding node.
    state.campaign!.node = '2-0';
    state = issue(state, { type: 'travel', node: '3-0' });
    const stock = structuredClone(state.campaign!.stock);
    const offer = stock[0];
    expect(stock.filter((entry) => entry.item)).toHaveLength(3);
    expect(stock.filter((entry) => entry.potion)).toHaveLength(3);
    expect(step(state, { type: 'buy', offer: offer.id }).state).toBe(state);
    state.resources.supplies = 100;
    state = issue(state, { type: 'buy', offer: offer.id });
    expect(state.resources.supplies).toBe(100 - offer.price);
    expect(step(state, { type: 'buy', offer: offer.id }).state).toBe(state);
    state = issue(state, { type: 'unequip', slot: 2 });
    state = issue(state, { type: 'sell', pack: 0 });
    expect(state.resources.supplies).toBe(100 - offer.price + Math.floor(offer.item!.price! / 2));
    expect(state.campaign!.stock).toEqual(stock.slice(1));
    state = issue(state, { type: 'choose', choice: 'leave' });
    expect(step(state, { type: 'travel', node: '3-0' }).state).toBe(state);
    expect(step(state, { type: 'choose', choice: 'rest' }).state).toBe(state);
  });

  it('completes a full route with finite quiet choices, locks victory at the boss kill, and ends after harvest', () => {
    let state = strong(start());
    while (state.phase !== 'ended') {
      if (!state.campaign!.active) state = issue(state, { type: 'travel', node: routeChoices(state)[0].id });
      const node = currentNode(state)!;
      if (state.encounter) {
        if (node.kind === 'boss') {
          expect(step(state, { type: 'flee' }).state).toBe(state);
          state = issue(state, { type: 'begin-round', round: manifest('boss') });
          state = issue(state, { type: 'turn', collect: { color: 0, amount: 9 } });
          expect(state.campaign!.victory).toBe(true);
          expect(state.phase).toBe('round');
          const saved = JSON.parse(JSON.stringify(state)) as AdventureState;
          for (const collect of manifest().collections.slice(1)) state = issue(state, { type: 'turn', collect });
          state = issue(state, { type: 'end-round', outcome: 'completed' });
          expect(state.outcome).toBe('victory');
          expect(issue(saved, { type: 'abandon' }).outcome).toBe('victory');
        } else state = solve(state, node.id);
      } else state = issue(state, { type: 'choose', choice: node.kind === 'rest' ? 'rest' : 'leave' });
    }
    expect(state.campaign!.visited).toHaveLength(Math.max(...state.campaign!.map.map((node) => node.column)) + 1);
    expect(state.campaign!.wins).toBe(state.campaign!.map.filter((node) => state.campaign!.visited.includes(node.id) && ['fight', 'elite', 'boss'].includes(node.kind)).length);
    expect(step(state, { type: 'abandon' }).state).toBe(state);
  });

  it('abandonment is an explicit saved outcome even before choosing a route', () => {
    const state = issue(start(), { type: 'abandon' });
    expect([state.phase, state.outcome]).toEqual(['ended', 'abandoned']);
    expect(deriveSeed(1, 'loot')).not.toBe(deriveSeed(1, 'map'));
  });
});

describe('capacity and updates', () => {
  it('rejects a full pack or consumable inventory without consuming loot or money', () => {
    let state = solve(strong(enter()));
    const slot = structuredClone(state.slots[0]);
    state.slots = Array.from({ length: 4 }, () => structuredClone(slot));
    state.campaign!.pack = Array.from({ length: 3 }, () => structuredClone(slot));
    const gear = state.campaign!.loot.find((offer) => offer.item)!;
    expect(step(state, { type: 'take-loot', offer: gear.id }).state).toBe(state);
    const replacement = issue(state, { type: 'take-loot', offer: gear.id, replace: 0 });
    expect(replacement.slots[0].item).toEqual(gear.item);
    expect(replacement.campaign!.pack).toHaveLength(3);
    state = replacement;
    state.campaign!.potions = Array.from({ length: 3 }, () => ({ id: 'healing-potion', value: 9 }));
    const potion = { id: 'potion', price: 0, item: null, potion: { id: 'block-potion' as const, value: 10 } };
    state.campaign!.loot.push(potion);
    expect(step(state, { type: 'take-loot', offer: potion.id }).state).toBe(state);
  });

  it('updates old active content while preserving random colors, countdowns and item state', () => {
    const state = enter();
    state.campaign!.version = 0;
    state.slots[0].readyAt = 7;
    state.slots[0].charged = [0];
    state.slots[0].chargedAmount = 12;
    Object.assign(state.slots[0], { item: { ...state.slots[0].item, bands: [{ min: 1, value: 999 }] } });
    const updated = issue(state, { type: 'set-ready', slot: 0, ready: false });
    expect(updated.campaign!.version).toBe(CONTENT_VERSION);
    expect(updated.slots[0]).toMatchObject({ readyAt: 7, charged: [0], chargedAmount: 12 });
    expect(updated.slots[0].item.bands).toEqual(STARTERS[0].loadout[0].bands);
    expect(updated.encounter!.countdown).toBe(state.encounter!.countdown);
    expect(updated.slots[0].item.colors).toEqual(state.slots[0].item.colors);
  });
});

describe('boss potion victory', () => {
  it('secures a between-puzzle potion kill exactly once and provides one final harvest puzzle', () => {
    let state = start();
    const boss = state.campaign!.map.find((node) => node.kind === 'boss')!;
    state.campaign!.node = state.campaign!.map.find((node) => node.next.includes(boss.id))!.id;
    state = issue(state, { type: 'travel', node: boss.id });
    if (state.encounter?.type === 'enemy') state.encounter.health = 5;
    state.campaign!.potions.push({ id: 'damage-potion', value: 10 });
    state = issue(state, { type: 'use-potion', potion: 0 });
    expect(state.phase).toBe('between');
    expect(state.campaign).toMatchObject({ victory: true, wins: 1 });
    const loot = structuredClone(state.campaign!.loot);
    expect(loot.filter((offer) => offer.item).length).toBeGreaterThanOrEqual(3);
    expect(step(state, { type: 'use-potion', potion: 0 }).state).toBe(state);
    state = solve(state, 'last-harvest');
    expect(state.outcome).toBe('victory');
    expect(state.campaign!.loot).toEqual(loot);
    expect(state.campaign!.wins).toBe(1);
  });
});

describe('hybrid regressions', () => {
  it('caps improvements without rewriting base bands, and awards the leveled forage value', () => {
    let state = startRun({ id: 'forager', health: 20, loadout: [{ id: 'satchel', effect: 'forage', colors: [0], bands: [{ min: 1, value: 1 }, { min: 4, value: 2 }, { min: 8, value: 3 }] }] });
    const bands = structuredClone(state.slots[0].item.bands);
    const events: AdventureEvent[] = [];
    for (let i = 0; i < MAX_ITEM_LEVEL + 2; i++) levelItem(state, state.slots[0], events);
    expect(state.slots[0].level).toBe(MAX_ITEM_LEVEL);
    expect(state.slots[0].item.bands).toEqual(bands);
    expect(events).toHaveLength(MAX_ITEM_LEVEL);
    state = issue(state, { type: 'begin-round', round: manifest() });
    const result = step(state, { type: 'turn', collect: { color: 0, amount: 9 } });
    const value = bandOf(bands, 9, MAX_ITEM_LEVEL).value;
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'ability-activated', value }));
    expect(result.state.resources.supplies).toBe(value);
  });

  it('only elites drop consumables', () => {
    expect(solve(strong(enter())).campaign!.loot.some((offer) => offer.potion)).toBe(false);
    const state = start();
    const elite = state.campaign!.map.find((node) => node.kind === 'elite' && node.lane === 0)!;
    state.campaign!.node = `${elite.column - 1}-0`;
    expect(solve(strong(issue(state, { type: 'travel', node: elite.id }))).campaign!.loot.filter((offer) => offer.potion)).toHaveLength(1);
  });

  it('elites are tougher, and about half also hit harder', () => {
    let fierce = 0, plain = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const state = start(seed);
      const elite = state.campaign!.map.find((node) => node.kind === 'elite' && node.lane === 0 && node.column === 10);
      if (!elite) continue;
      state.campaign!.node = '9-0';
      const { encounter } = issue(state, { type: 'travel', node: elite.id });
      if (encounter?.type !== 'enemy') throw new Error('Expected enemy');
      const template = ENEMIES.find((entry) => entry.id === encounter.def.id && entry.tier === elite.tier)!;
      expect(encounter.def.health).toBe(Math.round(template.health * ELITE_HEALTH));
      if (encounter.def.intents[0].damage > template.intents[0].damage) fierce++; else plain++;
    }
    expect(fierce).toBeGreaterThan(2);
    expect(plain).toBeGreaterThan(2);
  });

  it('treasure groves idle all gear except forage gear, which adds its yield to the harvest', () => {
    let state = start();
    const node = routeChoices(state)[0];
    Object.assign(node, { kind: 'forage' });
    state = issue(state, { type: 'travel', node: node.id });
    const satchel = { id: 'satchel', effect: 'forage' as const, colors: [0], bands: [{ min: 1, value: 1 }, { min: 8, value: 4 }] };
    state.slots.push({ item: satchel, ready: true, readyAt: 0, charged: [], chargedAmount: 0, level: 0, experience: 0 });
    const before = state.resources.supplies ?? 0;
    state = issue(state, { type: 'begin-round', round: manifest() });
    state = issue(state, { type: 'turn', collect: { color: 0, amount: 9 } });
    expect(state.resources.supplies).toBe(before + 2 + 4);
    state = issue(state, { type: 'turn', collect: { color: 2, amount: 9 } });
    expect(state.resources.supplies).toBe(before + 2 + 4 + 2);
    expect(state.slots.map((slot) => slot.experience ?? 0)).toEqual([0, 0, 0]);
  });

  it.each([10, -2])('preserves damage dealt when enemy maximum health changes by %s', (change) => {
    const state = enter();
    if (state.encounter?.type !== 'enemy') throw new Error('Expected enemy');
    const maximum = state.encounter.def.health;
    Object.assign(state.encounter, { def: { ...state.encounter.def, health: maximum + change }, health: maximum + change - 3 });
    state.campaign!.version = 0;
    const updated = issue(state, { type: 'set-ready', slot: 0, ready: false });
    expect(updated.encounter).toMatchObject({ health: maximum - 3 });
  });

  it('drops a consumable as reclaimable loot, making room for another', () => {
    let state = start();
    state.campaign!.potions = [{ id: 'healing-potion', value: 9 }, { id: 'block-potion', value: 10 }, { id: 'damage-potion', value: 10 }];
    state = issue(state, { type: 'drop-potion', potion: 1 });
    expect(state.campaign!.potions.map((potion) => potion.id)).toEqual(['healing-potion', 'damage-potion']);
    const dropped = state.campaign!.loot.find((offer) => offer.potion?.id === 'block-potion')!;
    state = issue(state, { type: 'take-loot', offer: dropped.id });
    expect(state.campaign!.potions).toHaveLength(3);
    expect(state.campaign!.loot).toHaveLength(0);
  });

  it('refreshes dropped gear as well as its offer before it can be reclaimed', () => {
    let state = start();
    const slot = structuredClone(state.slots[0]);
    Object.assign(slot, { item: { ...slot.item, bands: [{ min: 1, value: 999 }] } });
    state.campaign!.loot = [{ id: 'dropped', price: 0, item: slot.item, potion: null, slot }];
    state.campaign!.version = 0;
    state = issue(state, { type: 'take-loot', offer: 'dropped' });
    expect(state.slots.at(-1)!.item.bands).toEqual(STARTERS[0].loadout[0].bands);
  });

  it('buys a replacement with full inventory and leaves the old leveled item as reclaimable loot', () => {
    let state = start();
    state.campaign!.node = '2-0';
    state = issue(state, { type: 'travel', node: '3-0' });
    state.resources.supplies = 100;
    const original = { ...state.slots[0], level: 2, experience: 7, ready: false };
    state.slots = Array.from({ length: 4 }, () => structuredClone(original));
    state.campaign!.pack = Array.from({ length: 3 }, () => structuredClone(original));
    const offer = state.campaign!.stock.find((entry) => entry.item)!;
    state = issue(state, { type: 'buy', offer: offer.id, replace: 0 });
    expect(state.slots[0].item).toEqual(offer.item);
    expect(state.resources.supplies).toBe(100 - offer.price);
    const dropped = state.campaign!.loot.find((entry) => entry.slot)!;
    state = issue(state, { type: 'take-loot', offer: dropped.id, replace: 0 });
    expect(state.slots[0]).toEqual(original);
  });
});
