import { describe, expect, it } from 'vitest';
import { generate } from '../../engine';
import { STARTERS } from '../content/campaign';
import { createCampaign, startRun, step } from '../engine';
import { bankedOpportunities } from './ordering';
import { simulateCampaign } from './campaign';
import type { SimulationRound } from './simulation';

const puzzle = generate({ size: 9, tier: 'medium', freebies: 0, silver: false, shape: 1, sizeMix: 1 }, 7);
const rounds: SimulationRound[] = Array.from({ length: 3 }, (_, index) => ({ puzzle, input: {
  dataset: 'fixture', id: String(index), code: puzzle.code, size: 9, tier: 'medium', sequence: 'synthetic', turns: [],
} }));

describe('complete-run policies', () => {
  it('banks deductions without reading the hidden solution', () => {
    const { solution: _solution, ...visible } = puzzle;
    const bank = bankedOpportunities(visible);
    expect(bank).toHaveLength(9);
    expect(bank.map((entry) => entry.cell).sort((a, b) => a - b)).toEqual([...puzzle.solution]);
    expect(new Set(bank.map((entry) => entry.color)).size).toBe(9);
  });

  it.each(['ordinary', 'planned'] as const)('%s commands replay under exactly the interactive engine and remain deterministic', (policy) => {
    const options = { seed: 7, starter: STARTERS[0], policy, gear: 'coverage' as const, mistakes: false, rounds: rounds.slice(0, 1) };
    const result = simulateCampaign(options);
    const start = startRun(options.starter);
    start.campaign = createCampaign(options.seed);
    const replayed = result.log.reduce((state, command) => {
      const next = step(state, command);
      expect(next.events.some((event) => event.type === 'command-rejected')).toBe(false);
      return next.state;
    }, start);
    expect(replayed).toEqual(result.state);
    expect(simulateCampaign(options)).toEqual(result);
    expect(result.sources[0]).toMatchObject({ dataset: 'fixture', code: puzzle.code });
    expect(['death', 'limit']).toContain(result.outcome);
    expect(result.history).toHaveLength(1);
    expect(result.sequence).toContain('modeled');
  });

  it('labels synthetic wrong turns, tracks opening progress separately, and reports unfinished runs', () => {
    const result = simulateCampaign({ seed: 7, starter: STARTERS[0], policy: 'ordinary', gear: 'weak', mistakes: true, rounds });
    expect(result.sequence).toContain('synthetic wrong');
    expect(result.log.some((command) => command.type === 'turn' && !command.collect)).toBe(true);
    expect(result.history.every((point) => point.health <= 24)).toBe(true);
    expect(result.state.campaign!.wins).toBeGreaterThanOrEqual(0);
    const empty = simulateCampaign({ seed: 7, starter: STARTERS[0], policy: 'ordinary', gear: 'weak', mistakes: false, rounds: [] });
    expect(empty).toMatchObject({ outcome: 'limit', survived: true, usefulGearRound: null, openingWinRound: null });
  });
});
