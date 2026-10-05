import { EXCLUDED, generate, OPEN, STUMP } from '../engine';
import { bestTimes, closeExplanation, createPlay, explanationPages, markCells, newSave, parseSave, recordWin, reveal, setHypothesis, tentativeConflicts, undo, useHint, WRONG } from './state';
import { crossedCells } from './gestures';

const puzzle = generate({ size: 5, tier: 'easy', silver: false, sizeMix: 1, shape: 1, freebies: 0 }, 42);
const blank = (): ReturnType<typeof createPlay> => createPlay(puzzle, false);
const emptyCells = puzzle.regions.flatMap((_, cell) => puzzle.solution.includes(cell) ? [] : [cell]);

describe('puzzle play', () => {
  it('groups a whole stroke, never revisits a square, and undoes independently of permanent reveals', () => {
    const p = blank();
    const stroke = markCells(p, [emptyCells[0]], EXCLUDED);
    markCells(p, [emptyCells[0], emptyCells[1], puzzle.solution[0]], EXCLUDED, stroke);
    expect(p.undo).toHaveLength(1);
    reveal(p, puzzle.solution[0]);
    undo(p);
    expect(p.marks[emptyCells[0]]).toBe(OPEN);
    expect(p.marks[emptyCells[1]]).toBe(OPEN);
    expect(p.marks[puzzle.solution[0]]).toBe(STUMP);
  });
  it('keeps wrong reveals and lost lives permanent, and loses on the last acorn', () => {
    const p = blank();
    markCells(p, emptyCells.slice(0, 4), EXCLUDED);
    emptyCells.slice(0, 3).forEach((cell) => reveal(p, cell));
    expect(p.lives).toBe(0);
    expect(p.status).toBe('lost');
    expect(p.marks[emptyCells[0]]).toBe(WRONG);
    const before = [...p.marks];
    markCells(p, emptyCells, OPEN); undo(p); reveal(p, puzzle.solution[0]);
    expect(p.marks).toEqual(before);
  });
  it('does not validate normal Xs or place automatic Xs', () => {
    const p = blank();
    markCells(p, [puzzle.solution[0]], EXCLUDED);
    expect(p.lives).toBe(3);
    reveal(p, puzzle.solution[0]);
    expect(p.marks.filter((m) => m !== OPEN)).toEqual([STUMP]);
  });
  it('uses a separate scratch history and only keeps hypothesis Xs', () => {
    const p = blank();
    markCells(p, [emptyCells[0]], EXCLUDED);
    setHypothesis(p, 'start');
    reveal(p, emptyCells[1]);
    expect(p.lives).toBe(3);
    expect(p.pencil[emptyCells[1]]).toBe(STUMP);
    markCells(p, [emptyCells[2]], EXCLUDED);
    undo(p);
    expect(p.pencil[emptyCells[1]]).toBe(STUMP);
    expect(p.marks[emptyCells[0]]).toBe(EXCLUDED);
    markCells(p, [emptyCells[3]], EXCLUDED);
    setHypothesis(p, 'keep');
    undo(p);
    expect(p.marks[emptyCells[0]]).toBe(OPEN);
    expect(p.marks[emptyCells[3]]).toBe(EXCLUDED);
    expect(p.pencil.every((mark) => mark === OPEN)).toBe(true);
    expect(p.pencilUndo).toHaveLength(0);
    expect(p.marks[emptyCells[1]]).toBe(OPEN);
  });
  it('flags tentative rule conflicts and discards without affecting normal history', () => {
    const p = blank();
    reveal(p, puzzle.solution[0]);
    setHypothesis(p, 'start');
    const cell = puzzle.solution[0] === 0 ? 1 : 0;
    reveal(p, cell);
    expect(tentativeConflicts(p)).toContain(cell);
    markCells(p, [emptyCells[4]], EXCLUDED);
    setHypothesis(p, 'discard');
    expect(p.hypothesis).toBe(false);
    expect(p.pencil.every((mark) => mark === OPEN)).toBe(true);
    expect(p.marks[puzzle.solution[0]]).toBe(STUMP);
  });
  it('the owl clears a wrong X first and undo cannot restore it', () => {
    const p = blank();
    markCells(p, [puzzle.solution[0], emptyCells[0]], EXCLUDED);
    useHint(p, 'explain');
    expect(p.explanation).toEqual({ type: 'mistake', cell: puzzle.solution[0] });
    expect(p.marks[puzzle.solution[0]]).toBe(EXCLUDED);
    closeExplanation(p);
    undo(p);
    expect(p.marks[puzzle.solution[0]]).toBe(OPEN);
    expect(p.hints).toEqual(['explain']);
  });
  it('applies an owl deduction permanently and only spends each helper once', () => {
    const p = blank();
    reveal(p, puzzle.solution[0]);
    useHint(p, 'explain');
    expect(p.explanation?.type).toBe('deduction');
    expect(explanationPages(p)[0].cells).toContain(puzzle.solution[0]);
    closeExplanation(p);
    const before = [...p.marks];
    undo(p); useHint(p, 'explain');
    expect(p.marks).toEqual(before);
    expect(p.explanation).toBeNull();
  });
  it('the woodpecker selects the unrevealed patch with fewest open squares', () => {
    const p = blank();
    const target = puzzle.solution[2];
    const region = puzzle.regions[target];
    markCells(p, puzzle.regions.flatMap((r, c) => r === region ? [c] : []), EXCLUDED);
    useHint(p, 'reveal');
    expect(p.marks[target]).toBe(STUMP);
    expect(p.lives).toBe(3);
    undo(p);
    expect(p.marks[target]).toBe(STUMP);
    useHint(p, 'reveal');
    expect(p.marks.filter((m) => m === STUMP)).toHaveLength(1);
  });
  it('the squirrel selects up to three distinct safe unmarked cells', () => {
    const p = blank();
    useHint(p, 'eliminate', () => 0);
    expect(p.marks.filter((m) => m === EXCLUDED)).toHaveLength(3);
    expect(puzzle.solution.every((c) => p.marks[c] === OPEN)).toBe(true);
    undo(p);
    expect(p.marks.filter((m) => m === EXCLUDED)).toHaveLength(3);
    const nearDone = blank();
    markCells(nearDone, emptyCells.slice(2), EXCLUDED);
    useHint(nearDone, 'eliminate');
    expect(nearDone.marks.filter((m) => m === EXCLUDED)).toHaveLength(emptyCells.length);
  });
  it('does not spend hints in the scratch layer', () => {
    const p = blank(); setHypothesis(p, 'start');
    useHint(p, 'reveal'); useHint(p, 'eliminate'); useHint(p, 'explain');
    expect(p.hints).toEqual([]);
  });
  it('records each win once, puts clean solves first, and excludes repeats from clean results', () => {
    const save = newSave();
    save.current = blank();
    save.current.elapsed = 10000;
    puzzle.solution.forEach((cell) => reveal(save.current!, cell));
    recordWin(save); recordWin(save);
    expect(save.results).toHaveLength(1);
    expect(save.results[0].clean).toBe(true);
    save.current = createPlay(puzzle, true);
    save.current.elapsed = 1000;
    puzzle.solution.forEach((cell) => reveal(save.current!, cell));
    recordWin(save);
    expect(save.results[1].clean).toBe(false);
    expect(bestTimes(save.results, 5, puzzle.tier).map((r) => r.elapsed)).toEqual([10000, 1000]);
  });
  it('restores scratch marks, both stacks, spent hints and a pending owl explanation', () => {
    const save = newSave();
    save.current = blank();
    markCells(save.current, [emptyCells[0]], EXCLUDED);
    setHypothesis(save.current, 'start');
    reveal(save.current, emptyCells[1]);
    expect(parseSave(JSON.stringify(save))).toEqual(save);
    setHypothesis(save.current, 'discard');
    markCells(save.current, [puzzle.solution[0]], EXCLUDED);
    useHint(save.current, 'explain');
    const restored = parseSave(JSON.stringify(save))!;
    closeExplanation(restored.current!);
    expect(restored.current!.marks[puzzle.solution[0]]).toBe(OPEN);
    expect(restored.current!.hints).toEqual(['explain']);
  });
  it('rejects malformed saves and board values without crashing', () => {
    expect(parseSave('broken')).toBeNull();
    expect(parseSave('{"version":2}')).toBeNull();
    const save = newSave(); save.current = blank();
    save.current.marks.pop();
    expect(parseSave(JSON.stringify(save))).toBeNull();
    const p = blank(); reveal(p, -1); reveal(p, 100); markCells(p, [NaN, -1, 100], EXCLUDED);
    expect(p.marks.every((m) => m === OPEN)).toBe(true);
  });
});

describe('gap-free pointer strokes', () => {
  it('crosses every cell even with only one move event', () => {
    expect(crossedCells(5, { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 }).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(crossedCells(5, { x: 0.5, y: 0.5 }, { x: 4.5, y: 4.5 }).sort((a, b) => a - b)).toEqual([0, 6, 12, 18, 24]);
    expect(crossedCells(5, { x: 4.5, y: 4.5 }, { x: 0.5, y: 0.5 }).sort((a, b) => a - b)).toEqual([0, 6, 12, 18, 24]);
  });
  it('clips strokes to the grid without drawing along the outside edge', () => {
    expect(crossedCells(5, { x: -3, y: 1.5 }, { x: 9, y: 1.5 }).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9]);
    expect(crossedCells(5, { x: -3, y: 0 }, { x: -1, y: 4 })).toEqual([]);
    expect(crossedCells(5, { x: 1.5, y: 1.5 }, { x: 1.5, y: 1.5 })).toEqual([6]);
  });
});
