import { afterEach, expect, it, vi } from 'vitest';
import { command, newAdventure } from './adventurePlay';
import { adventurePage, newAdventureScreen } from './adventureScreens';
import type { AdventureScreenController } from './adventureScreens';
import { createAccessibleAdventure } from './adventureAccessibility';

const setup = () => {
  const save = newAdventure('ranger');
  const controller: AdventureScreenController = {
    get adventure() { return save; }, adventureUnlocks: ['ranger', 'sentinel'],
    adventureCommand: (next) => { command(save, next, 1); },
    setReady: (slot, ready) => { command(save, { type: 'set-ready', slot, ready }, 1); },
    showMenu: vi.fn(), selectAdventure: vi.fn(), startAdventure: vi.fn(() => Promise.resolve()),
    playAdventure: vi.fn(() => Promise.resolve()), abandonAdventure: vi.fn(() => Promise.resolve()),
  };
  return { save, controller, view: newAdventureScreen() };
};
afterEach(() => document.body.replaceChildren());

it('keeps campaign selection separate from the saved run and guards locked starters', () => {
  const { controller, save, view } = setup();
  const before = JSON.stringify(save);
  let page = adventurePage(controller, view, true, vi.fn());
  expect(page.cards.find((card) => card.id === 'herbalist')?.actions?.[0].disabled).toBe(true);
  page.cards.find((card) => card.id === 'sentinel')!.actions![0].onSelect();
  expect(JSON.stringify(save)).toBe(before);
  page = adventurePage(controller, view, true, vi.fn());
  page.primary!.onSelect();
  expect(controller.startAdventure).toHaveBeenCalledWith('sentinel');
});

it('offers only connected route actions and keeps equipment swaps out of an unfinished puzzle', () => {
  const { controller, save, view } = setup();
  let page = adventurePage(controller, view, false, vi.fn());
  expect(page.reachable?.every((id) => id.startsWith('0-'))).toBe(true);
  page.travel!(page.map!.find((node) => node.id === page.reachable![0])!);
  view.panel = 'map';
  expect(adventurePage(controller, view, false, vi.fn()).reachable).toEqual([]);
  view.panel = 'gear'; view.detail = { type: 'item', slot: 0 };
  save.state.phase = 'round';
  page = adventurePage(controller, view, false, vi.fn());
  const actions = page.cards.flatMap((card) => card.actions ?? []);
  expect(actions.find((action) => action.name === 'pack')?.disabled).toBe(true);
  expect(actions.find((action) => action.name === 'earlier')?.disabled).toBe(true);
  actions.find((action) => action.name === 'ready')!.onSelect();
  expect(save.state.slots[0].ready).toBe(false);
});

it('keeps all exact size bands in inspection cards and uses one-time location choices', () => {
  const { controller, save, view } = setup();
  view.detail = { type: 'item', slot: 0 };
  expect(adventurePage(controller, view, false, vi.fn()).cards[0].body).toContain('15+ squares: 5');
  view.detail = null; view.panel = 'here';
  save.state.campaign!.node = '12-0';
  controller.adventureCommand({ type: 'travel', node: '13-0' });
  save.state.health = 10;
  let page = adventurePage(controller, view, false, vi.fn());
  page.cards[0].actions!.find((action) => action.name === 'rest-heal')!.onSelect();
  expect(save.state.health).toBe(18);
  page = adventurePage(controller, view, false, vi.fn());
  expect(page.cards[0].id).toBe('move-on');
});

it('allows inspecting shop gear before spending supplies', () => {
  const { controller, save, view } = setup();
  save.state.campaign!.node = '2-0';
  controller.adventureCommand({ type: 'travel', node: '3-0' });
  view.panel = 'here';
  let page = adventurePage(controller, view, false, vi.fn());
  const offer = save.state.campaign!.stock.find((offer) => offer.item)!;
  const before = JSON.stringify(save);
  page.cards.find((card) => card.id === offer.id)!.actions!.find((action) => action.name.startsWith('inspect-offer-'))!.onSelect();
  page = adventurePage(controller, view, false, vi.fn());
  expect(page.cards[0].body).toContain('squares:');
  expect(page.cards[1].body).toMatch(/cooldown/i);
  expect(JSON.stringify(save)).toBe(before);
});

it('preserves semantic focus as canvas controls redraw and removes old scene controls on shutdown', () => {
  const onSelect = vi.fn();
  const menu = createAccessibleAdventure(document.body, onSelect);
  menu.render('Equipment', 'Readiness', [{ name: 'ready', label: 'Unready', bounds: [5, 5, 80, 44], disabled: false }]);
  menu.focus();
  (document.activeElement as HTMLButtonElement).click();
  expect(onSelect).toHaveBeenCalledWith('ready');
  menu.render('Equipment', 'Readiness', [{ name: 'ready', label: 'Ready', bounds: [5, 5, 80, 44], disabled: false }], 'ready');
  expect(document.activeElement?.getAttribute('aria-current')).toBe('page');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Ready');
  menu.render('Selection', 'Locked', [{ name: 'locked', label: 'Locked', bounds: [5, 5, 80, 44], disabled: true }]);
  document.querySelector<HTMLButtonElement>('[data-action="locked"]')!.click();
  expect(onSelect).toHaveBeenCalledTimes(1);
  menu.destroy();
  expect(document.querySelector('.accessible-adventure')).toBeNull();
});
