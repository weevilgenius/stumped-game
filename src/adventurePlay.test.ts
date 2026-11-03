import { describe, expect, it } from 'vitest';
import { STARTERS } from './adventure/content/campaign';
import { advance, choices } from './adventure/campaign';
import type { AdventureState } from './adventure/engine';
import { generate } from './engine';
import { beginStroke, doubleTap, type Game, newGame, woodpecker } from './game';
import { type AdventureSave, beginRound, command, needsPuzzle, newAdventure, parseAdventure, sync, turnsOf } from './adventurePlay';

/** A new run moved onto its first fight. */
const atFight = (starter = 'knight'): AdventureSave => {
  const save = newAdventure(starter, 5);
  command(save, { type: 'move', node: choices(save.state)[0] }, 0);
  return save;
};

const BOARD = generate({ size: 9, tier: 'medium', silver: false, sizeMix: 1, shape: 1, freebies: 0 }, 7);
/** The board with one given stump. */
const PUZZLE = { ...BOARD, givens: [BOARD.solution[4]] };

const tap = (game: Game, cell: number): void => void doubleTap(game, cell, beginStroke(game, cell) !== null);
const wrongCell = (game: Game): number => game.marks.findIndex((mark, cell) => mark === 0 && !game.puzzle.solution.includes(cell));
const open = (game: Game): number[] => game.puzzle.solution.filter((cell) => game.marks[cell] !== 3);

describe('turnsOf', () => {
  it('records reveals in order with their source, skipping givens and placing wrong reveals among them', () => {
    const game = newGame(PUZZLE, false, 'play', true);
    tap(game, wrongCell(game));
    const [first] = open(game);
    tap(game, first);
    woodpecker(game);
    tap(game, wrongCell(game));
    const turns = turnsOf(game);
    const region = PUZZLE.regions[first];
    expect(turns).toEqual([
      { type: 'turn' },
      {
        type: 'turn', source: 'player',
        collect: { color: PUZZLE.colors[region], amount: PUZZLE.regions.filter((r) => r === region).length },
      },
      expect.objectContaining({ type: 'turn', source: 'woodpecker' }),
      { type: 'turn' },
    ]);
  });

  it('makes no turns for X marks', () => {
    const game = newGame(PUZZLE, false, 'play', true);
    beginStroke(game, wrongCell(game));
    expect(turnsOf(game)).toEqual([]);
  });
});

describe('sync', () => {
  it('plays each reveal once, ends the round on a win, and the log replays the run exactly', () => {
    const save = atFight();
    const game = newGame(PUZZLE, false, 'play', true);
    beginRound(save, game, 1);
    tap(game, open(game)[0]);
    sync(save, 2);
    sync(save, 3);
    expect(save.state.round?.turn).toBe(1);
    command(save, { type: 'set-ready', slot: 0, ready: false }, 4);
    for (const cell of open(game)) {
      tap(game, cell);
    }
    sync(save, 5);
    expect(game.status).toBe('won');
    expect(save.played).toBe(PUZZLE.size - PUZZLE.givens.length);
    expect(['between', 'ended']).toContain(save.state.phase);
    const replayed = save.log.reduce((state: AdventureState, next) => advance(state, next).state, save.start);
    expect(replayed).toEqual(save.state);
    expect(save.log.filter((logged) => logged.type === 'turn')).toHaveLength(save.played);
    expect([save.times?.length, save.times?.slice(0, 5)]).toEqual([save.log.length, [0, 1, 2, 4, 5]]);
    expect(save.puzzles).toEqual([expect.objectContaining({ id: game.id, app: '', content: 1, code: PUZZLE.code, status: 'won' })]);
  });

  it('does not log rejected commands', () => {
    const save = atFight();
    expect(command(save, { type: 'set-ready', slot: 9, ready: false }, 1)[0].type).toBe('command-rejected');
    expect(save.log).toHaveLength(1);
  });
});

describe('parseAdventure', () => {
  it('reads its own format, treats null as no adventure, and rejects anything else', () => {
    const save = atFight();
    expect(parseAdventure(JSON.stringify(save))).toEqual(save);
    expect(parseAdventure('null')).toBeNull();
    expect(parseAdventure('not json')).toBeUndefined();
    expect(parseAdventure(JSON.stringify({ ...save, version: 2 }))).toBeUndefined();
  });
});

describe('starters', () => {
  it.each(STARTERS)('starts $id on a seeded map and replays after saving', (starter) => {
    const save = atFight(starter.id);
    expect(save.loadout).toEqual({ id: starter.id, health: starter.health, loadout: starter.loadout });
    expect(save.state.slots.map((slot) => slot.item)).toEqual(starter.loadout);
    expect(needsPuzzle(save.start)).toBe(false);
    expect(needsPuzzle(save.state)).toBe(true);
    const game = newGame(PUZZLE, false, 'play', true);
    beginRound(save, game, 1);
    tap(game, open(game)[0]);
    sync(save, 2);
    const restored = parseAdventure(JSON.stringify(save))!;
    expect(restored.log.reduce((state, next) => advance(state, next).state, restored.start)).toEqual(restored.state);
  });

  it('rejects an unknown starter', () => {
    expect(() => newAdventure('missing', 1)).toThrow('Unknown adventure character');
  });
});
