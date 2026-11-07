import type { Controller } from './controller';
import { bandOf } from './adventure/engine';
import { MAX_ITEM_LEVEL, XP_PER_LEVEL } from './adventure/content/campaign';
import type { AdventureCommand, AdventureState, ItemDef, SlotState } from './adventure/engine';

const title = (id: string): string => id.replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
const text = (parent: HTMLElement, value: string, tag = 'p'): HTMLElement => {
  const element = document.createElement(tag);
  element.textContent = value;
  parent.append(element);
  return element;
};
const button = (parent: HTMLElement, label: string, onClick: () => void, disabled = false): HTMLButtonElement => {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'text-button';
  element.textContent = label;
  element.disabled = disabled;
  element.onclick = onClick;
  parent.append(element);
  return element;
};
const swatches = (parent: HTMLElement, colors: readonly number[], palette: readonly number[]): void => {
  const row = document.createElement('span');
  row.className = 'campaign-colors';
  for (const color of colors) {
    const swatch = document.createElement('span');
    swatch.style.background = `#${palette[color].toString(16).padStart(6, '0')}`;
    swatch.textContent = String(color + 1);
    swatch.title = `Color ${color + 1}`;
    row.append(swatch);
  }
  parent.append(row);
};
const itemInfo = (parent: HTMLElement, item: ItemDef, palette: readonly number[], slot?: SlotState): void => {
  swatches(parent, item.colors, palette);
  text(parent, `${title(item.effect)} · ${item.charge ? 'All colors charge together' : 'Any matching color'}${item.cooldown ? ` · Cooldown ${item.cooldown} turns` : ''}`);
  text(parent, item.bands.map((band, index) => `${band.min}${item.bands[index + 1] ? `–${item.bands[index + 1].min - 1}` : '+'} squares: ${bandOf(item.bands, band.min, slot?.level).value}`).join(' · '));
  if (slot) text(parent, `Level ${slot.level ?? 0}/${MAX_ITEM_LEVEL} · Experience ${slot.experience ?? 0}/${XP_PER_LEVEL} · ${slot.chargedAmount} squares charged`);
};
const enemyInfo = (parent: HTMLElement, state: AdventureState, palette: readonly number[]): void => {
  const encounter = state.encounter;
  if (!encounter) return;
  text(parent, title(encounter.def.id), 'h3');
  if (encounter.type === 'enemy') {
    text(parent, `${Math.max(0, encounter.health)}/${encounter.def.health} health · Next hit ${encounter.def.intents[encounter.intent].damage} in ${encounter.countdown} reveals (wrong guesses count). Your pulse lands first.`);
    const budget = encounter.def.budget;
    text(parent, budget?.fleeAfter ? `Escapes without loot after ${budget.fleeAfter} puzzles; ${state.campaign?.encounterRounds ?? 0} finished.`
      : `Each new puzzle adds ${budget?.enrage ?? 0} damage to every hit. Attack countdown carries over.`);
  }
  text(parent, 'Harvest colors (unready gear to collect supplies):');
  swatches(parent, encounter.def.scavenge.flatMap((rule) => rule.colors), palette);
  text(parent, 'After a kill: matching readied gear earns experience; healing gear heals. Other matching colors harvest supplies. Each extra combat puzzle reduces harvest by 1 per color. One level per item per fight.');
};

const renderPotions = (parent: HTMLElement, state: AdventureState, issue: (command: AdventureCommand) => void): void => {
  text(parent, `Consumables · ${state.campaign!.potions.length}/3 · instant, no turn`, 'h3');
  state.campaign!.potions.forEach((potion, index) => button(parent, `Use ${title(potion.id)} · ${potion.value}`, () => issue({ type: 'use-potion', potion: index }), potion.id !== 'healing-potion' && state.encounter?.phase !== 'active'));
};

/** Open an exact tactical card from a strip item or enemy, with free readiness and potions. */
export function inspectAdventure(dialog: HTMLDialogElement, controller: Pick<Controller, 'adventure' | 'adventureCommand' | 'setReady'>, palette: readonly number[], slot?: number): void {
  const state = controller.adventure?.state;
  if (!state) return;
  dialog.replaceChildren();
  if (slot !== undefined && state.slots[slot]) {
    const item = state.slots[slot];
    text(dialog, title(item.item.id), 'h2');
    itemInfo(dialog, item.item, palette, item);
    text(dialog, `Ready in ${Math.max(0, item.readyAt - (state.round?.turn ?? 0) - 1)} more reveals.`);
    button(dialog, item.ready ? 'Unready' : 'Ready', () => { controller.setReady(slot, !item.ready); dialog.close(); });
  } else {
    enemyInfo(dialog, state, palette);
  }
  if (state.campaign && state.phase !== 'ended') renderPotions(dialog, state, (command) => { controller.adventureCommand(command); dialog.close(); });
  button(dialog, 'Back to puzzle', () => dialog.close());
  // Phaser also listens on window, so presses on the dialog or its backdrop would reach canvas controls beneath.
  const stop = (event: Event): void => event.stopPropagation();
  dialog.onmousedown = dialog.onmouseup = dialog.ontouchstart = dialog.ontouchend = dialog.onpointerdown = dialog.onpointerup = stop;
  dialog.onclick = (event) => {
    const box = dialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (event.target === dialog && outside) dialog.close();
  };
  dialog.showModal();
}
