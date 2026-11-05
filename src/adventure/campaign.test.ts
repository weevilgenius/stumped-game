import { readFileSync } from 'node:fs';
import { advance, choices, generateMap, newCampaign, type RunCommand } from './campaign';
import { STARTERS } from './content/campaign';
import {
  type AdventureEvent, type AdventureState, bandOf, type Collection, type EncounterDef, type RoundManifest, harvestColors, slotOf, startRun, step,
  XP_PER_LEVEL,
} from './engine';
import { decodeSeedCode, generate } from '../engine';
import { simulateRun } from './sim/runs';
import type { SimulationRound } from './sim/simulation';
import { parseTraces, replayRound, syntheticRound } from './sim/traces';

const KNIGHT = STARTERS[0];

/** Runs commands in order, failing on any rejection. */
const run = (state: AdventureState, ...commands: RunCommand[]): { state: AdventureState; events: AdventureEvent[] } => {
  const events: AdventureEvent[] = [];
  for (const command of commands) {
    const result = advance(state, command);
    expect(result.events.find((e) => e.type === 'command-rejected')).toBeUndefined();
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
};

const rejection = (state: AdventureState, command: RunCommand): string | undefined => {
  const [event] = advance(state, command).events;
  return event.type === 'command-rejected' ? event.reason : undefined;
};

const manifest = (collections: Collection[]): RoundManifest => ({ id: 'play', size: 9, collections, givenColors: [] });
const AMOUNTS = [15, 15, 9, 9, 9, 10, 10, 10, 9];
const ROUND = manifest(AMOUNTS.map((amount, color) => ({ color, amount })));
const turn = (color: number, amount = AMOUNTS[color]): RunCommand => ({ type: 'turn', collect: { color, amount } });
/** A one-region puzzle that is played and finished. */
const PUZZLE: RunCommand[] = [
  { type: 'begin-round', round: manifest([{ color: 8, amount: 1 }]) }, turn(8, 1), { type: 'end-round', outcome: 'completed' },
];

const foe = (extra: Partial<EncounterDef & { type: 'enemy' }> = {}): EncounterDef => ({
  type: 'enemy', id: 'foe', health: 10, intents: [{ delay: 50, damage: 3 }], scavenge: [], harvest: [5, 6, 7], ...extra,
});

/** A sandbox state with a sword on colors 0 to 2 and a foe. */
const fighting = (extra?: Partial<EncounterDef & { type: 'enemy' }>): AdventureState => run(
  startRun({ id: 'test', health: 20, loadout: KNIGHT.loadout }), { type: 'begin-encounter', encounter: foe(extra) },
).state;

describe('map', () => {
  it('is seeded, layered, and reachable, with a shop in columns 3 to 5, rests before the boss, and the boss last', () => {
    for (let seed = 0; seed < 40; seed++) {
      const nodes = generateMap(seed);
      expect(generateMap(seed)).toEqual(nodes);
      expect(nodes.at(-1)).toMatchObject({ kind: 'boss', column: 14 });
      expect(nodes.filter((n) => n.column === 13).every((n) => n.kind === 'rest')).toBe(true);
      expect(nodes.some((n) => n.kind === 'shop' && n.column >= 3 && n.column <= 5)).toBe(true);
      const reachable = new Set(nodes.flatMap((n, i) => (n.column === 0 ? [i] : [])));
      for (const [i, node] of nodes.entries()) {
        if (!reachable.has(i)) throw new Error(`seed ${seed}: node ${i} unreachable`);
        expect(node.lanes).toBeGreaterThanOrEqual(1);
        expect(node.lanes).toBeLessThanOrEqual(3);
        for (const n of node.next) {
          expect(nodes[n].column).toBe(node.column + 1);
          reachable.add(n);
        }
      }
    }
  });

  it('moves forward only, starting an enemy at a fight and keeping it until the fight ends', () => {
    let state = newCampaign(KNIGHT, 3);
    const first = choices(state);
    expect(first.map((i) => state.campaign!.nodes[i].column)).toEqual([0, 0, 0]);
    expect(rejection(state, { type: 'move', node: state.campaign!.nodes.length - 1 })).toBe('bad-node');
    ({ state } = run(state, { type: 'move', node: first[0] }));
    expect(state.encounter).toMatchObject({ type: 'enemy', phase: 'active', rounds: 0 });
    expect(choices(state)).toEqual([]);
    expect(rejection(state, { type: 'move', node: state.campaign!.nodes[first[0]].next[0] })).toBe('bad-node');
  });
});

describe('harvest and levels', () => {
  it('levels the first readied item that takes a harvest color once per fight, and turns untaken harvest into supplies', () => {
    let { state } = run(fighting(), { type: 'begin-round', round: ROUND }, turn(0), turn(1));
    expect(state.encounter?.phase).toBe('scavenge');
    // Harvest colors are 5, 6, 7 and the sword takes 0 to 2, so give it 5 and 6 by hand.
    state.slots[0] = { ...state.slots[0], item: { ...state.slots[0].item, colors: [0, 1, 2, 5, 6] } };
    const events: AdventureEvent[] = [];
    for (const color of [5, 6, 7, 8]) {
      const result = run(state, turn(color));
      state = result.state;
      events.push(...result.events);
    }
    expect(state.slots[0]).toMatchObject({ level: 1, xp: XP_PER_LEVEL });
    expect(events.filter((e) => e.type === 'item-leveled')).toHaveLength(1);
    // Color 7 harvests to supplies; 8 is not harvestable and fizzles.
    expect(state.resources.supplies).toBe(2);
    expect(events.at(-1)).toEqual({ type: 'pulse-discarded' });
  });

  it('lets readied items take any color after a kill, and only harvest colors become supplies', () => {
    let { state } = run(fighting(), { type: 'begin-round', round: ROUND }, turn(0), turn(1));
    // Color 8 is not harvestable; a readied forage item still forages it.
    state.slots[1] = { ...state.slots[1], item: { ...state.slots[1].item, effect: 'forage', colors: [8] } };
    const events: AdventureEvent[] = [];
    for (const color of [2, 8]) {
      const result = run(state, turn(color));
      state = result.state;
      events.push(...result.events);
    }
    expect(events).toContainEqual(expect.objectContaining({ type: 'experience-gained', item: state.slots[0].item.id }));
    expect(state.resources.supplies).toBeGreaterThan(0);
  });

  it('adds one band step per level, continuing past the top band', () => {
    const bands = [{ min: 1, value: 2 }, { min: 4, value: 3 }, { min: 8, value: 5 }];
    expect(bandOf(bands, 1, 1)).toEqual({ band: 1, value: 3 });
    expect(bandOf(bands, 8, 2)).toEqual({ band: 2, value: 9 });
  });
});

describe('fights that last', () => {
  it('enrages or flees at the end of each puzzle it survives, and harvest shrinks with fight length', () => {
    let { state } = run(fighting({ enrage: 2 }), ...PUZZLE);
    expect(state.encounter).toMatchObject({ rage: 2, rounds: 1 });
    ({ state } = run(state, { type: 'begin-round', round: ROUND }));
    expect(state.encounter).toMatchObject({ rounds: 2 });
    expect(harvestColors(state.encounter!)).toEqual([5, 6]);
    let fled = run(fighting({ flee: 1 }), ...PUZZLE);
    expect(fled.state.encounter).toBeNull();
    expect(fled.events.some((e) => e.type === 'enemy-fled')).toBe(true);
    fled = run(fighting({ flee: 2 }), ...PUZZLE, { type: 'begin-round', round: ROUND });
    expect(fled.state.encounter).toMatchObject({ rounds: 2 });
  });

  it('lets the player flee between puzzles, taking the telegraphed hit, but never from a boss', () => {
    const { state, events } = run(fighting(), { type: 'flee' });
    expect(state.encounter).toBeNull();
    expect(state.health).toBe(17);
    expect(events.some((e) => e.type === 'player-fled')).toBe(true);
    expect(rejection(fighting({ boss: true }), { type: 'flee' })).toBe('unavailable');
    expect(rejection(run(fighting(), { type: 'begin-round', round: ROUND }).state, { type: 'flee' })).toBe('wrong-phase');
  });

  it('locks in victory on the reveal that kills the boss and ends the run after that puzzle', () => {
    const { state: won } = run(fighting({ boss: true }), { type: 'begin-round', round: ROUND }, turn(0), turn(1));
    expect(won.outcome).toBe('victory');
    expect(won.phase).toBe('round');
    const { state, events } = run(won, { type: 'end-round', outcome: 'failed' });
    expect(state.phase).toBe('ended');
    expect(events.at(-1)).toEqual({ type: 'run-ended', outcome: 'victory' });
  });
});

describe('consumables and the pack', () => {
  it('uses consumables without a turn, between rounds or mid-puzzle', () => {
    const state = fighting();
    state.consumables = [{ id: 'bomb', effect: 'attack', value: 6 }, { id: 'shield', effect: 'block', value: 6 }];
    let result = run(state, { type: 'use-consumable', index: 0 }, { type: 'use-consumable', index: 0 });
    expect(result.state.encounter).toMatchObject({ health: 4 });
    expect(result.state.block).toBe(6);
    result = run(result.state, { type: 'begin-round', round: ROUND });
    expect(result.state.round?.turn).toBe(0);
    expect(rejection(startRun(KNIGHT), { type: 'use-consumable', index: 0 })).toBe('bad-slot');
  });

  it('moves items between slots and pack, keeping their state, within capacity', () => {
    const state = fighting();
    state.pack = [{ ...slotOf(KNIGHT.loadout[1]), level: 2 }];
    let result = run(state, { type: 'move-item', from: { area: 'pack', index: 0 }, to: { area: 'slots', index: 0 } });
    expect(result.state.slots[0].level).toBe(2);
    expect(result.state.pack?.[0].item.id).toBe('sword');
    result = run(result.state, { type: 'move-item', from: { area: 'pack', index: 0 }, to: { area: 'slots', index: 2 } });
    expect(result.state.slots.map((s) => s.item.id)).toEqual(['guard', 'guard', 'sword']);
    expect(rejection(result.state, { type: 'move-item', from: { area: 'slots', index: 0 }, to: { area: 'pack', index: 3 } })).toBe('bad-slot');
  });
});

describe('stops', () => {
  /** A campaign run moved onto a node of a kind, found by searching seeds. */
  const at = (kind: string): AdventureState => {
    for (let seed = 0; seed < 500; seed++) {
      let state = newCampaign(KNIGHT, seed);
      const nodes = state.campaign!.nodes;
      const target = nodes.findIndex((n) => n.kind === kind);
      const from = nodes.findIndex((n) => n.next.includes(target));
      if (target < 0 || from < 0) continue;
      state = structuredClone(state);
      state.campaign!.at = from;
      return run(state, { type: 'move', node: target }).state;
    }
    throw new Error(`no ${kind} found`);
  };

  it('rests once: heal a third, or level an item', () => {
    const state = at('rest');
    state.health = 10;
    expect(run(state, { type: 'rest', choice: 'heal' }).state.health).toBe(10 + Math.ceil(KNIGHT.health / 3));
    const upgraded = run(state, { type: 'rest', choice: 'upgrade', from: { area: 'slots', index: 1 } }).state;
    expect(upgraded.slots[1].level).toBe(1);
    expect(rejection(upgraded, { type: 'rest', choice: 'heal' })).toBe('unavailable');
  });

  it('sells fixed stock and healing for supplies, buys back at half price, with no reroll on return', () => {
    const state = at('shop');
    expect(state.campaign!.shop!.stock).toHaveLength(6);
    expect(rejection(state, { type: 'buy', index: 0 })).toBe('no-supplies');
    state.resources.supplies = 100;
    state.health = KNIGHT.health - 4;
    let result = run(state, { type: 'buy', index: 0 }, { type: 'buy-health', amount: 10 });
    expect(result.state.slots).toHaveLength(3);
    expect(result.state.health).toBe(KNIGHT.health);
    expect(result.state.campaign!.shop!.stock[0]).toBeNull();
    const spent = 100 - result.state.resources.supplies;
    expect(spent).toBe(state.campaign!.shop!.stock[0]!.price + 8);
    result = run(result.state, { type: 'sell', from: { area: 'slots', index: 2 } });
    expect(result.state.resources.supplies).toBe(100 - spent + Math.floor(state.campaign!.shop!.stock[0]!.price / 2));
  });

  it('answers an event once', () => {
    const state = at('event');
    state.resources.supplies = 20;
    const { state: after, events } = run(state, { type: 'answer', option: 0 });
    expect(events.some((e) => e.type === 'event-answered')).toBe(true);
    expect(rejection(after, { type: 'answer', option: 0 })).toBe('unavailable');
  });

  it('drops loot on a kill, from the seed, collected between rounds', () => {
    let state = newCampaign(KNIGHT, 11);
    ({ state } = run(state, { type: 'move', node: choices(state)[0] }));
    if (state.encounter?.type === 'enemy') state.encounter.health = 1;
    const killed = run(state, { type: 'begin-round', round: ROUND }, turn(0));
    expect(killed.state.campaign!.loot.length).toBeGreaterThanOrEqual(2);
    expect(killed.events.some((e) => e.type === 'loot-dropped')).toBe(true);
    expect(rejection(killed.state, { type: 'take-loot', index: 0 })).toBe('wrong-phase');
    const between = run(killed.state, ...[1, 2, 3, 4, 5, 6, 7, 8].map((c) => turn(c)), { type: 'end-round', outcome: 'completed' },
      { type: 'take-loot', index: 0 }).state;
    expect(between.campaign!.loot.length).toBe(killed.state.campaign!.loot.length - 1);
    expect(advance(killed.state, turn(5)).state.campaign!.loot).toEqual(killed.state.campaign!.loot);
  });

  it('leaves a dropped item here as loot, keeping its level when picked back up', () => {
    const state = newCampaign(KNIGHT, 11);
    state.slots[0].level = 2;
    const { state: dropped } = run(state, { type: 'drop-item', from: { area: 'slots', index: 0 } });
    expect(dropped.slots.map((s) => s.item.id)).not.toContain(state.slots[0].item.id);
    expect(dropped.campaign!.loot.at(-1)).toMatchObject({ kind: 'gear', item: { id: state.slots[0].item.id } });
    const back = run(dropped, { type: 'take-loot', index: dropped.campaign!.loot.length - 1 }).state;
    expect(back.slots.at(-1)).toMatchObject({ item: { id: state.slots[0].item.id }, level: 2 });
  });
});

describe('complete runs', () => {
  const pool: SimulationRound[] = [];
  const wrongPool: SimulationRound[] = [];
  for (const file of ['tests/sample-games.csv', 'tests/barry-phone.csv']) {
    for (const trace of parseTraces(readFileSync(file, 'utf8'), file).traces.filter((t) => t.size === 9)) {
      const input = replayRound(trace);
      const decoded = decodeSeedCode(trace.code);
      if (!input || !decoded) continue;
      const puzzle = generate(decoded.settings, decoded.seed, decoded.version);
      pool.push({ puzzle, input });
      wrongPool.push({ puzzle, input: syntheticRound(trace, 1, pool.length) });
    }
  }

  it('reaches a valid outcome for every starter and policy, deterministically', () => {
    expect(simulateRun(KNIGHT, 2, pool, 'planned')).toEqual(simulateRun(KNIGHT, 2, pool, 'planned'));
    expect(pool.length).toBeGreaterThanOrEqual(30);
    for (const starter of STARTERS) {
      for (const policy of ['planned', 'ordinary'] as const) {
        for (const rounds of [pool, wrongPool]) {
          const report = simulateRun(starter, 1, rounds, policy);
          expect(['victory', 'death']).toContain(report.outcome);
          expect(report.puzzles).toBeGreaterThan(0);
        }
      }
    }
  }, 30_000);

  it('keeps the engine and campaign in step: a sandbox step and advance agree on engine commands', () => {
    const state = fighting();
    expect(advance(state, { type: 'begin-round', round: ROUND })).toEqual(step(state, { type: 'begin-round', round: ROUND }));
  });
});
