import type { Band, CharacterDef, ConsumableDef, EncounterDef, Intent, ItemDef } from '../engine';

/* ========================================================= *\
 *  Phase 7 campaign content for 9x9 boards (colors 0 to 8): *
 *  starters, loot templates, enemies, events, and prices.   *
 *  Every number is a first guess for playtesting.           *
\* ========================================================= */

/** Content version, recorded with each adventure puzzle so reports can label mixed-version runs. */
export const CONTENT_VERSION = 1;

/** Colors on a 9x9 board. */
export const COLORS = 9;

/** Columns from the start to the boss. */
export const MAP_COLUMNS = 15;

/** Common size bands: 1-3, 4-7, 8-14, and 15+ squares. */
const bands = (...values: readonly [number, number, number, number]): readonly Band[] => [
  { min: 1, value: values[0] }, { min: 4, value: values[1] }, { min: 8, value: values[2] }, { min: 15, value: values[3] },
];

/** A playable starting character. */
export interface Starter extends CharacterDef {
  /** Display name. */
  readonly name: string;
  /** One sentence for the character picker. */
  readonly description: string;
  /** Runs that must be won on this device before it can be picked; 0 for the conventional starters. */
  readonly unlockWins: number;
}

/** Starting characters: one skill and one starter weapon each. */
export const STARTERS: readonly Starter[] = [
  {
    id: 'knight', name: 'Knight', health: 28, unlockWins: 0,
    description: 'A sword on three colors and a guard skill on one: steady damage, a little block.',
    loadout: [
      { id: 'sword', effect: 'attack', colors: [0, 1, 2], bands: bands(2, 3, 4, 6), tier: 1 },
      { id: 'guard', effect: 'block', colors: [3], bands: bands(3, 4, 6, 8), tier: 1 },
    ],
  },
  {
    id: 'scout', name: 'Scout', health: 26, unlockWins: 0,
    description: 'Twin knives on two colors and a dodge that shares one of them: priority decides which fires.',
    loadout: [
      { id: 'dodge', effect: 'block', colors: [1, 2], bands: bands(3, 4, 6, 8), tier: 1 },
      { id: 'knives', effect: 'attack', colors: [0, 1], bands: bands(2, 4, 6, 8), tier: 1 },
    ],
  },
  {
    id: 'herbalist', name: 'Herbalist', health: 24, unlockWins: 1,
    description: 'Unlocked by winning a run. A charged staff and healing herbs, with no block at all.',
    loadout: [
      { id: 'staff', effect: 'attack', colors: [0, 1], charge: true, bands: [{ min: 1, value: 4 }, { min: 10, value: 7 }, { min: 20, value: 10 }, { min: 30, value: 13 }], tier: 1 },
      { id: 'herbs', effect: 'heal', colors: [2, 3], bands: bands(2, 3, 5, 7), tier: 1 },
    ],
  },
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

/** Single-use items. */
export const CONSUMABLES: readonly ConsumableDef[] = [
  { id: 'healing potion', effect: 'heal', value: 6 },
  { id: 'shield potion', effect: 'block', value: 6 },
  { id: 'bomb', effect: 'attack', value: 6 },
];

/** Shop prices in supplies: gear by tier, consumables, and one health point. Items sell for half. */
export const PRICES = { gear: [0, 25, 35, 45], consumable: { 'healing potion': 12, 'shield potion': 10, bomb: 15 } as Record<string, number>, health: 2 };

/** An enemy template. Harvest colors are rolled per fight. */
export type EnemyTemplate = Omit<EncounterDef & { type: 'enemy' }, 'type' | 'scavenge' | 'harvest'> & {
  /** Danger tier it appears at. */
  readonly tier: number;
  /** Supplies it always drops. */
  readonly supplies: number;
};

const enemy = (id: string, tier: number, health: number, intents: readonly Intent[], bound: { enrage?: number; flee?: number }, supplies: number): EnemyTemplate => ({
  id, tier, health, intents, supplies, ...bound,
});

/** Enemies by tier. Each is bounded thematically: beasts and brutes enrage, skittish things flee. */
export const ENEMIES: readonly EnemyTemplate[] = [
  enemy('wolf', 1, 10, [{ delay: 3, damage: 2 }, { delay: 2, damage: 3 }], { flee: 3 }, 4),
  enemy('boar', 1, 12, [{ delay: 4, damage: 4 }], { enrage: 1 }, 4),
  enemy('rats', 1, 8, [{ delay: 2, damage: 2 }], { flee: 2 }, 3),
  enemy('bandit', 2, 18, [{ delay: 3, damage: 4 }, { delay: 2, damage: 3 }], { enrage: 2 }, 7),
  enemy('bear', 2, 22, [{ delay: 4, damage: 5 }], { enrage: 2 }, 7),
  enemy('wisp', 2, 16, [{ delay: 2, damage: 3 }], { flee: 2 }, 6),
  enemy('troll', 3, 30, [{ delay: 3, damage: 5 }, { delay: 3, damage: 6 }], { enrage: 2 }, 10),
  enemy('wraith', 3, 24, [{ delay: 2, damage: 4 }], { flee: 3 }, 10),
];

/** The run's last fight. */
export const BOSS: EnemyTemplate = { ...enemy('old oak', 3, 44, [{ delay: 3, damage: 5 }, { delay: 2, damage: 4 }, { delay: 4, damage: 8 }], { enrage: 2 }, 0), boss: true };

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
