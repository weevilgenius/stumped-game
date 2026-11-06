import type { Band, CharacterDef, ItemDef, Intent } from '../engine/types';
import type { Potion } from '../engine/campaignTypes';

/** Increment when campaign content changes; saves and reports retain provenance. */
export const CONTENT_VERSION = 2;
/** Maximum improvements an individual item can receive. */
export const MAX_ITEM_LEVEL = 3;
/** Harvested squares needed for one improvement. */
export const XP_PER_LEVEL = 10;
const bands = (a: number, b: number, c: number, d: number): readonly Band[] => [
  { min: 1, value: a }, { min: 4, value: b }, { min: 8, value: c }, { min: 15, value: d },
];
/** Conventional two-ability starters, followed by a victory unlock. */
export const STARTERS: readonly CharacterDef[] = [
  { id: 'ranger', health: 24, loadout: [
    { id: 'shortbow', effect: 'attack', colors: [0, 1], bands: bands(2, 3, 4, 5) },
    { id: 'parry', effect: 'block', colors: [2], bands: bands(3, 4, 6, 8) },
  ] },
  { id: 'sentinel', health: 28, loadout: [
    { id: 'spear', effect: 'attack', colors: [3], bands: bands(3, 4, 6, 8) },
    { id: 'brace', effect: 'block', colors: [3, 4], bands: bands(3, 4, 6, 8) },
  ] },
  { id: 'herbalist', health: 22, loadout: [
    { id: 'thorn', effect: 'attack', colors: [5, 6], bands: bands(2, 3, 4, 5) },
    { id: 'remedy', effect: 'heal', colors: [7], bands: bands(2, 3, 5, 7) },
  ] },
];
/** Fixed emergency options; stronger than one ordinary pulse. */
export const POTIONS: readonly Potion[] = [
  { id: 'healing-potion', value: 9 }, { id: 'block-potion', value: 10 }, { id: 'damage-potion', value: 10 },
];

/** A loot or shop item template. Colors are rolled per item. */
export interface ItemTemplate {
  /** Item made from it, without colors. */
  readonly item: Omit<ItemDef, 'colors'>;
  /** How many colors it rolls, fewest and most; 9 means every color. */
  readonly colors: readonly [number, number];
}

const template = (item: Omit<ItemDef, 'colors'>, fewest: number, most = fewest): ItemTemplate => ({ item, colors: [fewest, most] });

/** Gear that drops or is sold, by tier. */
export const ITEMS: readonly ItemTemplate[] = [
  template({ id: 'dagger', effect: 'attack', bands: bands(2, 3, 5, 7), tier: 1 }, 1, 2),
  template({ id: 'buckler', effect: 'block', bands: bands(3, 4, 6, 8), tier: 1 }, 1, 2),
  template({ id: 'herbs', effect: 'heal', bands: bands(2, 3, 5, 7), tier: 1 }, 1, 2),
  template({ id: 'satchel', effect: 'forage', resource: 'supplies', bands: bands(1, 2, 3, 4), tier: 1 }, 1, 2),
  template({ id: 'sword', effect: 'attack', bands: bands(3, 4, 6, 9), tier: 2 }, 2, 3),
  template({ id: 'shield', effect: 'block', bands: bands(4, 5, 7, 10), tier: 2 }, 2),
  template({ id: 'salve', effect: 'heal', bands: bands(3, 4, 6, 8), tier: 2 }, 2),
  template({ id: 'sling', effect: 'attack', cooldown: 2, bands: bands(2, 3, 4, 5), tier: 2 }, 9),
  template({ id: 'staff', effect: 'attack', charge: true, bands: [{ min: 1, value: 4 }, { min: 12, value: 8 }, { min: 24, value: 12 }, { min: 40, value: 16 }], tier: 2 }, 3),
  template({ id: 'axe', effect: 'attack', bands: bands(4, 6, 8, 11), tier: 3 }, 2, 3),
  template({ id: 'tower shield', effect: 'block', bands: bands(5, 7, 9, 12), tier: 3 }, 2, 3),
  template({ id: 'elixir', effect: 'heal', bands: bands(4, 5, 7, 10), tier: 3 }, 2, 3),
];

/** An enemy template. Harvest colors are rolled per fight. */
export interface EnemyTemplate {
  /** Enemy identifier. */
  readonly id: string;
  /** Danger tier. */
  readonly tier: number;
  /** Starting health. */
  readonly health: number;
  /** Repeating attacks. */
  readonly intents: readonly Intent[];
  /** Supplies dropped on defeat. */
  readonly supplies: number;
  /** Additional damage per extra puzzle. */
  readonly enrage?: number;
  /** Puzzles before escape. */
  readonly flee?: number;
  /** Final encounter. */
  readonly boss?: boolean;
}

const enemy = (id: string, tier: number, health: number, intents: readonly Intent[], bound: { enrage?: number; flee?: number }, supplies: number): EnemyTemplate => ({
  id, tier, health, intents, supplies, ...bound,
});

/** Enemies by tier. Each is bounded thematically: beasts and brutes enrage, skittish things flee. */
export const ENEMIES: readonly EnemyTemplate[] = [
  enemy('wolf', 1, 10, [{ delay: 3, damage: 2 }, { delay: 2, damage: 3 }], { flee: 3 }, 4),
  enemy('boar', 1, 12, [{ delay: 4, damage: 4 }], { enrage: 6 }, 4),
  enemy('rats', 1, 8, [{ delay: 2, damage: 2 }], { flee: 2 }, 3),
  enemy('bandit', 2, 18, [{ delay: 3, damage: 4 }, { delay: 2, damage: 3 }], { enrage: 6 }, 7),
  enemy('bear', 2, 22, [{ delay: 4, damage: 5 }], { enrage: 6 }, 7),
  enemy('wisp', 2, 16, [{ delay: 2, damage: 3 }], { flee: 2 }, 6),
  enemy('troll', 3, 30, [{ delay: 3, damage: 5 }, { delay: 3, damage: 6 }], { enrage: 6 }, 10),
  enemy('wraith', 3, 24, [{ delay: 2, damage: 4 }], { flee: 3 }, 10),
];

/** The run's last fight. */
export const BOSS: EnemyTemplate = { ...enemy('ancient-warden', 3, 48, [{ delay: 3, damage: 5 }, { delay: 2, damage: 4 }, { delay: 4, damage: 8 }], { enrage: 6 }, 0), boss: true };

/** Elites: an enemy of the next tier up, tougher, with better and more loot. */
export const ELITE_HEALTH = 1.25;

/** A between-round event: a short text choice without a puzzle. */
export interface EventDef {
  /** Content identifier. */
  readonly id: string;
  /** What the player finds. */
  readonly text: string;
  /** Choices; the last is always a free way to leave. */
  readonly options: readonly EventOption[];
}

/** One event choice: costs are paid, then gains received. */
export interface EventOption {
  /** Button text. */
  readonly label: string;
  /** Supplies it costs. */
  readonly supplies?: number;
  /** Health it costs (negative) or restores (positive). */
  readonly health?: number;
  /** Goods it gives, rolled at the node's tier. */
  readonly gain?: 'gear' | 'consumable';
  /** Supplies it gives. */
  readonly earn?: number;
}

/** Events, mostly trades, some simply calm. */
export const EVENTS: readonly EventDef[] = [
  { id: 'hermit', text: 'A hermit offers tea by a warm fire.', options: [{ label: 'Rest a while (+4 health)', health: 4 }, { label: 'Move on' }] },
  { id: 'peddler', text: 'A peddler waves you over to a cart of bottles.', options: [{ label: 'Buy a potion (8 supplies)', supplies: 8, gain: 'consumable' }, { label: 'Move on' }] },
  { id: 'shrine', text: 'An old shrine hums with a strange light.', options: [{ label: 'Touch it (-5 health, gain an item)', health: -5, gain: 'gear' }, { label: 'Leave it be' }] },
  { id: 'camp', text: 'An abandoned camp, long cold.', options: [{ label: 'Search it (+6 supplies)', earn: 6 }, { label: 'Move on' }] },
  { id: 'brook', text: 'A quiet brook. Nothing stirs.', options: [{ label: 'Move on' }] },
];

/** A rest heals this share of maximum health, rounded up. */
export const REST_HEAL = 1 / 3;
