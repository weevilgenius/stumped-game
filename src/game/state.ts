import { allUnits, conflicts, decodeSeedCode, describeStep, EXCLUDED, isValidSolution, nextStep, OPEN, STUMP, TIERS, unitCells } from '../engine';
import type { Puzzle, Step, Tier } from '../engine';

/** A failed reveal, which can never be erased. */
export const WRONG = 3;
/** One use of each woodland helper is available per puzzle. */
export type Hint = 'reveal' | 'explain' | 'eliminate';
/** A single reversible change to a player's pencil marks. */
export interface Change {
  /** Cell index. */
  cell: number;
  /** Value before the gesture. */
  before: number;
}
/** An owl result waiting for the player to close its explanation. */
export type Explanation = { type: 'mistake'; cell: number } | { type: 'deduction'; step: Step };
/** All state needed to resume a play, including its undo stacks. */
export interface Play {
  /** Unique play identifier for recording completion exactly once. */
  id: string;
  /** Deterministic generated puzzle. */
  puzzle: Puzzle;
  /** Normal marks, revealed stumps, and permanent red Xs. */
  marks: number[];
  /** Scratch marks: open, X, or tentative stump. */
  pencil: number[];
  /** Whether the scratch layer is active. */
  hypothesis: boolean;
  /** Normal gesture history. */
  undo: Change[][];
  /** Scratch gesture history. */
  pencilUndo: Change[][];
  /** Remaining acorns. */
  lives: number;
  /** Helpers already used. */
  hints: Hint[];
  /** Active owl explanation, saved until applied. */
  explanation: Explanation | null;
  /** Time spent playing, in milliseconds. */
  elapsed: number;
  /** Whether this code was started before on this device. */
  repeat: boolean;
  /** Current outcome. */
  status: 'playing' | 'won' | 'lost';
}
/** Device preferences; random variety controls use -1. */
export interface Settings {
  /** Whether the running timer is visible. */
  timer: boolean;
  /** Zero selects a random grid size. */
  size: number;
  /** Requested tier, or random. */
  tier: Tier | 'random';
  /** Always play with one silver acorn. */
  silver: boolean;
  /** Region size imbalance, -1 or 0–3. */
  sizeMix: number;
  /** Region elongation, -1 or 0–3. */
  shape: number;
  /** Freebie frequency, -1 or 0–3. */
  freebies: number;
}
/** A completed play kept in the local best-times book. */
export interface Result {
  /** Play identifier. */
  id: string;
  /** Seed code. */
  code: string;
  /** Grid size. */
  size: number;
  /** Actual solver-rated difficulty. */
  tier: Tier;
  /** Solve duration in milliseconds. */
  elapsed: number;
  /** Used helpers. */
  hints: Hint[];
  /** Acorns lost. */
  lost: number;
  /** Single-acorn play. */
  silver: boolean;
  /** Repeated puzzle. */
  repeat: boolean;
  /** First play, no help, no mistakes. */
  clean: boolean;
  /** Completion timestamp. */
  date: string;
}
/** Atomic local save, including preferences and completed plays. */
export interface Save {
  /** Save format version. */
  version: 1;
  /** Device preferences. */
  settings: Settings;
  /** Most recent puzzle. */
  current: Play | null;
  /** Codes previously started, including unsuccessful attempts. */
  played: string[];
  /** Every completed play. */
  results: Result[];
}
/** Initial local data. */
export function newSave(): Save {
  return { version: 1, settings: { timer: true, size: 0, tier: 'random', silver: false, sizeMix: -1, shape: -1, freebies: -1 }, current: null, played: [], results: [] };
}
/** Starts a play, retaining the generator's initial reveals. */
export function createPlay(puzzle: Puzzle, repeat: boolean): Play {
  const marks: number[] = Array(puzzle.size ** 2).fill(OPEN) as number[];
  puzzle.givens.forEach((cell) => { marks[cell] = STUMP; });
  return { id: crypto.randomUUID(), puzzle, marks, pencil: marks.map(() => OPEN), hypothesis: false, undo: [], pencilUndo: [], lives: puzzle.silver ? 1 : 3, hints: [], explanation: null, elapsed: 0, repeat, status: 'playing' };
}
/** Returns the active mark layer. */
export function layer(play: Play): number[] {
  return play.hypothesis ? play.pencil : play.marks;
}
/** Applies a stroke as one undo entry; reuse its changes array during dragging. */
export function markCells(play: Play, cells: readonly number[], value: number, changes: Change[] = []): Change[] {
  if (play.status !== 'playing' || play.explanation) return changes;
  const marks = layer(play);
  const stack = play.hypothesis ? play.pencilUndo : play.undo;
  for (const cell of cells) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= marks.length || play.marks[cell] >= STUMP
      || marks[cell] === value || changes.some((change) => change.cell === cell)) continue;
    if (changes.length === 0) stack.push(changes);
    changes.push({ cell, before: marks[cell] });
    marks[cell] = value;
  }
  return changes;
}
/** Undoes only reversible marks in the active layer. */
export function undo(play: Play): void {
  if (play.status !== 'playing' || play.explanation) return;
  const changes = (play.hypothesis ? play.pencilUndo : play.undo).pop();
  changes?.forEach(({ cell, before }) => { layer(play)[cell] = before; });
}

// Remove obsolete history for a permanent effect so undo cannot resurrect an old mark.
const permanent = (play: Play, cell: number, value: number): void => {
  play.marks[cell] = value;
  play.pencil[cell] = OPEN;
  for (const key of ['undo', 'pencilUndo'] as const) {
    play[key] = play[key].map((stroke) => stroke.filter((change) => change.cell !== cell)).filter((stroke) => stroke.length > 0);
  }
};
const finish = (play: Play): void => {
  if (play.lives === 0) play.status = 'lost';
  else if (play.puzzle.solution.every((cell) => play.marks[cell] === STUMP)) play.status = 'won';
};
/** Attempts a reveal, or places an unchecked tentative stump in hypothesis mode. */
export function reveal(play: Play, cell: number): void {
  if (play.status !== 'playing' || play.explanation || !Number.isInteger(cell)
    || cell < 0 || cell >= play.marks.length || play.marks[cell] >= STUMP) return;
  if (play.hypothesis) {
    markCells(play, [cell], STUMP);
  } else {
    const correct = play.puzzle.solution.includes(cell);
    permanent(play, cell, correct ? STUMP : WRONG);
    if (!correct) play.lives--;
    finish(play);
  }
}
/** Starts a single scratch layer, or leaves it by keeping only its Xs or discarding it. */
export function setHypothesis(play: Play, action: 'start' | 'keep' | 'discard'): void {
  if (play.status !== 'playing' || play.explanation) return;
  if (action === 'start') {
    play.hypothesis = true;
    return;
  }
  if (action === 'keep') {
    play.pencil.forEach((mark, cell) => {
      if (mark === EXCLUDED && play.marks[cell] < STUMP) permanent(play, cell, EXCLUDED);
    });
  }
  play.pencil.fill(OPEN);
  play.pencilUndo = [];
  play.hypothesis = false;
}
/** Lists tentative stumps violating a placement rule against real or tentative stumps. */
export function tentativeConflicts(play: Play): number[] {
  const stumps = play.marks.flatMap((mark, cell) => mark === STUMP || play.pencil[cell] === STUMP ? [cell] : []);
  return stumps.filter((cell) => play.pencil[cell] === STUMP && conflicts(play.puzzle, cell, stumps).length > 0);
}
/** Uses a helper once. The owl defers its permanent result until the explanation is closed. */
export function useHint(play: Play, hint: Hint, rng: () => number = Math.random): void {
  if (play.status !== 'playing' || play.hypothesis || play.explanation || play.hints.includes(hint)) return;
  if (hint === 'reveal') {
    const available = play.puzzle.solution.filter((cell) => play.marks[cell] !== STUMP);
    const openCount = (cell: number): number => unitCells(play.puzzle, { kind: 'region', index: play.puzzle.regions[cell] }).filter((c) => play.marks[c] === OPEN).length;
    available.sort((a, b) => openCount(a) - openCount(b));
    if (available.length === 0) return;
    permanent(play, available[0], STUMP);
  } else if (hint === 'eliminate') {
    const candidates = play.marks.flatMap((mark, cell) => mark === OPEN && !play.puzzle.solution.includes(cell) ? [cell] : []);
    if (candidates.length === 0) return;
    for (let i = 0; i < 3 && candidates.length > 0; i++) {
      const [cell] = candidates.splice(Math.floor(rng() * candidates.length), 1);
      permanent(play, cell, EXCLUDED);
    }
  } else {
    const mistake = play.puzzle.solution.find((cell) => play.marks[cell] === EXCLUDED);
    if (mistake !== undefined) play.explanation = { type: 'mistake', cell: mistake };
    else {
      const step = nextStep(play.puzzle, Uint8Array.from(play.marks, (mark) => mark === WRONG ? EXCLUDED : mark));
      if (!step) return;
      play.explanation = { type: 'deduction', step };
    }
  }
  play.hints.push(hint);
  finish(play);
}
/** Applies the saved explanation exactly once, even after a reload. */
export function closeExplanation(play: Play): void {
  const explanation = play.explanation;
  if (!explanation) return;
  if (explanation.type === 'mistake') permanent(play, explanation.cell, OPEN);
  else {
    const step = explanation.step;
    step.eliminated.forEach((cell) => permanent(play, cell, EXCLUDED));
    if (step.type === 'forced') permanent(play, step.place, STUMP);
  }
  play.explanation = null;
  finish(play);
}
/** Text and highlighted squares for each step of an owl explanation. */
export function explanationPages(play: Play): { text: string; cells: number[] }[] {
  const explanation = play.explanation;
  if (!explanation) return [];
  if (explanation.type === 'mistake') return [{ text: 'There is a stump under this X. Close this explanation to clear the mark and take another look.', cells: [explanation.cell] }];
  const describe = (step: Step): { text: string; cells: number[] } => {
    const cells = [...step.eliminated];
    if (step.type === 'elimination') cells.push(step.stump);
    if (step.type === 'forced' || step.type === 'blocking' || step.type === 'chain') cells.push(...unitCells(play.puzzle, step.unit));
    if (step.type === 'forced') cells.push(step.place);
    if (step.type === 'blocking' || step.type === 'chain') cells.push(step.cell);
    if (step.type === 'confinement') {
      step.regions.forEach((index) => cells.push(...unitCells(play.puzzle, { kind: 'region', index })));
      step.lines.forEach((index) => cells.push(...unitCells(play.puzzle, { kind: step.axis, index })));
    }
    return { text: describeStep(step), cells: [...new Set(cells)] };
  };
  const step = explanation.step;
  if (step.type !== 'chain') return [describe(step)];
  return [
    { text: 'Suppose a stump were in this square. Follow the deductions to see why it cannot be.', cells: [step.cell] },
    ...step.steps.map(describe), describe(step),
  ];
}
/** Units ready to pulse: a revealed stump with all other cells marked. */
export function completedUnits(play: Play): number[][] {
  return allUnits(play.puzzle).map((unit) => unitCells(play.puzzle, unit))
    .filter((cells) => cells.some((cell) => play.marks[cell] === STUMP) && cells.every((cell) => play.marks[cell] !== OPEN));
}
/** Records a win once, preserving all repeat times. */
export function recordWin(save: Save): void {
  const play = save.current;
  if (play?.status !== 'won' || save.results.some((result) => result.id === play.id)) return;
  const lost = (play.puzzle.silver ? 1 : 3) - play.lives;
  save.results.push({ id: play.id, code: play.puzzle.code, size: play.puzzle.size, tier: play.puzzle.tier, elapsed: play.elapsed, hints: [...play.hints], lost, silver: play.puzzle.silver, repeat: play.repeat, clean: !play.repeat && !lost && !play.hints.length, date: new Date().toISOString() });
}
/** Orders clean times above other times, each group fastest first. */
export function bestTimes(results: readonly Result[], size: number, tier: Tier): Result[] {
  return results.filter((result) => result.size === size && result.tier === tier)
    .sort((a, b) => Number(b.clean) - Number(a.clean) || a.elapsed - b.elapsed);
}
/** Formats elapsed milliseconds as minutes and seconds. */
export function formatTime(ms: number): string {
  return `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
}

/* ========================================================= *\
 *  Save validation: browser storage is an input boundary.    *
\* ========================================================= */
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const integer = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
const numbers = (value: unknown, length: number, max: number): value is number[] => Array.isArray(value) && value.length === length && value.every((n: unknown) => integer(n, 0, max));
const tier = (value: unknown): value is Tier => TIERS.includes(value as Tier);
const hints = (value: unknown): value is Hint[] => Array.isArray(value) && value.every((h: unknown) => ['reveal', 'explain', 'eliminate'].includes(String(h)));
const duration = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const code = (value: unknown): value is string => typeof value === 'string' && decodeSeedCode(value) !== null;
const validPuzzle = (value: unknown): value is Puzzle => {
  if (!object(value) || !integer(value.size, 5, 10) || !tier(value.tier) || !code(value.code) || typeof value.silver !== 'boolean') return false;
  const n = value.size;
  return numbers(value.regions, n * n, n - 1) && numbers(value.solution, n, n * n - 1)
    && numbers(value.colors, n, n - 1) && new Set(value.colors).size === n
    && Array.isArray(value.givens) && value.givens.every((cell: unknown) => (value.solution as number[]).includes(cell as number))
    && isValidSolution(value as unknown as Puzzle, value.solution);
};
const validHistory = (value: unknown, count: number): boolean => Array.isArray(value) && value.every((stroke: unknown) => Array.isArray(stroke)
  && stroke.every((change: unknown) => object(change) && integer(change.cell, 0, count - 1) && integer(change.before, 0, STUMP)));
const validUnit = (value: unknown, size: number): boolean => object(value) && ['row', 'col', 'region'].includes(String(value.kind)) && integer(value.index, 0, size - 1);
const validStep = (value: unknown, size: number, depth = 0): boolean => {
  if (!object(value) || depth > 10 || !Array.isArray(value.eliminated) || !value.eliminated.every((cell: unknown) => integer(cell, 0, size ** 2 - 1))) return false;
  if (value.type === 'elimination') return integer(value.stump, 0, size ** 2 - 1);
  if (value.type === 'forced') return integer(value.place, 0, size ** 2 - 1) && validUnit(value.unit, size);
  if (value.type === 'confinement') return integer(value.k, 1, 5) && typeof value.reverse === 'boolean' && ['row', 'col'].includes(String(value.axis))
    && numbers(value.regions, value.k, size - 1) && numbers(value.lines, value.k, size - 1);
  return (value.type === 'blocking' || value.type === 'chain') && integer(value.cell, 0, size ** 2 - 1) && validUnit(value.unit, size)
    && (value.type !== 'chain' || (Array.isArray(value.steps) && value.steps.every((step: unknown) => validStep(step, size, depth + 1))));
};
/** Parses only compatible, structurally valid local data; leaves recovery policy to the caller. */
export function parseSave(raw: string): Save | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || !object(value.settings)) return null;
    const s = value.settings;
    if (typeof s.timer !== 'boolean' || typeof s.silver !== 'boolean' || !(s.size === 0 || integer(s.size, 5, 10))
      || !(s.tier === 'random' || tier(s.tier)) || ![s.sizeMix, s.shape, s.freebies].every((v) => integer(v, -1, 3))) return null;
    if (!Array.isArray(value.played) || !value.played.every(code) || !Array.isArray(value.results)) return null;
    if (!value.results.every((r: unknown) => object(r) && typeof r.id === 'string' && code(r.code) && integer(r.size, 5, 10) && tier(r.tier)
      && duration(r.elapsed) && hints(r.hints) && integer(r.lost, 0, 2) && typeof r.silver === 'boolean'
      && typeof r.repeat === 'boolean' && typeof r.clean === 'boolean' && typeof r.date === 'string')) return null;
    const p = value.current;
    if (p !== null) {
      if (!object(p) || !validPuzzle(p.puzzle)) return null;
      const count = p.puzzle.size ** 2;
      if (typeof p.id !== 'string' || !numbers(p.marks, count, WRONG) || !numbers(p.pencil, count, STUMP)
        || typeof p.hypothesis !== 'boolean' || !validHistory(p.undo, count) || !validHistory(p.pencilUndo, count)
        || !integer(p.lives, 0, p.puzzle.silver ? 1 : 3) || !hints(p.hints) || !duration(p.elapsed)
        || typeof p.repeat !== 'boolean' || !['playing', 'won', 'lost'].includes(String(p.status))) return null;
      if (p.explanation !== null && (!object(p.explanation)
        || !(p.explanation.type === 'mistake' ? integer(p.explanation.cell, 0, count - 1)
          : p.explanation.type === 'deduction' && validStep(p.explanation.step, p.puzzle.size)))) return null;
    }
    return value as unknown as Save;
  } catch { return null; }
}
