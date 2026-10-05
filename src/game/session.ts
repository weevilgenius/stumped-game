import {
  allUnits, conflicts, type Conflict, EXCLUDED, nextStep, OPEN, type Puzzle, STUMP, type Unit, unitCells,
} from '../engine';
import {
  type ExplainEffect, type ExplainPage, pagesForStep,
} from './explain';

/* ========================================================= *\
 *  Marks                                                    *
\* ========================================================= */

/** Still empty. */
export const CELL_OPEN = 0;
/** A normal X the player can still remove. */
export const CELL_X = 1;
/** A wrong reveal. It stays for the rest of the puzzle. */
export const CELL_RED = 2;
/** A revealed stump, including givens. */
export const CELL_STUMP = 3;

/** A cell's permanent mark. */
export type CellMark = typeof CELL_OPEN | typeof CELL_X | typeof CELL_RED | typeof CELL_STUMP;

/** One cell in a normal-play undo step, storing the mark from before the change. */
export interface NormalChange {
  /** Cell index. */
  readonly cell: number;
  /** The mark before this step changed it. */
  readonly mark: CellMark;
}

/** One cell in a hypothesis undo step, storing the scratch marks from before the change. */
export interface HypoChange {
  /** Cell index. */
  readonly cell: number;
  /** Whether a hypothesis X was there. */
  readonly x: boolean;
  /** Whether a tentative stump was there. */
  readonly stump: boolean;
}

/** The owl's open explanation, including the page the player is on. */
export interface ExplanationState {
  /** Pages, in order. */
  readonly pages: readonly ExplainPage[];
  /** Index of the page being shown. */
  page: number;
  /** Applied when the explanation closes. */
  readonly effect: ExplainEffect;
}

/** What a reveal attempt did. `noop` means the gesture changed nothing. */
export interface RevealResult {
  /** How the attempt resolved. */
  readonly type: 'correct' | 'wrong' | 'noop';
  /** The cell that was tapped. */
  readonly cell: number;
  /** Revealed stumps the wrong guess conflicts with. */
  readonly conflicts: readonly Conflict[];
  /** Whether this reveal finished the puzzle. */
  readonly won: boolean;
  /** Whether the last acorn is gone. */
  readonly lost: boolean;
  /** Whether the finished board has no unmarked square. */
  readonly perfectlyMarked: boolean;
  /** Units whose other squares just became fully marked, for the pulse. */
  readonly pulses: readonly Unit[];
}

/** Squares the squirrel hint marked. */
export interface EliminateResult {
  /** Cells that received an X. */
  readonly cells: readonly number[];
  /** Units completed by those X's. */
  readonly pulses: readonly Unit[];
}

/** A session restored from storage. */
export interface SavedSession {
  /** The puzzle being played. */
  readonly puzzle: Puzzle;
  /** Permanent marks, one per cell. */
  readonly marks: readonly number[];
  /** Hypothesis X's, 0 or 1 per cell. */
  readonly hypoX: readonly number[];
  /** Tentative stumps, 0 or 1 per cell. */
  readonly hypoStump: readonly number[];
  /** Whether hypothesis mode is on. */
  readonly hypothesis: boolean;
  /** Acorns remaining. */
  readonly acornsLeft: number;
  /** Hints already used. */
  readonly hints: { readonly woodpecker: boolean; readonly owl: boolean; readonly squirrel: boolean };
  /** Normal-play undo stack. Each entry is one tap or one drag. */
  readonly undo: readonly (readonly NormalChange[])[];
  /** Hypothesis undo stack. */
  readonly hypoUndo: readonly (readonly HypoChange[])[];
  /** Play, win, or loss. */
  readonly status: 'playing' | 'won' | 'lost';
  /** Elapsed time in milliseconds. */
  readonly elapsedMs: number;
  /** Whether this code had been started before. */
  readonly isRepeat: boolean;
  /** Set when the winning reveal left nothing unmarked. */
  readonly perfectlyMarked: boolean;
  /** Whether the win has already been added to the records. */
  readonly recorded: boolean;
  /** An explanation waiting to be closed, if the owl is open. */
  readonly explanation: ExplanationState | null;
  /** Units that have already pulsed, so they do not pulse again until broken. */
  readonly pulsed: readonly string[];
}

interface Stroke {
  mode: 'place' | 'erase' | 'ignore';
  hypo: boolean;
  seen: Set<number>;
  normal: NormalChange[];
  hypoChanges: HypoChange[];
}

const noopResult = (cell: number): RevealResult => ({
  type: 'noop',
  cell,
  conflicts: [],
  won: false,
  lost: false,
  perfectlyMarked: false,
  pulses: [],
});

/* ========================================================= *\
 *  Session                                                  *
\* ========================================================= */

/**
 * One play of one puzzle: marks, hypothesis scratch, hints, and undo.
 * The Phaser scenes draw this and send gestures in. Nothing here touches the DOM.
 */
export class Session {
  /** The puzzle being played. */
  readonly puzzle: Puzzle;

  /** True when this device had already started this seed code. */
  readonly isRepeat: boolean;

  /** Permanent mark per cell. */
  readonly marks: Uint8Array;

  /** Hypothesis X per cell, as 0 or 1. */
  readonly hypoX: Uint8Array;

  /** Tentative stump per cell, as 0 or 1. */
  readonly hypoStump: Uint8Array;

  /** Acorns remaining. */
  acornsLeft: number;

  /** Which hints have been used. */
  readonly hints = { woodpecker: false, owl: false, squirrel: false };

  /** `playing` until the last stump or the last acorn. */
  status: 'playing' | 'won' | 'lost' = 'playing';

  /** Elapsed milliseconds, copied off the clock whenever the session is saved. */
  elapsedMs = 0;

  /** True when the winning reveal left no unmarked square. */
  perfectlyMarked = false;

  /** True once the win has been written to the records. */
  recorded = false;

  /** Open owl explanation, or null. */
  explanation: ExplanationState | null = null;

  /**
   * Set by the view while the wrong-reveal animation is playing.
   * Gestures are ignored until it clears. Not saved.
   */
  inputLocked = false;

  /** Whether the scratch layer is on. */
  hypothesis = false;

  private readonly solution: Set<number>;

  private normalUndo: NormalChange[][] = [];

  private hypothesisUndo: HypoChange[][] = [];

  private pulsed = new Set<string>();

  private stroke: Stroke | null = null;

  /**
   * @param puzzle the generated puzzle
   * @param options repeat flag for a code this device has started before
   */
  constructor(puzzle: Puzzle, options: { isRepeat?: boolean } = {}) {
    this.puzzle = puzzle;
    this.isRepeat = options.isRepeat ?? false;
    const count = puzzle.size * puzzle.size;
    this.marks = new Uint8Array(count);
    this.hypoX = new Uint8Array(count);
    this.hypoStump = new Uint8Array(count);
    this.acornsLeft = puzzle.silver ? 1 : 3;
    this.solution = new Set(puzzle.solution);
    for (const cell of puzzle.givens) {
      this.marks[cell] = CELL_STUMP;
    }
    this.refreshPulses();
  }

  /**
   * @returns how many stumps are revealed, including givens
   */
  revealedCount(): number {
    let count = 0;
    for (const mark of this.marks) {
      if (mark === CELL_STUMP) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * @returns true when any hint has been used
   */
  helped(): boolean {
    return this.hints.woodpecker || this.hints.owl || this.hints.squirrel;
  }

  /**
   * @returns true when the undo button has something to undo
   */
  canUndo(): boolean {
    if (this.blocked) {
      return false;
    }
    return this.hypothesis ? this.hypothesisUndo.length > 0 : this.normalUndo.length > 0;
  }

  /**
   * Hints act on the real board, so they wait until hypothesis mode is off
   * and nothing else has the board locked.
   * @returns true when the hint buttons should accept a press
   */
  hintsAvailable(): boolean {
    return this.status === 'playing' && !this.inputLocked && this.explanation === null && !this.hypothesis;
  }

  /**
   * Tentative stumps that break a placement rule against a revealed stump
   * or another tentative stump.
   * @returns the flagged cells
   */
  flagged(): number[] {
    const stumps: number[] = [];
    for (let cell = 0; cell < this.marks.length; cell++) {
      if (this.marks[cell] === CELL_STUMP || this.hypoStump[cell]) {
        stumps.push(cell);
      }
    }
    const flagged: number[] = [];
    for (const cell of stumps) {
      if (this.hypoStump[cell] && conflicts(this.puzzle, cell, stumps).length > 0) {
        flagged.push(cell);
      }
    }
    return flagged;
  }

  /**
   * Starts a drag. The mark does not change until the pointer actually moves.
   * @param cell the cell under the pointer
   */
  beginStroke(cell: number): void {
    if (this.blocked || !this.inRange(cell)) {
      return;
    }
    this.stroke = {
      mode: this.strokeMode(cell),
      hypo: this.hypothesis,
      seen: new Set(),
      normal: [],
      hypoChanges: [],
    };
  }

  /**
   * Applies the stroke's place or erase mode to one cell. Each cell is visited once.
   * @param cell a cell the pointer has crossed
   */
  extendStroke(cell: number): void {
    const stroke = this.stroke;
    if (!stroke || stroke.mode === 'ignore' || this.blocked || !this.inRange(cell) || stroke.seen.has(cell)) {
      return;
    }
    stroke.seen.add(cell);
    if (stroke.hypo) {
      this.extendHypothesis(stroke, cell);
    } else {
      this.extendNormal(stroke, cell);
    }
  }

  /**
   * Ends the drag and pushes one undo step if anything changed.
   * @returns units that just became fully marked
   */
  endStroke(): readonly Unit[] {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke) {
      return [];
    }
    if (stroke.hypo) {
      this.pushHypo(stroke.hypoChanges);
      return [];
    }
    this.pushNormal(stroke.normal);
    return this.refreshPulses();
  }

  /** Drops a stroke that turned out to be a tap, without recording it. */
  cancelStroke(): void {
    this.stroke = null;
  }

  /**
   * Toggles the mark a single tap controls. In normal play that is an X.
   * In hypothesis mode it is a hypothesis X, or a tentative stump being removed.
   * The result shows immediately; a following double tap is a separate call.
   * @param cell the tapped cell
   * @returns units that just became fully marked
   */
  tap(cell: number): readonly Unit[] {
    if (this.blocked || !this.inRange(cell)) {
      return [];
    }
    if (this.hypothesis) {
      if (this.hypoStump[cell]) {
        this.pushHypo([this.captureHypo(cell)]);
        this.hypoStump[cell] = 0;
        return [];
      }
      if (!this.canHypoMark(cell)) {
        return [];
      }
      this.pushHypo([this.captureHypo(cell)]);
      this.hypoX[cell] = this.hypoX[cell] ? 0 : 1;
      return [];
    }
    if (this.marks[cell] === CELL_X) {
      this.pushNormal([{ cell, mark: CELL_X }]);
      this.marks[cell] = CELL_OPEN;
      return this.refreshPulses();
    }
    if (this.marks[cell] === CELL_OPEN) {
      this.pushNormal([{ cell, mark: CELL_OPEN }]);
      this.marks[cell] = CELL_X;
      return this.refreshPulses();
    }
    return [];
  }

  /**
   * The second tap of a double tap. Normal play tries to reveal a stump.
   * Hypothesis mode places a tentative stump and does not spend an acorn.
   * @param cell the tapped cell
   * @returns what the reveal did, or a noop in hypothesis mode
   */
  doubleTap(cell: number): RevealResult {
    if (this.blocked || !this.inRange(cell)) {
      return noopResult(cell);
    }
    if (this.hypothesis) {
      if (this.marks[cell] === CELL_STUMP || this.marks[cell] === CELL_RED) {
        return noopResult(cell);
      }
      this.pushHypo([this.captureHypo(cell)]);
      this.hypoX[cell] = 0;
      this.hypoStump[cell] = 1;
      return noopResult(cell);
    }
    if (this.marks[cell] === CELL_STUMP || this.marks[cell] === CELL_RED) {
      return noopResult(cell);
    }
    if (this.solution.has(cell)) {
      return this.placeStump(cell);
    }
    return this.placeWrong(cell);
  }

  /**
   * Undoes one tap or one drag. Hypothesis mode undoes only scratch marks,
   * and never leaves the mode.
   * @returns units whose pulse state changed
   */
  undo(): readonly Unit[] {
    if (this.blocked) {
      return [];
    }
    if (this.hypothesis) {
      const step = this.hypothesisUndo.pop();
      if (!step) {
        return [];
      }
      for (const change of step) {
        this.hypoX[change.cell] = change.x ? 1 : 0;
        this.hypoStump[change.cell] = change.stump ? 1 : 0;
      }
      return [];
    }
    const step = this.normalUndo.pop();
    if (!step) {
      return [];
    }
    for (const change of step) {
      const current = this.marks[change.cell];
      if (current === CELL_STUMP || current === CELL_RED) {
        continue;
      }
      this.marks[change.cell] = change.mark;
    }
    return this.refreshPulses();
  }

  /** Turns hypothesis mode on. Leaving it is discard or keep, not another toggle. */
  enterHypothesis(): void {
    if (this.blocked || this.hypothesis) {
      return;
    }
    this.hypothesis = true;
  }

  /** Leaves hypothesis mode and throws away every scratch mark. */
  discardHypothesis(): void {
    if (this.blocked || !this.hypothesis) {
      return;
    }
    this.hypoX.fill(0);
    this.hypoStump.fill(0);
    this.hypothesisUndo = [];
    this.hypothesis = false;
  }

  /**
   * Leaves hypothesis mode. Scratch X's become normal X's and tentative stumps
   * are removed. The conversion itself is not an undo step.
   * @returns units that just became fully marked
   */
  keepHypothesis(): readonly Unit[] {
    if (this.blocked || !this.hypothesis) {
      return [];
    }
    for (let cell = 0; cell < this.marks.length; cell++) {
      if (this.hypoX[cell] && this.marks[cell] === CELL_OPEN) {
        this.marks[cell] = CELL_X;
        this.seal(cell);
      }
      this.hypoX[cell] = 0;
      this.hypoStump[cell] = 0;
    }
    this.hypothesisUndo = [];
    this.hypothesis = false;
    return this.refreshPulses();
  }

  /**
   * Reveals the stump in the region with the fewest open squares.
   * @returns the reveal, or null if the hint is already used or there is nothing to reveal
   */
  useWoodpecker(): RevealResult | null {
    if (this.hints.woodpecker || !this.hintsAvailable()) {
      return null;
    }
    const cell = this.fewestRegionStump();
    if (cell === null) {
      return null;
    }
    this.hints.woodpecker = true;
    return this.placeStump(cell);
  }

  /**
   * Places X's on up to three random unmarked squares that are not stumps.
   * @param rng random source returning a number in [0, 1)
   * @returns the cells marked, empty if the hint is unavailable or nothing qualifies
   */
  useSquirrel(rng: () => number): EliminateResult {
    const empty = { cells: [], pulses: [] };
    if (this.hints.squirrel || !this.hintsAvailable()) {
      return empty;
    }
    const candidates: number[] = [];
    for (let cell = 0; cell < this.marks.length; cell++) {
      if (this.marks[cell] === CELL_OPEN && !this.solution.has(cell)) {
        candidates.push(cell);
      }
    }
    if (candidates.length === 0) {
      return empty;
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const swap = candidates[i];
      candidates[i] = candidates[j] ?? swap;
      candidates[j] = swap;
    }
    const chosen = candidates.slice(0, 3);
    this.hints.squirrel = true;
    for (const cell of chosen) {
      this.marks[cell] = CELL_X;
      this.hypoX[cell] = 0;
      this.hypoStump[cell] = 0;
      this.seal(cell);
    }
    return { cells: chosen, pulses: this.refreshPulses() };
  }

  /**
   * Opens the owl. A wrong X is explained before any deduction. Nothing is
   * written onto the board until `closeOwl`.
   * @returns false when the hint is unavailable or there is nothing to say
   */
  openOwl(): boolean {
    if (this.hints.owl || !this.hintsAvailable()) {
      return false;
    }
    const wrong: number[] = [];
    for (let cell = 0; cell < this.marks.length; cell++) {
      if (this.marks[cell] === CELL_X && this.solution.has(cell)) {
        wrong.push(cell);
      }
    }
    if (wrong.length > 0) {
      const text = wrong.length === 1
        ? 'This X sits on a stump. It will be removed.'
        : 'These X\'s sit on stumps. They will be removed.';
      this.explanation = {
        page: 0,
        pages: [{ text, cells: wrong, focus: wrong }],
        effect: { type: 'clear-x', cells: wrong },
      };
      this.hints.owl = true;
      return true;
    }
    const step = nextStep(this.puzzle, this.engineState());
    if (!step) {
      return false;
    }
    this.explanation = { page: 0, pages: pagesForStep(this.puzzle, step), effect: { type: 'step', step } };
    this.hints.owl = true;
    return true;
  }

  /**
   * @returns the page currently shown, or null when the owl is closed
   */
  explainPage(): ExplainPage | null {
    return this.explanation?.pages[this.explanation.page] ?? null;
  }

  /**
   * @returns the page position, or null when the owl is closed
   */
  explainIndex(): { page: number; total: number } | null {
    if (!this.explanation) {
      return null;
    }
    return { page: this.explanation.page, total: this.explanation.pages.length };
  }

  /**
   * Moves through a multi-step explanation.
   * @param delta -1 or 1
   */
  stepExplain(delta: number): void {
    if (!this.explanation) {
      return;
    }
    const next = this.explanation.page + delta;
    if (next >= 0 && next < this.explanation.pages.length) {
      this.explanation.page = next;
    }
  }

  /**
   * Closes the owl and makes its mark: clearing a wrong X, placing X's, or
   * revealing the stump a forced square found.
   * @returns a reveal when the mark was a stump, otherwise null
   */
  closeOwl(): RevealResult | null {
    const explanation = this.explanation;
    if (!explanation) {
      return null;
    }
    this.explanation = null;
    return this.applyEffect(explanation.effect);
  }

  /**
   * @returns a plain object that round-trips through JSON
   */
  toJSON(): SavedSession {
    return {
      puzzle: this.puzzle,
      marks: [...this.marks],
      hypoX: [...this.hypoX],
      hypoStump: [...this.hypoStump],
      hypothesis: this.hypothesis,
      acornsLeft: this.acornsLeft,
      hints: { ...this.hints },
      undo: this.normalUndo.map((step) => step.map((change) => ({ ...change }))),
      hypoUndo: this.hypothesisUndo.map((step) => step.map((change) => ({ ...change }))),
      status: this.status,
      elapsedMs: this.elapsedMs,
      isRepeat: this.isRepeat,
      perfectlyMarked: this.perfectlyMarked,
      recorded: this.recorded,
      explanation: this.explanation
        ? { page: this.explanation.page, pages: this.explanation.pages, effect: this.explanation.effect }
        : null,
      pulsed: [...this.pulsed],
    };
  }

  /**
   * Restores a session from storage.
   * @param saved the object read from JSON
   * @returns the session, or null if the payload is not a board we can play
   */
  static revive(saved: SavedSession): Session | null {
    const puzzle = saved.puzzle;
    const count = puzzle?.size * puzzle?.size;
    if (!puzzle || !Number.isInteger(puzzle.size) || saved.marks?.length !== count) {
      return null;
    }
    const session = new Session(puzzle, { isRepeat: saved.isRepeat });
    session.marks.set(saved.marks);
    if (saved.hypoX?.length === count) {
      session.hypoX.set(saved.hypoX);
    }
    if (saved.hypoStump?.length === count) {
      session.hypoStump.set(saved.hypoStump);
    }
    session.hypothesis = saved.hypothesis === true;
    session.acornsLeft = saved.acornsLeft;
    session.hints.woodpecker = saved.hints?.woodpecker === true;
    session.hints.owl = saved.hints?.owl === true;
    session.hints.squirrel = saved.hints?.squirrel === true;
    session.normalUndo = saved.undo?.map((step) => [...step]) ?? [];
    session.hypothesisUndo = saved.hypoUndo?.map((step) => [...step]) ?? [];
    session.status = saved.status ?? 'playing';
    session.elapsedMs = saved.elapsedMs ?? 0;
    session.perfectlyMarked = saved.perfectlyMarked === true;
    session.recorded = saved.recorded === true;
    session.explanation = saved.explanation ?? null;
    session.pulsed = new Set(saved.pulsed ?? []);
    return session;
  }

  /* --------------------------------------------------------- *\
   *  Internal                                                *
  \* --------------------------------------------------------- */

  private get blocked(): boolean {
    return this.inputLocked || this.explanation !== null || this.status !== 'playing';
  }

  private inRange(cell: number): boolean {
    return cell >= 0 && cell < this.marks.length;
  }

  /** A hypothesis mark can land on an empty square or replace a hypothesis X, never a normal mark. */
  private canHypoMark(cell: number): boolean {
    return this.marks[cell] === CELL_OPEN;
  }

  private strokeMode(cell: number): 'place' | 'erase' | 'ignore' {
    if (this.hypothesis) {
      if (!this.canHypoMark(cell) || this.hypoStump[cell]) {
        return 'ignore';
      }
      return this.hypoX[cell] ? 'erase' : 'place';
    }
    if (this.marks[cell] === CELL_X) {
      return 'erase';
    }
    if (this.marks[cell] === CELL_OPEN) {
      return 'place';
    }
    return 'ignore';
  }

  private extendNormal(stroke: Stroke, cell: number): void {
    const before = this.marks[cell] as CellMark;
    if (stroke.mode === 'place' && before === CELL_OPEN) {
      this.marks[cell] = CELL_X;
    } else if (stroke.mode === 'erase' && before === CELL_X) {
      this.marks[cell] = CELL_OPEN;
    } else {
      return;
    }
    stroke.normal.push({ cell, mark: before });
  }

  private extendHypothesis(stroke: Stroke, cell: number): void {
    if (stroke.mode === 'place') {
      if (!this.canHypoMark(cell) || this.hypoX[cell] || this.hypoStump[cell]) {
        return;
      }
      stroke.hypoChanges.push(this.captureHypo(cell));
      this.hypoX[cell] = 1;
      return;
    }
    if (!this.hypoX[cell]) {
      return;
    }
    stroke.hypoChanges.push(this.captureHypo(cell));
    this.hypoX[cell] = 0;
  }

  private captureHypo(cell: number): HypoChange {
    return { cell, x: this.hypoX[cell] === 1, stump: this.hypoStump[cell] === 1 };
  }

  private pushNormal(changes: readonly NormalChange[]): void {
    if (changes.length > 0) {
      this.normalUndo.push([...changes]);
    }
  }

  private pushHypo(changes: readonly HypoChange[]): void {
    if (changes.length > 0) {
      this.hypothesisUndo.push([...changes]);
    }
  }

  /** Drops a cell out of the undo stack so a reveal or hint cannot be undone. */
  private seal(cell: number): void {
    this.normalUndo = this.normalUndo
      .map((step) => step.filter((change) => change.cell !== cell))
      .filter((step) => step.length > 0);
  }

  private placeStump(cell: number): RevealResult {
    this.marks[cell] = CELL_STUMP;
    this.hypoX[cell] = 0;
    this.hypoStump[cell] = 0;
    this.seal(cell);
    const pulses = this.refreshPulses();
    const won = this.revealedCount() === this.puzzle.size;
    if (won) {
      this.status = 'won';
      this.perfectlyMarked = this.noOpenSquares();
    }
    return {
      type: 'correct',
      cell,
      conflicts: [],
      won,
      lost: false,
      perfectlyMarked: this.perfectlyMarked,
      pulses,
    };
  }

  private placeWrong(cell: number): RevealResult {
    const stumps: number[] = [];
    this.marks.forEach((mark, index) => {
      if (mark === CELL_STUMP) {
        stumps.push(index);
      }
    });
    const found = conflicts(this.puzzle, cell, stumps);
    this.marks[cell] = CELL_RED;
    this.hypoX[cell] = 0;
    this.hypoStump[cell] = 0;
    this.seal(cell);
    this.acornsLeft -= 1;
    const lost = this.acornsLeft <= 0;
    if (lost) {
      this.status = 'lost';
    }
    return {
      type: 'wrong',
      cell,
      conflicts: found,
      won: false,
      lost,
      perfectlyMarked: false,
      pulses: [],
    };
  }

  private fewestRegionStump(): number | null {
    const { size, regions, solution } = this.puzzle;
    const stumpOf = new Array<number>(size).fill(-1);
    for (const cell of solution) {
      stumpOf[regions[cell]] = cell;
    }
    let bestRegion = -1;
    let bestOpen = Number.POSITIVE_INFINITY;
    for (let region = 0; region < size; region++) {
      const stump = stumpOf[region] ?? -1;
      if (stump < 0 || this.marks[stump] === CELL_STUMP) {
        continue;
      }
      let open = 0;
      for (let cell = 0; cell < regions.length; cell++) {
        if (regions[cell] === region && this.marks[cell] === CELL_OPEN) {
          open += 1;
        }
      }
      if (open < bestOpen) {
        bestOpen = open;
        bestRegion = region;
      }
    }
    return bestRegion < 0 ? null : stumpOf[bestRegion] ?? null;
  }

  private applyEffect(effect: ExplainEffect): RevealResult | null {
    if (effect.type === 'clear-x') {
      for (const cell of effect.cells) {
        if (this.marks[cell] === CELL_X) {
          this.marks[cell] = CELL_OPEN;
        }
        this.seal(cell);
      }
      this.refreshPulses();
      return null;
    }
    let placed: number | null = null;
    if (effect.step.type === 'forced' && this.marks[effect.step.place] !== CELL_STUMP) {
      placed = effect.step.place;
      this.marks[placed] = CELL_STUMP;
      this.hypoX[placed] = 0;
      this.hypoStump[placed] = 0;
      this.seal(placed);
    }
    for (const cell of effect.step.eliminated) {
      if (this.marks[cell] === CELL_OPEN) {
        this.marks[cell] = CELL_X;
        this.hypoX[cell] = 0;
        this.hypoStump[cell] = 0;
        this.seal(cell);
      }
    }
    const pulses = this.refreshPulses();
    if (placed === null) {
      return null;
    }
    const won = this.revealedCount() === this.puzzle.size;
    if (won) {
      this.status = 'won';
      this.perfectlyMarked = this.noOpenSquares();
    }
    return {
      type: 'correct',
      cell: placed,
      conflicts: [],
      won,
      lost: false,
      perfectlyMarked: this.perfectlyMarked,
      pulses,
    };
  }

  private engineState(): Uint8Array {
    const state = new Uint8Array(this.marks.length);
    for (let cell = 0; cell < this.marks.length; cell++) {
      const mark = this.marks[cell];
      if (mark === CELL_STUMP) {
        state[cell] = STUMP;
      } else if (mark === CELL_X || mark === CELL_RED) {
        state[cell] = EXCLUDED;
      } else {
        state[cell] = OPEN;
      }
    }
    return state;
  }

  private noOpenSquares(): boolean {
    for (const mark of this.marks) {
      if (mark === CELL_OPEN) {
        return false;
      }
    }
    return true;
  }

  /**
   * A unit pulses once when a revealed stump's other squares are all marked.
   * Removing a mark arms it to pulse again the next time it is completed.
   */
  private refreshPulses(): readonly Unit[] {
    const fresh: Unit[] = [];
    for (const unit of allUnits(this.puzzle)) {
      const key = `${unit.kind}:${unit.index}`;
      const cells = unitCells(this.puzzle, unit);
      const complete = cells.some((cell) => this.marks[cell] === CELL_STUMP)
        && cells.every((cell) => this.marks[cell] !== CELL_OPEN);
      if (complete) {
        if (!this.pulsed.has(key)) {
          this.pulsed.add(key);
          fresh.push(unit);
        }
      } else {
        this.pulsed.delete(key);
      }
    }
    return fresh;
  }
}
