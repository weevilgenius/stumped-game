import type { Controller } from './controller';
import { currentNode, routeChoices } from './adventure/engine';
import type { AdventureCommand, AdventureState, ItemDef, Offer, SlotState } from './adventure/engine';

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
  text(parent, item.bands.map((band, index) => `${band.min}${item.bands[index + 1] ? `–${item.bands[index + 1].min - 1}` : '+'} squares: ${band.value}`).join(' · '));
  if (slot) text(parent, `Level ${slot.level ?? 0}/3 · Experience ${slot.experience ?? 0}/24 · ${slot.chargedAmount} squares charged`);
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

/** Render the forward map, rewards, quiet choices, and between-puzzle equipment. */
export function renderCampaign(parent: HTMLElement, controller: Pick<Controller, 'adventure' | 'adventureCommand' | 'setReady'>, palette: readonly number[]): void {
  const mapScroll = parent.querySelector('.campaign-map')?.scrollLeft ?? 0;
  const open = new Set([...parent.querySelectorAll<HTMLDetailsElement>('details[open]')].map((detail) => detail.dataset.disclosure ?? detail.querySelector('summary')?.textContent));
  const focus = document.activeElement instanceof HTMLElement && parent.contains(document.activeElement) ? document.activeElement.dataset.focusKey ?? document.activeElement.textContent : null;
  parent.replaceChildren();
  const state = controller.adventure?.state;
  if (!state?.campaign) return;
  const campaign = state.campaign;
  const issue = (command: AdventureCommand): void => controller.adventureCommand(command);
  const ended = state.phase === 'ended';
  const node = currentNode(state);
  text(parent, `The Warden's trail · Step ${node ? node.column + 1 : 0}/15`, 'h3');
  text(parent, `${campaign.wins} fights won · ${campaign.fled} escaped · ${campaign.gear} gear found · ${campaign.upgrades} upgrades · Supplies ${campaign.earned} earned / ${campaign.spent} spent`);
  const mapDetails = document.createElement('details');
  mapDetails.dataset.disclosure = 'map';
  mapDetails.open = !ended && !campaign.active;
  text(mapDetails, 'Route map', 'summary');
  const map = document.createElement('div');
  map.className = 'campaign-map';
  map.setAttribute('aria-label', 'Route map');
  const rail = document.createElement('div');
  rail.className = 'campaign-rail';
  const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  lines.setAttribute('width', String(15 * 142 - 32));
  lines.setAttribute('height', '182');
  lines.setAttribute('aria-hidden', 'true');
  for (const entry of campaign.map) for (const id of entry.next) {
    const next = campaign.map.find((candidate) => candidate.id === id)!;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(entry.column * 142 + 110));
    line.setAttribute('y1', String(50 + entry.lane * 54));
    line.setAttribute('x2', String(next.column * 142));
    line.setAttribute('y2', String(50 + next.lane * 54));
    lines.append(line);
  }
  rail.append(lines);
  const choices = routeChoices(state);
  for (let column = 0; column < 15; column++) {
    const group = document.createElement('div');
    group.className = 'campaign-column';
    text(group, String(column + 1), 'small');
    for (const entry of campaign.map.filter((entry) => entry.column === column)) {
      const visited = campaign.visited.includes(entry.id);
      const available = choices.some((choice) => choice.id === entry.id);
      const label = `${entry.hidden && !visited && entry.id !== node?.id ? 'Unknown' : title(entry.kind)}${['fight', 'elite', 'boss'].includes(entry.kind) ? ` · ${entry.tier}` : ''}`;
      const action = button(group, label, () => issue({ type: 'travel', node: entry.id }), !available || ended);
      action.style.gridRow = String(entry.lane + 2);
      action.setAttribute('aria-label', `Step ${column + 1}, path ${entry.lane + 1}: ${label}`);
      action.dataset.current = String(entry.id === node?.id);
      action.dataset.visited = String(visited);
      action.title = `Step ${column + 1}, path ${entry.lane + 1}. Leads to ${entry.next.map((id) => Number(id.split('-')[1]) + 1).join(', ') || 'victory'}`;
      if (entry.id === node?.id) action.setAttribute('aria-current', 'step');
    }
    rail.append(group);
  }
  map.append(rail);
  text(mapDetails, 'Lines connect the paths. Scroll sideways to see the trail; highlighted choices are reachable.');
  mapDetails.append(map);
  parent.append(mapDetails);
  if (!node) text(parent, 'Choose an opening fight. Find gear to widen your colors before the trail grows dangerous. Shops sell gear, potions and healing; rests heal or improve gear.');
  if (state.encounter) enemyInfo(parent, state, palette);
  if (ended) return;
  const between = state.phase === 'between';
  if (between && campaign.active && !state.encounter) {
    if (node?.kind === 'rest') {
      text(parent, 'Rest: choose healing or improve one equipped item. No puzzle required.');
      button(parent, `Recover ${Math.ceil(state.maxHealth / 3)} health`, () => issue({ type: 'choose', choice: 'rest' }));
      state.slots.forEach((slot, index) => button(parent, `Improve ${title(slot.item.id)}`, () => issue({ type: 'choose', choice: 'upgrade', slot: index }), (slot.level ?? 0) >= 3));
    } else if (node?.kind === 'event') {
      text(parent, 'A quiet clearing. A traveler offers a trade; a thorny cache tempts you.');
      button(parent, 'Pay 6 supplies for 6 health', () => issue({ type: 'choose', choice: 'trade' }), (state.resources.supplies ?? 0) < 6);
      button(parent, 'Take 4 damage for one random item', () => issue({ type: 'choose', choice: 'risk' }));
      button(parent, 'Enjoy the quiet and leave', () => issue({ type: 'choose', choice: 'leave' }));
    } else if (node?.kind === 'shop') {
      text(parent, 'Shop · stock is fixed. Sell packed gear for half its price.');
      renderOffers(parent, campaign.stock, true, state, issue, palette);
      button(parent, 'Buy healing · 2 supplies per health', () => issue({ type: 'shop-heal' }), state.health >= state.maxHealth || (state.resources.supplies ?? 0) < 2);
      button(parent, 'Leave shop', () => issue({ type: 'choose', choice: 'leave' }));
    }
  }
  if (between && !state.encounter && campaign.loot.length) {
    text(parent, 'Loot · take what fits, or replace equipped gear. Moving on leaves the rest behind.', 'h3');
    renderOffers(parent, campaign.loot, false, state, issue, palette);
  }
  text(parent, 'Equipment · four slots, first ready match takes the pulse', 'h3');
  state.slots.forEach((slot, index) => {
    const detail = document.createElement('details');
    const key = slot.item.instance ?? slot.item.id;
    detail.dataset.disclosure = `equipped/${key}`;
    text(detail, `${index + 1}. ${title(slot.item.id)} · ${slot.ready ? 'Ready' : 'Unready'} · level ${slot.level ?? 0}`, 'summary');
    itemInfo(detail, slot.item, palette, slot);
    button(detail, slot.ready ? `Unready ${title(slot.item.id)}` : `Ready ${title(slot.item.id)}`, () => controller.setReady(index, !slot.ready)).dataset.focusKey = `ready/${key}`;
    if (between) {
      button(detail, 'Pack', () => issue({ type: 'unequip', slot: index }), campaign.pack.length >= 3);
      if (index > 0) button(detail, 'Move earlier', () => {
        const order = state.slots.map((_, i) => i);
        [order[index - 1], order[index]] = [order[index], order[index - 1]];
        issue({ type: 'set-priority', slots: order });
      });
    }
    parent.append(detail);
  });
  if (between && campaign.pack.length) {
    text(parent, `Pack · ${campaign.pack.length}/3`, 'h3');
    campaign.pack.forEach((slot, packed) => {
      const detail = document.createElement('details');
      text(detail, title(slot.item.id), 'summary');
      itemInfo(detail, slot.item, palette, slot);
      for (let index = 0; index < Math.min(4, state.slots.length + 1); index++) {
        button(detail, state.slots[index] ? `Swap with ${title(state.slots[index].item.id)}` : 'Equip in empty slot', () => issue({ type: 'equip', pack: packed, slot: index }));
      }
      if (campaign.active && node?.kind === 'shop') button(detail, `Sell for ${Math.floor((slot.item.price ?? 25) / 2)}`, () => issue({ type: 'sell', pack: packed }));
      parent.append(detail);
    });
  }
  renderPotions(parent, state, issue);
  for (const detail of parent.querySelectorAll<HTMLDetailsElement>('details')) {
    if (open.has(detail.dataset.disclosure ?? detail.querySelector('summary')?.textContent)) detail.open = true;
  }
  if (focus) {
    const next = [...parent.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].find((entry) => (entry.dataset.focusKey ?? entry.textContent) === focus);
    parent.tabIndex = -1;
    (next ?? parent).focus({ preventScroll: true });
  }
  map.scrollLeft = mapScroll;
  if (between && state.encounter?.type === 'enemy' && state.encounter.phase === 'active' && !state.encounter.def.budget?.boss) {
    button(parent, `Flee · take ${state.encounter.def.intents[state.encounter.intent].damage} damage, lose loot`, () => issue({ type: 'flee' }));
  }
}
const renderOffers = (parent: HTMLElement, offers: readonly Offer[], shop: boolean, state: AdventureState, issue: (command: AdventureCommand) => void, palette: readonly number[]): void => {
  const campaign = state.campaign!;
  for (const offer of offers) {
    const detail = document.createElement('details');
    detail.dataset.disclosure = `offer/${offer.id}`;
    const name = title(offer.item?.id ?? offer.potion!.id);
    text(detail, `${name}${shop ? ` · ${offer.price} supplies` : ''}`, 'summary');
    if (offer.item) itemInfo(detail, offer.item, palette);
    else text(detail, `Instant ${offer.potion!.value} ${offer.potion!.id.split('-')[0]}; no tactical turn.`);
    const full = offer.item ? state.slots.length >= 4 && campaign.pack.length >= 3 : campaign.potions.length >= 3;
    button(detail, `${shop ? 'Buy' : 'Take'} ${name}`, () => issue(shop ? { type: 'buy', offer: offer.id } : { type: 'take-loot', offer: offer.id }), full || (state.resources.supplies ?? 0) < offer.price);
    if (!shop && offer.item) {
      const replace = document.createElement('select');
      replace.setAttribute('aria-label', `Replace gear with ${name}`);
      state.slots.forEach((slot, index) => replace.add(new Option(title(slot.item.id), String(index))));
      detail.append(replace);
      button(detail, 'Replace selected gear', () => issue({ type: 'take-loot', offer: offer.id, replace: Number(replace.value) }), state.slots.length === 0);
    }
    parent.append(detail);
  }
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
  dialog.showModal();
}
