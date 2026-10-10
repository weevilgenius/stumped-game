import { encodeSeedCode, generate, type Step } from './engine';
import { applyExplanation, beginStroke, doubleTap, enterHypothesis, explain, newGame, resultOf } from './game';
import { LEGACY_KEYS, migrateSave, newSave, parseSave, type Save } from './save';

const SETTINGS = { size: 5, tier: 'easy', silver: false, sizeMix: 1, shape: 1, freebies: 1 } as const;
const PUZZLE = generate(SETTINGS, 4);
const fresh = (): Save => ({ ...newSave(), game: newGame(structuredClone(PUZZLE), false, 'current'), played: [PUZZLE.code], open: true });
const read = (value: unknown): Save | null => parseSave(JSON.stringify(value));
const legacy = (value: Save): Record<typeof LEGACY_KEYS[number], string | null> => Object.fromEntries(
  LEGACY_KEYS.map((key) => [key, JSON.stringify(value[key])]),
) as Record<typeof LEGACY_KEYS[number], string | null>;
let nextId = 0;
const createId = (): string => `migrated-${++nextId}`;

const won = (): Save => {
  const save = fresh();
  const game = save.game!;
  for (const cell of game.puzzle.solution) {
    doubleTap(game, cell, false);
  }
  game.elapsed = 1234;
  return save;
};

describe('save round trips', () => {
  it('restores defaults, preferences, and a marked active game with history', () => {
    expect(read(newSave())).toEqual(newSave());
    const save = fresh();
    const { silver: _silver, ...fixed } = SETTINGS;
    save.settings = { ...fixed, timer: false, silver: true };
    beginStroke(save.game!, 0);
    expect(read(save)).toEqual(save);
  });

  it('restores hypothesis marks and their independent undo history', () => {
    const save = fresh();
    enterHypothesis(save.game!);
    doubleTap(save.game!, 0, false);
    beginStroke(save.game!, 2);
    expect(read(save)).toEqual(save);
  });

  it('restores wins with and without a recorded completion, and losses', () => {
    const save = won();
    expect(read(save)).toEqual(save);
    save.results.push(resultOf(save.game!, 1000));
    expect(read(save)).toEqual(save);
    const lost = fresh();
    for (const cell of PUZZLE.regions.flatMap((_, cell) => PUZZLE.solution.includes(cell) ? [] : [cell]).slice(0, 3)) {
      doubleTap(lost.game!, cell, false);
    }
    expect(lost.game?.status).toBe('lost');
    expect(read(lost)).toEqual(lost);
  });

  it('restores a wrong-X explanation and safely applies it after reload', () => {
    const save = fresh();
    const cell = PUZZLE.solution.find((c) => !PUZZLE.givens.includes(c))!;
    beginStroke(save.game!, cell);
    explain(save.game!);
    const restored = read(save)!;
    expect(restored).toEqual(save);
    applyExplanation(restored.game!);
    expect(restored.game?.marks[cell]).toBe(0);
    expect(read(restored)).toEqual(restored);
  });

  it('accepts a puzzle whose rated tier differs from its requested tier', () => {
    const save = fresh();
    save.game!.puzzle = { ...PUZZLE, tier: 'hard' };
    expect(read(save)).toEqual(save);
  });

  it('validates every step variant and nested chain steps', () => {
    const cell = PUZZLE.regions.findIndex((_, c) => !PUZZLE.solution.includes(c));
    const unit = { kind: 'row', index: 0 } as const;
    const steps: Step[] = [
      { type: 'elimination', stump: PUZZLE.solution[0], eliminated: [cell] },
      { type: 'forced', unit, place: PUZZLE.solution.find((c) => !PUZZLE.givens.includes(c))!, eliminated: [] },
      { type: 'confinement', k: 1, axis: 'col', reverse: false, regions: [0], lines: [0], eliminated: [cell] },
      { type: 'blocking', cell, unit, eliminated: [cell] },
      { type: 'chain', cell, unit, eliminated: [cell], steps: [{ type: 'elimination', stump: cell, eliminated: [1] }] },
    ];
    for (const step of steps) {
      const save = fresh();
      save.game!.hints = ['owl'];
      save.game!.explaining = { type: 'step', step };
      expect(read(save)).toEqual(save);
    }
  });
});

describe('invalid saves', () => {
  it.each(['{', 'null', '[]', '{}', '{"version":2}'])('rejects malformed or unsupported input: %s', (raw) => {
    expect(parseSave(raw)).toBeNull();
  });

  it.each([
    ['settings', { timer: 'yes', silver: false }],
    ['settings', { timer: true, silver: false, size: 11 }],
    ['settings', { timer: true, silver: false, tier: 'expert' }],
    ['settings', { timer: true, silver: false, freebies: -1 }],
    ['played', ['not-a-code']],
    ['results', [{}]],
    ['open', 1],
  ])('rejects invalid %s', (key, value) => {
    expect(read({ ...fresh(), [key]: value })).toBeNull();
  });

  it.each([
    { id: '' }, { marks: [] }, { marks: Array<number>(25).fill(4) },
    { hypo: [] }, { hypoUndo: [[[0, 2]]] }, { undo: [[[25, 0]]] }, { undo: [[[0, 3]]] },
    { elapsed: -1 }, { acorns: 4 }, { acornsLost: 1 }, { hints: ['cat'] }, { hints: ['owl', 'owl'] },
    { status: 'won' }, { status: 'lost' }, { explaining: {} },
  ])('rejects invalid game fields %j', (fields) => {
    const save = fresh();
    Object.assign(save.game!, fields);
    expect(read(save)).toBeNull();
  });

  it.each([
    { size: 0 }, { code: 'TEST' }, { regions: [] }, { colors: [0, 0, 0, 0, 0] },
    { solution: [0, 0, 0, 0, 0] }, { solution: [25, 26, 27, 28, 29] }, { givens: [25] },
    { silver: true },
  ])('rejects invalid puzzle fields %j', (fields) => {
    const save = fresh();
    Object.assign(save.game!.puzzle, fields);
    expect(read(save)).toBeNull();
  });

  it('rejects undo entries that could resurrect marks over a permanent reveal', () => {
    const save = fresh();
    const cell = PUZZLE.solution.find((c) => !PUZZLE.givens.includes(c))!;
    doubleTap(save.game!, cell, false);
    save.game!.undo = [[[cell, 1]]];
    expect(read(save)).toBeNull();
  });

  it('rejects malformed nested steps and excessively deep chains', () => {
    const save = fresh();
    save.game!.hints = ['owl'];
    const step = { type: 'chain', cell: 0, unit: { kind: 'row', index: 0 }, eliminated: [0], steps: [{}] };
    save.game!.explaining = { type: 'step', step: step as Step };
    expect(read(save)).toBeNull();
    let nested: Step = { type: 'elimination', stump: 0, eliminated: [] };
    for (let depth = 0; depth < 12; depth++) {
      nested = { type: 'chain', cell: 0, unit: { kind: 'row', index: 0 }, eliminated: [0], steps: [nested] };
    }
    save.game!.explaining = { type: 'step', step: nested };
    expect(read(save)).toBeNull();
  });

  it('rejects inconsistent or duplicate result IDs and invalid result fields', () => {
    const save = won();
    const result = resultOf(save.game!, 1000);
    for (const fields of [{ id: '' }, { time: -1 }, { date: -1 }, { hints: ['owl', 'owl'] }, { acornsLost: 3 }, { code: 'TEST' }]) {
      expect(read({ ...save, results: [{ ...result, ...fields }] })).toBeNull();
    }
    expect(read({ ...save, results: [result, result] })).toBeNull();
    expect(read({ ...save, results: [{ ...result, time: result.time + 1 }] })).toBeNull();
  });
});

describe('legacy migration', () => {
  it('defaults absent sections and assigns IDs to an active play', () => {
    const raw = legacy(fresh());
    raw.settings = null;
    raw.results = null;
    const game = JSON.parse(raw.game!) as Record<string, unknown>;
    delete game.id;
    raw.game = JSON.stringify(game);
    const migrated = migrateSave(raw, createId)!;
    expect(migrated.game?.id).toMatch(/^migrated-/);
    expect(migrated.settings).toEqual(newSave().settings);
    expect(read(migrated)).toEqual(migrated);
  });

  it('uses the latest matching result ID without dropping earlier repeats', () => {
    const save = won();
    save.results = [resultOf(save.game!, 100), resultOf(save.game!, 200)];
    const migrated = migrateSave(legacy(save), createId)!;
    expect(migrated.results).toHaveLength(2);
    expect(migrated.game?.id).toBe(migrated.results[1].id);
    expect(migrated.results[0].id).not.toBe(migrated.results[1].id);
    expect(read(migrated)).toEqual(migrated);
  });

  it('retains a won game with no matching result for controller reconciliation', () => {
    const migrated = migrateSave(legacy(won()), createId)!;
    expect(migrated.game?.status).toBe('won');
    expect(migrated.results).toEqual([]);
  });

  it.each(LEGACY_KEYS)('rejects the whole migration if %s is malformed', (key) => {
    const raw = legacy(fresh());
    raw[key] = '{';
    expect(migrateSave(raw, createId)).toBeNull();
  });

  it('rejects unsupported version-2 puzzle codes', () => {
    const raw = legacy(fresh());
    raw.played = JSON.stringify(['20580000027']);
    expect(migrateSave(raw, createId)).toBeNull();
    expect(encodeSeedCode(SETTINGS, 4)).toBe(PUZZLE.code);
  });
});
