import { generate, type Puzzle } from '../../engine';
import type { CharacterDef, EncounterDef, ItemDef } from '../engine';
import { runExperiments, summarize } from './experiments';
import { opportunities, reachableCells, shuffleTurns, streamSeed } from './ordering';
import { simulate, type SimulationRound } from './simulation';
import type { RoundTurn } from './traces';

const bands = [{ min: 1, value: 1 }];
const dagger: ItemDef = { id: 'attack', effect: 'attack', colors: [0, 1, 2], bands };
const character: CharacterDef = { id: 'test', health: 5, loadout: [dagger] };
const enemy: EncounterDef = {
  type: 'enemy', id: 'enemy', health: 4, intents: [{ delay: 99, damage: 1 }],
  scavenge: [{ colors: [0, 1, 2], resource: 'supplies', bands }],
};
// Fixed-order engine fixture; intentionally no solver assumptions about its solution.
const puzzle: Puzzle = {
  size: 3, regions: [0, 0, 0, 1, 1, 1, 2, 2, 2], colors: [0, 1, 2],
  solution: [0, 4, 8], givens: [], tier: 'medium', silver: false, code: 'fixture',
};
const round = (id = 'a'): SimulationRound => ({
  puzzle, input: { dataset: 'fixture', id, code: 'fixture', size: 3, tier: 'medium', sequence: 'replay',
    turns: [0, 1, 2].map((color) => ({ type: 'collect', color, amount: 3, source: 'player' })) },
});

describe('strategic simulation', () => {
  it('carries a single encounter across distinct puzzles and finishes the won puzzle for scavenging', () => {
    const options = { character, encounter: enemy, rounds: [round(), round('b')], readiness: 'passive' as const, order: 'fixed' as const };
    const saved = JSON.stringify(options);
    const result = simulate(options);
    expect(result).toMatchObject({ outcome: 'defeated', resolutionTurn: 4, rounds: 2, turns: 6,
      combatTurns: 4, damageDealt: 4, damageTaken: 0, resources: { supplies: 2 }, energy: 18, consumedEnergy: 18 });
    expect(simulate(JSON.parse(saved) as typeof options)).toEqual(result);
    expect(JSON.stringify(options)).toBe(saved);
  });

  it('reactively bypasses overlapping full-health healing to land a lethal attack before the enemy', () => {
    const overlap: CharacterDef = { ...character, loadout: [
      { id: 'herbs', effect: 'heal', colors: [0, 1, 2], bands }, { ...dagger, bands: [{ min: 1, value: 7 }] },
    ] };
    const options = { character: overlap, encounter: { ...enemy, health: 6, intents: [{ delay: 1, damage: 10 }] },
      rounds: [round()], order: 'fixed' as const };
    expect(simulate({ ...options, readiness: 'passive' })).toMatchObject({ outcome: 'death', turns: 1, healed: 0 });
    const reactive = simulate({ ...options, readiness: 'reactive' });
    expect(reactive).toMatchObject({ outcome: 'defeated', resolutionTurn: 1, damageTaken: 0,
      damageDealt: 6, usefulBeforeFirstAttack: true });
    expect(reactive.readinessChanges).toBeGreaterThan(0);
  });

  it('accounts separately for discarded pulses, cooldowns, and charge energy lost at the boundary', () => {
    const result = simulate({ character: { ...character, loadout: [
      { ...dagger, colors: [0, 1], cooldown: 4 },
      { ...dagger, id: 'charge', colors: [2, 3], charge: true },
    ] }, encounter: enemy, rounds: [round()], readiness: 'passive', order: 'fixed' });
    expect(result).toMatchObject({ outcome: 'limit', energy: 9, consumedEnergy: 6, discardedEnergy: 3,
      cooldownEnergy: 3, abandonedChargeEnergy: 3, completedCharges: 0 });
    expect(result.energy).toBe(result.consumedEnergy + result.discardedEnergy);
    expect(result.discardedEnergy).toBe(result.cooldownEnergy + result.uncoveredEnergy + result.contextEnergy);
  });

  it('distinguishes being alive at the limit from surviving a resolved encounter', () => {
    const records = runExperiments([round()], 'recorded', {
      seed: 4, shuffles: 2, maxRounds: 3, loadouts: [character], encounters: [enemy],
    }).filter((r) => r.order === 'observed');
    expect(summarize(records)).toMatchObject({ n: 2, survived: 0, success: 0, death: 0, unresolved: 1, resolutionTurn: null });
    expect(records[0].sources).toHaveLength(1); // Never repeats a puzzle to pad a short dataset.
  });

  it('shuffles whole pulses reproducibly, preserving wrong-turn positions', () => {
    const turns: RoundTurn[] = [
      { type: 'collect', color: 0, amount: 1, source: 'player' }, { type: 'wrong' },
      { type: 'collect', color: 1, amount: 9, source: 'owl' },
      { type: 'collect', color: 2, amount: 15, source: 'player' },
    ];
    const shuffled = shuffleTurns(turns, streamSeed(4, 'shuffle'));
    expect(shuffled).toEqual(shuffleTurns(turns, streamSeed(4, 'shuffle')));
    expect(shuffled[1]).toEqual({ type: 'wrong' });
    expect(shuffled.filter((t) => t.type === 'collect')).toEqual(expect.arrayContaining(turns.filter((t) => t.type === 'collect')));
    expect(shuffled).not.toEqual(turns);
  });

  it('does not let readiness inspect the hidden solution or future collection order', () => {
    // The API accepts only current engine state and the visible pulse.
    const a = runExperiments([round()], 'recorded', { seed: 6, shuffles: 1, maxRounds: 1,
      loadouts: [character], encounters: [enemy] }).filter((r) => r.order === 'observed');
    const changed = { ...round(), puzzle: { ...puzzle, solution: [1, 5, 6] } };
    const b = runExperiments([changed], 'recorded', { seed: 6, shuffles: 1, maxRounds: 1,
      loadouts: [character], encounters: [enemy] }).filter((r) => r.order === 'observed');
    expect(a).toEqual(b);
  });

  it('wrong turns advance attacks but never create a pulse', () => {
    const wrong = round();
    const baseline = { character, encounter: { ...enemy, intents: [{ delay: 2, damage: 3 }] },
      readiness: 'passive' as const, order: 'fixed' as const };
    const clean = simulate({ ...baseline, rounds: [wrong] });
    const result = simulate({ ...baseline, rounds: [{ ...wrong, input: { ...wrong.input,
      turns: [{ type: 'wrong' }, ...wrong.input.turns] } }] });
    expect(clean).toMatchObject({ outcome: 'limit', health: 2, turns: 3, pulses: 3 });
    expect(result).toMatchObject({ outcome: 'death', health: 0, turns: 4, pulses: 3, energy: 9 });
  });
});

describe('solver availability boundary', () => {
  const board = generate({ size: 5, tier: 'medium', freebies: 0, silver: false, shape: 2, sizeMix: 2 }, 42);

  it('finishes using only currently deducible stumps, without reading the hidden solution', () => {
    const visible = { size: board.size, regions: board.regions, colors: board.colors };
    const revealed = [...board.givens];
    while (revealed.length < board.size) {
      const choices = reachableCells(visible, revealed);
      expect(choices.length).toBeGreaterThan(0);
      expect(choices.every((cell) => board.solution.includes(cell) && !revealed.includes(cell))).toBe(true);
      revealed.push(choices[0]);
    }
    expect(reachableCells(visible, revealed)).toEqual([]);
  });

  it('keeps oracle knowledge separate from solver candidates', () => {
    const revealed = [...board.givens];
    const solver = opportunities(board, revealed);
    const oracle = opportunities(board, revealed, true);
    expect(oracle.length).toBe(board.size - revealed.length);
    expect(oracle).toEqual(expect.arrayContaining(solver));
    expect(opportunities({ ...board, solution: [] }, revealed)).toEqual(solver);
  });
});
