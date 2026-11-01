import { encodeSeedCode, type Puzzle } from './engine';
import { parseBoard } from './engine/testBoards';
import { applyExplanation, beginStroke, doubleTap, enterHypothesis, explain, leaveHypothesis, newGame, woodpecker } from './game';
import { newSave, parseSave } from './save';
import { parseSolves, type Solve, solveOf, solvesCsv } from './solves';

const PUZZLE: Puzzle = {
  ...parseBoard(`
    CAABB
    CBBBB
    CCCCC
    CCCDD
    CCEDD
  `),
  solution: [1, 8, 10, 19, 22], givens: [19], colors: [4, 3, 2, 1, 0], tier: 'easy', silver: false,
  code: encodeSeedCode({ size: 5, tier: 'easy', silver: false, sizeMix: 1, shape: 1, freebies: 1 }, 4),
};

const tap = (game: ReturnType<typeof newGame>, cell: number): void => {
  doubleTap(game, cell, beginStroke(game, cell) !== null);
};

describe('solve log', () => {
  beforeEach(() => vi.stubEnv('VITE_COLLECT_SOLVE_DATA', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  it('keeps the order, color, patch size, time, and source of every stump', () => {
    const game = newGame(PUZZLE, false, 'play');
    expect(game.found).toEqual([{ cell: 19, time: 0, by: 'given' }]);
    game.elapsed = 3000;
    tap(game, 22);
    game.elapsed = 5000;
    woodpecker(game);
    expect(game.found?.map((found) => found.by)).toEqual(['given', 'player', 'woodpecker']);
    while (game.status === 'playing') {
      const explanation = explain(game);
      game.hints = game.hints.filter((hint) => hint !== 'owl');
      expect(explanation).not.toBeNull();
      applyExplanation(game);
    }
    expect(game.found).toHaveLength(5);
    expect(new Set(game.found?.map((found) => found.cell))).toEqual(new Set(PUZZLE.solution));
    const solve = solveOf(game, 0, 'vallarta')!;
    expect(solve.stumps.slice(0, 3)).toEqual([
      { row: 3, col: 4, color: 1, patch: 4, time: 0, by: 'given' },
      { row: 4, col: 2, color: 0, patch: 1, time: 3000, by: 'player' },
      expect.objectContaining({ time: 5000, by: 'woodpecker' }),
    ]);
    expect(parseSolves(JSON.stringify([solve]))).toEqual([solve]);
    expect(parseSave(JSON.stringify({ ...newSave(), game }))?.game?.found).toEqual(game.found);
  });

  it('rejects a found list that does not match the board', () => {
    const game = newGame(PUZZLE, false, 'play');
    const bad = { ...game, found: [{ cell: 0, time: 0, by: 'player' }] };
    expect(parseSave(JSON.stringify({ ...newSave(), game: bad }))).toBeNull();
    const older = { ...game, found: undefined };
    expect(parseSave(JSON.stringify({ ...newSave(), game: older }))?.game?.found).toBeUndefined();
  });

  it('keeps wrong reveals in order beside the stumps', () => {
    const game = newGame(PUZZLE, false, 'play');
    game.elapsed = 2000;
    tap(game, 0);
    game.elapsed = 3000;
    tap(game, 22);
    game.elapsed = 4000;
    tap(game, 2);
    expect(game.acornsLost).toBe(2);
    expect(game.misses).toEqual([{ cell: 0, time: 2000, after: 1 }, { cell: 2, time: 4000, after: 2 }]);
    const saved = parseSave(JSON.stringify({ ...newSave(), game }))?.game;
    expect(saved?.misses).toEqual(game.misses);
    expect(parseSave(JSON.stringify({ ...newSave(), game: { ...game, misses: [{ cell: 1, time: 0, after: 0 }] } }))).toBeNull();
    for (const cell of [1, 8, 10]) {
      tap(game, cell);
    }
    const solve = solveOf(game, 0, 'woods')!;
    expect(solve.misses).toEqual([
      { row: 0, col: 0, color: 2, patch: 12, time: 2000, after: 1 },
      { row: 0, col: 2, color: 4, patch: 2, time: 4000, after: 2 },
    ]);
    expect(parseSolves(JSON.stringify([solve]))).toEqual([solve]);
    expect(solvesCsv([solve]).split('\n').map((row) => row.split(',').slice(-4, -2).join(' '))).toEqual([
      'found_by wrong', 'given false', 'player true', 'player false', 'player true', 'player false', 'player false',
      'player false',
    ]);
    expect(solveOf({ ...game, misses: game.misses?.slice(1) }, 0, 'woods')?.misses).toBeUndefined();
  });

  it('formats one CSV row per stump', () => {
    const solve: Solve = {
      id: 'a', date: Date.UTC(2026, 9, 29), code: 'CODE', size: 5, tier: 'hard', silver: false, repeat: false,
      theme: 'woods', time: 61234, hints: ['owl', 'squirrel'], acornsLost: 1,
      stumps: [
        { row: 0, col: 1, color: 2, patch: 6, time: 1500, by: 'player' },
        { row: 1, col: 3, color: 0, patch: 3, time: 61234, by: 'owl' },
      ],
      misses: [{ row: 2, col: 2, color: 1, patch: 4, time: 30000, after: 1 }],
      whatIfs: [12000, 45500], adventure: true,
    };
    expect(solvesCsv([solve]).split('\n')).toEqual([
      'solve,date,size,difficulty,silver,repeat,theme,hints,acorns_lost,total_seconds,code,order,row,col,color,patch_size,found_seconds,found_by,wrong,mode,what_if_seconds',
      'a,2026-10-29T00:00:00.000Z,5,hard,false,false,woods,owl squirrel,1,61.2,CODE,1,1,2,3,6,1.5,player,false,adventure,12.0 45.5',
      'a,2026-10-29T00:00:00.000Z,5,hard,false,false,woods,owl squirrel,1,61.2,CODE,2,3,3,2,4,30.0,player,true,adventure,12.0 45.5',
      'a,2026-10-29T00:00:00.000Z,5,hard,false,false,woods,owl squirrel,1,61.2,CODE,3,2,4,1,3,61.2,owl,false,adventure,12.0 45.5',
    ]);
  });

  it('records when What if? mode was turned on', () => {
    const game = newGame(PUZZLE, false, 'play');
    game.elapsed = 5000;
    enterHypothesis(game);
    leaveHypothesis(game, false);
    expect(game.whatIfs).toEqual([5000]);
    for (const cell of [22, 1, 8, 10]) {
      tap(game, cell);
    }
    const solve = solveOf(game, 0, 'woods', true)!;
    expect([solve.whatIfs, solve.adventure]).toEqual([[5000], true]);
    expect(parseSolves(JSON.stringify([solve]))).toEqual([solve]);
  });

  it('reads nothing from a malformed log', () => {
    expect(parseSolves('{')).toBeNull();
    expect(parseSolves('[{"id": 1}]')).toBeNull();
  });
});
