import { applyCampaign, campaignKill, campaignRoundEnd, levelItem, refreshCampaignContent } from './campaign';
import { currentNode } from './campaignTypes';
import { MAX_ITEM_LEVEL, XP_PER_LEVEL } from '../content/campaign';
import type {
  AdventureCommand, AdventureEvent, AdventureState, Band, CharacterDef, Collection, CollectSource, EncounterDef,
  EncounterState, EngineResult, RejectReason, RoundManifest, SlotState,
} from './types';

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
    slots: character.loadout.map((item) => ({ item, ready: true, readyAt: 0, charged: [], chargedAmount: 0 })),
    resources: {},
    encounter: null,
    round: null,
    rounds: 0,
    outcome: null,
  };
}

/**
 * The band a pulse falls in.
 * @param bands bands, smallest first
 * @param amount pulse size
 * @param level earned band steps, without changing the item's base definition
 * @returns the band's index and value
 */
export function bandOf(bands: readonly Band[], amount: number, level = 0): { band: number; value: number } {
  if (!bands.length) return { band: 0, value: 0 };
  const step = Math.max(0, bands.findLastIndex((b) => b.min <= amount)) + level;
  const last = bands.length - 1;
  const band = Math.min(step, last);
  const rise = last > 0 ? bands[last].value - bands[last - 1].value : 1;
  return { band, value: bands[band].value + (step - band) * rise };
}

class Rejected extends Error {
  constructor(readonly reason: RejectReason) {
    super(reason);
  }
}

const reject = (reason: RejectReason): never => {
  throw new Rejected(reason);
};

const startEncounter = (def: EncounterDef): EncounterState => (def.type === 'enemy'
  ? { type: 'enemy', def, phase: 'active', health: def.health, intent: 0, countdown: def.intents[0]?.delay ?? 1 }
  : { type: 'objective', def, phase: 'active', progress: 0, countdown: def.deadline });

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
    encounter.phase = 'scavenge';
    if (encounter.type === 'enemy') campaignKill(state, events);
    events.push({
      type: 'encounter-transitioned', encounter: encounter.def.id, to: 'scavenge',
      outcome: encounter.type === 'enemy' ? 'defeated' : 'completed',
    });
  };

  const addResource = (resource: string, bands: readonly Band[], amount: number, level = 0): void => {
    const { band, value } = bandOf(bands, amount, level);
    state.resources[resource] = (state.resources[resource] ?? 0) + value;
    if (state.campaign && resource === 'supplies') state.campaign.earned += value;
    events.push({ type: 'resource-changed', resource, amount: value, total: state.resources[resource], band });
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
    } else if (item.effect === 'attack' && encounter?.phase === 'active' && encounter.type === 'enemy') {
      encounter.health -= value;
      events.push({ type: 'damage-applied', target: 'enemy', amount: value, blocked: 0, health: encounter.health });
      if (encounter.health <= 0) win(encounter);
    } else if (item.effect === 'block') {
      state.block += value;
      events.push({ type: 'block-changed', block: state.block });
    } else if (item.effect === 'heal') {
      const healed = Math.min(value, state.maxHealth - state.health);
      state.health += healed;
      events.push({ type: 'healed', amount: healed, health: state.health });
    } else if (item.effect === 'forage') {
      addResource(item.resource ?? 'supplies', item.bands, amount, slot.level);
    }
  };

  /** Routes a pulse to the first eligible readied item, the scavenge rules, or nowhere. */
  const route = (collect: Collection, turn: number): void => {
    const campaign = state.campaign;
    if (campaign && state.encounter?.phase === 'scavenge' && currentNode(state)?.kind !== 'forage') {
      const index = state.slots.findIndex((slot) => slot.ready && slot.item.colors.includes(collect.color));
      const slot = state.slots[index];
      if (slot) {
        events.push({ type: 'pulse-routed', slot: index, item: slot.item.id });
        if (slot.item.effect === 'heal' || slot.item.effect === 'forage') activate(index, slot, collect.amount, turn);
        else {
          const id = slot.item.instance ?? slot.item.id;
          slot.experience = Math.min(XP_PER_LEVEL, (slot.experience ?? 0) + collect.amount);
          if (slot.experience >= XP_PER_LEVEL && !campaign.leveled.includes(id) && (slot.level ?? 0) < MAX_ITEM_LEVEL) {
            levelItem(state, slot, events);
            campaign.leveled.push(id);
          }
          events.push({ type: 'experience-gained', item: slot.item.id, slot: index, experience: slot.experience, level: slot.level ?? 0 });
        }
        return;
      }
    }
    const index = campaign && state.encounter?.phase === 'scavenge' ? -1
      : state.slots.findIndex((slot) => eligible(slot, collect.color, turn));
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
    const rule = state.encounter?.phase === 'scavenge'
      ? state.encounter.def.scavenge.find((r) => r.colors.includes(collect.color))
      : undefined;
    if (rule) {
      const loss = state.campaign?.encounterRounds ?? 0;
      const bands = rule.bands.map((band) => ({ ...band, value: Math.max(0, band.value - loss) }));
      addResource(rule.resource, bands, collect.amount);
    }
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
      events.push({ type: 'enemy-acted', encounter: encounter.def.id, damage: intent.damage, next: encounter.countdown });
      hurtCharacter(intent.damage, true);
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
    if (state.campaign?.victory && outcome !== 'completed') {
      state.phase = 'ended'; state.outcome = 'victory';
      events.push({ type: 'run-ended', outcome: 'victory' });
      return;
    }
    if (outcome !== 'completed') {
      state.phase = 'ended';
      state.outcome = outcome;
      events.push({ type: 'run-ended', outcome });
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
    // A won encounter ends with its round; an unfinished one carries over unchanged.
    if (state.encounter?.phase === 'scavenge') {
      events.push({ type: 'encounter-transitioned', encounter: state.encounter.def.id, to: 'ended', outcome: 'cleared' });
      state.encounter = null;
    }
    campaignRoundEnd(state, events);
  };

  return { turn, endRound };
};

const apply = (state: AdventureState, command: AdventureCommand, events: AdventureEvent[]): void => {
  if (state.phase === 'ended') reject('run-ended');
  const { turn, endRound } = resolver(state, events);
  switch (command.type) {
  case 'begin-encounter':
    if (state.phase !== 'between') reject('wrong-phase');
    if (state.encounter || state.campaign) reject('encounter-active');
    state.encounter = startEncounter(command.encounter);
    events.push({ type: 'encounter-started', encounter: command.encounter.id });
    return;
  case 'begin-round':
    if (state.phase !== 'between') reject('wrong-phase');
    if (state.campaign && !state.encounter) reject('wrong-phase');
    if (!validManifest(command.round)) reject('bad-manifest');
    state.phase = 'round';
    state.round = { manifest: command.round, turn: 0, collected: [] };
    events.push({ type: 'round-started', id: command.round.id });
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
    return;
  default: {
    const reason = applyCampaign(state, command, events);
    if (reason) reject(reason);
  }
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
    refreshCampaignContent(next);
    apply(next, command, events);
  } catch (error) {
    if (!(error instanceof Rejected)) throw error;
    return { state, events: [{ type: 'command-rejected', command: command.type, reason: error.reason }] };
  }
  return { state: next, events };
}
