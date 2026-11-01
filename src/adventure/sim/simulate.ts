import {
  type AdventureEvent, type AdventureState, type CharacterDef, type Collection, type EncounterDef, type RoundManifest,
  startRun, step,
} from '../engine';
import { allUnits, applyStep, nextStep, OPEN, type Puzzle, STUMP, unitCells } from '../../engine';
import mulberry32 from '../../utils/mulberry';
import type { RoundTurn } from './traces';

/* ========================================================= *\
 *  Phase 4 encounter simulation: replay recorded or modeled *
 *  reveal orders through the engine under player policies.  *
 *  See docs/adventure-mode-technical.md, sections 11-13.    *
\* ========================================================= */

/** How readiness is handled. */
export type Policy = 'passive' | 'reactive';

/** Where the reveal order comes from. */
export type Ordering = 'observed' | 'shuffled' | 'solver' | 'tactical' | 'oracle';

/** Every policy, for reports. */
export const POLICIES: readonly Policy[] = ['passive', 'reactive'];

/**
 * Every ordering, for reports. `observed` is the recording; `shuffled` keeps its
 * pulses and wrong turns in a seeded random order; `solver` takes the solver's
 * next stump; `tactical` picks the best stump the solver can deduce now;
 * `oracle` picks the best remaining stump, deducible or not (an upper bound).
 */
export const ORDERINGS: readonly Ordering[] = ['observed', 'shuffled', 'solver', 'tactical', 'oracle'];

/** One recorded puzzle, ready to simulate. */
export interface SimRound {
  /** The rebuilt board. */
  readonly puzzle: Puzzle;
  /** Recorded turns, givens excluded. */
  readonly turns: readonly RoundTurn[];
}

/** How a simulated encounter ended. */
export type SimOutcome = 'won' | 'died' | 'failed' | 'unfinished';

/** One simulated encounter. */
export interface EncounterResult {
  /** How it ended. */
  readonly outcome: SimOutcome;
  /** Rounds played. */
  readonly rounds: number;
  /** Health lost, net of healing. */
  readonly healthLost: number;
  /** Pulses that arrived while the encounter was active. */
  readonly combatPulses: number;
  /** Of those, pulses that did nothing: discarded, or healing at full health. */
  readonly wasted: number;
  /** For an enemy, whether an ability did something before its first attack. */
  readonly usefulBeforeFirstHit: boolean;
}

/** The manifest of a puzzle, one collection per region. */
const manifestOf = (puzzle: Puzzle, id: string): RoundManifest => ({
  id,
  size: puzzle.size,
  collections: puzzle.colors.map((color, region) => ({
    color, amount: puzzle.regions.filter((r) => r === region).length,
  })),
  givenColors: puzzle.givens.map((cell) => puzzle.colors[puzzle.regions[cell]]),
});

const collectionAt = (puzzle: Puzzle, cell: number): Collection => {
  const region = puzzle.regions[cell];
  return { color: puzzle.colors[region], amount: puzzle.regions.filter((r) => r === region).length };
};

/**
 * Stumps the solver can place from the revealed ones without revealing any
 * other: apply every deduction until one would place a stump, then take every
 * row, column, or region left with a single open square.
 * @param puzzle the board
 * @param revealed stump cells revealed so far, givens included
 * @returns deducible unrevealed stump cells, ascending
 */
export function deducible(puzzle: Puzzle, revealed: readonly number[]): number[] {
  let state: Uint8Array = new Uint8Array(puzzle.size * puzzle.size);
  for (const cell of revealed) state[cell] = STUMP;
  for (let deduction = nextStep(puzzle, state); deduction; deduction = nextStep(puzzle, state)) {
    if (deduction.type === 'forced') {
      const units = allUnits(puzzle).map((unit) => unitCells(puzzle, unit));
      const forced = units
        .filter((cells) => !cells.some((cell) => state[cell] === STUMP))
        .map((cells) => cells.filter((cell) => state[cell] === OPEN))
        .filter((open) => open.length === 1)
        .map((open) => open[0]);
      return [...new Set(forced)].sort((a, b) => a - b);
    }
    state = applyStep(state, deduction);
  }
  return [];
}

/** Applies commands, keeping the events. Rejections are simulator bugs. */
const run = (state: AdventureState, commands: Parameters<typeof step>[1][], events: AdventureEvent[] = []): AdventureState => {
  for (const command of commands) {
    const result = step(state, command);
    if (result.events[0]?.type === 'command-rejected') {
      throw new Error(`simulator command rejected: ${JSON.stringify(result.events[0])}`);
    }
    events.push(...result.events);
    state = result.state;
  }
  return state;
};

/**
 * Readiness commands that send a pulse of `color` to slot `target`, or to no
 * slot if it is -1: ready everything, then unready the target's competitors.
 */
const directTo = (state: AdventureState, color: number, target: number): Parameters<typeof step>[1][] => state.slots
  .map((slot, index) => ({
    type: 'set-ready' as const, slot: index, ready: index === target || !slot.item.colors.includes(color),
  }))
  .filter((command, index) => state.slots[index].ready !== command.ready);

/**
 * How good a state looks to a policy one turn ahead: health, plus block that
 * will absorb the next hit, minus what the encounter still needs, plus a
 * bonus for winning. Provisional, like all phase 4 weights.
 */
const score = (state: AdventureState): number => {
  if (state.outcome === 'death') return -1000;
  const encounter = state.encounter;
  let value = state.health + Object.values(state.resources).reduce((a, b) => a + b, 0) / 2;
  if (encounter?.phase === 'active') {
    if (encounter.type === 'enemy') {
      value += Math.min(state.block, encounter.def.intents[encounter.intent].damage) - encounter.health;
    } else {
      value -= encounter.def.goal - encounter.progress;
    }
  } else if (encounter?.phase === 'scavenge') {
    value += 10;
  }
  return value;
};

/** A choice for one turn: which stump to reveal, and where its pulse goes. */
interface Choice {
  /** Commands for the turn, readiness first. */
  readonly commands: Parameters<typeof step>[1][];
  /** The stump revealed, if it is a collection. */
  readonly cell?: number;
}

/** One round of turns, in a fixed or chosen order, returning the state after it. */
const playRound = (
  start: AdventureState, round: SimRound, id: string, policy: Policy, ordering: Ordering, seed: number,
  onEvents: (events: readonly AdventureEvent[], wasActive: boolean) => void,
): AdventureState => {
  const { puzzle } = round;
  let state = run(start, [{ type: 'begin-round', round: manifestOf(puzzle, id) }]);
  const revealed = [...puzzle.givens];
  let fixed: RoundTurn[] | null = null;
  if (ordering === 'observed') fixed = [...round.turns];
  if (ordering === 'shuffled') {
    const rng = mulberry32(seed);
    fixed = [...round.turns];
    for (let i = fixed.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [fixed[i], fixed[j]] = [fixed[j], fixed[i]];
    }
  }
  const cellOf = (turn: RoundTurn & { type: 'collect' }): number => puzzle.solution
    .find((cell) => !revealed.includes(cell) && collectionAt(puzzle, cell).color === turn.color)!;

  while (state.phase === 'round' && revealed.length < puzzle.size) {
    let cells: number[];
    let wrong = false;
    if (fixed) {
      const next = fixed.shift()!;
      wrong = next.type === 'wrong';
      cells = next.type === 'collect' ? [cellOf(next)] : [];
    } else if (ordering === 'solver') {
      cells = deducible(puzzle, revealed).slice(0, 1);
    } else if (ordering === 'tactical') {
      cells = deducible(puzzle, revealed);
    } else {
      cells = puzzle.solution.filter((cell) => !revealed.includes(cell));
    }
    if (cells.length === 0 && !wrong) {
      throw new Error(`no reveal available in ${id}`);
    }
    const choices: Choice[] = wrong ? [{ commands: [{ type: 'turn' }] }] : cells.flatMap((cell) => {
      const collect = collectionAt(puzzle, cell);
      const turn = { type: 'turn' as const, collect };
      if (policy === 'passive') return [{ cell, commands: [turn] }];
      const takers = state.slots.flatMap((slot, index) => (slot.item.colors.includes(collect.color) ? [index] : []));
      return [...takers, -1].map((target) => ({ cell, commands: [...directTo(state, collect.color, target), turn] }));
    });
    // Greedy one-turn lookahead; ties keep the first choice, so priority order breaks them.
    let best = choices[0];
    if (choices.length > 1) {
      const scores = choices.map((choice) => score(run(state, choice.commands)));
      best = choices[scores.indexOf(Math.max(...scores))];
    }
    const wasActive = state.encounter?.phase === 'active';
    const events: AdventureEvent[] = [];
    state = run(state, best.commands, events);
    onEvents(events, wasActive);
    if (best.cell !== undefined) revealed.push(best.cell);
  }
  return state.phase === 'round' ? run(state, [{ type: 'end-round', outcome: 'completed' }]) : state;
};

/**
 * Fights one encounter with a fresh character, starting with the first round
 * and continuing into the next ones until it is won, lost, or out of rounds.
 * Deterministic: the same inputs always give the same result.
 * @param character the character and loadout
 * @param encounter the encounter
 * @param rounds puzzles to play, in order
 * @param policy readiness policy
 * @param ordering reveal order
 * @param seed seed for the shuffled order
 * @returns what happened
 */
export function simulateEncounter(
  character: CharacterDef, encounter: EncounterDef, rounds: readonly SimRound[], policy: Policy, ordering: Ordering,
  seed = 1,
): EncounterResult {
  let state = run(startRun(character), [{ type: 'begin-encounter', encounter }]);
  let combatPulses = 0;
  let wasted = 0;
  let hit = false;
  let useful = false;
  let played = 0;
  let ended: SimOutcome | null = null;
  for (const round of rounds) {
    if (state.phase === 'ended' || ended) break;
    played++;
    state = playRound(state, round, `${encounter.id}-${played}`, policy, ordering, seed + played, (events, wasActive) => {
      for (const event of events) {
        if (event.type === 'enemy-acted') hit = true;
        if (!hit && ((event.type === 'damage-applied' && event.target === 'enemy') || event.type === 'block-changed'
          || (event.type === 'healed' && event.amount > 0))) useful = true;
        if (event.type === 'encounter-transitioned' && event.outcome !== 'cleared') {
          ended = event.outcome === 'failed' ? 'failed' : 'won';
        }
        if (!wasActive) continue;
        if (event.type === 'collected') combatPulses++;
        if (event.type === 'pulse-discarded' || (event.type === 'healed' && event.amount === 0)) wasted++;
      }
    });
  }
  return {
    outcome: state.outcome === 'death' ? 'died' : ended ?? 'unfinished',
    rounds: played,
    healthLost: character.health - Math.max(0, state.health),
    combatPulses,
    wasted,
    usefulBeforeFirstHit: useful,
  };
}
