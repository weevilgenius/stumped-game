import { DAGGER, HERBS, SATCHEL, SHIELD, STAFF, WANDERER } from './sandbox';
import type { CharacterDef } from '../engine';

/** Five experimental loadouts, shared by the simulator and interactive playtest; not final balance. */
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
  { id: 'hunter', health: 20, loadout: [
    { ...DAGGER, id: 'sling', colors: [0, 1, 2, 3, 4, 5, 6, 7, 8], cooldown: 2,
      bands: [{ min: 1, value: 2 }, { min: 4, value: 3 }, { min: 8, value: 4 }, { min: 15, value: 5 }] },
    DAGGER, SHIELD, HERBS,
  ] },
];

/** One-sentence playtest descriptions, keyed by simulator loadout id. */
export const LOADOUT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  wanderer: 'A balanced mix of dagger, shield, charged staff, and healing herbs covers most colors.',
  coverage: 'A wide-color dagger, shield, herbs, and satchel use every color for combat, healing, or supplies.',
  overlap: 'Herbs, shield, and dagger compete for the same colors, making readiness and priority especially important.',
  specialist: 'A charged staff and powerful any-color sling trade flexible attacks against cooldowns and overlapping support colors.',
  hunter: 'An any-color sling leads the dagger, shield, and herbs, trading frequent attacks against support needs.',
};
