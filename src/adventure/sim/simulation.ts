import type { Puzzle } from '../../engine';
import { bandOf, startRun, step } from '../engine';
import type { AdventureCommand, AdventureEvent, AdventureState, CharacterDef, Collection, EncounterDef } from '../engine';
import { opportunities, type Opportunity } from './ordering';
import type { RoundInput, RoundTurn } from './traces';

/** Readiness uses only current state, visible pulse, and public round manifest. */
export type ReadinessPolicy = 'passive' | 'reactive';
/** Fixed external order, first solver deduction, tactical solver choice, or hidden-solution benchmark. */
export type OrderPolicy = 'fixed' | 'solver' | 'tactical' | 'oracle';

/** A validated recording or generated board and its fixed-order input. */
export interface SimulationRound {
  /** Rebuilt board; hidden solution is read only by the oracle candidate provider. */
  readonly puzzle: Puzzle;
  /** Provenance and replay/synthetic turns. */
  readonly input: RoundInput;
}

/** A bounded first-encounter experiment; never a complete adventure win-rate test. */
export interface TrialOptions {
  /** Character and loadout under test. */
  readonly character: CharacterDef;
  /** Encounter started once; unfinished encounters carry into the next puzzle. */
  readonly encounter: EncounterDef;
  /** Distinct puzzle inputs in sequence. No puzzle is replayed within a trial. */
  readonly rounds: readonly SimulationRound[];
  /** Readiness behavior. */
  readonly readiness: ReadinessPolicy;
  /** How to select collections. */
  readonly order: OrderPolicy;
}

/** Metrics from semantic engine events, before aggregation. Energy is measured in squares. */
export interface TrialMetrics {
  /** Death, encounter success/failure, or a live encounter at the puzzle limit. */
  outcome: 'defeated' | 'completed' | 'failed' | 'death' | 'limit' | 'solver-stalled';
  /** Health at the end, clamped to zero. */
  health: number;
  /** Puzzles entered. */
  rounds: number;
  /** Turns consumed, including wrong reveals. */
  turns: number;
  /** Turns beginning with an active encounter. */
  combatTurns: number;
  /** Total turns to encounter resolution, or null at death/limit. */
  resolutionTurn: number | null;
  /** Net incoming damage after block, including overkill. */
  damageTaken: number;
  /** Net damage during the first three turns of the encounter. */
  earlyDamageTaken: number;
  /** Attack damage, capped at the enemy's remaining health. */
  damageDealt: number;
  /** Effective attack damage during the first three turns. */
  earlyDamageDealt: number;
  /** Damage prevented. */
  blocked: number;
  /** Effective health restored. */
  healed: number;
  /** Resources earned, by resource id. */
  resources: Record<string, number>;
  /** Subset of resource income earned after the encounter resolves. */
  postcombatResources: Record<string, number>;
  /** Size of all collected pulses. */
  energy: number;
  /** Energy actually routed, including scavenge and incomplete charges. */
  consumedEnergy: number;
  /** Pulses consumed by items or scavenge. */
  consumedPulses: number;
  /** Total collected pulses. */
  pulses: number;
  /** Energy discarded with no destination. */
  discardedEnergy: number;
  /** Energy held in charges when they expire or the run ends. Subset of consumedEnergy. */
  abandonedChargeEnergy: number;
  /** Energy discarded with no compatible item or scavenge rule. */
  uncoveredEnergy: number;
  /** Energy discarded when a compatible item is cooling down. */
  cooldownEnergy: number;
  /** Other discards: context, readiness, or already-charged colors. */
  contextEnergy: number;
  /** Item activations by id. */
  activations: Record<string, number>;
  /** Number of completed multi-color recipes. */
  completedCharges: number;
  /** Free readiness commands actually issued. */
  readinessChanges: number;
  /** Whether any item produced an effect or accepted a charge before the first enemy action. */
  usefulBeforeFirstAttack: boolean;
}

const chargeValue = (state: AdventureState): number => state.slots.reduce((total, slot) => {
  if (!slot.item.charge || slot.charged.length === 0 || !state.round) return total;
  const { manifest, collected } = state.round;
  const missing = slot.item.colors.filter((color) => !slot.charged.includes(color));
  if (missing.some((color) => collected.includes(color) || manifest.givenColors.includes(color)
    || !manifest.collections.some((c) => c.color === color))) return total;
  const amount = slot.chargedAmount + missing.reduce((sum, color) => (
    sum + (manifest.collections.find((c) => c.color === color)?.amount ?? 0)), 0);
  return total + bandOf(slot.item.bands, amount).value * slot.charged.length / slot.item.colors.length;
}, 0);

/** A deliberately simple, one-turn heuristic; no future order, search, or hidden solution. */
/** Shared visible-state heuristic; bounded planning is not an optimal oracle. */
export function valueOf(state: AdventureState): number {
  const enemy = state.encounter?.phase === 'active' && state.encounter.type === 'enemy' ? state.encounter : null;
  const progress = state.encounter?.type === 'objective' ? state.encounter.progress : 0;
  const damage = enemy?.def.intents[enemy.intent].damage ?? 0;
  return Math.max(0, state.health) * 3 - (state.phase === 'ended' ? 1000 : 0)
    - Math.max(0, enemy?.health ?? 0) * 2 + progress * 2
    + Math.min(state.block, damage) * 1.5 + chargeValue(state) * 2
    + Object.values(state.resources).reduce((sum, n) => sum + n, 0) * 0.25
    + state.slots.reduce((sum, slot) => sum + (slot.experience ?? 0) * 0.08 + (slot.level ?? 0), 0);
}

/** Best slot for a visible pulse, allowing no item (scavenge/discard); ties are stable. */
export function reactiveChoice(state: AdventureState, collect: Collection): { slot: number; value: number } {
  let choice = { slot: -1, value: -Infinity };
  // Test every slot independently to let later overlapping equipment receive the pulse.
  for (let slot = -1; slot < state.slots.length; slot++) {
    const preview = { ...state, slots: state.slots.map((s, i) => ({ ...s, ready: i === slot })) };
    const result = step(preview, { type: 'turn', collect });
    const value = valueOf(result.state);
    if (value > choice.value) choice = { slot, value };
  }
  return choice;
}

/** Run one deterministic encounter, finishing its final puzzle to measure postcombat economy. */
export function simulate(options: TrialOptions): TrialMetrics {
  let state = startRun(options.character);
  const m: TrialMetrics = {
    outcome: 'limit', health: state.health, rounds: 0, turns: 0, combatTurns: 0, resolutionTurn: null,
    damageTaken: 0, earlyDamageTaken: 0, damageDealt: 0, earlyDamageDealt: 0, blocked: 0, healed: 0,
    resources: {}, postcombatResources: {}, energy: 0, consumedEnergy: 0, consumedPulses: 0, pulses: 0, discardedEnergy: 0,
    abandonedChargeEnergy: 0, uncoveredEnergy: 0, cooldownEnergy: 0, contextEnergy: 0,
    activations: {}, completedCharges: 0, readinessChanges: 0, usefulBeforeFirstAttack: false,
  };
  let firstAttack = false;
  const issue = (command: AdventureCommand): readonly AdventureEvent[] => {
    const result = step(state, command);
    const rejected = result.events.find((event) => event.type === 'command-rejected');
    if (rejected) throw new Error(`Simulation issued invalid ${command.type}: ${rejected.reason}`);
    state = result.state;
    return result.events;
  };
  issue({ type: 'begin-encounter', encounter: options.encounter });
  for (const round of options.rounds) {
    const { puzzle, input } = round;
    m.rounds++;
    const collections = Array.from({ length: puzzle.size }, (_, region) => ({
      color: puzzle.colors[region], amount: puzzle.regions.filter((r) => r === region).length,
    }));
    issue({ type: 'begin-round', round: {
      id: `${input.dataset}/${input.id}`, size: puzzle.size, collections,
      givenColors: puzzle.givens.map((cell) => puzzle.colors[puzzle.regions[cell]]),
    } });
    const revealed = [...puzzle.givens];
    for (const fixed of input.turns) {
      let turn: RoundTurn = fixed;
      if (fixed.type === 'collect' && options.order !== 'fixed') {
        const choices = opportunities(puzzle, revealed, options.order === 'oracle');
        if (choices.length === 0) {
          m.outcome = 'solver-stalled';
          break;
        }
        let selected: Opportunity = choices[0];
        if (options.order !== 'solver') {
          selected = choices.map((candidate) => ({ candidate, value: reactiveChoice(state, candidate).value }))
            .reduce((best, candidate) => candidate.value > best.value ? candidate : best).candidate;
        }
        revealed.push(selected.cell);
        turn = { type: 'collect', color: selected.color, amount: selected.amount, source: 'player' };
      }
      if (turn.type === 'collect' && options.readiness === 'reactive') {
        const choice = reactiveChoice(state, turn);
        for (let slot = 0; slot < state.slots.length; slot++) {
          const ready = choice.slot === slot;
          if (state.slots[slot].ready !== ready) {
            issue({ type: 'set-ready', slot, ready });
            m.readinessChanges++;
          }
        }
      }
      const before = state;
      if (before.encounter?.phase === 'active') m.combatTurns++;
      const events = issue(turn.type === 'wrong' ? { type: 'turn' } : {
        type: 'turn', collect: { color: turn.color, amount: turn.amount },
        source: turn.source === 'given' ? 'player' : turn.source,
      });
      m.turns++;
      if (turn.type === 'collect') {
        m.pulses++;
        m.energy += turn.amount;
        if (events.some((e) => e.type === 'pulse-discarded')) {
          m.discardedEnergy += turn.amount;
          const compatible = before.slots.filter((s) => s.item.colors.includes(turn.color));
          if (compatible.length === 0) m.uncoveredEnergy += turn.amount;
          else if (compatible.some((s) => s.readyAt > (before.round?.turn ?? 0) + 1)) m.cooldownEnergy += turn.amount;
          else m.contextEnergy += turn.amount;
        } else {
          m.consumedEnergy += turn.amount;
          m.consumedPulses++;
        }
      }
      let enemyHealth = before.encounter?.type === 'enemy' ? Math.max(0, before.encounter.health) : 0;
      for (const event of events) {
        switch (event.type) {
        case 'damage-applied': {
          if (event.target === 'character') {
            const damage = event.amount - event.blocked;
            m.damageTaken += damage;
            m.blocked += event.blocked;
            if (m.turns <= 3) m.earlyDamageTaken += damage;
          } else {
            const damage = Math.min(enemyHealth, event.amount);
            enemyHealth -= damage;
            m.damageDealt += damage;
            if (m.turns <= 3) m.earlyDamageDealt += damage;
          }
          break;
        }
        case 'healed': m.healed += event.amount; break;
        case 'resource-changed':
          m.resources[event.resource] = event.total;
          if (before.encounter?.phase === 'scavenge') {
            m.postcombatResources[event.resource] = (m.postcombatResources[event.resource] ?? 0) + event.amount;
          }
          break;
        case 'ability-activated':
          m.activations[event.item] = (m.activations[event.item] ?? 0) + 1;
          if (before.slots[event.slot].item.charge) m.completedCharges++;
          // Zero-effect healing is routed but is not a useful opening action.
          if (!firstAttack && (event.effect !== 'heal' || before.health < before.maxHealth)) {
            m.usefulBeforeFirstAttack = true;
          }
          break;
        case 'ability-charged':
          if (!firstAttack) m.usefulBeforeFirstAttack = true;
          break;
        case 'enemy-acted': firstAttack = true; break;
        case 'encounter-transitioned':
          if (event.outcome === 'defeated' || event.outcome === 'completed' || event.outcome === 'failed') {
            m.outcome = event.outcome;
            m.resolutionTurn = m.turns;
          }
          break;
        }
      }
      if (state.phase === 'ended') break;
    }
    m.abandonedChargeEnergy += state.slots.reduce((sum, s) => sum + s.chargedAmount, 0);
    if (state.phase === 'ended' || m.outcome === 'solver-stalled') break;
    issue({ type: 'end-round', outcome: 'completed' });
    if (!state.encounter) break;
  }
  if (state.outcome === 'death') m.outcome = 'death';
  m.health = Math.max(0, state.health);
  return m;
}
