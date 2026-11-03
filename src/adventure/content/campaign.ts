import type { CharacterDef, ItemDef } from '../engine/types';
import type { Potion } from '../engine/campaignTypes';

/** Increment when campaign content changes; saves and reports retain provenance. */
export const CONTENT_VERSION = 1;
const bands = (a: number, b: number, c: number, d: number) => [
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
/** Compact catalog; rolls vary colors independently, including unlucky overlap. */
export const GEAR: readonly ItemDef[] = [
  { id: 'blade', effect: 'attack', colors: [0, 1], bands: bands(3, 4, 6, 9) },
  { id: 'buckler', effect: 'block', colors: [0, 1], bands: bands(4, 5, 7, 9) },
  { id: 'herbs', effect: 'heal', colors: [0, 1], bands: bands(2, 3, 5, 7) },
  { id: 'sling', effect: 'attack', colors: [0, 1, 2], cooldown: 1, bands: bands(2, 3, 5, 7) },
  { id: 'storm-staff', effect: 'attack', colors: [0, 1, 2], charge: true, bands: bands(5, 9, 13, 18) },
  { id: 'satchel', effect: 'forage', colors: [0, 1], resource: 'supplies', bands: bands(1, 2, 3, 4) },
];
/** Fixed emergency options; stronger than one ordinary pulse. */
export const POTIONS: readonly Potion[] = [
  { id: 'healing-potion', value: 9 }, { id: 'block-potion', value: 10 }, { id: 'damage-potion', value: 10 },
];
