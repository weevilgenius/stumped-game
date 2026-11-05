import type { ColorId, ConsumableDef, EncounterState, ItemDef, NodeKind, SlotState } from './adventure/engine';
import { bandOf, nextHit, XP_PER_LEVEL } from './adventure/engine';
import type { RunCommand } from './adventure/campaign';

/* ========================================================= *\
 *  Adventure text shared by the camp screen and the detail  *
 *  cards: names, exact item and enemy values, and HTML      *
 *  helpers for the cards.                                   *
\* ========================================================= */

/** Node names, for the map and its legend. */
export const NODE_NAMES: Readonly<Record<NodeKind, string>> = {
  fight: 'Fight', elite: 'Elite', boss: 'Boss', shop: 'Shop', rest: 'Rest', event: 'Event', forage: 'Forage',
};

/** One-letter map symbols. */
export const NODE_SYMBOLS: Readonly<Record<NodeKind, string>> = {
  fight: 'F', elite: 'E', boss: 'B', shop: '$', rest: 'R', event: '?', forage: 'H',
};

/** Effect names. */
export const EFFECT_NAMES = { attack: 'Attack', block: 'Block', heal: 'Heal', forage: 'Supplies' } as const;

/**
 * A content identifier as a display name.
 * @param id identifier, such as 'tower shield'
 * @returns 'Tower shield'
 */
export function titleOf(id: string): string {
  return `${id[0]?.toUpperCase() ?? ''}${id.slice(1)}`;
}

const escape = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A button that sends a run command, or a disabled one for null. */
export const button = (label: string, command: RunCommand | null, extra = ''): string => `<button type="button" class="text-button"${
  command ? ` data-command="${escape(JSON.stringify(command))}"` : ' disabled'} ${extra}>${label}</button>`;

/**
 * Color swatches, as HTML.
 * @param colors palette indexes
 * @param color CSS color of a palette index
 * @returns HTML
 */
export const swatches = (colors: readonly ColorId[], color: (c: ColorId) => string): string => `<span class="swatches">${
  colors.map((c) => `<i style="background:${color(c)}"></i>`).join('')}</span>`;

/**
 * An item's exact values: effect, colors, bands at its level, cooldown or charge, and level progress.
 * @param item the item
 * @param slot its state, if equipped or packed
 * @returns plain sentences
 */
export function itemDetails(item: ItemDef, slot?: SlotState): string[] {
  const level = slot?.level ?? 0;
  const values = item.bands.map((band, i) => {
    const next = item.bands[i + 1];
    const range = next ? `${band.min}-${next.min - 1}` : `${band.min}+`;
    return `${range}: ${bandOf(item.bands, band.min, level).value}`;
  });
  const lines = [`${EFFECT_NAMES[item.effect]} by ${item.charge ? 'total charged squares' : 'color size'}: ${values.join(', ')}.`];
  if (item.charge) lines.push(`Charges: fires once it has taken all ${item.colors.length} of its colors in one puzzle.`);
  if (item.cooldown) lines.push(`Cooldown: skipped for ${item.cooldown} turns after it fires.`);
  if (slot && item.effect !== 'heal' && item.effect !== 'forage') {
    lines.push(`Level ${level}: ${slot.xp ?? 0}/${XP_PER_LEVEL} squares collected after kills toward the next (one level per fight).`);
  } else if (level) {
    lines.push(`Level ${level}.`);
  }
  return lines;
}

/**
 * An encounter's exact values: health, next hit and its timing, attack cycle, enrage or flee, and harvest colors.
 * @param encounter the encounter
 * @returns plain sentences, without harvest colors (shown as swatches)
 */
export function encounterDetails(encounter: EncounterState): string[] {
  if (encounter.type === 'forage') return ['No enemy: every color harvests as experience or supplies.'];
  if (encounter.type === 'objective') {
    return [`Progress ${encounter.progress}/${encounter.def.goal}. Deadline in ${encounter.countdown} turns, or ${encounter.def.failDamage} damage.`];
  }
  const { def } = encounter;
  if (encounter.phase === 'scavenge') return ['Defeated. Readied items level up from their colors; harvest colors no item takes become supplies.'];
  const lines = [
    `Health ${encounter.health}/${def.health}.`,
    `Next hit: ${nextHit(encounter)} damage ${encounter.countdown <= 1 ? 'this turn' : `in ${encounter.countdown} turns`}.`,
    `Attack cycle: ${def.intents.map((intent) => `${intent.damage + (encounter.rage ?? 0)} damage after ${intent.delay} turns`).join(', then ')}.`,
  ];
  const fought = encounter.rounds ?? 0;
  if (def.flee) lines.push(`Flees with its loot after ${def.flee} ${def.flee === 1 ? 'puzzle' : 'puzzles'} (${Math.max(0, def.flee - fought)} left).`);
  if (def.enrage) lines.push(`Enrages: +${def.enrage} damage for each new puzzle (now +${encounter.rage ?? 0}).`);
  if (def.boss) lines.push('Boss: no fleeing. Defeat it to win the run.');
  return lines;
}

/**
 * A consumable's effect.
 * @param item the consumable
 * @returns one sentence
 */
export function consumableDetails(item: ConsumableDef): string {
  const what = { heal: `Heals ${item.value}`, block: `Blocks ${item.value}`, attack: `Deals ${item.value} damage` }[item.effect];
  return `${what}. Free to use at any time, even mid-puzzle.`;
}

/**
 * One line for an item row: effect and band values at its level, charge or cooldown, and level.
 * @param item the item
 * @param slot its state, if owned
 * @returns a short summary
 */
export function itemSummary(item: ItemDef, slot?: SlotState): string {
  const level = slot?.level ?? 0;
  const values = item.bands.map((band) => bandOf(item.bands, band.min, level).value).join('/');
  const levels = slot && item.effect !== 'heal' && item.effect !== 'forage' ? ` · xp ${slot.xp ?? 0}/${XP_PER_LEVEL}` : '';
  return `${EFFECT_NAMES[item.effect]} ${values}${item.charge ? ' · charge' : ''}${item.cooldown ? ` · cooldown ${item.cooldown}` : ''}${levels}`;
}

