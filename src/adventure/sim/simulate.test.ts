import { readFileSync } from 'node:fs';
import { HUNTER, WANDERER, WOLF } from '../content/sandbox';
import { decodeSeedCode, generate } from '../../engine';
import { deducible, ORDERINGS, POLICIES, type SimRound, simulateEncounter } from './simulate';
import { parseTraces, replayRound } from './traces';

const { traces } = parseTraces(readFileSync('tests/sample-games.csv', 'utf8'), 'sample-games');
const trace = traces.find((t) => t.size === 9 && t.turnsKnown)!;
const decoded = decodeSeedCode(trace.code)!;
const puzzle = generate(decoded.settings, decoded.seed, decoded.version);
const round: SimRound = { puzzle, turns: replayRound(trace)!.turns };

describe('deducible stumps', () => {
  it('finds only real stumps, and at least one', () => {
    const cells = deducible(puzzle, puzzle.givens);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((cell) => puzzle.solution.includes(cell) && !puzzle.givens.includes(cell))).toBe(true);
  });

  it('finds the last stump once the rest are revealed', () => {
    const last = puzzle.solution.at(-1)!;
    expect(deducible(puzzle, puzzle.solution.slice(0, -1))).toEqual([last]);
  });
});

describe('simulated encounters', () => {
  it('plays every policy and ordering to a result, repeatably', () => {
    for (const policy of POLICIES) {
      for (const ordering of ORDERINGS) {
        const result = simulateEncounter(HUNTER, WOLF, [round, round, round], policy, ordering, 7);
        expect(result).toEqual(simulateEncounter(HUNTER, WOLF, [round, round, round], policy, ordering, 7));
        expect(result.rounds).toBeGreaterThan(0);
        expect(result.wasted).toBeLessThanOrEqual(result.combatPulses);
      }
    }
  });

  it('counts every recorded pulse in the observed order', () => {
    const result = simulateEncounter(WANDERER, WOLF, [round], 'passive', 'observed');
    const pulses = round.turns.filter((turn) => turn.type === 'collect').length;
    expect(result.rounds).toBe(1);
    expect(result.combatPulses).toBeLessThanOrEqual(pulses);
    expect(result.combatPulses).toBeGreaterThan(0);
  });
});
