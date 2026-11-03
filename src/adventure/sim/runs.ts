import type { AdventureEvent, AdventureState, Collection, RunOutcome } from '../engine';
import { advance, choices, priceOf, type RunCommand } from '../campaign';
import { newCampaign } from '../campaign';
import { MAX_CONSUMABLES } from '../engine';
import type { Starter } from '../content/campaign';
import { opportunities } from './ordering';
import { reactiveChoice, type SimulationRound } from './simulation';
import type { RoundTurn } from './traces';

/* ========================================================= *\
 *  Complete-run simulation: a simple player drives a whole  *
 *  campaign through advance(), the same rules the game      *
 *  uses, with recorded or generated puzzles.                *
\* ========================================================= */

/** How the simulated player reveals: planned (banked deductions, chosen order, tended readiness) or ordinary. */
export type RunPolicy = 'planned' | 'ordinary';

/** What one complete run did. */
export interface RunReport {
  /** Starter id. */
  readonly starter: string;
  /** Map and loot seed. */
  readonly seed: number;
  /** Reveal policy. */
  readonly policy: RunPolicy;
  /** How it ended, or 'unfinished' if the puzzle pool ran out. */
  readonly outcome: RunOutcome | 'unfinished';
  /** Map column reached, from 0. */
  readonly column: number;
  /** Puzzles played. */
  readonly puzzles: number;
  /** Fights won. */
  readonly fightsWon: number;
  /** Enemies that fled with their loot. */
  readonly escaped: number;
  /** Health after each fight that was won. */
  readonly healthAfterFights: readonly number[];
  /** Gear picked up or bought. */
  readonly gearGained: number;
  /** Levels gained by harvest or rest. */
  readonly levels: number;
  /** Supplies earned and spent. */
  readonly suppliesEarned: number;
  readonly suppliesSpent: number;
}

/** Map preference: low health heads for recovery, otherwise for fights and loot. */
const nodeScore = (state: AdventureState, node: number): number => {
  const { kind } = state.campaign!.nodes[node];
  const low = state.health < state.maxHealth / 2;
  const scores: Record<string, number> = low
    ? { rest: 6, shop: 5, event: 4, forage: 3, fight: 2, elite: 0, boss: 1 }
    : { elite: 4, fight: 5, forage: 3, shop: 3, event: 2, rest: 1, boss: 1 };
  return scores[kind];
};

/**
 * Plays one complete run.
 * @param starter the character
 * @param seed the run's seed
 * @param pool puzzles to play in order, starting at an offset from the seed; none is repeated
 * @param policy how reveals are chosen
 * @returns the run's report
 */
export function simulateRun(starter: Starter, seed: number, pool: readonly SimulationRound[], policy: RunPolicy): RunReport {
  let state = newCampaign(starter, seed);
  const tally = { puzzles: 0, fightsWon: 0, escaped: 0, gearGained: 0, levels: 0, suppliesEarned: 0, suppliesSpent: 0 };
  const healthAfterFights: number[] = [];
  const issue = (command: RunCommand): readonly AdventureEvent[] => {
    const result = advance(state, command);
    if (result.events[0]?.type === 'command-rejected') return [];
    state = result.state;
    for (const event of result.events) {
      if (event.type === 'encounter-transitioned' && event.outcome === 'defeated') tally.fightsWon++;
      if (event.type === 'enemy-fled') tally.escaped++;
      if (event.type === 'item-leveled') tally.levels++;
      if (event.type === 'resource-changed' && event.resource === 'supplies') {
        if (event.amount > 0) tally.suppliesEarned += event.amount;
        else tally.suppliesSpent -= event.amount;
      }
    }
    return result.events;
  };
  // A function, so the checks see state changed by issue().
  const ended = (): boolean => state.phase === 'ended';
  const gear = (): number => state.slots.length + (state.pack?.length ?? 0);

  /** Between rounds: take loot, use the stop, then move on. */
  const between = (): void => {
    const campaign = state.campaign!;
    for (let i = campaign.loot.length - 1; i >= 0; i--) {
      const before = gear();
      issue({ type: 'take-loot', index: i });
      tally.gearGained += gear() - before;
    }
    if (campaign.event) {
      const event = state.campaign!.event!;
      issue({ type: 'answer', option: 0 });
      if (state.campaign!.event === event) issue({ type: 'answer', option: 1 });
      for (let i = state.campaign!.loot.length - 1; i >= 0; i--) issue({ type: 'take-loot', index: i });
    }
    if (campaign.rest) {
      issue(state.health < state.maxHealth * 0.7 ? { type: 'rest', choice: 'heal' } : { type: 'rest', choice: 'upgrade', from: { area: 'slots', index: 0 } });
    }
    if (campaign.shop) {
      const missing = state.maxHealth - state.health;
      if (missing > state.maxHealth / 3) issue({ type: 'buy-health', amount: Math.min(missing, Math.floor((state.resources.supplies ?? 0) / 2)) });
      campaign.shop.stock.forEach((entry, i) => {
        if (entry && (state.resources.supplies ?? 0) >= priceOf(entry.goods)) {
          const before = gear();
          issue({ type: 'buy', index: i });
          tally.gearGained += gear() - before;
        }
      });
    }
    // Healing potions between fights when low.
    const potion = (state.consumables ?? []).findIndex((c) => c.effect === 'heal');
    if (potion >= 0 && state.health < state.maxHealth / 2) issue({ type: 'use-consumable', index: potion });
    const options = choices(state);
    if (options.length) {
      const best = [...options].sort((a, b) => nodeScore(state, b) - nodeScore(state, a))[0];
      issue({ type: 'move', node: best });
    }
  };

  let next = seed % Math.max(1, pool.length);
  for (let guard = 0; !ended() && guard < 200; guard++) {
    if (!state.encounter) {
      if (!choices(state).length) break;
      between();
      continue;
    }
    if (tally.puzzles >= pool.length) break;
    const { puzzle, input } = pool[next];
    next = (next + 1) % pool.length;
    tally.puzzles++;
    // A bomb opens a fight; consumables never take a turn.
    const bomb = (state.consumables ?? []).findIndex((c) => c.effect === 'attack');
    if (bomb >= 0 && state.encounter.type === 'enemy') issue({ type: 'use-consumable', index: bomb });
    if (!state.encounter || ended()) continue;
    issue({ type: 'begin-round', round: {
      id: `${input.dataset}/${input.id}`, size: puzzle.size,
      collections: Array.from({ length: puzzle.size }, (_, region) => ({
        color: puzzle.colors[region], amount: puzzle.regions.filter((r) => r === region).length,
      })),
      givenColors: puzzle.givens.map((cell) => puzzle.colors[puzzle.regions[cell]]),
    } });
    const revealed = [...puzzle.givens];
    for (const fixed of input.turns) {
      let turn: RoundTurn = fixed;
      if (fixed.type === 'collect' && policy === 'planned') {
        const options = opportunities(puzzle, revealed);
        if (options.length) {
          const chosen = options.map((candidate) => ({ candidate, value: reactiveChoice(state, candidate).value }))
            .reduce((best, candidate) => (candidate.value > best.value ? candidate : best)).candidate;
          revealed.push(chosen.cell);
          turn = { type: 'collect', color: chosen.color, amount: chosen.amount, source: 'player' };
        }
      }
      // Readiness is tended during the fight; after a kill everything is readied to harvest experience.
      if (turn.type === 'collect' && policy === 'planned') {
        const collect: Collection = turn;
        const slot = state.encounter?.phase === 'active' ? reactiveChoice(state, collect).slot : null;
        state.slots.forEach((s, i) => {
          const ready = slot === null || i === slot;
          if (s.ready !== ready) issue({ type: 'set-ready', slot: i, ready });
        });
      }
      // Emergency potions just before a hit that would kill.
      const enemy = state.encounter?.type === 'enemy' && state.encounter.phase === 'active' ? state.encounter : null;
      if (enemy && enemy.countdown <= 1 && state.health <= 6) {
        const potion = (state.consumables ?? []).findIndex((c) => c.effect !== 'attack');
        if (potion >= 0) issue({ type: 'use-consumable', index: potion });
      }
      issue(turn.type === 'wrong' ? { type: 'turn' } : {
        type: 'turn', collect: { color: turn.color, amount: turn.amount }, source: turn.source === 'given' ? 'player' : turn.source,
      });
      if (ended()) break;
    }
    if (policy === 'planned') state.slots.forEach((s, i) => !s.ready && issue({ type: 'set-ready', slot: i, ready: true }));
    const fighting = state.encounter?.type === 'enemy';
    if (state.phase === 'round') issue({ type: 'end-round', outcome: 'completed' });
    if (fighting && !state.encounter && !ended()) healthAfterFights.push(state.health);
    if ((state.consumables?.length ?? 0) > MAX_CONSUMABLES) throw new Error('consumables over capacity');
  }
  const campaign = state.campaign!;
  return {
    starter: starter.id, seed, policy, outcome: state.outcome ?? 'unfinished',
    column: campaign.at === null ? 0 : campaign.nodes[campaign.at].column,
    healthAfterFights, ...tally,
  };
}
