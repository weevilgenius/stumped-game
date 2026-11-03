import { STARTERS } from '../content/campaign';
import {
  createCampaign, currentNode, deriveSeed, routeChoices, startRun, step,
  type AdventureCommand, type AdventureState, type CharacterDef, type Offer,
} from '../engine';
import { bankedOpportunities, opportunities, type Opportunity } from './ordering';
import { reactiveChoice, valueOf, type SimulationRound } from './simulation';

/** Deliberate equipment paths are separate from random offer luck. */
export type GearPolicy = 'coverage' | 'weak' | 'recovery';
/** A complete-run experiment under the interactive game's engine rules. */
export interface CampaignOptions {
  /** Same seed pairs map and node loot across policies. */
  seed: number;
  /** Actual starter; concept loadouts are deliberately excluded. */
  starter: CharacterDef;
  /** Ordinary solver order or banked deductions with bounded sequence search. */
  policy: 'ordinary' | 'planned';
  /** Equipment preference. */
  gear: GearPolicy;
  /** One synthetic wrong reveal per puzzle, or none. */
  mistakes: boolean;
  /** Distinct source puzzles, consumed in order. */
  rounds: readonly SimulationRound[];
}
/** Raw complete-run evidence, including unfinished runs and reproducible commands. */
export interface CampaignTrial {
  /** Experimental configuration. */
  seed: number;
  /** Starter identifier. */
  starter: string;
  /** Decision policy. */
  policy: CampaignOptions['policy'];
  /** Gear path preference. */
  gear: GearPolicy;
  /** Exact/synthetic provenance of turn inputs. */
  sequence: string;
  /** Final outcome; limits and solver stalls remain unresolved. */
  outcome: string;
  /** Alive at termination, independently of encounter success. */
  survived: boolean;
  /** Final engine state, retaining all definitions. */
  state: AdventureState;
  /** Accepted commands; replay from the starter and seed. */
  log: AdventureCommand[];
  /** Per-puzzle and fight health/gear/economy trajectories. */
  history: { round: number; node: string | null; health: number; enemyHealth: number | null; wins: number; gear: number; coverage: number; supplies: number; earned: number; spent: number; upgrades: number }[];
  /** Original dataset, code and input order for each used puzzle. */
  sources: { dataset: string; id: string; code: string; sequence: string }[];
  /** Tactical turn count. */
  turns: number;
  /** First acquired item that expands starting coverage, puzzle number; null when never reached. */
  usefulGearRound: number | null;
  /** First encounter completion puzzle; not merely surviving an opening board. */
  openingWinRound: number | null;
  /** Mean distinct colors offered per equipment drop, before player choice. */
  lootQuality: number;
}

interface PlannedChoice {
  /** The deduced collection to reveal next. */
  collect: Opportunity;
  /** Receiving equipment slot, or -1 to skip items. */
  slot: number;
}
interface Branch {
  /** Projected engine state. */
  state: AdventureState;
  /** Deductions still banked. */
  remaining: Opportunity[];
  /** First action on this sequence. */
  first: PlannedChoice;
  /** Visible-state score at the search frontier. */
  score: number;
}

/** Three-turn, width-four beam search over banked deductions and receiving slots. */
export function plannedChoice(state: AdventureState, available: readonly Opportunity[]): PlannedChoice {
  // Turn previews cannot travel. Keep the current node's exact definition and
  // loot stream, while avoiding thousands of copies of the rest of the map.
  const tactical = state.campaign ? { ...state, campaign: { ...state.campaign,
    map: state.campaign.map.filter((node) => node.id === state.campaign!.node),
  } } : state;
  let branches: Branch[] = [];
  for (let depth = 0; depth < Math.min(3, available.length); depth++) {
    const expanded: Branch[] = [];
    const sources = depth ? branches : [{ state: tactical, remaining: [...available], first: null }];
    for (const source of sources) {
      if (source.state.phase === 'ended') { if (source.first) expanded.push({ ...source, first: source.first, score: valueOf(source.state) }); continue; }
      for (const collect of source.remaining) {
        for (let slot = -1; slot < state.slots.length; slot++) {
          const preview = { ...source.state, slots: source.state.slots.map((item, index) => ({ ...item, ready: index === slot })) };
          const result = step(preview, { type: 'turn', collect });
          expanded.push({ state: result.state, remaining: source.remaining.filter((candidate) => candidate !== collect),
            first: source.first ?? { collect, slot }, score: valueOf(result.state) });
        }
      }
    }
    branches = expanded.sort((a, b) => b.score - a.score).slice(0, 4);
  }
  return branches[0].first;
}
const coverage = (state: AdventureState): number => new Set(state.slots.flatMap((slot) => slot.item.colors)).size;
const offerValue = (offer: Offer, state: AdventureState, policy: GearPolicy): number => {
  if (!offer.item) return 0;
  const colors = new Set(state.slots.flatMap((slot) => slot.item.colors));
  const fresh = offer.item.colors.filter((color) => !colors.has(color)).length;
  if (policy === 'weak') return -fresh * 10 + Number(offer.item.effect === 'forage');
  return fresh * 10 + (offer.item.effect === 'attack' ? 4 : 0)
    + (offer.item.effect === 'heal' ? policy === 'recovery' ? 30 : 7 : 0);
};

/** Execute a whole seeded adventure, using only accepted commands shared with the UI. */
export function simulateCampaign(options: CampaignOptions): CampaignTrial {
  if (!STARTERS.some((starter) => starter.id === options.starter.id)) throw new Error('Campaign trials require an actual starter');
  let state = startRun(options.starter);
  state.campaign = createCampaign(options.seed);
  const result: CampaignTrial = {
    seed: options.seed, starter: options.starter.id, policy: options.policy, gear: options.gear,
    sequence: options.mistakes ? 'modeled with one labeled synthetic wrong reveal per puzzle' : 'modeled solver deductions',
    outcome: 'limit', survived: true, state, log: [], history: [], sources: [], turns: 0,
    usefulGearRound: null, openingWinRound: null, lootQuality: 0,
  };
  let offers = 0;
  let wrong = 0;
  const initialCoverage = coverage(state);
  const issue = (command: AdventureCommand): void => {
    const next = step(state, command);
    const rejected = next.events.find((event) => event.type === 'command-rejected');
    if (rejected) throw new Error(`${command.type}: ${rejected.reason}`);
    state = next.state;
    result.log.push(command);
    for (const event of next.events) {
      if (event.type === 'loot-created') {
        offers += event.offers.filter((offer) => offer.item).length;
        result.lootQuality += event.offers.reduce((sum, offer) => sum + (offer.item?.colors.length ?? 0), 0);
      }
    }
  };
  const equipLoot = (): void => {
    const loot = [...state.campaign!.loot].sort((a, b) => offerValue(b, state, options.gear) - offerValue(a, state, options.gear));
    for (const offer of loot) {
      if (offer.potion) {
        if (state.campaign!.potions.length < 3) issue({ type: 'take-loot', offer: offer.id });
      } else if (state.slots.length < 4 || state.campaign!.pack.length < 3) {
        issue({ type: 'take-loot', offer: offer.id });
      }
    }
    // Prefer the strongest coverage/recovery combination, while weak trials keep the unlucky selection.
    for (let packed = 0; packed < state.campaign!.pack.length; packed++) {
      const item = state.campaign!.pack[packed].item;
      let best = -1;
      let gain = 0;
      const base = coverage(state) * (options.gear === 'weak' ? -10 : 10)
        + state.slots.reduce((sum, slot) => sum + Number(slot.item.effect === 'heal') * (options.gear === 'recovery' ? 30 : 7), 0);
      state.slots.forEach((_, slot) => {
        const preview = { ...state, slots: state.slots.map((entry, index) => index === slot ? { ...entry, item } : entry) };
        const value = coverage(preview) * (options.gear === 'weak' ? -10 : 10)
          + preview.slots.reduce((sum, entry) => sum + Number(entry.item.effect === 'heal') * (options.gear === 'recovery' ? 30 : 7), 0);
        if (value - base > gain) { gain = value - base; best = slot; }
      });
      if (best >= 0) issue({ type: 'equip', pack: packed, slot: best });
    }
    if (coverage(state) > initialCoverage && result.usefulGearRound === null) result.usefulGearRound = state.rounds;
  };
  const prepare = (): boolean => {
    for (let guard = 0; guard < 40 && state.phase === 'between' && !state.encounter; guard++) {
      equipLoot();
      const campaign = state.campaign!;
      const node = currentNode(state);
      if (campaign.active && node) {
        if (node.kind === 'rest') {
          issue(state.health < state.maxHealth * 0.75 || !state.slots.length || state.slots.every((slot) => (slot.level ?? 0) >= 3) ? { type: 'choose', choice: 'rest' }
            : { type: 'choose', choice: 'upgrade', slot: Math.max(0, state.slots.findIndex((slot) => (slot.level ?? 0) < 3)) });
        } else if (node.kind === 'event') {
          issue({ type: 'choose', choice: state.health < state.maxHealth - 6 && (state.resources.supplies ?? 0) >= 6 ? 'trade' : 'leave' });
        } else if (node.kind === 'shop') {
          // Sell reserves before spending. This does not reroll stock.
          while (state.campaign!.pack.length) issue({ type: 'sell', pack: 0 });
          if (state.health < state.maxHealth * 0.7 && (state.resources.supplies ?? 0) >= 2) issue({ type: 'shop-heal' });
          const stock = [...state.campaign!.stock].sort((a, b) => offerValue(b, state, options.gear) - offerValue(a, state, options.gear));
          for (const offer of stock) {
            if (offer.price > (state.resources.supplies ?? 0)) continue;
            if (offer.item && state.slots.length < 4) issue({ type: 'buy', offer: offer.id });
            else if (offer.potion && state.campaign!.potions.length < 3) issue({ type: 'buy', offer: offer.id });
          }
          issue({ type: 'choose', choice: 'leave' });
        } else return false;
      } else {
        const choices = [...routeChoices(state)];
        choices.sort((a, b) => {
          const score = (kind: string): number => kind === 'rest' && state.health < state.maxHealth * 0.7 ? 10 : kind === 'elite' ? -3 : 0;
          return score(b.hidden ? 'unknown' : b.kind) - score(a.hidden ? 'unknown' : a.kind);
        });
        if (!choices.length) return false;
        issue({ type: 'travel', node: choices[0].id });
      }
    }
    return !!state.encounter;
  };
  const ended = (): boolean => state.phase === 'ended';
  for (const source of options.rounds) {
    if (ended() || !prepare()) break;
    const bank = bankedOpportunities(source.puzzle);
    if (bank.length !== source.puzzle.size) { result.outcome = 'solver-stalled'; break; }
    const collections = bank.map(({ color, amount }) => ({ color, amount }));
    const givenColors = source.puzzle.givens.map((cell) => source.puzzle.colors[source.puzzle.regions[cell]]);
    issue({ type: 'begin-round', round: { id: `${source.input.dataset}/${source.input.id}/${state.rounds}`, size: 9, collections, givenColors } });
    result.sources.push({ dataset: source.input.dataset, id: source.input.id, code: source.puzzle.code, sequence: source.input.sequence });
    const revealed = [...source.puzzle.givens];
    const wrongAt = deriveSeed(options.seed, `wrong/${state.rounds}`) % Math.max(1, bank.length);
    for (let index = 0; index < bank.length - givenColors.length; index++) {
      // Emergencies happen before the next reveal, including an immediate carried hit.
      const healing = state.campaign.potions.findIndex((potion) => potion.id === 'healing-potion');
      if (healing >= 0 && state.health <= state.maxHealth - 9) issue({ type: 'use-potion', potion: healing });
      if (options.mistakes && index === wrongAt) {
        issue({ type: 'turn' }); result.turns++; wrong++;
        if (wrong >= 3 && !ended()) issue({ type: 'end-round', outcome: 'failed' });
        if (ended()) break;
      }
      const available = options.policy === 'planned' ? bank.filter((entry) => !revealed.includes(entry.cell))
        : opportunities(source.puzzle, revealed);
      if (!available.length) { result.outcome = 'solver-stalled'; break; }
      const choice = options.policy === 'planned' ? plannedChoice(state, available) : { collect: available[0], ...reactiveChoice(state, available[0]) };
      for (let slot = 0; slot < state.slots.length; slot++) {
        if (state.slots[slot].ready !== (slot === choice.slot)) issue({ type: 'set-ready', slot, ready: slot === choice.slot });
      }
      issue({ type: 'turn', collect: { color: choice.collect.color, amount: choice.collect.amount } });
      result.turns++;
      revealed.push(choice.collect.cell);
      if (ended()) break;
    }
    wrong = 0;
    if (state.phase === 'round' && result.outcome !== 'solver-stalled') issue({ type: 'end-round', outcome: 'completed' });
    const campaign = state.campaign;
    if (campaign.wins && result.openingWinRound === null) result.openingWinRound = state.rounds;
    result.history.push({ round: result.history.length + 1, node: campaign.node, health: state.health,
      enemyHealth: state.encounter?.type === 'enemy' ? state.encounter.health : null,
      wins: campaign.wins, gear: campaign.gear, coverage: coverage(state), supplies: state.resources.supplies ?? 0,
      earned: campaign.earned, spent: campaign.spent, upgrades: campaign.upgrades });
    if (ended() || result.outcome === 'solver-stalled') break;
  }
  result.state = state;
  result.outcome = state.outcome ?? result.outcome;
  result.survived = state.health > 0 && state.outcome !== 'failed';
  result.lootQuality /= Math.max(1, offers);
  return result;
}
