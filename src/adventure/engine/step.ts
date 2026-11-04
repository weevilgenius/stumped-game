import type {
  AdventureCommand, AdventureEvent, AdventureState, Band, CharacterDef, Collection, CollectSource, ColorId, EncounterDef,
  EncounterState, EngineResult, ItemDef, ItemPlace, RejectReason, RoundManifest, SlotState,
} from './types';

/** Equipment slots. */
export const MAX_SLOTS = 4;
/** Reserve items in the pack. */
export const MAX_PACK = 3;
/** Consumables carried. */
export const MAX_CONSUMABLES = 3;
/** Harvested squares that earn an item one band step. */
export const XP_PER_LEVEL = 10;
/** Supplies a harvestable color gives when no readied item takes it, by patch size. */
export const HARVEST_SUPPLIES: readonly Band[] = [{ min: 1, value: 1 }, { min: 4, value: 1 }, { min: 8, value: 2 }, { min: 15, value: 3 }];

/**
 * A fresh equipment slot for an item.
 * @param item the item
 * @returns a readied slot at level 0
 */
export function slotOf(item: ItemDef): SlotState {
  return { item, ready: true, readyAt: 0, charged: [], chargedAmount: 0, level: 0, xp: 0 };
}

/**
 * Colors that harvest in an encounter now: an enemy's shrink by one for each puzzle after the first.
 * @param encounter the encounter
 * @returns its harvestable colors, or null if it uses scavenge rules instead
 */
export function harvestColors(encounter: EncounterState): readonly ColorId[] | null {
  if (encounter.type === 'forage') return encounter.def.harvest;
  if (encounter.type !== 'enemy' || !encounter.def.harvest) return null;
  const { harvest } = encounter.def;
  return harvest.slice(0, Math.max(1, harvest.length - Math.max(0, (encounter.rounds ?? 1) - 1)));
}

/**
 * The damage an enemy's next attack does, rage included.
 * @param encounter the enemy
 * @returns its next hit
 */
export function nextHit(encounter: EncounterState & { type: 'enemy' }): number {
  return (encounter.def.intents[encounter.intent]?.damage ?? 0) + (encounter.rage ?? 0);
}

/* ========================================================= *\
 *  step(): the deterministic state transition               *
\* ========================================================= */

/**
 * A new run, between rounds, with every slot readied.
 * @param character the character and starting loadout
 * @returns the run's starting state
 */
export function startRun(character: CharacterDef): AdventureState {
  return {
    phase: 'between',
    character: character.id,
    health: character.health,
    maxHealth: character.health,
    block: 0,
    slots: character.loadout.map(slotOf),
    pack: [],
    consumables: [],
    fights: 0,
    resources: {},
    encounter: null,
    round: null,
    rounds: 0,
    outcome: null,
  };
}

/**
 * The band a pulse falls in. Each level moves it one band step up; past the top band,
 * each step adds the top band's increase again.
 * @param bands bands, smallest first
 * @param amount pulse size
 * @param level band steps the item has gained
 * @returns the band's index and value
 */
export function bandOf(bands: readonly Band[], amount: number, level = 0): { band: number; value: number } {
  const step = Math.max(0, bands.findLastIndex((b) => b.min <= amount)) + level;
  const last = bands.length - 1;
  const band = Math.min(step, last);
  const rise = last > 0 ? bands[last].value - bands[last - 1].value : 1;
  return { band, value: (bands[band]?.value ?? 0) + (step - band) * rise };
}

class Rejected extends Error {
  constructor(readonly reason: RejectReason) {
    super(reason);
  }
}

const reject = (reason: RejectReason): never => {
  throw new Rejected(reason);
};

const startEncounter = (def: EncounterDef): EncounterState => {
  if (def.type === 'enemy') {
    return { type: 'enemy', def, phase: 'active', health: def.health, intent: 0, countdown: def.intents[0]?.delay ?? 1, rounds: 0, rage: 0 };
  }
  return def.type === 'forage'
    ? { type: 'forage', def, phase: 'scavenge' }
    : { type: 'objective', def, phase: 'active', progress: 0, countdown: def.deadline };
};

const validManifest = (round: RoundManifest): boolean => {
  const colors = round.collections.map((c) => c.color);
  return round.collections.length > 0
    && new Set(colors).size === colors.length
    && round.collections.every((c) => Number.isInteger(c.amount) && c.amount > 0)
    && round.givenColors.every((color) => colors.includes(color))
    && new Set(round.givenColors).size === round.givenColors.length;
};

/** Mutates a cloned state while collecting events. */
const resolver = (state: AdventureState, events: AdventureEvent[]) => {
  const die = (): void => {
    if (state.health > 0) return;
    state.phase = 'ended';
    state.outcome = 'death';
    state.round = null;
    events.push({ type: 'run-ended', outcome: 'death' });
  };

  const hurtCharacter = (amount: number, blockable: boolean): void => {
    const blocked = blockable ? Math.min(state.block, amount) : 0;
    state.health -= amount - blocked;
    events.push({ type: 'damage-applied', target: 'character', amount, blocked, health: state.health });
    // Block absorbs the next attack, then any remainder is lost.
    if (blockable && state.block > 0) {
      state.block = 0;
      events.push({ type: 'block-changed', block: 0 });
    }
    die();
  };

  const win = (encounter: EncounterState): void => {
    const outcome = encounter.type === 'enemy' ? 'defeated' : 'completed';
    if (encounter.type === 'enemy' && encounter.def.boss) state.outcome = 'victory';
    // A kill between rounds (by a consumable) has no puzzle left to harvest.
    if (state.phase === 'between') {
      state.encounter = null;
      events.push({ type: 'encounter-transitioned', encounter: encounter.def.id, to: 'ended', outcome });
      if (state.outcome === 'victory') endRun('victory');
      return;
    }
    encounter.phase = 'scavenge';
    events.push({ type: 'encounter-transitioned', encounter: encounter.def.id, to: 'scavenge', outcome });
  };

  const endRun = (outcome: AdventureState['outcome'] & string): void => {
    state.phase = 'ended';
    state.outcome = outcome;
    state.round = null;
    events.push({ type: 'run-ended', outcome });
  };

  const addResource = (resource: string, bands: readonly Band[], amount: number): void => {
    const { band, value } = bandOf(bands, amount);
    state.resources[resource] = (state.resources[resource] ?? 0) + value;
    events.push({ type: 'resource-changed', resource, amount: value, total: state.resources[resource], band });
  };

  const hurtEnemy = (value: number): void => {
    const encounter = state.encounter;
    if (encounter?.phase !== 'active' || encounter.type !== 'enemy') return;
    encounter.health -= value;
    events.push({ type: 'damage-applied', target: 'enemy', amount: value, blocked: 0, health: encounter.health });
    if (encounter.health <= 0) win(encounter);
  };

  const addBlock = (value: number): void => {
    state.block += value;
    events.push({ type: 'block-changed', block: state.block });
  };

  const heal = (value: number): void => {
    const healed = Math.min(value, state.maxHealth - state.health);
    state.health += healed;
    events.push({ type: 'healed', amount: healed, health: state.health });
  };

  /** A harvested pulse: experience for the first readied item that takes it, or supplies. */
  const harvest = (collect: Collection, turn: number): void => {
    const index = state.slots.findIndex((slot) => slot.ready && slot.item.colors.includes(collect.color));
    const slot = state.slots[index];
    if (!slot) {
      addResource('supplies', HARVEST_SUPPLIES, collect.amount);
      return;
    }
    events.push({ type: 'pulse-routed', slot: index, item: slot.item.id });
    // Healing and foraging items keep doing their job instead of levelling.
    if (slot.item.effect === 'heal' || slot.item.effect === 'forage') {
      activate(index, slot, collect.amount, turn);
      return;
    }
    const fight = state.fights ?? 0;
    slot.xp = Math.min((slot.xp ?? 0) + collect.amount, XP_PER_LEVEL);
    if (slot.xp >= XP_PER_LEVEL && slot.leveledIn !== fight) {
      slot.level = (slot.level ?? 0) + 1;
      slot.xp = 0;
      slot.leveledIn = fight;
      events.push({ type: 'item-leveled', item: slot.item.id, level: slot.level });
    }
    events.push({ type: 'experience-gained', slot: index, item: slot.item.id, xp: slot.xp, level: slot.level ?? 0 });
  };

  /** Whether an item's effect can do anything right now. */
  const useful = (slot: SlotState): boolean => {
    const { effect } = slot.item;
    if (effect === 'heal' || effect === 'forage') return true;
    const encounter = state.encounter;
    if (encounter?.phase !== 'active') return false;
    return encounter.type === 'enemy' || encounter.def.accepts.includes(effect);
  };

  const eligible = (slot: SlotState, color: number, turn: number): boolean => slot.ready
    && turn >= slot.readyAt
    && slot.item.colors.includes(color)
    && !slot.charged.includes(color)
    && useful(slot);

  const activate = (index: number, slot: SlotState, amount: number, turn: number): void => {
    const { item } = slot;
    const { band, value } = bandOf(item.bands, amount, slot.level);
    events.push({ type: 'ability-activated', slot: index, item: item.id, effect: item.effect, value, band });
    slot.readyAt = turn + (item.cooldown ?? 0) + 1;
    const encounter = state.encounter;
    if (encounter?.phase === 'active' && encounter.type === 'objective' && encounter.def.accepts.includes(item.effect)) {
      encounter.progress += value;
      events.push({
        type: 'objective-progressed', encounter: encounter.def.id, progress: encounter.progress, goal: encounter.def.goal,
      });
      if (encounter.progress >= encounter.def.goal) win(encounter);
    } else if (item.effect === 'attack') {
      hurtEnemy(value);
    } else if (item.effect === 'block') {
      addBlock(value);
    } else if (item.effect === 'heal') {
      heal(value);
    } else if (item.effect === 'forage') {
      addResource(item.resource ?? 'supplies', item.bands, amount);
    }
  };

  /** Routes a pulse to the first eligible readied item, the scavenge rules, or nowhere. */
  const route = (collect: Collection, turn: number): void => {
    const harvestable = state.encounter ? harvestColors(state.encounter) : null;
    if (state.encounter?.phase === 'scavenge' && harvestable) {
      if (harvestable.includes(collect.color)) {
        harvest(collect, turn);
        return;
      }
      // After a kill, other colors fizzle, even for items that heal or forage.
      if (state.encounter.type === 'enemy') {
        events.push({ type: 'pulse-discarded' });
        return;
      }
    }
    const index = state.slots.findIndex((slot) => eligible(slot, collect.color, turn));
    const slot = state.slots[index];
    if (slot) {
      events.push({ type: 'pulse-routed', slot: index, item: slot.item.id });
      if (!slot.item.charge) {
        activate(index, slot, collect.amount, turn);
        return;
      }
      slot.charged.push(collect.color);
      slot.chargedAmount += collect.amount;
      const missing = slot.item.colors.filter((color) => !slot.charged.includes(color));
      events.push({ type: 'ability-charged', slot: index, item: slot.item.id, missing });
      // A completed charge fires at once, sized by everything it took.
      if (missing.length === 0) {
        activate(index, slot, slot.chargedAmount, turn);
        slot.charged = [];
        slot.chargedAmount = 0;
      }
      return;
    }
    const rule = state.encounter?.phase === 'scavenge' && state.encounter.type !== 'forage' && !harvestable
      ? state.encounter.def.scavenge.find((r) => r.colors.includes(collect.color))
      : undefined;
    if (rule) addResource(rule.resource, rule.bands, collect.amount);
    else events.push({ type: 'pulse-discarded' });
  };

  /** Enemy actions and deadlines due this turn, then countdowns advance. */
  const advance = (): void => {
    const encounter = state.encounter;
    if (encounter?.phase !== 'active') return;
    if (encounter.countdown > 1) {
      encounter.countdown--;
      return;
    }
    if (encounter.type === 'enemy') {
      const { intents } = encounter.def;
      const intent = intents[encounter.intent];
      encounter.intent = (encounter.intent + 1) % intents.length;
      encounter.countdown = intents[encounter.intent].delay;
      const damage = intent.damage + (encounter.rage ?? 0);
      events.push({ type: 'enemy-acted', encounter: encounter.def.id, damage, next: encounter.countdown });
      hurtCharacter(damage, true);
    } else {
      state.encounter = null;
      events.push({ type: 'encounter-transitioned', encounter: encounter.def.id, to: 'ended', outcome: 'failed' });
      hurtCharacter(encounter.def.failDamage, false);
    }
  };

  const turn = (collect: Collection | undefined, source: CollectSource): void => {
    const round = state.round ?? reject('wrong-phase');
    if (collect) {
      const entry = round.manifest.collections.find((c) => c.color === collect.color);
      if (entry?.amount !== collect.amount || round.collected.includes(collect.color)
        || round.manifest.givenColors.includes(collect.color)) reject('bad-collection');
    }
    round.turn++;
    events.push({ type: 'turn-started', turn: round.turn });
    if (collect) {
      round.collected.push(collect.color);
      events.push({ type: 'collected', color: collect.color, amount: collect.amount, source });
      route(collect, round.turn);
    }
    if (state.phase !== 'ended') advance();
  };

  const endRound = (outcome: 'completed' | 'failed' | 'abandoned'): void => {
    const round = state.round ?? reject('wrong-phase');
    const { collections, givenColors } = round.manifest;
    if (outcome === 'completed' && round.collected.length + givenColors.length < collections.length) {
      reject('round-incomplete');
    }
    events.push({ type: 'round-ended', outcome });
    state.round = null;
    state.rounds++;
    // Victory locked in on the boss's killing reveal; the rest of the puzzle was for harvest.
    if (state.outcome === 'victory') {
      endRun('victory');
      return;
    }
    if (outcome !== 'completed') {
      endRun(outcome);
      return;
    }
    state.phase = 'between';
    if (state.block > 0) {
      state.block = 0;
      events.push({ type: 'block-changed', block: 0 });
    }
    for (const slot of state.slots) {
      slot.readyAt = 0;
      slot.charged = [];
      slot.chargedAmount = 0;
    }
    // A won encounter ends with its round; an unfinished one carries over, fleeing or enraging if it does that.
    const encounter = state.encounter;
    if (encounter?.phase === 'scavenge') {
      events.push({ type: 'encounter-transitioned', encounter: encounter.def.id, to: 'ended', outcome: 'cleared' });
      state.encounter = null;
    } else if (encounter?.type === 'enemy') {
      const { flee, enrage } = encounter.def;
      if (flee && (encounter.rounds ?? 0) >= flee) {
        state.encounter = null;
        events.push({ type: 'enemy-fled', encounter: encounter.def.id });
        events.push({ type: 'encounter-transitioned', encounter: encounter.def.id, to: 'ended', outcome: 'escaped' });
      } else if (enrage) {
        encounter.rage = (encounter.rage ?? 0) + enrage;
        events.push({ type: 'enemy-enraged', encounter: encounter.def.id, rage: encounter.rage });
      }
    }
  };

  const useConsumable = (index: number): void => {
    const consumables = state.consumables ?? [];
    const item = consumables[index] ?? reject('bad-slot');
    const encounter = state.encounter;
    if (item.effect === 'attack' && (encounter?.type !== 'enemy' || encounter.phase !== 'active')) reject('no-target');
    consumables.splice(index, 1);
    state.consumables = consumables;
    events.push({ type: 'consumable-used', item: item.id, effect: item.effect, value: item.value });
    if (item.effect === 'attack') hurtEnemy(item.value);
    else if (item.effect === 'block') addBlock(item.value);
    else heal(item.value);
  };

  const flee = (): void => {
    const encounter = state.encounter?.type === 'enemy' && state.encounter.phase === 'active' ? state.encounter : reject('no-target');
    if (state.phase !== 'between') reject('wrong-phase');
    if (encounter.def.boss) reject('unavailable');
    state.encounter = null;
    events.push({ type: 'player-fled', encounter: encounter.def.id });
    events.push({ type: 'encounter-transitioned', encounter: encounter.def.id, to: 'ended', outcome: 'fled' });
    // The parting attack: its telegraphed hit, which block from a consumable can still soak.
    hurtCharacter(nextHit(encounter), true);
  };

  return { turn, endRound, useConsumable, flee, endRun };
};

const areaOf = (state: AdventureState, area: ItemPlace['area']): SlotState[] => (area === 'slots' ? state.slots : state.pack ??= []);

/** Moves an item to a place, swapping with what is there, or appending at an area's end if there is room. */
const moveItem = (state: AdventureState, from: ItemPlace, to: ItemPlace): void => {
  const source = areaOf(state, from.area);
  const target = areaOf(state, to.area);
  const item = source[from.index] ?? reject('bad-slot');
  if (to.index < target.length) {
    source[from.index] = target[to.index];
    target[to.index] = item;
    return;
  }
  if (to.index !== target.length) reject('bad-slot');
  if (source !== target && target.length >= (to.area === 'slots' ? MAX_SLOTS : MAX_PACK)) reject('no-room');
  source.splice(from.index, 1);
  target.push(item);
};

const apply = (state: AdventureState, command: AdventureCommand, events: AdventureEvent[]): void => {
  if (state.phase === 'ended') reject('run-ended');
  const { turn, endRound, useConsumable, flee, endRun } = resolver(state, events);
  switch (command.type) {
  case 'begin-encounter':
    if (state.phase !== 'between') reject('wrong-phase');
    if (state.encounter) reject('encounter-active');
    state.encounter = startEncounter(command.encounter);
    state.fights = (state.fights ?? 0) + 1;
    events.push({ type: 'encounter-started', encounter: command.encounter.id });
    return;
  case 'begin-round':
    if (state.phase !== 'between') reject('wrong-phase');
    if (!validManifest(command.round)) reject('bad-manifest');
    state.phase = 'round';
    state.round = { manifest: command.round, turn: 0, collected: [] };
    if (state.encounter?.type === 'enemy') state.encounter.rounds = (state.encounter.rounds ?? 0) + 1;
    events.push({ type: 'round-started', id: command.round.id });
    return;
  case 'use-consumable':
    useConsumable(command.index);
    return;
  case 'move-item':
  case 'drop-item': {
    if (state.phase !== 'between') reject('wrong-phase');
    if (command.type === 'move-item') {
      moveItem(state, command.from, command.to);
      events.push({ type: 'item-moved', from: command.from, to: command.to });
    } else {
      const area = areaOf(state, command.from.area);
      const slot = area[command.from.index] ?? reject('bad-slot');
      area.splice(command.from.index, 1);
      events.push({ type: 'item-dropped', item: slot.item.id });
    }
    return;
  }
  case 'flee':
    flee();
    return;
  case 'abandon':
    if (state.round) events.push({ type: 'round-ended', outcome: 'abandoned' });
    endRun('abandoned');
    return;
  case 'turn':
    turn(command.collect, command.source ?? 'player');
    return;
  case 'set-ready': {
    const slot = state.slots[command.slot] ?? reject('bad-slot');
    slot.ready = command.ready;
    events.push({ type: 'readiness-changed', slot: command.slot, ready: command.ready });
    return;
  }
  case 'set-priority': {
    if (state.phase !== 'between') reject('wrong-phase');
    const order = command.slots;
    if (order.length !== state.slots.length || new Set(order).size !== order.length
      || order.some((i) => !state.slots[i])) reject('bad-slot');
    state.slots = order.map((i) => state.slots[i]);
    events.push({ type: 'priority-changed', items: state.slots.map((slot) => slot.item.id) });
    return;
  }
  case 'end-round':
    endRound(command.outcome);
  }
};

/**
 * Applies one command. The same state and commands always give the same
 * result. An invalid command changes nothing and returns one
 * `command-rejected` event, so it can never break the puzzle.
 * @param state the current state, which is not modified
 * @param command what happened
 * @returns the new state and the events, in order
 */
export function step(state: AdventureState, command: AdventureCommand): EngineResult {
  const next = structuredClone(state);
  const events: AdventureEvent[] = [];
  try {
    apply(next, command, events);
  } catch (error) {
    if (!(error instanceof Rejected)) throw error;
    return { state, events: [{ type: 'command-rejected', command: command.type, reason: error.reason }] };
  }
  return { state: next, events };
}
