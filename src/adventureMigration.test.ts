import { expect, it } from 'vitest';
import { beginRound, command, newAdventure, parseAdventure, recordPuzzle } from './adventurePlay';
import { step } from './adventure/engine';
import { newGame } from './game';
import { generate } from './engine';

it('imports a version-1 command journal as a new replay baseline and keeps the original verbatim', () => {
  const save = newAdventure('ranger', 7);
  command(save, { type: 'travel', node: '0-0' }, 1);
  const puzzle = generate({ size: 9, tier: 'medium', freebies: 0, silver: false, sizeMix: 1, shape: 1 }, 7);
  beginRound(save, newGame(puzzle, false, 'imported', true), 2);
  save.game!.elapsed = 1234;
  recordPuzzle(save);
  const raw = { ...save, version: 1 };
  const restored = parseAdventure(JSON.stringify(raw))!;
  expect(restored.version).toBe(2);
  expect(restored.previous).toEqual(raw);
  expect(restored.game).toEqual(save.game);
  expect(restored.state.round).toEqual(save.state.round);
  expect(restored.log).toEqual([]);
  command(restored, { type: 'set-ready', slot: 0, ready: false }, 3);
  expect(restored.log.reduce((state, next) => step(state, next).state, restored.start)).toEqual(restored.state);
  expect(parseAdventure(JSON.stringify(restored))).toEqual(restored);
});

it('imports PR #79 numeric maps, inventory, consumables and shop stock without changing the route', () => {
  const save = newAdventure('ranger', 7);
  const item = save.state.slots[0].item;
  const slot = { ...save.state.slots[0], level: 6, xp: 7, readyAt: 8, charged: [0], chargedAmount: 12 };
  const raw = { ...save, version: 1, state: { ...save.state, character: 'knight', slots: [slot], pack: [slot], fights: 4,
    consumables: [{ id: 'bomb', effect: 'attack', value: 6 }],
    campaign: { seed: 7, at: 1, visited: [0, 1], rest: false, event: null,
      nodes: [
        { column: 0, lane: 0, lanes: 1, kind: 'fight', tier: 1, next: [1] },
        { column: 1, lane: 0, lanes: 1, kind: 'shop', tier: 1, next: [2] },
        { column: 2, lane: 0, lanes: 1, kind: 'boss', tier: 3, next: [] },
      ], loot: [{ kind: 'gear', item, slot }], shop: { stock: [null, { price: 25, goods: { kind: 'gear', item } }] },
    },
  } };
  const restored = parseAdventure(JSON.stringify(raw))!;
  expect(restored.previous).toEqual(raw);
  expect(restored.state.campaign).toMatchObject({ node: '1', active: true, potions: [{ id: 'damage-potion', value: 6 }] });
  expect(restored.state.campaign!.map.map((node) => node.next)).toEqual([['1'], ['2'], []]);
  expect(restored.state.slots[0]).toMatchObject({ level: 3, experience: 7, readyAt: 8, charged: [0], chargedAmount: 12 });
  expect(restored.state.campaign!.loot[0].slot).toMatchObject({ level: 3, experience: 7 });
  expect(restored.state.campaign!.stock).toHaveLength(1);
  expect(parseAdventure(JSON.stringify(restored))).toEqual(restored);
});

it('imports a PR #79 forage puzzle and keeps its collected turns', () => {
  const save = newAdventure('ranger', 7);
  const raw = { ...save, version: 1, state: { ...save.state, phase: 'round',
    round: { manifest: { id: 'forage', size: 9, collections: [{ color: 0, amount: 3 }], givenColors: [] }, turn: 1, collected: [0] },
    encounter: { type: 'forage', phase: 'scavenge', def: { type: 'forage', id: 'forage', harvest: [0, 1, 2] } },
    campaign: { seed: 7, at: 0, visited: [0], rest: false, event: null, loot: [], shop: null,
      nodes: [{ column: 0, lane: 0, lanes: 1, kind: 'forage', tier: 1, next: [] }],
    },
  } };
  const restored = parseAdventure(JSON.stringify(raw))!;
  expect(restored.state.encounter).toMatchObject({ type: 'objective', phase: 'scavenge', def: { scavenge: [{ colors: [0, 1, 2] }] } });
  expect(restored.state.round?.collected).toEqual([0]);
});

it('rejects malformed prototype inventories so the controller can preserve a recovery copy', () => {
  const save = newAdventure('ranger');
  const raw = { ...save, version: 1, state: { ...save.state, campaign: { nodes: [], at: 0 } } };
  expect(parseAdventure(JSON.stringify(raw))).toBeUndefined();
});

it('restores base bands for PR #80 leveled gear instead of applying its level twice', () => {
  const save = newAdventure('ranger');
  const slot = { ...save.state.slots[0], level: 1, item: { id: 'blade', instance: 'old-blade', price: 25,
    effect: 'attack', colors: [0, 1], bands: [{ min: 1, value: 4 }, { min: 4, value: 6 }, { min: 8, value: 9 }, { min: 15, value: 11 }] } };
  const raw = { ...save, version: 1, state: { ...save.state, slots: [slot] } };
  const restored = parseAdventure(JSON.stringify(raw))!;
  expect(restored.state.slots[0].level).toBe(1);
  expect(restored.state.slots[0].item.bands.map((band) => band.value)).toEqual([3, 4, 6, 9]);
  expect(restored.previous).toEqual(raw);
});
