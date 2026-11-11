import {
  allUnits, applyStep, conflicts, describeStep, EXCLUDED, nextStep, OPEN, type Puzzle, type Step, STUMP,
  type Unit, unitCells,
} from '../engine';
import {
  type ActiveExplanation, type CellChange, HINT_KINDS, type HintKind, type HintsUsed, HYP_NONE, HYP_STUMP, HYP_X,
  type HypothesisMark, MARK_OPEN, MARK_RED_X, MARK_STUMP, MARK_X, type NormalMark, type PuzzleStatus,
  type RevealResult, type SavedPuzzleState, type SolveRecord, type UndoStep,
} from './types';

/** Maximum interval in milliseconds between two taps on the same square to count as a double tap. */
export const DOUBLE_TAP_MS = 350;

interface ActiveStroke {
  readonly mode: 'normal' | 'hypothesis';
  readonly action: 'place-x' | 'erase-x' | 'place-hyp-x' | 'erase-hyp-x' | 'remove-hyp-stump';
  readonly startCell: number;
  lastCell: number;
  readonly changes: CellChange[];
  readonly changedCells: Set<number>;
}

interface LastTapInfo {
  readonly cell: number;
  readonly timeMs: number;
  readonly mode: 'normal' | 'hypothesis';
  readonly priorMark: number;
  readonly priorPulsedUnits: string[];
  committedUndo: boolean;
}

/** Result of a `pointerDown` or `pointerMove` gesture on the board. */
export interface GestureResult {
  /** What kind of gesture occurred. */
  readonly kind: 'tap-or-drag' | 'double-tap' | 'noop';
  /** Cells whose marks changed during this event. */
  readonly changedCells: readonly number[];
  /** Cells belonging to units that newly became completely marked (for pulse animation). */
  readonly pulsedCells: readonly number[];
  /** Reveal result if a double-tap in normal mode attempted a reveal. */
  readonly reveal?: RevealResult;
}

const unitKey = (unit: Unit): string => `${unit.kind}:${unit.index}`;

/**
 * Manages the complete playable state of a single Stumped puzzle, including
 * normal marks, hypothesis scratch marks, separate undo stacks, hints,
 * conflict detection, unit pulse detection, and serialization.
 */
export class GameSession {
  /** The underlying puzzle definition. */
  public readonly puzzle: Puzzle;

  private status: PuzzleStatus;
  private readonly normalMarks: NormalMark[];
  private readonly lockedCells: Set<number>;
  private hypothesisMode: boolean;
  private readonly hypothesisMarks: HypothesisMark[];
  private readonly normalUndoStack: UndoStep[];
  private readonly hypothesisUndoStack: UndoStep[];
  private acorns: number;
  private acornsLost: number;
  private hintsUsed: HintsUsed;
  private elapsedMs: number;
  private readonly repeat: boolean;
  private perfectlyMarked: boolean;
  private readonly pulsedUnits: Set<string>;
  private activeExplanation: ActiveExplanation | null = null;
  private activeStroke: ActiveStroke | null = null;
  private lastTap: LastTapInfo | null = null;

  private constructor(state: SavedPuzzleState) {
    this.puzzle = state.puzzle;
    this.status = state.status;
    this.normalMarks = [...state.normalMarks];
    this.lockedCells = new Set(state.lockedCells);
    this.hypothesisMode = state.hypothesisMode;
    this.hypothesisMarks = [...state.hypothesisMarks];
    this.normalUndoStack = state.normalUndoStack.map((s) => ({ changes: [...s.changes] }));
    this.hypothesisUndoStack = state.hypothesisUndoStack.map((s) => ({ changes: [...s.changes] }));
    this.acorns = state.acorns;
    this.acornsLost = state.acornsLost;
    this.hintsUsed = { ...state.hintsUsed };
    this.elapsedMs = state.elapsedMs;
    this.repeat = state.repeat;
    this.perfectlyMarked = state.perfectlyMarked;
    this.pulsedUnits = new Set(state.pulsedUnits);
  }

  /**
   * Starts a fresh session for the given puzzle.
   * @param puzzle generated puzzle
   * @param repeat true if this puzzle code has been played before on this device
   * @returns a new GameSession
   */
  public static fromPuzzle(puzzle: Puzzle, repeat = false): GameSession {
    const total = puzzle.size * puzzle.size;
    const normalMarks = new Array<NormalMark>(total).fill(MARK_OPEN);
    const lockedCells: number[] = [];
    for (const given of puzzle.givens) {
      normalMarks[given] = MARK_STUMP;
      lockedCells.push(given);
    }
    const session = new GameSession({
      puzzle,
      status: 'in_progress',
      normalMarks,
      lockedCells,
      hypothesisMode: false,
      hypothesisMarks: new Array<HypothesisMark>(total).fill(HYP_NONE),
      normalUndoStack: [],
      hypothesisUndoStack: [],
      acorns: puzzle.silver ? 1 : 3,
      acornsLost: 0,
      hintsUsed: { reveal: false, explain: false, eliminate: false },
      elapsedMs: 0,
      repeat,
      perfectlyMarked: false,
      pulsedUnits: [],
    });
    // Pre-mark any unit that starts already complete (such as a 1-cell region given) so it doesn't pulse later.
    session.syncCompleteUnits();
    return session;
  }

  /**
   * Restores a session from saved persistence state.
   * @param state saved puzzle state
   * @returns restored GameSession
   */
  public static fromSaved(state: SavedPuzzleState): GameSession {
    return new GameSession(state);
  }

  /* ========================================================= *\
   *  Getters                                                  *
  \* ========================================================= */

  /** @returns current puzzle status ('in_progress', 'won', or 'lost') */
  public getStatus(): PuzzleStatus {
    return this.status;
  }

  /** @returns current normal-layer marks for all cells */
  public getNormalMarks(): readonly NormalMark[] {
    return this.normalMarks;
  }

  /** @returns current hypothesis-layer marks for all cells */
  public getHypothesisMarks(): readonly HypothesisMark[] {
    return this.hypothesisMarks;
  }

  /** @returns whether hypothesis scratch mode is currently active */
  public isHypothesisMode(): boolean {
    return this.hypothesisMode;
  }

  /** @returns remaining acorns (lives) */
  public getAcorns(): number {
    return this.acorns;
  }

  /** @returns maximum acorns this puzzle started with (1 for silver, 3 otherwise) */
  public getMaxAcorns(): number {
    return this.puzzle.silver ? 1 : 3;
  }

  /** @returns number of acorns lost so far */
  public getAcornsLost(): number {
    return this.acornsLost;
  }

  /** @returns count of currently revealed stumps on the board */
  public getRevealedStumpCount(): number {
    return this.normalMarks.filter((m) => m === MARK_STUMP).length;
  }

  /** @returns cells of all currently revealed stumps */
  public getRevealedStumps(): number[] {
    const cells: number[] = [];
    this.normalMarks.forEach((mark, cell) => {
      if (mark === MARK_STUMP) {
        cells.push(cell);
      }
    });
    return cells;
  }

  /** @returns cells of all tentative stumps in the hypothesis layer */
  public getTentativeStumps(): number[] {
    const cells: number[] = [];
    this.hypothesisMarks.forEach((mark, cell) => {
      if (mark === HYP_STUMP) {
        cells.push(cell);
      }
    });
    return cells;
  }

  /** @returns which hints have been used in this puzzle */
  public getHintsUsed(): HintsUsed {
    return this.hintsUsed;
  }

  /** @returns elapsed play time in milliseconds */
  public getElapsedMs(): number {
    return this.elapsedMs;
  }

  /** @returns whether this play is a repeat of a previously played puzzle */
  public isRepeat(): boolean {
    return this.repeat;
  }

  /** @returns whether the puzzle was won with every non-stump square marked */
  public isPerfectlyMarked(): boolean {
    return this.perfectlyMarked;
  }

  /** @returns whether the active undo stack has at least one step */
  public canUndo(): boolean {
    if (this.status !== 'in_progress' || this.activeExplanation !== null) {
      return false;
    }
    return this.hypothesisMode
      ? this.hypothesisUndoStack.length > 0
      : this.normalUndoStack.length > 0;
  }

  /** @returns active Owl explanation overlay state, or null */
  public getActiveExplanation(): ActiveExplanation | null {
    return this.activeExplanation;
  }

  /**
   * Advances the puzzle timer if the puzzle is in progress.
   * @param deltaMs milliseconds to add
   */
  public tick(deltaMs: number): void {
    if (this.status === 'in_progress' && deltaMs > 0) {
      this.elapsedMs += deltaMs;
    }
  }

  /* ========================================================= *\
   *  Tentative stump conflict flagging                        *
  \* ========================================================= */

  /**
   * Lists tentative stumps that break one of the four placement rules against
   * a revealed stump or another tentative stump, along with their conflicts.
   * @returns map from flagged tentative stump cell to its conflicts
   */
  public getFlaggedTentativeStumps(): Map<number, ReturnType<typeof conflicts>> {
    const flagged = new Map<number, ReturnType<typeof conflicts>>();
    if (!this.hypothesisMode) {
      return flagged;
    }
    const revealed = this.getRevealedStumps();
    const tentative = this.getTentativeStumps();
    const allStumps = [...revealed, ...tentative];
    for (const cell of tentative) {
      const broken = conflicts(this.puzzle, cell, allStumps);
      if (broken.length > 0) {
        flagged.set(cell, broken);
      }
    }
    return flagged;
  }

  /* ========================================================= *\
   *  Board gestures: tap, drag, double tap                    *
  \* ========================================================= */

  /**
   * Handles pointer-down on a board square.
   * Single taps take effect immediately; a second tap on the same square within
   * `DOUBLE_TAP_MS` reverts the first tap's toggle and performs a double-tap.
   * @param cell cell index (`row * size + col`)
   * @param nowMs current timestamp in milliseconds
   * @returns gesture outcome and affected cells
   */
  public pointerDown(cell: number, nowMs: number): GestureResult {
    if (this.status !== 'in_progress' || this.activeExplanation !== null) {
      return { kind: 'noop', changedCells: [], pulsedCells: [] };
    }
    if (cell < 0 || cell >= this.normalMarks.length) {
      return { kind: 'noop', changedCells: [], pulsedCells: [] };
    }

    const mode = this.hypothesisMode ? 'hypothesis' : 'normal';

    // Check if this is the second tap of a double-tap on the same cell.
    if (
      this.lastTap !== null
      && this.lastTap.cell === cell
      && this.lastTap.mode === mode
      && nowMs - this.lastTap.timeMs <= DOUBLE_TAP_MS
    ) {
      const tapInfo = this.lastTap;
      this.lastTap = null;
      this.activeStroke = null;

      // Revert the first tap's immediate mark change and undo step.
      if (tapInfo.mode === 'normal') {
        if (tapInfo.committedUndo) {
          this.normalUndoStack.pop();
        }
        this.normalMarks[cell] = tapInfo.priorMark as NormalMark;
        this.pulsedUnits.clear();
        for (const key of tapInfo.priorPulsedUnits) {
          this.pulsedUnits.add(key);
        }
        const reveal = this.revealCell(cell);
        return {
          kind: 'double-tap',
          changedCells: reveal.outcome === 'noop' ? [] : [cell],
          pulsedCells: reveal.pulsedCells,
          reveal,
        };
      }

      // Hypothesis mode double-tap: place a tentative stump.
      if (tapInfo.committedUndo) {
        this.hypothesisUndoStack.pop();
      }
      const priorHyp = tapInfo.priorMark as HypothesisMark;
      this.hypothesisMarks[cell] = priorHyp;
      if (this.normalMarks[cell] !== MARK_OPEN) {
        return { kind: 'noop', changedCells: [], pulsedCells: [] };
      }
      if (priorHyp !== HYP_STUMP) {
        this.hypothesisMarks[cell] = HYP_STUMP;
        this.hypothesisUndoStack.push({
          changes: [{ cell, before: priorHyp, after: HYP_STUMP }],
        });
      }
      return { kind: 'double-tap', changedCells: [cell], pulsedCells: [] };
    }

    // Otherwise, start a new tap or drag stroke immediately.
    if (this.hypothesisMode) {
      if (this.normalMarks[cell] !== MARK_OPEN) {
        this.activeStroke = null;
        this.lastTap = null;
        return { kind: 'noop', changedCells: [], pulsedCells: [] };
      }
      const currentHyp = this.hypothesisMarks[cell];
      if (currentHyp === HYP_STUMP) {
        // Tapping a tentative stump removes it (does not start a multi-cell X drag or double-tap).
        this.hypothesisMarks[cell] = HYP_NONE;
        this.activeStroke = {
          mode: 'hypothesis',
          action: 'remove-hyp-stump',
          startCell: cell,
          lastCell: cell,
          changes: [{ cell, before: HYP_STUMP, after: HYP_NONE }],
          changedCells: new Set([cell]),
        };
        this.lastTap = null;
        return { kind: 'tap-or-drag', changedCells: [cell], pulsedCells: [] };
      }
      const nextHyp = currentHyp === HYP_NONE ? HYP_X : HYP_NONE;
      const action = currentHyp === HYP_NONE ? 'place-hyp-x' : 'erase-hyp-x';
      this.hypothesisMarks[cell] = nextHyp;
      this.activeStroke = {
        mode: 'hypothesis',
        action,
        startCell: cell,
        lastCell: cell,
        changes: [{ cell, before: currentHyp, after: nextHyp }],
        changedCells: new Set([cell]),
      };
      this.lastTap = {
        cell,
        timeMs: nowMs,
        mode: 'hypothesis',
        priorMark: currentHyp,
        priorPulsedUnits: [...this.pulsedUnits],
        committedUndo: false,
      };
      return { kind: 'tap-or-drag', changedCells: [cell], pulsedCells: [] };
    }

    // Normal mode single tap / drag start.
    const currentMark = this.normalMarks[cell];
    if (currentMark === MARK_STUMP || currentMark === MARK_RED_X) {
      this.activeStroke = null;
      this.lastTap = null;
      return { kind: 'noop', changedCells: [], pulsedCells: [] };
    }

    const priorPulsedUnits = [...this.pulsedUnits];
    const nextMark = currentMark === MARK_OPEN ? MARK_X : MARK_OPEN;
    const action = currentMark === MARK_OPEN ? 'place-x' : 'erase-x';
    this.normalMarks[cell] = nextMark;
    const pulsedCells = this.syncCompleteUnits();

    this.activeStroke = {
      mode: 'normal',
      action,
      startCell: cell,
      lastCell: cell,
      changes: [{ cell, before: currentMark, after: nextMark }],
      changedCells: new Set([cell]),
    };
    this.lastTap = {
      cell,
      timeMs: nowMs,
      mode: 'normal',
      priorMark: currentMark,
      priorPulsedUnits,
      committedUndo: false,
    };
    return { kind: 'tap-or-drag', changedCells: [cell], pulsedCells };
  }

  /**
   * Continues an active drag stroke across the given square.
   * Call this for every square crossed along the pointer path so fast strokes never skip squares.
   * @param cell cell index crossed by the drag stroke
   * @returns gesture outcome and affected cells
   */
  public pointerMove(cell: number): GestureResult {
    if (!this.activeStroke || this.status !== 'in_progress' || this.activeExplanation !== null) {
      return { kind: 'noop', changedCells: [], pulsedCells: [] };
    }
    if (cell < 0 || cell >= this.normalMarks.length || cell === this.activeStroke.lastCell) {
      return { kind: 'noop', changedCells: [], pulsedCells: [] };
    }
    this.activeStroke.lastCell = cell;

    // Moving to a different square turns the gesture into a drag, canceling double-tap detection.
    if (cell !== this.activeStroke.startCell) {
      this.lastTap = null;
    }

    if (this.activeStroke.changedCells.has(cell)) {
      return { kind: 'noop', changedCells: [], pulsedCells: [] };
    }

    const { action } = this.activeStroke;
    if (action === 'place-x') {
      if (this.normalMarks[cell] === MARK_OPEN) {
        this.normalMarks[cell] = MARK_X;
        this.activeStroke.changes.push({ cell, before: MARK_OPEN, after: MARK_X });
        this.activeStroke.changedCells.add(cell);
        const pulsedCells = this.syncCompleteUnits();
        return { kind: 'tap-or-drag', changedCells: [cell], pulsedCells };
      }
      return { kind: 'noop', changedCells: [], pulsedCells: [] };
    }

    if (action === 'erase-x') {
      if (this.normalMarks[cell] === MARK_X) {
        this.normalMarks[cell] = MARK_OPEN;
        this.activeStroke.changes.push({ cell, before: MARK_X, after: MARK_OPEN });
        this.activeStroke.changedCells.add(cell);
        this.syncCompleteUnits();
        return { kind: 'tap-or-drag', changedCells: [cell], pulsedCells: [] };
      }
      return { kind: 'noop', changedCells: [], pulsedCells: [] };
    }

    if (action === 'place-hyp-x') {
      if (this.normalMarks[cell] === MARK_OPEN && this.hypothesisMarks[cell] === HYP_NONE) {
        this.hypothesisMarks[cell] = HYP_X;
        this.activeStroke.changes.push({ cell, before: HYP_NONE, after: HYP_X });
        this.activeStroke.changedCells.add(cell);
        return { kind: 'tap-or-drag', changedCells: [cell], pulsedCells: [] };
      }
      return { kind: 'noop', changedCells: [], pulsedCells: [] };
    }

    if (action === 'erase-hyp-x') {
      if (this.normalMarks[cell] === MARK_OPEN && this.hypothesisMarks[cell] === HYP_X) {
        this.hypothesisMarks[cell] = HYP_NONE;
        this.activeStroke.changes.push({ cell, before: HYP_X, after: HYP_NONE });
        this.activeStroke.changedCells.add(cell);
        return { kind: 'tap-or-drag', changedCells: [cell], pulsedCells: [] };
      }
      return { kind: 'noop', changedCells: [], pulsedCells: [] };
    }

    return { kind: 'noop', changedCells: [], pulsedCells: [] };
  }

  /**
   * Finishes the current tap or drag stroke, committing its changes as a single step
   * on the active undo stack.
   */
  public pointerUp(): void {
    if (!this.activeStroke) {
      return;
    }
    const stroke = this.activeStroke;
    this.activeStroke = null;
    if (stroke.changes.length === 0) {
      return;
    }
    const step: UndoStep = { changes: stroke.changes };
    if (stroke.mode === 'hypothesis') {
      this.hypothesisUndoStack.push(step);
    } else {
      this.normalUndoStack.push(step);
    }
    if (this.lastTap !== null) {
      this.lastTap.committedUndo = true;
    }
  }

  /* ========================================================= *\
   *  Reveals (normal mode)                                    *
  \* ========================================================= */

  /**
   * Attempts to reveal a stump on `cell` in normal play.
   * Can be invoked by a double-tap or directly.
   * @param cell cell index to reveal
   * @returns details of the reveal outcome
   */
  public revealCell(cell: number): RevealResult {
    if (
      this.status !== 'in_progress'
      || this.hypothesisMode
      || this.activeExplanation !== null
      || cell < 0
      || cell >= this.normalMarks.length
    ) {
      return {
        outcome: 'noop',
        cell,
        conflicts: [],
        pulsedCells: [],
        won: false,
        perfectlyMarked: false,
        lost: false,
      };
    }

    const current = this.normalMarks[cell];
    if (current === MARK_STUMP || current === MARK_RED_X) {
      return {
        outcome: 'noop',
        cell,
        conflicts: [],
        pulsedCells: [],
        won: false,
        perfectlyMarked: false,
        lost: false,
      };
    }

    this.lastTap = null;
    this.activeStroke = null;

    if (this.puzzle.solution.includes(cell)) {
      this.setPermanentNormalMark(cell, MARK_STUMP);
      const pulsedCells = this.syncCompleteUnits();
      const won = this.checkWin();
      return {
        outcome: 'correct',
        cell,
        conflicts: [],
        pulsedCells,
        won,
        perfectlyMarked: this.perfectlyMarked,
        lost: false,
      };
    }

    // Wrong reveal: check conflicts against already-revealed stumps, place red X, lose 1 acorn.
    const broken = conflicts(this.puzzle, cell, this.getRevealedStumps());
    this.setPermanentNormalMark(cell, MARK_RED_X);
    this.acorns = Math.max(0, this.acorns - 1);
    this.acornsLost += 1;
    const pulsedCells = this.syncCompleteUnits();
    const lost = this.acorns === 0;
    if (lost) {
      this.status = 'lost';
    }
    return {
      outcome: 'wrong',
      cell,
      conflicts: broken,
      pulsedCells,
      won: false,
      perfectlyMarked: false,
      lost,
    };
  }

  /* ========================================================= *\
   *  Undo                                                     *
  \* ========================================================= */

  /**
   * Undoes the most recent tap or drag stroke in the active mode (normal or hypothesis).
   * Reveals, lost acorns, and hint results are permanent and are never undone.
   * @returns the cells whose marks were reverted
   */
  public undo(): number[] {
    if (!this.canUndo()) {
      return [];
    }
    this.lastTap = null;
    this.activeStroke = null;

    if (this.hypothesisMode) {
      const step = this.hypothesisUndoStack.pop();
      if (!step) {
        return [];
      }
      const reverted: number[] = [];
      for (let i = step.changes.length - 1; i >= 0; i--) {
        const { cell, before } = step.changes[i];
        if (this.normalMarks[cell] === MARK_OPEN) {
          this.hypothesisMarks[cell] = before as HypothesisMark;
          reverted.push(cell);
        }
      }
      return reverted;
    }

    while (this.normalUndoStack.length > 0) {
      const step = this.normalUndoStack.pop()!;
      const reverted: number[] = [];
      for (let i = step.changes.length - 1; i >= 0; i--) {
        const { cell, before } = step.changes[i];
        if (!this.lockedCells.has(cell) && this.normalMarks[cell] !== MARK_STUMP && this.normalMarks[cell] !== MARK_RED_X) {
          this.normalMarks[cell] = before as NormalMark;
          reverted.push(cell);
        }
      }
      if (reverted.length > 0) {
        this.syncCompleteUnits();
        return reverted;
      }
    }
    return [];
  }

  /* ========================================================= *\
   *  Hypothesis mode                                          *
  \* ========================================================= */

  /**
   * Turns on hypothesis mode.
   */
  public enterHypothesis(): void {
    if (this.status !== 'in_progress' || this.hypothesisMode || this.activeExplanation !== null) {
      return;
    }
    this.pointerUp();
    this.lastTap = null;
    this.hypothesisMode = true;
    this.hypothesisMarks.fill(HYP_NONE);
    this.hypothesisUndoStack.length = 0;
  }

  /**
   * Leaves hypothesis mode via Discard: removes every tentative stump and hypothesis X.
   */
  public discardHypothesis(): void {
    if (!this.hypothesisMode) {
      return;
    }
    this.pointerUp();
    this.lastTap = null;
    this.hypothesisMarks.fill(HYP_NONE);
    this.hypothesisUndoStack.length = 0;
    this.hypothesisMode = false;
  }

  /**
   * Leaves hypothesis mode via Keep: turns hypothesis X's into normal X's and
   * removes tentative stumps. Cannot be undone.
   * @returns cells that newly became normal X's (and any unit pulse cells)
   */
  public keepHypothesis(): { keptCells: number[]; pulsedCells: number[] } {
    if (!this.hypothesisMode) {
      return { keptCells: [], pulsedCells: [] };
    }
    this.pointerUp();
    this.lastTap = null;
    const keptCells: number[] = [];
    this.hypothesisMarks.forEach((mark, cell) => {
      if (mark === HYP_X && this.normalMarks[cell] === MARK_OPEN) {
        this.normalMarks[cell] = MARK_X;
        // Lock kept cells against earlier normal undo steps so Keep cannot be undone.
        this.stripCellsFromNormalUndo([cell]);
        keptCells.push(cell);
      }
    });
    this.hypothesisMarks.fill(HYP_NONE);
    this.hypothesisUndoStack.length = 0;
    this.hypothesisMode = false;
    const pulsedCells = this.syncCompleteUnits();
    return { keptCells, pulsedCells };
  }

  /* ========================================================= *\
   *  Hints: Woodpecker (Reveal), Owl (Explain), Squirrel      *
  \* ========================================================= */

  /**
   * Woodpecker (Reveal) hint: reveals the stump in the color region with the
   * fewest open squares.
   * @returns the revealed cell and any unit pulse / win state, or null if unavailable
   */
  public useRevealHint(): RevealResult | null {
    if (this.status !== 'in_progress' || this.hintsUsed.reveal || this.activeExplanation !== null) {
      return null;
    }
    this.pointerUp();
    this.lastTap = null;

    const { size, regions, solution } = this.puzzle;
    const revealedRegions = new Set<number>();
    this.normalMarks.forEach((mark, cell) => {
      if (mark === MARK_STUMP) {
        revealedRegions.add(regions[cell]);
      }
    });

    let bestRegion = -1;
    let fewestOpen = Infinity;
    for (let r = 0; r < size; r++) {
      if (revealedRegions.has(r)) {
        continue;
      }
      let openCount = 0;
      regions.forEach((region, cell) => {
        if (region === r && this.normalMarks[cell] === MARK_OPEN) {
          openCount++;
        }
      });
      // Prefer positive open counts over 0 if the player wrongly X'd an entire region,
      // but still fall back to 0 if needed.
      const effectiveOpen = openCount === 0 ? size * size + 1 : openCount;
      if (effectiveOpen < fewestOpen) {
        fewestOpen = effectiveOpen;
        bestRegion = r;
      }
    }

    if (bestRegion < 0) {
      return null;
    }

    const targetCell = solution.find((cell) => regions[cell] === bestRegion);
    if (targetCell === undefined) {
      return null;
    }

    this.hintsUsed = { ...this.hintsUsed, reveal: true };
    this.setPermanentNormalMark(targetCell, MARK_STUMP);
    const pulsedCells = this.syncCompleteUnits();
    const won = this.checkWin();
    return {
      outcome: 'correct',
      cell: targetCell,
      conflicts: [],
      pulsedCells,
      won,
      perfectlyMarked: this.perfectlyMarked,
      lost: false,
    };
  }

  /**
   * Owl (Explain) hint: starts the explanation overlay.
   * If any of the player's normal X's sits on a stump's square, points that out first.
   * Otherwise finds the simplest available deduction with `nextStep()`.
   * @returns the active explanation state, or null if hint already used / unavailable
   */
  public startExplainHint(): ActiveExplanation | null {
    if (this.status !== 'in_progress' || this.hintsUsed.explain || this.activeExplanation !== null) {
      return null;
    }
    this.pointerUp();
    this.lastTap = null;

    // Check if any player X sits on a solution stump's square.
    const wrongCell = this.puzzle.solution.find((cell) => this.normalMarks[cell] === MARK_X);
    if (wrongCell !== undefined) {
      this.hintsUsed = { ...this.hintsUsed, explain: true };
      this.activeExplanation = {
        type: 'wrong-x',
        cell: wrongCell,
        text: 'This X is on a square that holds a stump. Closing this hint removes the wrong X.',
      };
      return this.activeExplanation;
    }

    const solverState = this.toSolverState();
    const step = nextStep(this.puzzle, solverState);
    if (!step) {
      return null;
    }

    this.hintsUsed = { ...this.hintsUsed, explain: true };
    this.activeExplanation = {
      type: 'deduction',
      step,
      chainIndex: 0,
      text: describeStep(step),
    };
    return this.activeExplanation;
  }

  /**
   * Steps backward or forward through a multi-step chain explanation.
   * @param delta -1 for previous step, +1 for next step
   * @returns updated explanation state, or null if not in a chain explanation
   */
  public stepExplanation(delta: -1 | 1): ActiveExplanation | null {
    if (this.activeExplanation?.type !== 'deduction') {
      return this.activeExplanation;
    }
    const { step, chainIndex } = this.activeExplanation;
    if (step.type !== 'chain') {
      return this.activeExplanation;
    }
    const maxIndex = step.steps.length;
    const nextIndex = Math.max(0, Math.min(maxIndex, chainIndex + delta));
    const text = nextIndex === 0
      ? describeStep(step)
      : `Step ${nextIndex} of ${maxIndex}: ${describeStep(step.steps[nextIndex - 1])}`;
    this.activeExplanation = {
      type: 'deduction',
      step,
      chainIndex: nextIndex,
      text,
    };
    return this.activeExplanation;
  }

  /**
   * Closes the active Owl explanation and applies its resulting mark(s) to the board:
   * - For a wrong-X explanation: removes that wrong X.
   * - For a forced step: reveals the stump on that square.
   * - For any elimination/confinement/blocking/chain step: places permanent X's on the ruled-out squares.
   * @returns affected cells, pulsed cells, and whether the puzzle was won
   */
  public applyExplainHint(): { changedCells: number[]; pulsedCells: number[]; won: boolean; perfectlyMarked: boolean } {
    const exp = this.activeExplanation;
    if (!exp) {
      return { changedCells: [], pulsedCells: [], won: false, perfectlyMarked: false };
    }
    this.activeExplanation = null;

    if (exp.type === 'wrong-x') {
      this.normalMarks[exp.cell] = MARK_OPEN;
      this.stripCellsFromNormalUndo([exp.cell]);
      this.syncCompleteUnits();
      return { changedCells: [exp.cell], pulsedCells: [], won: false, perfectlyMarked: false };
    }

    const { step } = exp;
    const changedCells: number[] = [];
    if (step.type === 'forced') {
      this.setPermanentNormalMark(step.place, MARK_STUMP);
      changedCells.push(step.place);
    } else {
      for (const cell of step.eliminated) {
        if (this.normalMarks[cell] === MARK_OPEN) {
          this.setPermanentNormalMark(cell, MARK_X);
          changedCells.push(cell);
        }
      }
    }

    const pulsedCells = this.syncCompleteUnits();
    const won = this.checkWin();
    return { changedCells, pulsedCells, won, perfectlyMarked: this.perfectlyMarked };
  }

  /**
   * Squirrel (Eliminate) hint: places X's on up to three random unmarked squares
   * that hold no stump.
   * @param rng optional random number generator returning [0, 1)
   * @returns the cells that were marked with X's, plus any unit pulse cells
   */
  public useEliminateHint(rng: () => number = Math.random): { eliminatedCells: number[]; pulsedCells: number[] } | null {
    if (this.status !== 'in_progress' || this.hintsUsed.eliminate || this.activeExplanation !== null) {
      return null;
    }
    this.pointerUp();
    this.lastTap = null;

    const solutionSet = new Set(this.puzzle.solution);
    const candidates: number[] = [];
    this.normalMarks.forEach((mark, cell) => {
      if (mark === MARK_OPEN && !solutionSet.has(cell)) {
        candidates.push(cell);
      }
    });

    if (candidates.length === 0) {
      return null;
    }

    // Fisher-Yates partial shuffle to pick up to 3 random candidates.
    const count = Math.min(3, candidates.length);
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(rng() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const chosen = candidates.slice(0, count).sort((a, b) => a - b);

    this.hintsUsed = { ...this.hintsUsed, eliminate: true };
    for (const cell of chosen) {
      this.setPermanentNormalMark(cell, MARK_X);
    }
    const pulsedCells = this.syncCompleteUnits();
    return { eliminatedCells: chosen, pulsedCells };
  }

  /* ========================================================= *\
   *  Serialization and solve record                           *
  \* ========================================================= */

  /**
   * Serializes the session for localStorage persistence.
   * @returns serializable SavedPuzzleState
   */
  public toSavedState(): SavedPuzzleState {
    return {
      puzzle: this.puzzle,
      status: this.status,
      normalMarks: [...this.normalMarks],
      lockedCells: [...this.lockedCells],
      hypothesisMode: this.hypothesisMode,
      hypothesisMarks: [...this.hypothesisMarks],
      normalUndoStack: this.normalUndoStack.map((s) => ({ changes: [...s.changes] })),
      hypothesisUndoStack: this.hypothesisUndoStack.map((s) => ({ changes: [...s.changes] })),
      acorns: this.acorns,
      acornsLost: this.acornsLost,
      hintsUsed: { ...this.hintsUsed },
      elapsedMs: Math.round(this.elapsedMs),
      repeat: this.repeat,
      perfectlyMarked: this.perfectlyMarked,
      pulsedUnits: [...this.pulsedUnits],
    };
  }

  /**
   * Builds a SolveRecord when the puzzle is won.
   * @param completedAt completion timestamp (epoch ms)
   * @returns SolveRecord for Best Times
   */
  public toSolveRecord(completedAt = Date.now()): SolveRecord {
    const usedList: HintKind[] = HINT_KINDS.filter((k) => this.hintsUsed[k]);
    const clean = usedList.length === 0 && this.acornsLost === 0 && !this.repeat;
    return {
      code: this.puzzle.code,
      size: this.puzzle.size,
      tier: this.puzzle.tier,
      timeMs: Math.max(1, Math.round(this.elapsedMs)),
      hintsUsed: usedList,
      acornsLost: this.acornsLost,
      silver: this.puzzle.silver,
      repeat: this.repeat,
      clean,
      completedAt,
    };
  }

  /**
   * Simulates the solver state up to `chainIndex` for rendering a multi-step chain explanation.
   * @returns simulated state and active step at the current chain index
   */
  public getChainPreview(): { state: Uint8Array; activeSubStep: Step | null } | null {
    if (this.activeExplanation?.type !== 'deduction' || this.activeExplanation.step.type !== 'chain') {
      return null;
    }
    const { step, chainIndex } = this.activeExplanation;
    let sim = this.toSolverState();
    if (chainIndex > 0) {
      sim[step.cell] = STUMP;
      for (let i = 0; i < chainIndex; i++) {
        sim = applyStep(sim, step.steps[i]);
      }
    }
    const activeSubStep = chainIndex > 0 ? step.steps[chainIndex - 1] : null;
    return { state: sim, activeSubStep };
  }

  /* ========================================================= *\
   *  Internal helpers                                         *
  \* ========================================================= */

  private toSolverState(): Uint8Array {
    const state = new Uint8Array(this.normalMarks.length);
    this.normalMarks.forEach((mark, cell) => {
      if (mark === MARK_STUMP) {
        state[cell] = STUMP;
      } else if (mark === MARK_X || mark === MARK_RED_X) {
        state[cell] = EXCLUDED;
      } else {
        state[cell] = OPEN;
      }
    });
    return state;
  }

  private setPermanentNormalMark(cell: number, mark: NormalMark): void {
    this.normalMarks[cell] = mark;
    this.hypothesisMarks[cell] = HYP_NONE;
    this.lockedCells.add(cell);
    this.stripCellsFromNormalUndo([cell]);
    this.stripCellsFromHypothesisUndo([cell]);
  }

  private stripCellsFromNormalUndo(cells: readonly number[]): void {
    const cellSet = new Set(cells);
    for (let i = this.normalUndoStack.length - 1; i >= 0; i--) {
      const filtered = this.normalUndoStack[i].changes.filter((c) => !cellSet.has(c.cell));
      if (filtered.length === 0) {
        this.normalUndoStack.splice(i, 1);
      } else if (filtered.length !== this.normalUndoStack[i].changes.length) {
        this.normalUndoStack[i] = { changes: filtered };
      }
    }
  }

  private stripCellsFromHypothesisUndo(cells: readonly number[]): void {
    const cellSet = new Set(cells);
    for (let i = this.hypothesisUndoStack.length - 1; i >= 0; i--) {
      const filtered = this.hypothesisUndoStack[i].changes.filter((c) => !cellSet.has(c.cell));
      if (filtered.length === 0) {
        this.hypothesisUndoStack.splice(i, 1);
      } else if (filtered.length !== this.hypothesisUndoStack[i].changes.length) {
        this.hypothesisUndoStack[i] = { changes: filtered };
      }
    }
  }

  /**
   * Checks every unit (row, column, region). When a unit holds a revealed stump and
   * every other square in that unit is marked, records that unit and returns its
   * non-stump squares so the UI can pulse them once.
   */
  private syncCompleteUnits(): number[] {
    const newlyPulsedCells = new Set<number>();
    for (const unit of allUnits(this.puzzle)) {
      const key = unitKey(unit);
      const cells = unitCells(this.puzzle, unit);
      const stumpCells = cells.filter((c) => this.normalMarks[c] === MARK_STUMP);
      const allOthersMarked = stumpCells.length === 1
        && cells.every((c) => c === stumpCells[0] || this.normalMarks[c] === MARK_X || this.normalMarks[c] === MARK_RED_X);

      if (allOthersMarked) {
        if (!this.pulsedUnits.has(key)) {
          this.pulsedUnits.add(key);
          for (const c of cells) {
            if (c !== stumpCells[0]) {
              newlyPulsedCells.add(c);
            }
          }
        }
      } else {
        this.pulsedUnits.delete(key);
      }
    }
    return [...newlyPulsedCells].sort((a, b) => a - b);
  }

  private checkWin(): boolean {
    if (this.getRevealedStumpCount() === this.puzzle.size) {
      this.status = 'won';
      this.perfectlyMarked = this.normalMarks.every((mark) => mark !== MARK_OPEN);
      return true;
    }
    return false;
  }
}
