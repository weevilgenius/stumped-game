import type { AdventureState, ItemDef, SlotState } from './types';

/** Forward-only map location; unknown nodes conceal their actual kind until arrival. */
export interface RouteNode {
  /** Stable map identifier. */
  id: string;
  /** Zero-based map column. */
  column: number;
  /** Lane within this column. */
  lane: number;
  /** Location category. */
  kind: 'fight' | 'elite' | 'boss' | 'shop' | 'rest' | 'event' | 'forage';
  /** Hide category before arrival. */
  hidden: boolean;
  /** Public danger tier, one to three. */
  tier: number;
  /** Reachable locations in the next column. */
  next: string[];
}

/** Emergency effect, usable freely before the next reveal. */
export interface Potion {
  /** Potion identifier. */
  id: 'healing-potion' | 'block-potion' | 'damage-potion';
  /** Effect strength. */
  value: number;
}

/** A fixed reward or shop offer, removed exactly once when taken. */
export interface Offer {
  /** Stable offer identifier. */
  id: string;
  /** Cost in supplies (zero for loot). */
  price: number;
  /** Gear, or null for a potion. */
  item: ItemDef | null;
  /** Potion, or null for gear. */
  potion: Potion | null;
  /** Whole dropped item, preserving level, readiness and timers when reclaimed. */
  slot?: SlotState;
}

/** Per-run progression saved atomically with combat. Rules follow the current application. */
export interface CampaignState {
  /** PR #79 did not record aggregate counters; these start at import. */
  imported?: boolean;
  /** Imported unanswered event, kept until leaving its node. */
  event?: string;
  /** Content revision for provenance, refreshed on commands after updates. */
  version: number;
  /** Original run seed. */
  seed: number;
  /** Serializable independent loot random stream. */
  rng: number;
  /** Entire seeded map. */
  map: RouteNode[];
  /** Current location, null before choosing the opening route. */
  node: string | null;
  /** Completed locations in order. */
  visited: string[];
  /** A location awaiting its completion choice, combat, or puzzle. */
  active: boolean;
  /** Packed gear retains all per-item state. */
  pack: SlotState[];
  /** Up to three emergency consumables. */
  potions: Potion[];
  /** Pending loot. Leaving the node leaves it behind. */
  loot: Offer[];
  /** Fixed stock generated on arrival. */
  stock: Offer[];
  /** Puzzles completed at the current encounter. */
  encounterRounds: number;
  /** True as soon as the boss dies, even before the last puzzle finishes. */
  victory: boolean;
  /** Items leveled this fight (unique instance ids). */
  leveled: string[];
  /** Total supplies earned. */
  earned: number;
  /** Total supplies spent. */
  spent: number;
  /** Fights won. */
  wins: number;
  /** Fights fled or enemies that escaped. */
  fled: number;
  /** Items collected. */
  gear: number;
  /** Band upgrades earned. */
  upgrades: number;
}

/** Commands available in a bounded adventure. */
export type CampaignCommand =
  | { readonly type: 'travel'; readonly node: string }
  | { readonly type: 'choose'; readonly choice: 'leave' | 'rest' | 'upgrade' | 'event'; readonly slot?: number; readonly option?: number }
  | { readonly type: 'take-loot'; readonly offer: string; readonly replace?: number }
  | { readonly type: 'buy'; readonly offer: string; readonly replace?: number }
  | { readonly type: 'sell'; readonly pack: number }
  | { readonly type: 'shop-heal' }
  | { readonly type: 'equip'; readonly pack: number; readonly slot: number }
  | { readonly type: 'unequip'; readonly slot: number }
  | { readonly type: 'drop'; readonly slot: number; readonly pack?: boolean }
  | { readonly type: 'use-potion'; readonly potion: number }
  | { readonly type: 'flee' }
  | { readonly type: 'abandon' };

/** Semantic progression events, consumed by both UI and simulation. */
export type CampaignEvent =
  | { readonly type: 'travelled'; readonly node: string }
  | { readonly type: 'loot-created'; readonly offers: readonly Offer[] }
  | { readonly type: 'gear-changed'; readonly item: string }
  | { readonly type: 'item-leveled'; readonly item: string; readonly level: number }
  | { readonly type: 'potion-used'; readonly potion: string }
  | { readonly type: 'enemy-escalated'; readonly damage: number }
  | { readonly type: 'victory-secured' };

/** A bounded enemy: escalating damage or escape prevents infinite farming. */
export interface EncounterBudget {
  /** Added damage on each subsequent puzzle. */
  enrage?: number;
  /** Escape after this many completed puzzles. */
  fleeAfter?: number;
  /** Final enemy; player cannot flee. */
  boss?: boolean;
}

/** Current node, shared by presentation and simulation. */
export function currentNode(state: AdventureState): RouteNode | undefined {
  return state.campaign?.map.find((node) => node.id === state.campaign?.node);
}
