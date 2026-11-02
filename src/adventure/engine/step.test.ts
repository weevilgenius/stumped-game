import { DAGGER, HERBS, ROCKFALL, SHIELD, STAFF, WANDERER, WOLF } from '../content/sandbox';
import { bandOf, startRun, step } from './step';
import type { AdventureCommand, AdventureEvent, AdventureState, Collection, EncounterDef, RoundManifest } from './types';

const manifest = (collections: Collection[], givenColors: number[] = []): RoundManifest => (
  { id: 'play', size: 9, collections, givenColors }
);

/** Runs commands in order, failing on any rejection. */
const run = (state: AdventureState, ...commands: AdventureCommand[]): { state: AdventureState; events: AdventureEvent[] } => {
  const events: AdventureEvent[] = [];
  for (const command of commands) {
    const result = step(state, command);
    expect(result.events.find((e) => e.type === 'command-rejected')).toBeUndefined();
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
};

const turn = (color?: number, amount?: number): AdventureCommand => (
  color === undefined ? { type: 'turn' } : { type: 'turn', collect: { color, amount: amount ?? 1 } }
);

const types = (events: readonly AdventureEvent[]): string[] => events.map((e) => e.type);

const enemy = (health: number, damage: number, delay = 1): EncounterDef => ({
  type: 'enemy', id: 'test', health, intents: [{ delay, damage }],
  scavenge: [{ colors: [2], resource: 'coins', bands: [{ min: 1, value: 1 }, { min: 4, value: 2 }] }],
});

describe('bands', () => {
  it('picks the last band a pulse reaches', () => {
    const bands = [{ min: 1, value: 2 }, { min: 4, value: 3 }, { min: 8, value: 5 }];
    expect(bandOf(bands, 1)).toEqual({ band: 0, value: 2 });
    expect(bandOf(bands, 7)).toEqual({ band: 1, value: 3 });
    expect(bandOf(bands, 51)).toEqual({ band: 2, value: 5 });
  });
});

describe('turn lifecycle', () => {
  it('resolves the pulse, then the enemy, then countdowns', () => {
    const round = manifest([{ color: 0, amount: 2 }, { color: 2, amount: 2 }, { color: 8, amount: 77 }], [8]);
    let { state, events } = run(startRun(WANDERER), { type: 'begin-encounter', encounter: WOLF },
      { type: 'begin-round', round }, turn(0, 2));
    expect(types(events).slice(2)).toEqual([
      'turn-started', 'collected', 'pulse-routed', 'ability-activated', 'damage-applied',
    ]);
    expect(events).toContainEqual({ type: 'ability-activated', slot: 0, item: 'dagger', effect: 'attack', value: 2, band: 0 });
    expect(state.encounter).toMatchObject({ health: 22, countdown: 2 });

    ({ state } = run(state, turn(2, 2)));
    expect(state.block).toBe(3);

    // A wrong reveal is a turn: the wolf attacks into the block, and the rest of the block is lost.
    ({ state, events } = run(state, turn()));
    expect(events).toContainEqual({ type: 'enemy-acted', encounter: 'wolf', damage: 4, next: 2 });
    expect(events).toContainEqual({ type: 'damage-applied', target: 'character', amount: 4, blocked: 3, health: 19 });
    expect(state.block).toBe(0);

    ({ state } = run(state, { type: 'end-round', outcome: 'completed' }));
    expect(state.phase).toBe('between');
    expect(state.encounter).toMatchObject({ phase: 'active', countdown: 2, intent: 1 });
  });

  it('lets the pulse land before an attack due the same turn', () => {
    const round = manifest([{ color: 0, amount: 20 }, { color: 2, amount: 6 }, { color: 7, amount: 3 }]);
    let { state, events } = run(startRun(WANDERER), { type: 'begin-encounter', encounter: enemy(8, 50) },
      { type: 'begin-round', round }, turn(0, 20));
    expect(types(events)).not.toContain('enemy-acted');
    expect(events).toContainEqual({ type: 'encounter-transitioned', encounter: 'test', to: 'scavenge', outcome: 'defeated' });

    // Scavenging: the shield has nothing to block, so color 2 becomes coins; herbs still heal.
    ({ state, events } = run(state, turn(2, 6), turn(7, 3)));
    expect(types(events)).not.toContain('pulse-discarded');
    expect(events).toContainEqual({ type: 'resource-changed', resource: 'coins', amount: 2, total: 2, band: 1 });
    expect(events).toContainEqual({ type: 'pulse-routed', slot: 3, item: 'herbs' });

    ({ state, events } = run(state, { type: 'end-round', outcome: 'completed' }));
    expect(events).toContainEqual({ type: 'encounter-transitioned', encounter: 'test', to: 'ended', outcome: 'cleared' });
    expect(state.encounter).toBeNull();
  });

  it('discards a scavenged color no rule takes', () => {
    const round = manifest([{ color: 0, amount: 20 }, { color: 3, amount: 6 }]);
    const { state, events } = run(startRun({ ...WANDERER, loadout: [DAGGER] }),
      { type: 'begin-encounter', encounter: enemy(8, 1) }, { type: 'begin-round', round }, turn(0, 20), turn(3, 6));
    expect(types(events).at(-1)).toBe('pulse-discarded');
    expect(state.resources).toEqual({});
  });
});

describe('equipment', () => {
  it('fires a charge when its last color arrives, in any order, sized by the total', () => {
    const round = manifest([{ color: 6, amount: 10 }, { color: 4, amount: 1 }, { color: 5, amount: 2 }]);
    const { state, events } = run(startRun(WANDERER), { type: 'begin-encounter', encounter: WOLF },
      { type: 'begin-round', round }, turn(6, 10), turn(4, 1), turn(5, 2));
    expect(events.filter((e) => e.type === 'ability-charged').map((e) => e.missing)).toEqual([[4, 5], [5], []]);
    expect(events).toContainEqual({ type: 'ability-activated', slot: 2, item: 'staff', effect: 'attack', value: 8, band: 1 });
    expect(state.slots[2]).toMatchObject({ charged: [], chargedAmount: 0 });
  });

  it('loses an unfinished charge, block, and cooldowns at round end, and keeps the encounter', () => {
    const round = manifest([{ color: 5, amount: 3 }, { color: 2, amount: 2 }, { color: 8, amount: 4 }], [8]);
    let { state } = run(startRun(WANDERER), { type: 'begin-encounter', encounter: WOLF },
      { type: 'begin-round', round }, turn(5, 3), turn(2, 2));
    expect(state.slots[2].charged).toEqual([5]);
    expect(state.encounter?.countdown).toBe(1);
    ({ state } = run(state, { type: 'end-round', outcome: 'completed' }));
    expect(state.slots[2]).toMatchObject({ charged: [], chargedAmount: 0, readyAt: 0 });
    expect(state.block).toBe(0);
    expect(state.encounter).toMatchObject({ health: 24, countdown: 1 });

    // The countdown carries over: the wolf attacks on the next round's first turn.
    const { events } = run(state, { type: 'begin-round', round }, turn());
    expect(types(events)).toContain('enemy-acted');
  });

  it('skips a cooling-down item for the next eligible one', () => {
    const axe = { id: 'axe', effect: 'attack' as const, colors: [0, 1, 2], cooldown: 1, bands: [{ min: 1, value: 1 }] };
    const round = manifest([{ color: 0, amount: 2 }, { color: 1, amount: 2 }, { color: 2, amount: 2 }]);
    const { events } = run(startRun({ ...WANDERER, loadout: [axe, DAGGER] }),
      { type: 'begin-encounter', encounter: WOLF }, { type: 'begin-round', round }, turn(0, 2), turn(1, 2), turn(2, 2));
    expect(events.filter((e) => e.type === 'pulse-routed').map((e) => e.item)).toEqual(['axe', 'dagger', 'axe']);
  });

  it('skips unready items and discards a pulse nothing takes', () => {
    const round = manifest([{ color: 0, amount: 2 }, { color: 8, amount: 2 }]);
    const { state, events } = run(startRun(WANDERER), { type: 'begin-encounter', encounter: WOLF },
      { type: 'begin-round', round }, { type: 'set-ready', slot: 0, ready: false }, turn(0, 2), turn(8, 2));
    expect(types(events).filter((t) => t.startsWith('pulse'))).toEqual(['pulse-discarded', 'pulse-discarded']);
    expect(state.encounter).toMatchObject({ health: 24 });
  });

  it('skips attack and block items with no encounter', () => {
    const round = manifest([{ color: 0, amount: 2 }, { color: 7, amount: 2 }]);
    const { events } = run(startRun(WANDERER), { type: 'begin-round', round }, turn(0, 2), turn(7, 2));
    expect(types(events).filter((t) => t.startsWith('pulse'))).toEqual(['pulse-discarded', 'pulse-routed']);
  });

  it('reorders slots between rounds only', () => {
    const { state, events } = run(startRun(WANDERER), { type: 'set-priority', slots: [3, 2, 1, 0] });
    expect(events).toEqual([{ type: 'priority-changed', items: ['herbs', 'staff', 'shield', 'dagger'] }]);
    expect(state.slots.map((s) => s.item)).toEqual([HERBS, STAFF, SHIELD, DAGGER]);
  });
});

describe('encounters and run end', () => {
  it('completes a noncombat objective with accepted effects', () => {
    const round = manifest([{ color: 0, amount: 20 }, { color: 1, amount: 4 }]);
    const { state, events } = run(startRun(WANDERER), { type: 'begin-encounter', encounter: ROCKFALL },
      { type: 'begin-round', round }, turn(0, 20), turn(1, 4));
    expect(events.filter((e) => e.type === 'objective-progressed').map((e) => e.progress)).toEqual([8, 11]);
    expect(state.encounter).toMatchObject({ phase: 'active', progress: 11, countdown: 4 });
    expect(types(events)).not.toContain('damage-applied');
  });

  it('fails an objective whose deadline passes, and shields do nothing against it', () => {
    const round = manifest([{ color: 2, amount: 20 }, { color: 3, amount: 2 }]);
    const { state, events } = run(startRun(WANDERER), { type: 'begin-encounter', encounter: ROCKFALL },
      { type: 'begin-round', round }, turn(2, 20), ...Array<AdventureCommand>(5).fill(turn()));
    expect(types(events)).toContain('pulse-discarded');
    expect(events).toContainEqual({ type: 'encounter-transitioned', encounter: 'rockfall', to: 'ended', outcome: 'failed' });
    expect(state).toMatchObject({ health: 16, encounter: null });
  });

  it('ends the run and the puzzle when the character dies', () => {
    const round = manifest([{ color: 0, amount: 2 }]);
    const { state, events } = run(startRun(WANDERER), { type: 'begin-encounter', encounter: enemy(50, 30) },
      { type: 'begin-round', round }, turn());
    expect(types(events).slice(-2)).toEqual(['damage-applied', 'run-ended']);
    expect(state).toMatchObject({ phase: 'ended', outcome: 'death', round: null, health: -10 });
    const after = step(state, turn(0, 2));
    expect(after.state).toBe(state);
    expect(after.events).toEqual([{ type: 'command-rejected', command: 'turn', reason: 'run-ended' }]);
  });

  it('ends the run when the puzzle is lost or the run abandoned', () => {
    const round = manifest([{ color: 0, amount: 2 }]);
    for (const outcome of ['failed', 'abandoned'] as const) {
      const { state, events } = run(startRun(WANDERER), { type: 'begin-round', round }, { type: 'end-round', outcome });
      expect(events.at(-1)).toEqual({ type: 'run-ended', outcome });
      expect(state).toMatchObject({ phase: 'ended', outcome });
    }
  });
});

describe('invalid commands', () => {
  const round = manifest([{ color: 0, amount: 2 }, { color: 1, amount: 3 }, { color: 8, amount: 4 }], [8]);
  const { state: playing } = run(startRun(WANDERER), { type: 'begin-encounter', encounter: WOLF },
    { type: 'begin-round', round }, turn(0, 2));

  it.each<[AdventureCommand, string]>([
    [turn(5, 2), 'bad-collection'],
    [turn(1, 4), 'bad-collection'],
    [turn(0, 2), 'bad-collection'],
    [turn(8, 4), 'bad-collection'],
    [{ type: 'end-round', outcome: 'completed' }, 'round-incomplete'],
    [{ type: 'set-priority', slots: [0, 1, 2, 3] }, 'wrong-phase'],
    [{ type: 'begin-round', round }, 'wrong-phase'],
    [{ type: 'begin-encounter', encounter: WOLF }, 'wrong-phase'],
    [{ type: 'set-ready', slot: 9, ready: false }, 'bad-slot'],
  ])('rejects %j without changing anything', (command, reason) => {
    const before = JSON.stringify(playing);
    const result = step(playing, command);
    expect(result.state).toBe(playing);
    expect(result.events).toEqual([{ type: 'command-rejected', command: command.type, reason }]);
    expect(JSON.stringify(playing)).toBe(before);
  });

  it('rejects bad setup between rounds', () => {
    const fresh = run(startRun(WANDERER), { type: 'begin-encounter', encounter: WOLF }).state;
    const reasons = [
      step(fresh, { type: 'begin-encounter', encounter: ROCKFALL }),
      step(fresh, { type: 'begin-round', round: manifest([{ color: 0, amount: 2 }, { color: 0, amount: 3 }]) }),
      step(fresh, { type: 'set-priority', slots: [0, 0, 1, 2] }),
      step(fresh, turn()),
    ].map((r) => r.events[0]);
    expect(reasons.map((e) => e.type === 'command-rejected' && e.reason))
      .toEqual(['encounter-active', 'bad-manifest', 'bad-slot', 'wrong-phase']);
  });
});
