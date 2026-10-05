/* ========================================================= *\
 *  GameSession Unit Tests                                    *
\* ========================================================= */

import { describe, expect, it } from 'vitest';
import { generate, randomSettings } from '../src/engine';
import { GameSession } from '../src/state/gameSession';
import {
  HYPO_NONE, HYPO_STUMP, HYPO_X, MARK_OPEN, MARK_RED_X, MARK_STUMP, MARK_X,
} from '../src/state/types';

describe('GameSession', () => {
  // Generate a deterministic size 5 easy puzzle for tests
  const settings = randomSettings(Math.random, { size: 5, tier: 'easy', silver: false });
  const puzzle = generate(settings, 12345);

  it('initializes cleanly from a puzzle', () => {
    const session = new GameSession();
    session.initialize(puzzle);

    expect(session.puzzle.size).toBe(5);
    expect(session.acorns).toBe(3);
    expect(session.maxAcorns).toBe(3);
    expect(session.status).toBe('playing');
    expect(session.hypothesisMode).toBe(false);
    expect(session.undoStack.length).toBe(0);
    expect(session.normalMarks.length).toBe(25);
    expect(session.hypoMarks.length).toBe(25);
  });

  it('handles single tap marking and unmarking with undo', () => {
    const session = new GameSession();
    session.initialize(puzzle);

    // Find an open cell not given
    const openCell = session.normalMarks.findIndex((m) => m === MARK_OPEN);
    expect(openCell).toBeGreaterThanOrEqual(0);

    // Tap on open cell places X
    const res1 = session.handleTap(openCell);
    expect(res1?.modifiedCells).toContain(openCell);
    expect(session.normalMarks[openCell]).toBe(MARK_X);
    expect(session.undoStack.length).toBe(1);

    // Tap on X cell removes X
    const res2 = session.handleTap(openCell);
    expect(res2?.modifiedCells).toContain(openCell);
    expect(session.normalMarks[openCell]).toBe(MARK_OPEN);
    expect(session.undoStack.length).toBe(2);

    // Undo reverts back to X
    expect(session.undo()).toBe(true);
    expect(session.normalMarks[openCell]).toBe(MARK_X);

    // Undo reverts back to OPEN
    expect(session.undo()).toBe(true);
    expect(session.normalMarks[openCell]).toBe(MARK_OPEN);

    // Nothing left to undo
    expect(session.undo()).toBe(false);
  });

  it('handles dragging to mark and erase with single-step undo', () => {
    const session = new GameSession();
    session.initialize(puzzle);

    const cellsToMark = [0, 1, 2].filter((c) => session.normalMarks[c] === MARK_OPEN);
    expect(cellsToMark.length).toBeGreaterThan(0);

    // Drag to place X
    const dragRes = session.handleDrag(cellsToMark, 'PLACE_X');
    expect(dragRes?.modifiedCells).toEqual(cellsToMark);
    for (const c of cellsToMark) {
      expect(session.normalMarks[c]).toBe(MARK_X);
    }
    expect(session.undoStack.length).toBe(1);

    // Single undo reverts entire drag stroke
    expect(session.undo()).toBe(true);
    for (const c of cellsToMark) {
      expect(session.normalMarks[c]).toBe(MARK_OPEN);
    }
  });

  it('handles correct reveal and detects win', () => {
    const session = new GameSession();
    session.initialize(puzzle);

    // Reveal all unrevealed stumps from solution
    for (const stumpCell of puzzle.solution) {
      if (session.normalMarks[stumpCell] === MARK_STUMP) {
        continue;
      }
      const res = session.attemptReveal(stumpCell);
      expect(res?.correct).toBe(true);
      expect(session.normalMarks[stumpCell]).toBe(MARK_STUMP);
    }
    expect(session.status).toBe('won');
  });

  it('handles wrong reveal, acorn loss, conflict detection, and loss', () => {
    const session = new GameSession();
    session.initialize(puzzle);

    // Find an unrevealed stump and reveal it
    const correctStump = puzzle.solution.find((c) => session.normalMarks[c] === MARK_OPEN)!;
    session.attemptReveal(correctStump);

    // Now find a cell that does not have a stump, preferably in same row to test conflict
    const row = Math.floor(correctStump / puzzle.size);
    const sameRowNonStump = [0, 1, 2, 3, 4]
      .map((c) => row * puzzle.size + c)
      .find((c) => !puzzle.solution.includes(c));
    expect(sameRowNonStump).toBeDefined();

    const wrongRes = session.attemptReveal(sameRowNonStump!);
    expect(wrongRes?.correct).toBe(false);
    expect(wrongRes?.lost).toBe(false);
    expect(session.normalMarks[sameRowNonStump!]).toBe(MARK_RED_X);
    expect(session.acorns).toBe(2);
    // Should detect conflict with correctStump in same row!
    expect(wrongRes?.conflicts.some((conf) => conf.stump === correctStump && conf.rule === 'row')).toBe(true);

    // Two more wrong reveals should cause a loss
    const remainingNonStumps = Array.from({ length: 25 }, (_, i) => i)
      .filter((c) => !puzzle.solution.includes(c) && session.normalMarks[c] === MARK_OPEN);

    session.attemptReveal(remainingNonStumps[0]);
    expect(session.acorns).toBe(1);

    const finalRes = session.attemptReveal(remainingNonStumps[1]);
    expect(session.acorns).toBe(0);
    expect(finalRes?.lost).toBe(true);
    expect(session.status).toBe('lost');
  });

  it('supports hypothesis mode: tentative stumps, separate undo, discard, and keep', () => {
    const session = new GameSession();
    session.initialize(puzzle);

    session.setHypothesisMode(true);
    expect(session.hypothesisMode).toBe(true);

    // Tap places hypothesis X
    session.handleTap(5);
    expect(session.hypoMarks[5]).toBe(HYPO_X);
    expect(session.normalMarks[5]).toBe(MARK_OPEN); // Normal marks unchanged!
    expect(session.hypoUndoStack.length).toBe(1);

    // Double tap places tentative stump
    const hypoReveal = session.attemptReveal(6);
    expect(hypoReveal?.correct).toBe(true);
    expect(session.hypoMarks[6]).toBe(HYPO_STUMP);
    expect(session.normalMarks[6]).toBe(MARK_OPEN);

    // Hypothesis undo removes tentative stump
    expect(session.undo()).toBe(true);
    expect(session.hypoMarks[6]).toBe(HYPO_NONE);

    // Put tentative stump back
    session.attemptReveal(6);
    expect(session.hypoMarks[6]).toBe(HYPO_STUMP);

    // Discard clears all hypothesis marks
    session.discardHypothesis();
    expect(session.hypothesisMode).toBe(false);
    expect(session.hypoMarks[5]).toBe(HYPO_NONE);
    expect(session.hypoMarks[6]).toBe(HYPO_NONE);

    // Re-enable and test Keep
    session.setHypothesisMode(true);
    session.handleTap(7); // hypo X
    session.attemptReveal(8); // tentative stump
    expect(session.hypoMarks[7]).toBe(HYPO_X);
    expect(session.hypoMarks[8]).toBe(HYPO_STUMP);

    session.keepHypothesis();
    expect(session.hypothesisMode).toBe(false);
    // Hypo X converted to normal X
    expect(session.normalMarks[7]).toBe(MARK_X);
    // Tentative stump discarded
    expect(session.normalMarks[8]).toBe(MARK_OPEN);
    expect(session.hypoMarks[7]).toBe(HYPO_NONE);
    expect(session.hypoMarks[8]).toBe(HYPO_NONE);
  });

  it('executes hints correctly', () => {
    const session = new GameSession();
    session.initialize(puzzle);

    // 1. Woodpecker Hint
    const woodpeckerRevealed = session.useWoodpeckerHint();
    expect(woodpeckerRevealed).not.toBeNull();
    expect(session.normalMarks[woodpeckerRevealed!]).toBe(MARK_STUMP);
    expect(session.hintsUsed.woodpecker).toBe(true);

    // 2. Squirrel Hint
    const squirrelEliminated = session.useSquirrelHint();
    expect(squirrelEliminated.length).toBeGreaterThan(0);
    expect(squirrelEliminated.length).toBeLessThanOrEqual(3);
    for (const cell of squirrelEliminated) {
      expect(session.normalMarks[cell]).toBe(MARK_X);
      expect(puzzle.solution.includes(cell)).toBe(false);
    }
    expect(session.hintsUsed.squirrel).toBe(true);

    // 3. Owl Hint: test incorrect player X detection
    const unrevealedStump = puzzle.solution.find((c) => session.normalMarks[c] === MARK_OPEN);
    expect(unrevealedStump).toBeDefined();

    // Place an X on the stump deliberately
    session.handleTap(unrevealedStump!);
    expect(session.normalMarks[unrevealedStump!]).toBe(MARK_X);

    // Owl should detect it
    const incorrect = session.findIncorrectPlayerX();
    expect(incorrect).toBe(unrevealedStump);

    // Remove it
    session.removeIncorrectPlayerX(incorrect!);
    expect(session.normalMarks[unrevealedStump!]).toBe(MARK_OPEN);
    expect(session.hintsUsed.owl).toBe(true);
  });

  it('serializes and deserializes cleanly', () => {
    const session1 = new GameSession();
    session1.initialize(puzzle);
    session1.handleTap(0);
    session1.updateElapsedTime(15000);

    const saved = session1.toSavedState();
    expect(saved.elapsedTimeMs).toBe(15000);

    const session2 = new GameSession();
    session2.initialize(puzzle, { savedState: saved });
    expect(session2.elapsedTimeMs).toBe(15000);
    expect(session2.normalMarks[0]).toBe(MARK_X);
  });
});
