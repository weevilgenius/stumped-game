import { readFileSync } from 'node:fs';
import { type AdventureCommand, type AdventureEvent, type AdventureState, type CollectSource, type RoundManifest, startRun, step } from '../engine';
import { parseTraces, replayRound, type SolveTrace } from '../sim/traces';
import { DAGGER, HERBS, ROCKFALL, SATCHEL, SHIELD, STAFF, WOLF } from './sandbox';

const traces = ['tests/sample-games.csv', 'tests/barry-phone.csv']
  .flatMap((file) => parseTraces(readFileSync(file, 'utf8'), file).traces)
  .filter((trace) => trace.size === 9);

const manifestOf = (trace: SolveTrace): RoundManifest => {
  const found = trace.events.filter((event) => !event.wrong);
  return {
    id: trace.id, size: trace.size,
    collections: found.map((event) => ({ color: event.color, amount: event.amount })),
    givenColors: found.filter((event) => event.source === 'given').map((event) => event.color),
  };
};

/** Plays one recorded puzzle against the wolf, checking invariants at every step. */
const play = (trace: SolveTrace): AdventureEvent[] => {
  const round = replayRound(trace)!;
  const commands: AdventureCommand[] = [
    { type: 'begin-encounter', encounter: WOLF },
    { type: 'begin-round', round: manifestOf(trace) },
    ...round.turns.map((turn): AdventureCommand => (turn.type === 'wrong'
      ? { type: 'turn' }
      : { type: 'turn', collect: { color: turn.color, amount: turn.amount }, source: turn.source as CollectSource })),
    { type: 'end-round', outcome: 'completed' },
  ];
  let state: AdventureState = startRun({ id: 'wanderer', health: 20, loadout: [DAGGER, SHIELD, STAFF, HERBS] });
  const log: AdventureEvent[] = [];
  for (const command of commands) {
    if (state.phase === 'ended') break;
    const { state: next, events } = step(state, command);
    expect(events[0].type).not.toBe('command-rejected');
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
    if (command.type === 'turn') {
      expect(events.filter((e) => e.type === 'turn-started')).toHaveLength(1);
      // Each pulse goes to exactly one place: an item, the scavenge rules, or the discard.
      const outlets = events.filter((e) => e.type === 'pulse-routed' || e.type === 'pulse-discarded').length;
      if (command.collect) expect(outlets === 1 || (outlets === 0 && events.some((e) => e.type === 'resource-changed'))).toBe(true);
      else expect(outlets).toBe(0);
    }
    expect(next.health).toBeLessThanOrEqual(next.maxHealth);
    state = next;
    log.push(...events);
  }
  return log;
};

describe('sandbox content', () => {
  it('uses only 9x9 colors and bands that start at 1', () => {
    for (const item of [DAGGER, SHIELD, STAFF, HERBS, SATCHEL]) {
      expect(item.colors.every((c) => c >= 0 && c < 9)).toBe(true);
      expect(item.bands[0].min).toBe(1);
    }
    for (const encounter of [WOLF, ROCKFALL]) {
      expect(encounter.type !== 'forage' && encounter.scavenge.every((rule) => rule.bands[0].min === 1)).toBe(true);
    }
  });

  it('replays every recorded 9x9 puzzle deterministically', () => {
    expect(traces.length).toBeGreaterThanOrEqual(44);
    for (const trace of traces.filter((t) => t.turnsKnown)) {
      expect(play(trace)).toEqual(play(trace));
    }
  });
});
