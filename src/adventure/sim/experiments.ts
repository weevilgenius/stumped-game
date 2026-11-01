import { DAGGER, HERBS, ROCKFALL, SATCHEL, SHIELD, STAFF, WANDERER, WOLF } from '../content/sandbox';
import type { CharacterDef, EncounterDef } from '../engine';
import { shuffleTurns, streamSeed } from './ordering';
import { simulate, type OrderPolicy, type ReadinessPolicy, type SimulationRound, type TrialMetrics } from './simulation';

/** Four experimental loadouts, not loot definitions or proposed final balance. */
export const LOADOUTS: readonly CharacterDef[] = [
  WANDERER,
  { id: 'coverage', health: 20, loadout: [
    { ...DAGGER, colors: [0, 1, 4, 5, 6] }, SHIELD, HERBS, SATCHEL,
  ] },
  { id: 'overlap', health: 20, loadout: [
    { ...HERBS, colors: [0, 1, 2, 3] }, { ...SHIELD, colors: [0, 1, 2, 3] },
    { ...DAGGER, colors: [0, 1, 2, 3] }, STAFF,
  ] },
  { id: 'specialist', health: 20, loadout: [
    { ...STAFF, colors: [0, 1, 2] },
    { ...DAGGER, id: 'sling', colors: [0, 1, 2, 3, 4, 5, 6, 7, 8], cooldown: 2,
      bands: [{ min: 1, value: 4 }, { min: 8, value: 5 }, { min: 15, value: 6 }] },
    { ...SHIELD, colors: [2, 3, 4] }, { ...HERBS, colors: [4, 5] },
  ] },
];

const wolf = WOLF as EncounterDef & { readonly type: 'enemy' };

/** Opening enemy plus timing/strength sensitivity and the noncombat objective. */
export const ENCOUNTERS: readonly EncounterDef[] = [
  WOLF,
  { ...wolf, id: 'swift-wolf', intents: [{ delay: 2, damage: 4 }] },
  { ...wolf, id: 'brute', health: 30, intents: [{ delay: 4, damage: 8 }] },
  ROCKFALL,
];

/** Configuration and provenance of one metric row. */
export interface TrialRecord {
  /** Planned puzzle inputs; metrics.rounds gives the prefix actually entered. */
  readonly sources: readonly { dataset: string; id: string; code: string; sequence: string }[];
  /** Cohort; generated puzzles are always modeled. */
  readonly cohort: 'recorded' | 'generated';
  /** First puzzle's difficulty; later puzzles stay in the same group. */
  readonly tier: string;
  /** Loadout id. */
  readonly loadout: string;
  /** Encounter id. */
  readonly encounter: string;
  /** Collection order model. */
  readonly order: 'observed' | 'shuffled' | 'solver' | 'tactical' | 'oracle';
  /** Readiness model. */
  readonly readiness: ReadinessPolicy;
  /** Shuffle replicate, null for non-shuffled orders. */
  readonly replicate: number | null;
  /** Stable seed for this experiment, independent of loadout and policy. */
  readonly seed: number;
  /** Raw results. */
  readonly metrics: TrialMetrics;
}

/** Batch knobs kept in the report for reproducibility. */
export interface ExperimentOptions {
  /** Root seed, used only for shuffle streams. */
  readonly seed: number;
  /** Shuffles per puzzle. */
  readonly shuffles: number;
  /** Maximum distinct puzzles before an unresolved encounter is censored. */
  readonly maxRounds: number;
  /** Override loadouts for small experiments. */
  readonly loadouts?: readonly CharacterDef[];
  /** Override encounters for small experiments. */
  readonly encounters?: readonly EncounterDef[];
}

/**
 * Paired experiments: every loadout/readiness comparison receives the same
 * boards and shuffle stream. Pools must be homogeneous by dataset and tier.
 * No victory rate is claimed; trials stop after their first encounter.
 */
export function runExperiments(pool: readonly SimulationRound[], cohort: TrialRecord['cohort'], options: ExperimentOptions): TrialRecord[] {
  if (!Number.isInteger(options.shuffles) || options.shuffles < 1
    || !Number.isInteger(options.maxRounds) || options.maxRounds < 1) throw new Error('Positive shuffle and round counts required');
  if (pool.some((r) => r.input.dataset !== pool[0].input.dataset || r.input.tier !== pool[0].input.tier)) {
    throw new Error('Experiment pools must share dataset and tier');
  }
  const records: TrialRecord[] = [];
  const variants: { order: TrialRecord['order']; mode: OrderPolicy; replicate: number | null }[] = [
    ...(cohort === 'recorded' ? [{ order: 'observed' as const, mode: 'fixed' as const, replicate: null }] : []),
    ...Array.from({ length: options.shuffles }, (_, replicate) => ({
      order: 'shuffled' as const, mode: 'fixed' as const, replicate,
    })),
    { order: 'solver', mode: 'solver', replicate: null },
    { order: 'tactical', mode: 'tactical', replicate: null },
    { order: 'oracle', mode: 'oracle', replicate: null },
  ];
  for (let index = 0; index < pool.length; index++) {
    const seenCodes = new Set<string>();
    const rounds = Array.from({ length: pool.length }, (_, offset) => pool[(index + offset) % pool.length])
      .filter((round) => {
        if (seenCodes.has(round.input.code)) return false;
        seenCodes.add(round.input.code);
        return true;
      }).slice(0, options.maxRounds);
    for (const variant of variants) {
      const seed = streamSeed(options.seed, `${pool[index].input.dataset}/${pool[index].input.id}/${variant.replicate ?? 'fixed'}`);
      const inputs = rounds.map((round) => (variant.order !== 'shuffled' ? round : {
        ...round, input: { ...round.input, turns: shuffleTurns(round.input.turns, streamSeed(seed, round.input.id)) },
      }));
      for (const character of options.loadouts ?? LOADOUTS) {
        for (const encounter of options.encounters ?? ENCOUNTERS) {
          // Tactical and oracle already select using the reactive heuristic.
          const policies: ReadinessPolicy[] = variant.mode === 'tactical' || variant.mode === 'oracle'
            ? ['reactive'] : ['passive', 'reactive'];
          for (const readiness of policies) {
            records.push({
              sources: inputs.map(({ input }) => ({
                dataset: input.dataset, id: input.id, code: input.code,
                sequence: variant.order === 'observed' ? input.sequence : `modeled-${variant.order}`,
              })),
              cohort, tier: pool[index].input.tier, loadout: character.id, encounter: encounter.id,
              order: variant.order, readiness, replicate: variant.replicate, seed,
              metrics: simulate({ character, encounter, rounds: inputs, readiness, order: variant.mode }),
            });
          }
        }
      }
    }
  }
  return records;
}

/** Aggregated comparison, with death and censoring kept distinct. */
export interface Summary {
  /** Number of trials (not independent players). */
  readonly n: number;
  /** Fraction dying before the encounter resolves. */
  readonly death: number;
  /** Fraction winning the encounter. */
  readonly success: number;
  /** Fraction surviving a resolved encounter, conservative lower survival estimate. */
  readonly survived: number;
  /** Live encounters stopped at the round limit; never counted as success. */
  readonly unresolved: number;
  /** Availability model could not finish the puzzle. */
  readonly stalled: number;
  /** Mean net incoming damage. */
  readonly damage: number;
  /** Mean net incoming damage in the first three turns. */
  readonly earlyDamage: number;
  /** Mean effective outgoing damage in the first three turns. */
  readonly earlyAttack: number;
  /** Mean final health. */
  readonly health: number;
  /** Mean resolution turn among resolved encounters, null when none resolve. */
  readonly resolutionTurn: number | null;
  /** Fraction of turns starting in combat, weighted by turns. */
  readonly combat: number;
  /** Discarded squares / collected squares. */
  readonly waste: number;
  /** Unfinished charge squares / collected squares. */
  readonly abandonedCharges: number;
  /** Fraction of trials with an item action before the first attack. */
  readonly openingAction: number;
  /** Mean completed charges. */
  readonly charges: number;
  /** Mean supplies, including postcombat scavenging. */
  readonly supplies: number;
}

/** Aggregate a homogeneous group; raw JSON retains item metrics and discard reasons. */
export function summarize(records: readonly TrialRecord[]): Summary {
  const metrics = records.map((r) => r.metrics);
  const mean = (f: (m: TrialMetrics) => number): number => metrics.reduce((sum, m) => sum + f(m), 0) / (metrics.length || 1);
  const total = (key: keyof Pick<TrialMetrics, 'energy' | 'turns' | 'combatTurns' | 'discardedEnergy' | 'abandonedChargeEnergy'>): number => (
    metrics.reduce((sum, m) => sum + m[key], 0));
  const resolved = metrics.flatMap((m) => m.resolutionTurn === null ? [] : [m.resolutionTurn]);
  return {
    n: metrics.length, death: mean((m) => Number(m.outcome === 'death')),
    success: mean((m) => Number(m.outcome === 'defeated' || m.outcome === 'completed')),
    survived: mean((m) => Number(['defeated', 'completed', 'failed'].includes(m.outcome))),
    unresolved: mean((m) => Number(m.outcome === 'limit')), stalled: mean((m) => Number(m.outcome === 'solver-stalled')),
    damage: mean((m) => m.damageTaken), earlyDamage: mean((m) => m.earlyDamageTaken), earlyAttack: mean((m) => m.earlyDamageDealt),
    health: mean((m) => m.health), resolutionTurn: resolved.length ? resolved.reduce((a, b) => a + b, 0) / resolved.length : null,
    combat: total('combatTurns') / (total('turns') || 1), waste: total('discardedEnergy') / (total('energy') || 1),
    abandonedCharges: total('abandonedChargeEnergy') / (total('energy') || 1),
    openingAction: mean((m) => Number(m.usefulBeforeFirstAttack)), charges: mean((m) => m.completedCharges),
    supplies: mean((m) => m.resources.supplies ?? 0),
  };
}

