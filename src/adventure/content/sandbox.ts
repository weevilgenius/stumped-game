import type { Band, CharacterDef, EncounterDef, ItemDef } from '../engine';

/* ========================================================= *\
 *  Phase 3 sandbox content for 9x9 boards (colors 0 to 8).  *
 *  Every number is provisional, for simulation and tuning.  *
\* ========================================================= */

/** Common size bands: 1-3, 4-7, 8-14, and 15+ squares. */
const bands = (...values: readonly [number, number, number, number]): readonly Band[] => [
  { min: 1, value: values[0] }, { min: 4, value: values[1] }, { min: 8, value: values[2] }, { min: 15, value: values[3] },
];

/** Immediate attack on two colors. */
export const DAGGER: ItemDef = { id: 'dagger', effect: 'attack', colors: [0, 1], bands: bands(2, 3, 5, 8) };

/** Defense on two colors. */
export const SHIELD: ItemDef = { id: 'shield', effect: 'block', colors: [2, 3], bands: bands(2, 3, 4, 6) };

/** Multi-color charge: fires once it has taken colors 4, 5, and 6, sized by their total. */
export const STAFF: ItemDef = {
  id: 'staff', effect: 'attack', colors: [4, 5, 6], charge: true,
  bands: [{ min: 1, value: 4 }, { min: 12, value: 8 }, { min: 24, value: 12 }, { min: 40, value: 16 }],
};

/** Recovery on one color. */
export const HERBS: ItemDef = { id: 'herbs', effect: 'heal', colors: [7], bands: bands(2, 3, 5, 7) };

/** Scavenging on one color. Not in the starting loadout. */
export const SATCHEL: ItemDef = { id: 'satchel', effect: 'forage', colors: [8], resource: 'supplies', bands: bands(1, 2, 3, 4) };

/** The one sandbox character. */
export const WANDERER: CharacterDef = { id: 'wanderer', health: 20, loadout: [DAGGER, SHIELD, STAFF, HERBS] };

/** After a win, every color scavenges supplies for now. */
const SCAVENGE_ALL = [{ colors: [0, 1, 2, 3, 4, 5, 6, 7, 8], resource: 'supplies', bands: bands(1, 1, 2, 3) }];

/** A telegraphed enemy that alternates two attacks. */
export const WOLF: EncounterDef = {
  type: 'enemy', id: 'wolf', health: 24, intents: [{ delay: 3, damage: 4 }, { delay: 2, damage: 5 }], scavenge: SCAVENGE_ALL,
};

/** A noncombat objective: break through before the ceiling falls. */
export const ROCKFALL: EncounterDef = {
  type: 'objective', id: 'rockfall', goal: 12, accepts: ['attack'], deadline: 6, failDamage: 4, scavenge: SCAVENGE_ALL,
};
