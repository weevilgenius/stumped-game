import {
  allUnits, type Board, colOf, EXCLUDED, isValidSolution, neighbors, OPEN, rowOf, STUMP, type Tier, TIERS,
  type Unit, unitCells,
} from './board';

/* ========================================================= *\
 *  Steps                                                    *
\* ========================================================= */

/** A known stump rules out its row, column, region, and eight neighbors. */
export interface EliminationStep {
  readonly type: 'elimination';
  /** The stump's cell. */
  readonly stump: number;
  /** Cells ruled out, ascending. */
  readonly eliminated: readonly number[];
}

/** A row, column, or region with one open square holds its stump there. */
export interface ForcedStep {
  readonly type: 'forced';
  /** The unit with one open square. */
  readonly unit: Unit;
  /** The cell that gets the stump. */
  readonly place: number;
  /** Always empty; the follow-up elimination is its own step. */
  readonly eliminated: readonly number[];
}

/**
 * k regions whose open squares fit inside k lines rule out the rest of those
 * lines. In reverse, k lines whose open squares fit inside k regions rule out
 * the rest of those regions.
 */
export interface ConfinementStep {
  readonly type: 'confinement';
  /** Number of regions and lines involved, 1 to 5. */
  readonly k: number;
  /** Whether the lines are rows or columns. */
  readonly axis: 'row' | 'col';
  /** False: regions confined to lines. True: lines confined to regions. */
  readonly reverse: boolean;
  /** Region indexes involved, ascending. */
  readonly regions: readonly number[];
  /** Row or column indexes involved, ascending. */
  readonly lines: readonly number[];
  /** Cells ruled out, ascending. */
  readonly eliminated: readonly number[];
}

/** A stump in this square would at once leave some unit with no open square. */
export interface BlockingStep {
  readonly type: 'blocking';
  /** The square ruled out. */
  readonly cell: number;
  /** The unit that would be emptied. */
  readonly unit: Unit;
  /** Just `cell`. */
  readonly eliminated: readonly number[];
}

/**
 * A stump in this square would, after several easy steps, leave some unit with
 * no open square.
 */
export interface ChainStep {
  readonly type: 'chain';
  /** The square ruled out (the assumed stump). */
  readonly cell: number;
  /** The unit that ends up empty. */
  readonly unit: Unit;
  /** The easy steps that follow from the assumption, in order. */
  readonly steps: readonly Step[];
  /** Just `cell`. */
  readonly eliminated: readonly number[];
}

/** One deduction, as shown by the explain hint. */
export type Step = EliminationStep | ForcedStep | ConfinementStep | BlockingStep | ChainStep;

/** The result of solving a board by deduction. */
export interface SolveResult {
  /** True if every stump was found without guessing, which proves the solution is unique. */
  readonly solved: boolean;
  /** Every deduction made, in order. */
  readonly steps: readonly Step[];
  /** The hardest tier among the steps. */
  readonly tier: Tier;
  /** Stump cells found, ascending. */
  readonly stumps: readonly number[];
}

/* ========================================================= *\
 *  Precomputed geometry                                     *
\* ========================================================= */

interface Geometry {
  /** Every unit: rows, then columns, then regions. */
  readonly units: readonly Unit[];
  /** Cells of each unit, same order as `units`. */
  readonly unitCells: readonly (readonly number[])[];
  /** Indexes into `units` of the three units holding each cell. */
  readonly cellUnits: readonly (readonly number[])[];
  /** Cells a stump in each cell rules out (row, column, region, neighbors), ascending. */
  readonly kills: readonly (readonly number[])[];
}

const geometryCache = new WeakMap<Board, Geometry>();

const geometryOf = (board: Board): Geometry => {
  let geometry = geometryCache.get(board);
  if (!geometry) {
    const { size, regions } = board;
    const units = allUnits(board);
    const cells = Array.from({ length: size * size }, (_, cell) => cell);
    const cellUnits = cells.map((cell) => [rowOf(size, cell), size + colOf(size, cell), 2 * size + regions[cell]]);
    const unitCellLists = units.map((unit) => unitCells(board, unit));
    const kills = cells.map((cell) => {
      const set = new Set([...cellUnits[cell].flatMap((u) => unitCellLists[u]), ...neighbors(size, cell)]);
      set.delete(cell);
      return [...set].sort((a, b) => a - b);
    });
    geometry = { units, unitCells: unitCellLists, cellUnits, kills };
    geometryCache.set(board, geometry);
  }
  return geometry;
};

const hasStump = (state: Uint8Array, cells: readonly number[]): boolean => cells.some((c) => state[c] === STUMP);

const openIn = (state: Uint8Array, cells: readonly number[]): number[] => cells.filter((c) => state[c] === OPEN);

/** Index of the first unit with no stump and no open square, or -1. */
const emptyUnit = (geometry: Geometry, state: Uint8Array): number => geometry.unitCells
  .findIndex((cells) => cells.every((c) => state[c] === EXCLUDED));

const bitsOf = (mask: number): number[] => {
  const bits: number[] = [];
  for (let i = 0; mask >> i; i++) {
    if ((mask >> i) & 1) {
      bits.push(i);
    }
  }
  return bits;
};

/** Calls `visit` with each k-combination of `items` in lexicographic order until it returns a value. */
const firstCombination = <T>(
  items: readonly number[], k: number, visit: (chosen: number[]) => T | null,
): T | null => {
  const chosen: number[] = [];
  const recurse = (start: number): T | null => {
    if (chosen.length === k) {
      return visit(chosen);
    }
    for (let i = start; i <= items.length - (k - chosen.length); i++) {
      chosen.push(items[i]);
      const result = recurse(i + 1);
      chosen.pop();
      if (result !== null) {
        return result;
      }
    }
    return null;
  };
  return recurse(0);
};

/* ========================================================= *\
 *  Techniques                                               *
 *                                                           *
 *  Each finder returns its first step that makes progress   *
 *  (rules out an open square or places a stump), or null.   *
 *  Exported for testing; use nextStep in game code.         *
\* ========================================================= */

/**
 * Stump elimination (easy).
 * @param board the board
 * @param state cell states
 * @returns the first stump with open squares left to rule out
 */
export function findElimination(board: Board, state: Uint8Array): EliminationStep | null {
  const { kills } = geometryOf(board);
  for (let cell = 0; cell < state.length; cell++) {
    if (state[cell] === STUMP) {
      const eliminated = openIn(state, kills[cell]);
      if (eliminated.length) {
        return { type: 'elimination', stump: cell, eliminated };
      }
    }
  }
  return null;
}

/**
 * Forced square (easy).
 * @param board the board
 * @param state cell states
 * @returns the first unit (rows, columns, then regions) with no stump and one open square
 */
export function findForced(board: Board, state: Uint8Array): ForcedStep | null {
  const { units, unitCells: cellsOf } = geometryOf(board);
  for (let u = 0; u < units.length; u++) {
    const open = openIn(state, cellsOf[u]);
    if (open.length === 1 && !hasStump(state, cellsOf[u])) {
      return { type: 'forced', unit: units[u], place: open[0], eliminated: [] };
    }
  }
  return null;
}

/**
 * Confinement with k regions and k lines (easy for 1, medium for 2 and 3, hard
 * for 4 and 5). Tries regions in rows, regions in columns, rows in regions,
 * then columns in regions.
 * @param board the board
 * @param state cell states
 * @param k number of regions and lines
 * @returns the first confinement that rules something out
 */
export function findConfinement(board: Board, state: Uint8Array, k: number): ConfinementStep | null {
  const { size, regions } = board;
  const variants = [
    { axis: 'row', reverse: false },
    { axis: 'col', reverse: false },
    { axis: 'row', reverse: true },
    { axis: 'col', reverse: true },
  ] as const;
  for (const { axis, reverse } of variants) {
    const lineOf = (cell: number): number => (axis === 'row' ? rowOf(size, cell) : colOf(size, cell));
    // Sources are the units being confined, targets the units they fit inside.
    const sourceOf = reverse ? lineOf : (cell: number): number => regions[cell];
    const targetOf = reverse ? (cell: number): number => regions[cell] : lineOf;
    const masks = new Array<number>(size).fill(0);
    const solved = new Array<boolean>(size).fill(false);
    state.forEach((value, cell) => {
      if (value === OPEN) {
        masks[sourceOf(cell)] |= 1 << targetOf(cell);
      } else if (value === STUMP) {
        solved[sourceOf(cell)] = true;
      }
    });
    const sources = masks.flatMap((mask, s) => (mask && !solved[s] ? [s] : []));
    const step = firstCombination(sources, k, (chosen) => {
      const targets = chosen.reduce((mask, s) => mask | masks[s], 0);
      if (bitsOf(targets).length !== k) {
        return null;
      }
      const eliminated: number[] = [];
      state.forEach((value, cell) => {
        if (value === OPEN && (targets >> targetOf(cell)) & 1 && !chosen.includes(sourceOf(cell))) {
          eliminated.push(cell);
        }
      });
      if (!eliminated.length) {
        return null;
      }
      const lines = reverse ? [...chosen] : bitsOf(targets);
      const regionList = reverse ? bitsOf(targets) : [...chosen];
      return { type: 'confinement', k, axis, reverse, regions: regionList, lines, eliminated } as const;
    });
    if (step) {
      return step;
    }
  }
  return null;
}

/**
 * One-step blocking (medium).
 * @param board the board
 * @param state cell states
 * @returns the first open square whose stump would at once empty another unit
 */
export function findBlocking(board: Board, state: Uint8Array): BlockingStep | null {
  const { units, unitCells: cellsOf, cellUnits, kills } = geometryOf(board);
  const killed = new Uint8Array(state.length);
  for (let cell = 0; cell < state.length; cell++) {
    if (state[cell] !== OPEN) {
      continue;
    }
    killed.fill(0);
    for (const k of kills[cell]) {
      killed[k] = 1;
    }
    for (let u = 0; u < units.length; u++) {
      const cells = cellsOf[u];
      if (!cellUnits[cell].includes(u) && !hasStump(state, cells)
        && cells.every((c) => state[c] !== OPEN || killed[c])) {
        return { type: 'blocking', cell, unit: units[u], eliminated: [cell] };
      }
    }
  }
  return null;
}

/** Easy techniques used to follow a chain. */
const CHAIN_TECHNIQUES = [
  findElimination,
  findForced,
  (board: Board, state: Uint8Array): Step | null => findConfinement(board, state, 1),
];

/**
 * Multi-step chain (hard). Assumes a stump in each open square, follows easy
 * steps, and looks for a unit left with no open square. Prefers the shortest
 * chain; chains of one step are left to `findBlocking`.
 * @param board the board
 * @param state cell states
 * @returns the shortest contradiction chain found, or null
 */
export function findChain(board: Board, state: Uint8Array): ChainStep | null {
  const geometry = geometryOf(board);
  let best: ChainStep | null = null;
  for (let cell = 0; cell < state.length; cell++) {
    if (state[cell] !== OPEN) {
      continue;
    }
    let sim: Uint8Array = state.slice();
    sim[cell] = STUMP;
    const steps: Step[] = [];
    // ponytail: a full propagation per open square, O(cells * steps); fine for N <= 10.
    while (!best || steps.length + 1 < best.steps.length) {
      const step = CHAIN_TECHNIQUES.reduce<Step | null>((found, find) => found ?? find(board, sim), null);
      if (!step) {
        break;
      }
      sim = applyStep(sim, step);
      steps.push(step);
      const empty = emptyUnit(geometry, sim);
      if (empty >= 0) {
        if (steps.length >= 2) {
          best = { type: 'chain', cell, unit: geometry.units[empty], steps, eliminated: [cell] };
        }
        break;
      }
    }
  }
  return best;
}

/* ========================================================= *\
 *  Solving                                                  *
\* ========================================================= */

/** Techniques from simplest to hardest. Reorder here to tune the tiers. */
const TECHNIQUES: readonly ((board: Board, state: Uint8Array) => Step | null)[] = [
  findElimination,
  findForced,
  (board, state) => findConfinement(board, state, 1),
  (board, state) => findConfinement(board, state, 2),
  findBlocking,
  (board, state) => findConfinement(board, state, 3),
  (board, state) => findConfinement(board, state, 4),
  (board, state) => findConfinement(board, state, 5),
  findChain,
];

/**
 * Finds the simplest deduction that makes progress from the given marks. This
 * drives the explain hint: player X's (normal and red) are EXCLUDED and
 * revealed stumps are STUMP. The marks must agree with the solution.
 * @param board the board
 * @param state cell states
 * @returns the step, or null if no technique applies
 */
export function nextStep(board: Board, state: Uint8Array): Step | null {
  for (const find of TECHNIQUES) {
    const step = find(board, state);
    if (step) {
      return step;
    }
  }
  return null;
}

/**
 * @param state cell states
 * @param step a deduction
 * @returns a copy of the state with the step's eliminations and placement marked
 */
export function applyStep(state: Uint8Array, step: Step): Uint8Array {
  const next = state.slice();
  for (const cell of step.eliminated) {
    next[cell] = EXCLUDED;
  }
  if (step.type === 'forced') {
    next[step.place] = STUMP;
  }
  return next;
}

/**
 * @param step a deduction
 * @returns the tier of the technique it uses
 */
export function stepTier(step: Step): Tier {
  switch (step.type) {
  case 'elimination':
  case 'forced':
    return 'easy';
  case 'confinement':
    return step.k === 1 ? 'easy' : step.k <= 3 ? 'medium' : 'hard';
  case 'blocking':
    return 'medium';
  case 'chain':
    return 'hard';
  }
}

/**
 * Solves a board by deduction alone, the way a person would.
 * @param board the board
 * @param givens stumps revealed at the start
 * @returns whether it was solved, the steps, and the tier
 */
export function solve(board: Board, givens: readonly number[] = []): SolveResult {
  const geometry = geometryOf(board);
  let state: Uint8Array = new Uint8Array(board.size * board.size);
  for (const cell of givens) {
    state[cell] = STUMP;
  }
  const steps: Step[] = [];
  while (emptyUnit(geometry, state) < 0) {
    const step = nextStep(board, state);
    if (!step) {
      break;
    }
    state = applyStep(state, step);
    steps.push(step);
  }
  const stumps = state.reduce<number[]>((list, value, cell) => (value === STUMP ? [...list, cell] : list), []);
  const tierIndex = Math.max(0, ...steps.map((step) => TIERS.indexOf(stepTier(step))));
  return { solved: isValidSolution(board, stumps), steps, tier: TIERS[tierIndex], stumps };
}

/**
 * Lists solutions by backtracking, stopping at `limit`.
 * @param board the board
 * @param limit stop once this many are found
 * @returns up to `limit` solutions, each as stump cells ordered by row
 */
export function findSolutions(board: Board, limit: number): number[][] {
  const { size, regions } = board;
  const solutions: number[][] = [];
  const cols: number[] = [];
  const place = (row: number, colsUsed: number, regionsUsed: number): void => {
    if (row === size) {
      solutions.push(cols.map((col, r) => r * size + col));
      return;
    }
    for (let col = 0; col < size && solutions.length < limit; col++) {
      const region = regions[row * size + col];
      if (!((colsUsed >> col) & 1) && !((regionsUsed >> region) & 1) && !(row && Math.abs(col - cols[row - 1]) <= 1)) {
        cols.push(col);
        place(row + 1, colsUsed | (1 << col), regionsUsed | (1 << region));
        cols.pop();
      }
    }
  };
  place(0, 0, 0);
  return solutions;
}

/**
 * Counts solutions by backtracking, stopping at `limit`.
 * @param board the board
 * @param limit stop counting once this many are found
 * @returns the number of solutions, at most `limit`
 */
export function countSolutions(board: Board, limit = 2): number {
  return findSolutions(board, limit).length;
}

/* ========================================================= *\
 *  Explanations                                             *
\* ========================================================= */

const unitName = (unit: Unit): string => (unit.kind === 'region'
  ? 'that patch'
  : `${unit.kind === 'row' ? 'row' : 'column'} ${unit.index + 1}`);

const listLines = (axis: 'row' | 'col', lines: readonly number[]): string => {
  const numbers = lines.map((line) => String(line + 1));
  const noun = axis === 'row' ? 'row' : 'column';
  if (numbers.length === 1) {
    return `${noun} ${numbers[0]}`;
  }
  const last = numbers.pop() ?? '';
  return `${noun}s ${numbers.join(', ')}${numbers.length > 1 ? ',' : ''} and ${last}`;
};

/**
 * Explains a step in plain words for the explain hint. Rows and columns are
 * numbered from 1; regions are referred to as highlighted patches.
 * @param step a deduction
 * @returns a sentence or two
 */
export function describeStep(step: Step): string {
  switch (step.type) {
  case 'elimination':
    return 'A stump rules out every other square in its row, column, and patch, and every square touching it.';
  case 'forced': {
    const name = step.unit.kind === 'region' ? 'This patch' : unitName(step.unit).replace(/^./, (c) => c.toUpperCase());
    return `${name} has only one open square left, so its stump must go there.`;
  }
  case 'confinement': {
    const lines = listLines(step.axis, step.lines);
    const nouns = step.axis === 'row' ? 'rows' : 'columns';
    if (!step.reverse && step.k === 1) {
      return `This patch's open squares all lie in ${lines}, so its stump is there `
        + `and no other square in ${lines} can hold one.`;
    }
    if (!step.reverse) {
      return `These ${step.k} patches fit entirely inside ${lines}, so their stumps fill those ${nouns} `
        + 'and no other square in them can hold one.';
    }
    if (step.k === 1) {
      return `The open squares of ${lines} all lie in one patch, so that patch's stump is in ${lines} `
        + 'and the rest of the patch is ruled out.';
    }
    return `The open squares of ${lines} all lie in these ${step.k} patches, so those patches' stumps `
      + `are in those ${nouns} and the rest of the patches is ruled out.`;
  }
  case 'blocking':
    return `A stump here would rule out every open square in ${unitName(step.unit)}, so this square can't hold one.`;
  case 'chain':
    return `If a stump went here, then after ${step.steps.length} steps ${unitName(step.unit)} `
      + 'would have no open square left, so this square can\'t hold one.';
  }
}
