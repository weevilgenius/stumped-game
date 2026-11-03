import { afterEach, expect, it } from 'vitest';
import type { Controller } from './controller';
import { command, newAdventure } from './adventurePlay';
import { renderCampaign } from './adventureMenu';

const palette = Array.from({ length: 9 }, () => 0xAAAAAA);
afterEach(() => document.body.replaceChildren());

it('preserves an equipment disclosure and keyboard focus when readiness redraws the campaign menu', () => {
  const save = newAdventure('ranger');
  const parent = document.createElement('div');
  document.body.append(parent);
  const controller: Pick<Controller, 'adventure' | 'adventureCommand' | 'setReady'> = {
    get adventure() { return save; },
    adventureCommand: (next) => { command(save, next, 1); renderCampaign(parent, controller, palette); },
    setReady: (slot, ready) => { command(save, { type: 'set-ready', slot, ready }, 1); renderCampaign(parent, controller, palette); },
  };
  renderCampaign(parent, controller, palette);
  const equipment = parent.querySelector<HTMLDetailsElement>('[data-disclosure="equipped/shortbow"]')!;
  equipment.open = true;
  const control = equipment.querySelector('button')!;
  control.focus();
  control.click();
  expect(save.state.slots[0].ready).toBe(false);
  expect(parent.querySelector<HTMLDetailsElement>('[data-disclosure="equipped/shortbow"]')!.open).toBe(true);
  expect(document.activeElement?.textContent).toBe('Ready Shortbow');
});
