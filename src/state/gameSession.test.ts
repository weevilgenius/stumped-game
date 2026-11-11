import { generate, type GeneratorSettings } from '../engine';
import { parseBoard } from '../engine/testBoards';
import { DOUBLE_TAP_MS, GameSession } from './gameSession';
import { HYP_NONE, HYP_STUMP, HYP_X, MARK_OPEN, MARK_RED_X, MARK_STUMP, MARK_X } from './types';

const SETTINGS: GeneratorSettings = {
  size: 5,
  tier: 'easy',
  silver: false,
  sizeMix: 0,
  shape: 0,
  freebies: 0,
};

const makePuzzle = () => generate(SETTINGS, 101);

describe('GameSession', () => {
  it('initializes marks, givens, and acorns according to puzzle mode', () => {
    const puzzle = makePuzzle();
    const session = GameSession.fromPuzzle(puzzle);
    expect(session.getStatus()).toBe('in_progress');
    expect(session.getAcorns()).toBe(3);
    expect(session.getMaxAcorns()).toBe(3);

    const silverSession = GameSession.fromPuzzle({ ...puzzle, silver: true });
    expect(silverSession.getAcorns()).toBe(1);
    expect(silverSession.getMaxAcorns()).toBe(1);
  });

  it('toggles X immediately on single tap and supports drag strokes and undo', () => {
    const puzzle = makePuzzle();
    const session = GameSession.fromPuzzle(puzzle);

    // Tap unmarked cell 0 -> places X immediately on pointerDown
    const down = session.pointerDown(0, 1000);
    expect(down.kind).toBe('tap-or-drag');
    expect(session.getNormalMarks()[0]).toBe(MARK_X);
    session.pointerUp();
    expect(session.canUndo()).toBe(true);

    // Drag across cells 1, 2, 3 -> places X on all three as one undo step
    session.pointerDown(1, 2000);
    session.pointerMove(2);
    session.pointerMove(3);
    session.pointerUp();
    expect(session.getNormalMarks().slice(0, 4)).toEqual([MARK_X, MARK_X, MARK_X, MARK_X]);

    // Undo once reverts the drag stroke (1, 2, 3) but leaves cell 0
    expect(session.undo().sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(session.getNormalMarks().slice(0, 4)).toEqual([MARK_X, MARK_OPEN, MARK_OPEN, MARK_OPEN]);

    // Tap cell 0 again (after double-tap window) -> removes the X
    session.pointerDown(0, 3000);
    session.pointerUp();
    expect(session.getNormalMarks()[0]).toBe(MARK_OPEN);
  });

  it('erases X across every X cell crossed when drag starts on an X', () => {
    const puzzle = makePuzzle();
    const session = GameSession.fromPuzzle(puzzle);

    session.pointerDown(0, 1000);
    session.pointerMove(1);
    session.pointerMove(2);
    session.pointerUp();

    // Drag starting on X at cell 0 across 1 and unmarked 3
    session.pointerDown(0, 2000);
    session.pointerMove(1);
    session.pointerMove(3);
    session.pointerUp();
    expect(session.getNormalMarks().slice(0, 4)).toEqual([MARK_OPEN, MARK_OPEN, MARK_X, MARK_OPEN]);
  });

  it('double tap reveals a stump without leaving a stray single-tap undo step', () => {
    const puzzle = makePuzzle();
    const session = GameSession.fromPuzzle(puzzle);
    const stumpCell = puzzle.solution[0];

    // First tap places X immediately
    session.pointerDown(stumpCell, 1000);
    session.pointerUp();
    expect(session.getNormalMarks()[stumpCell]).toBe(MARK_X);

    // Second tap within DOUBLE_TAP_MS reveals the stump and cleans up the single-tap undo
    const second = session.pointerDown(stumpCell, 1000 + DOUBLE_TAP_MS - 50);
    session.pointerUp();
    expect(second.kind).toBe('double-tap');
    expect(second.reveal?.outcome).toBe('correct');
    expect(session.getNormalMarks()[stumpCell]).toBe(MARK_STUMP);
    expect(session.canUndo()).toBe(false);
  });

  it('wrong reveal places a permanent red X, costs an acorn, and reports conflicts against revealed stumps', () => {
    const puzzle = makePuzzle();
    const session = GameSession.fromPuzzle(puzzle);
    const row0Stump = puzzle.solution[0];
    const row0Wrong = row0Stump === 0 ? 1 : 0;

    // Reveal the valid stump in row 0 first
    session.revealCell(row0Stump);

    // Wrong reveal in the same row
    const result = session.revealCell(row0Wrong);
    expect(result.outcome).toBe('wrong');
    expect(result.conflicts.some((c) => c.stump === row0Stump && c.rule === 'row')).toBe(true);
    expect(session.getNormalMarks()[row0Wrong]).toBe(MARK_RED_X);
    expect(session.getAcorns()).toBe(2);
    expect(session.getAcornsLost()).toBe(1);

    // Drags and taps never change revealed stumps or red X's
    session.pointerDown(row0Wrong, 5000);
    session.pointerUp();
    expect(session.getNormalMarks()[row0Wrong]).toBe(MARK_RED_X);
  });

  it('pulses a unit once when all other squares in a revealed stump unit are marked', () => {
    const puzzle = makePuzzle();
    const session = GameSession.fromPuzzle(puzzle);
    const col0Stump = puzzle.solution.find((c) => c % puzzle.size === 0)!;
    session.revealCell(col0Stump);

    const otherCol0 = [0, 5, 10, 15, 20].filter((c) => c !== col0Stump);
    let lastRes = { pulsedCells: [] as readonly number[] };
    for (let i = 0; i < otherCol0.length; i++) {
      lastRes = session.pointerDown(otherCol0[i], 1000 + i * 500);
      session.pointerUp();
    }
    expect(lastRes.pulsedCells).toEqual(expect.arrayContaining(otherCol0));
  });

  it('detects winning and Perfectly Marked status', () => {
    const puzzle = makePuzzle();
    const session = GameSession.fromPuzzle(puzzle);

    // Mark every non-stump square with an X
    for (let c = 0; c < puzzle.size * puzzle.size; c++) {
      if (!puzzle.solution.includes(c)) {
        session.pointerDown(c, 1000 + c * 500);
        session.pointerUp();
      }
    }
    // Reveal all stumps
    for (let r = 0; r < puzzle.size; r++) {
      const res = session.revealCell(puzzle.solution[r]);
      if (r === puzzle.size - 1) {
        expect(res.won).toBe(true);
        expect(res.perfectlyMarked).toBe(true);
      }
    }
    expect(session.getStatus()).toBe('won');
    expect(session.isPerfectlyMarked()).toBe(true);
  });

  it('supports hypothesis mode with separate undo, conflict flagging, Discard, and Keep', () => {
    const puzzle = makePuzzle();
    const session = GameSession.fromPuzzle(puzzle);

    // Place a normal X on cell 0
    session.pointerDown(0, 1000);
    session.pointerUp();

    session.enterHypothesis();
    expect(session.isHypothesisMode()).toBe(true);
    expect(session.canUndo()).toBe(false);

    // Normal X at cell 0 cannot be changed in hypothesis mode
    session.pointerDown(0, 2000);
    session.pointerUp();
    expect(session.getNormalMarks()[0]).toBe(MARK_X);
    expect(session.getHypothesisMarks()[0]).toBe(HYP_NONE);

    // Place hypothesis X on cell 1
    session.pointerDown(1, 3000);
    session.pointerUp();
    expect(session.getHypothesisMarks()[1]).toBe(HYP_X);

    // Double-tap cell 2 and cell 3 (same row) to place two conflicting tentative stumps
    session.pointerDown(2, 4000);
    session.pointerUp();
    session.pointerDown(2, 4100);
    session.pointerUp();

    session.pointerDown(3, 5000);
    session.pointerUp();
    session.pointerDown(3, 5100);
    session.pointerUp();

    expect(session.getHypothesisMarks()[2]).toBe(HYP_STUMP);
    expect(session.getHypothesisMarks()[3]).toBe(HYP_STUMP);
    const flagged = session.getFlaggedTentativeStumps();
    expect(flagged.has(2)).toBe(true);
    expect(flagged.has(3)).toBe(true);

    // Single tap on tentative stump at cell 3 removes it
    session.pointerDown(3, 6000);
    session.pointerUp();
    expect(session.getHypothesisMarks()[3]).toBe(HYP_NONE);
    expect(session.getFlaggedTentativeStumps().size).toBe(0);

    // Keep converts hypothesis X (cell 1) to normal X and removes tentative stump (cell 2)
    const { keptCells } = session.keepHypothesis();
    expect(keptCells).toEqual([1]);
    expect(session.isHypothesisMode()).toBe(false);
    expect(session.getNormalMarks()[1]).toBe(MARK_X);
    expect(session.getHypothesisMarks()[2]).toBe(HYP_NONE);

    // Enter hypothesis again and Discard
    session.enterHypothesis();
    session.pointerDown(4, 7000);
    session.pointerUp();
    expect(session.getHypothesisMarks()[4]).toBe(HYP_X);
    session.discardHypothesis();
    expect(session.getHypothesisMarks()[4]).toBe(HYP_NONE);
    expect(session.getNormalMarks()[4]).toBe(MARK_OPEN);
  });

  it('implements Reveal (Woodpecker), Explain (Owl), and Eliminate (Squirrel) hints', () => {
    const puzzle = makePuzzle();
    const session = GameSession.fromPuzzle(puzzle);

    // Squirrel (Eliminate) marks 3 random non-stump squares
    const elim = session.useEliminateHint(() => 0);
    expect(elim?.eliminatedCells).toHaveLength(3);
    for (const c of elim?.eliminatedCells ?? []) {
      expect(puzzle.solution).not.toContain(c);
      expect(session.getNormalMarks()[c]).toBe(MARK_X);
    }

    // Woodpecker (Reveal) reveals the stump in the region with fewest open squares
    const rev = session.useRevealHint();
    expect(rev?.outcome).toBe('correct');
    expect(puzzle.solution).toContain(rev?.cell);

    // Place a wrong X on an unrevealed stump square; Owl (Explain) points it out first and removes it
    const unrevealedStump = puzzle.solution.find((c) => session.getNormalMarks()[c] === MARK_OPEN)!;
    session.pointerDown(unrevealedStump, 9000);
    session.pointerUp();
    expect(session.getNormalMarks()[unrevealedStump]).toBe(MARK_X);

    const exp = session.startExplainHint();
    expect(exp?.type).toBe('wrong-x');
    const applied = session.applyExplainHint();
    expect(applied.changedCells).toEqual([unrevealedStump]);
    expect(session.getNormalMarks()[unrevealedStump]).toBe(MARK_OPEN);
  });

  it('supports stepping backward and forward through a chain explanation', () => {
    const board = parseBoard(`
      CAABB
      CBBBB
      CCCCC
      CCCDD
      CCEDD
    `);
    const puzzle = {
      ...board,
      solution: [1, 8, 10, 19, 22],
      givens: [22],
      colors: [0, 1, 2, 3, 4],
      tier: 'easy' as const,
      silver: false,
      code: '1000000000Z',
    };
    const session = GameSession.fromPuzzle(puzzle);
    const exp = session.startExplainHint();
    expect(exp?.type).toBe('deduction');
    const applied = session.applyExplainHint();
    expect(applied.changedCells.length).toBeGreaterThan(0);
  });
});
