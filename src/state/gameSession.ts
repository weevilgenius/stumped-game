/* ========================================================= *\
 *  Game Session Engine & State Manager                      *
\* ========================================================= */

import {
  colOf, conflicts, type Conflict, describeStep, EXCLUDED,
  nextStep, OPEN, type Puzzle, rowOf, type Step, STUMP, type Unit, unitCells,
} from '../engine';
import {
  isCodePlayed, markCodePlayed, saveBestTime, saveSavedGame,
} from './storage';
import {
  type BestTimeRecord, type CellChange, type HintsUsed, HYPO_NONE, HYPO_STUMP, HYPO_X,
  type HypoMark, MARK_OPEN, MARK_RED_X, MARK_STUMP, MARK_X, type MarkResult,
  type NormalMark, type RevealResult, type SavedGameState, type UndoStep,
} from './types';

/**
 * Manages active puzzle gameplay state, marking, reveals, hints, and undo stacks.
 */
export class GameSession {
  /** Current puzzle. */
  public puzzle!: Puzzle;
  /** Normal marks array (row * size + col). */
  public normalMarks: NormalMark[] = [];
  /** Hypothesis marks array (row * size + col). */
  public hypoMarks: HypoMark[] = [];
  /** Acorns remaining. */
  public acorns: number = 3;
  /** Maximum starting acorns. */
  public maxAcorns: number = 3;
  /** Hints used in this puzzle. */
  public hintsUsed: HintsUsed = { woodpecker: false, owl: false, squirrel: false };
  /** Elapsed time in milliseconds. */
  public elapsedTimeMs: number = 0;
  /** Game status. */
  public status: 'playing' | 'won' | 'lost' = 'playing';
  /** Whether hypothesis mode is active. */
  public hypothesisMode: boolean = false;
  /** Whether this is a repeat play of the puzzle. */
  public isRepeat: boolean = false;
  /** Normal undo stack. */
  public undoStack: UndoStep[] = [];
  /** Hypothesis undo stack. */
  public hypoUndoStack: UndoStep[] = [];
  /** Timestamp when completed. */
  public completedAt?: string;
  /** Whether all squares on the board were marked when solved. */
  public perfectlyMarked: boolean = false;

  /** Completed units tracked to trigger pulse animation only once. */
  private completedUnits: Set<string> = new Set();

  /**
   * Initializes a game session with a new puzzle or restores from saved state.
   * @param puzzle the puzzle to play
   * @param options configuration options or saved state
   */
  public initialize(
    puzzle: Puzzle,
    options?: { isRepeat?: boolean, savedState?: SavedGameState },
  ): void {
    this.puzzle = puzzle;
    const totalCells = puzzle.size * puzzle.size;

    if (options?.savedState) {
      const s = options.savedState;
      this.normalMarks = [...s.normalMarks];
      this.hypoMarks = [...s.hypoMarks];
      this.acorns = s.acorns;
      this.maxAcorns = s.maxAcorns;
      this.hintsUsed = { ...s.hintsUsed };
      this.elapsedTimeMs = s.elapsedTimeMs;
      this.status = s.status;
      this.hypothesisMode = s.hypothesisMode;
      this.isRepeat = s.isRepeat;
      this.undoStack = [...s.undoStack];
      this.hypoUndoStack = [...s.hypoUndoStack];
      this.completedAt = s.completedAt;
      this.perfectlyMarked = s.perfectlyMarked ?? false;
    } else {
      this.normalMarks = new Array<NormalMark>(totalCells).fill(MARK_OPEN);
      this.hypoMarks = new Array<HypoMark>(totalCells).fill(HYPO_NONE);
      this.maxAcorns = puzzle.silver ? 1 : 3;
      this.acorns = this.maxAcorns;
      this.hintsUsed = { woodpecker: false, owl: false, squirrel: false };
      this.elapsedTimeMs = 0;
      this.status = 'playing';
      this.hypothesisMode = false;
      this.isRepeat = options?.isRepeat ?? isCodePlayed(puzzle.code);
      this.undoStack = [];
      this.hypoUndoStack = [];
      this.completedAt = undefined;
      this.perfectlyMarked = false;

      // Reveal any givens
      for (const given of puzzle.givens) {
        this.normalMarks[given] = MARK_STUMP;
      }
    }

    this.completedUnits = new Set();
    this.recalculateCompletedUnits();
    this.persist();
  }

  /**
   * Resets the current puzzle to an initial blank board for a retry.
   */
  public retry(): void {
    this.initialize(this.puzzle, { isRepeat: true });
  }

  /**
   * Persists current state to local storage.
   */
  public persist(): void {
    saveSavedGame(this.toSavedState());
  }

  /**
   * Converts current session to a serializable state object.
   * @returns serializable game state
   */
  public toSavedState(): SavedGameState {
    return {
      puzzle: this.puzzle,
      normalMarks: [...this.normalMarks],
      hypoMarks: [...this.hypoMarks],
      acorns: this.acorns,
      maxAcorns: this.maxAcorns,
      hintsUsed: { ...this.hintsUsed },
      elapsedTimeMs: this.elapsedTimeMs,
      status: this.status,
      hypothesisMode: this.hypothesisMode,
      isRepeat: this.isRepeat,
      undoStack: [...this.undoStack],
      hypoUndoStack: [...this.hypoUndoStack],
      completedAt: this.completedAt,
      perfectlyMarked: this.perfectlyMarked,
    };
  }

  /**
   * Returns list of currently revealed stump cells.
   * @returns array of stump cell indices
   */
  public getRevealedStumps(): number[] {
    const list: number[] = [];
    for (let i = 0; i < this.normalMarks.length; i++) {
      if (this.normalMarks[i] === MARK_STUMP) {
        list.push(i);
      }
    }
    return list;
  }

  /**
   * Returns list of tentative stump cells in hypothesis mode.
   * @returns array of tentative stump cell indices
   */
  public getTentativeStumps(): number[] {
    const list: number[] = [];
    for (let i = 0; i < this.hypoMarks.length; i++) {
      if (this.hypoMarks[i] === HYPO_STUMP) {
        list.push(i);
      }
    }
    return list;
  }

  /**
   * Checks whether a tentative stump breaks any placement rules against
   * revealed stumps or other tentative stumps.
   * @param cell cell index of tentative stump
   * @returns list of broken rule conflicts
   */
  public getHypoConflicts(cell: number): Conflict[] {
    const revealed = this.getRevealedStumps();
    const tentative = this.getTentativeStumps();
    const otherStumps = [...revealed, ...tentative.filter((c) => c !== cell)];
    return conflicts(this.puzzle, cell, otherStumps);
  }

  /**
   * Checks whether all squares on the board are marked (stump, normal X, or red X).
   * @returns true if no square is open
   */
  public isAllMarked(): boolean {
    return this.normalMarks.every((m) => m !== MARK_OPEN);
  }

  /**
   * Handles a tap on a cell.
   * @param cell cell index
   * @returns mark result or null if no change
   */
  public handleTap(cell: number): MarkResult | null {
    if (this.status !== 'playing') {
      return null;
    }

    if (this.hypothesisMode) {
      // In hypothesis mode, normal marks cannot be altered
      const normal = this.normalMarks[cell];
      if (normal === MARK_STUMP || normal === MARK_RED_X || normal === MARK_X) {
        return null;
      }
      const prevHypo = this.hypoMarks[cell];
      let nextHypo: HypoMark;

      if (prevHypo === HYPO_STUMP) {
        // Tapping a tentative stump removes it
        nextHypo = HYPO_NONE;
      } else if (prevHypo === HYPO_X) {
        nextHypo = HYPO_NONE;
      } else {
        nextHypo = HYPO_X;
      }

      this.hypoMarks[cell] = nextHypo;
      this.hypoUndoStack.push({
        mode: 'hypothesis',
        changes: [{ cell, from: prevHypo, to: nextHypo }],
      });
      this.persist();
      return {
        modifiedCells: [cell],
        newlyCompletedUnits: [],
        perfectlyMarked: false,
      };
    }

    // Normal play
    const current = this.normalMarks[cell];
    if (current === MARK_STUMP || current === MARK_RED_X) {
      return null;
    }

    const next = current === MARK_X ? MARK_OPEN : MARK_X;
    this.normalMarks[cell] = next;
    this.undoStack.push({
      mode: 'normal',
      changes: [{ cell, from: current, to: next }],
    });

    const newlyCompletedUnits = this.checkNewlyCompletedUnits();
    const allStumpsRevealed = this.getRevealedStumps().length === this.puzzle.size;
    const perfectlyMarked = allStumpsRevealed && this.isAllMarked();
    if (perfectlyMarked) {
      this.perfectlyMarked = true;
    }

    this.persist();
    return {
      modifiedCells: [cell],
      newlyCompletedUnits,
      perfectlyMarked,
    };
  }

  /**
   * Handles a drag stroke across multiple cells.
   * @param cells list of cell indices in stroke
   * @param action 'PLACE_X' or 'ERASE_X'
   * @returns mark result or null if no change
   */
  public handleDrag(cells: readonly number[], action: 'PLACE_X' | 'ERASE_X'): MarkResult | null {
    if (this.status !== 'playing' || cells.length === 0) {
      return null;
    }

    const changes: CellChange[] = [];
    const modifiedCells: number[] = [];

    if (this.hypothesisMode) {
      for (const cell of cells) {
        const normal = this.normalMarks[cell];
        if (normal === MARK_STUMP || normal === MARK_RED_X || normal === MARK_X) {
          continue;
        }
        const currentHypo = this.hypoMarks[cell];
        if (currentHypo === HYPO_STUMP) {
          continue; // Drags do not modify tentative stumps
        }

        if (action === 'PLACE_X' && currentHypo === HYPO_NONE) {
          this.hypoMarks[cell] = HYPO_X;
          changes.push({ cell, from: HYPO_NONE, to: HYPO_X });
          modifiedCells.push(cell);
        } else if (action === 'ERASE_X' && currentHypo === HYPO_X) {
          this.hypoMarks[cell] = HYPO_NONE;
          changes.push({ cell, from: HYPO_X, to: HYPO_NONE });
          modifiedCells.push(cell);
        }
      }

      if (changes.length > 0) {
        this.hypoUndoStack.push({ mode: 'hypothesis', changes });
        this.persist();
        return { modifiedCells, newlyCompletedUnits: [], perfectlyMarked: false };
      }
      return null;
    }

    // Normal play
    for (const cell of cells) {
      const current = this.normalMarks[cell];
      if (current === MARK_STUMP || current === MARK_RED_X) {
        continue;
      }

      if (action === 'PLACE_X' && current === MARK_OPEN) {
        this.normalMarks[cell] = MARK_X;
        changes.push({ cell, from: MARK_OPEN, to: MARK_X });
        modifiedCells.push(cell);
      } else if (action === 'ERASE_X' && current === MARK_X) {
        this.normalMarks[cell] = MARK_OPEN;
        changes.push({ cell, from: MARK_X, to: MARK_OPEN });
        modifiedCells.push(cell);
      }
    }

    if (changes.length > 0) {
      this.undoStack.push({ mode: 'normal', changes });
      const newlyCompletedUnits = this.checkNewlyCompletedUnits();
      const allStumpsRevealed = this.getRevealedStumps().length === this.puzzle.size;
      const perfectlyMarked = allStumpsRevealed && this.isAllMarked();
      if (perfectlyMarked) {
        this.perfectlyMarked = true;
      }
      this.persist();
      return { modifiedCells, newlyCompletedUnits, perfectlyMarked };
    }

    return null;
  }

  /**
   * Attempts to reveal a stump on a double tap.
   * In hypothesis mode, places a tentative stump.
   * In normal play, checks against the solution.
   * @param cell cell index to reveal
   * @returns reveal result or null if cell cannot be revealed
   */
  public attemptReveal(cell: number): RevealResult | null {
    if (this.status !== 'playing') {
      return null;
    }

    if (this.hypothesisMode) {
      // Hypothesis mode: place tentative stump
      const normal = this.normalMarks[cell];
      if (normal === MARK_STUMP || normal === MARK_RED_X || normal === MARK_X) {
        return null;
      }
      const prevHypo = this.hypoMarks[cell];
      this.hypoMarks[cell] = HYPO_STUMP;
      this.hypoUndoStack.push({
        mode: 'hypothesis',
        changes: [{ cell, from: prevHypo, to: HYPO_STUMP }],
      });
      this.persist();
      const conflictsList = this.getHypoConflicts(cell);
      return {
        correct: true,
        cell,
        won: false,
        lost: false,
        perfectlyMarked: false,
        newlyCompletedUnits: [],
        conflicts: conflictsList,
      };
    }

    // Normal play
    const current = this.normalMarks[cell];
    if (current === MARK_STUMP || current === MARK_RED_X) {
      return null;
    }

    const isStump = this.puzzle.solution.includes(cell);
    if (isStump) {
      this.normalMarks[cell] = MARK_STUMP;
      const newlyCompletedUnits = this.checkNewlyCompletedUnits();
      const revealedCount = this.getRevealedStumps().length;
      const won = revealedCount === this.puzzle.size;

      let perfectlyMarked = false;
      if (won) {
        this.status = 'won';
        this.completedAt = new Date().toISOString();
        perfectlyMarked = this.isAllMarked();
        this.perfectlyMarked = perfectlyMarked;
        this.recordBestTime();
      }

      this.persist();
      return {
        correct: true,
        cell,
        won,
        lost: false,
        perfectlyMarked,
        newlyCompletedUnits,
        conflicts: [],
      };
    }

    // Wrong reveal
    this.normalMarks[cell] = MARK_RED_X;
    this.acorns = Math.max(0, this.acorns - 1);
    const lost = this.acorns === 0;
    if (lost) {
      this.status = 'lost';
    }

    const revealed = this.getRevealedStumps();
    const conflictList = conflicts(this.puzzle, cell, revealed);

    this.persist();
    return {
      correct: false,
      cell,
      won: false,
      lost,
      perfectlyMarked: false,
      newlyCompletedUnits: [],
      conflicts: conflictList,
    };
  }

  /**
   * Toggles hypothesis mode on or off.
   * @param on whether to activate hypothesis mode
   */
  public setHypothesisMode(on: boolean): void {
    if (this.status !== 'playing') {
      return;
    }
    this.hypothesisMode = on;
    this.persist();
  }

  /**
   * Leaves hypothesis mode and discards all hypothesis marks and tentative stumps.
   */
  public discardHypothesis(): void {
    this.hypoMarks.fill(HYPO_NONE);
    this.hypoUndoStack = [];
    this.hypothesisMode = false;
    this.persist();
  }

  /**
   * Leaves hypothesis mode and converts hypothesis X's to normal X's.
   * Tentative stumps are removed.
   */
  public keepHypothesis(): void {
    const changes: CellChange[] = [];
    for (let i = 0; i < this.hypoMarks.length; i++) {
      if (this.hypoMarks[i] === HYPO_X) {
        if (this.normalMarks[i] === MARK_OPEN) {
          changes.push({ cell: i, from: MARK_OPEN, to: MARK_X });
          this.normalMarks[i] = MARK_X;
        }
      }
    }

    this.hypoMarks.fill(HYPO_NONE);
    this.hypoUndoStack = [];
    this.hypothesisMode = false;

    if (changes.length > 0) {
      this.undoStack.push({ mode: 'normal', changes });
    }

    this.checkNewlyCompletedUnits();
    this.persist();
  }

  /**
   * Undoes the last tap or drag stroke.
   * @returns true if an action was undone
   */
  public undo(): boolean {
    if (this.status !== 'playing') {
      return false;
    }

    if (this.hypothesisMode) {
      const step = this.hypoUndoStack.pop();
      if (!step) {
        return false;
      }
      for (let i = step.changes.length - 1; i >= 0; i--) {
        const c = step.changes[i];
        this.hypoMarks[c.cell] = c.from as HypoMark;
      }
      this.persist();
      return true;
    }

    const step = this.undoStack.pop();
    if (!step) {
      return false;
    }
    for (let i = step.changes.length - 1; i >= 0; i--) {
      const c = step.changes[i];
      this.normalMarks[c.cell] = c.from as NormalMark;
    }

    this.persist();
    return true;
  }

  /**
   * Executes the Woodpecker (reveal) hint:
   * Reveals the stump in the color region with the fewest open squares.
   * @returns revealed cell index or null if none available
   */
  public useWoodpeckerHint(): number | null {
    if (this.status !== 'playing' || this.hintsUsed.woodpecker) {
      return null;
    }

    const { size, regions, solution } = this.puzzle;
    const revealed = this.getRevealedStumps();
    let bestRegion = -1;
    let minOpen = Infinity;

    for (let r = 0; r < size; r++) {
      // Check if region already has a revealed stump
      const hasStump = revealed.some((c) => regions[c] === r);
      if (hasStump) {
        continue;
      }

      // Count open squares
      let openCount = 0;
      for (let cell = 0; cell < size * size; cell++) {
        if (regions[cell] === r && this.normalMarks[cell] === MARK_OPEN) {
          openCount++;
        }
      }

      if (openCount < minOpen) {
        minOpen = openCount;
        bestRegion = r;
      }
    }

    if (bestRegion < 0) {
      return null;
    }

    // Find the stump in this region
    const stumpCell = solution.find((c) => regions[c] === bestRegion);
    if (stumpCell === undefined) {
      return null;
    }

    this.normalMarks[stumpCell] = MARK_STUMP;
    this.hintsUsed = { ...this.hintsUsed, woodpecker: true };

    this.checkNewlyCompletedUnits();
    const won = this.getRevealedStumps().length === size;

    if (won) {
      this.status = 'won';
      this.completedAt = new Date().toISOString();
      this.perfectlyMarked = this.isAllMarked();
      this.recordBestTime();
    }

    this.persist();
    return stumpCell;
  }

  /**
   * Executes the Squirrel (eliminate) hint:
   * Places X's on up to three random unmarked squares that hold no stump.
   * @returns list of eliminated cells
   */
  public useSquirrelHint(): number[] {
    if (this.status !== 'playing' || this.hintsUsed.squirrel) {
      return [];
    }

    const { size, solution } = this.puzzle;
    const solutionSet = new Set(solution);
    const candidates: number[] = [];

    for (let i = 0; i < size * size; i++) {
      if (this.normalMarks[i] === MARK_OPEN && !solutionSet.has(i)) {
        candidates.push(i);
      }
    }

    if (candidates.length === 0) {
      this.hintsUsed = { ...this.hintsUsed, squirrel: true };
      this.persist();
      return [];
    }

    // Shuffle candidates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    const picked = candidates.slice(0, 3);
    for (const cell of picked) {
      this.normalMarks[cell] = MARK_X;
    }

    this.hintsUsed = { ...this.hintsUsed, squirrel: true };
    this.checkNewlyCompletedUnits();
    const allStumpsRevealed = this.getRevealedStumps().length === this.puzzle.size;
    if (allStumpsRevealed && this.isAllMarked()) {
      this.perfectlyMarked = true;
    }

    this.persist();
    return picked;
  }

  /**
   * Checks if the player has placed an X on any square that contains a stump.
   * Required check for the Owl hint.
   * @returns first cell containing an incorrect X, or null if none
   */
  public findIncorrectPlayerX(): number | null {
    const { solution } = this.puzzle;
    for (const stump of solution) {
      if (this.normalMarks[stump] === MARK_X) {
        return stump;
      }
    }
    return null;
  }

  /**
   * Removes an incorrect player X found on a stump.
   * @param cell cell index
   */
  public removeIncorrectPlayerX(cell: number): void {
    if (this.normalMarks[cell] === MARK_X) {
      this.normalMarks[cell] = MARK_OPEN;
    }
    this.hintsUsed = { ...this.hintsUsed, owl: true };
    this.persist();
  }

  /**
   * Calculates the next deduction step for the Owl hint.
   * @returns deduction step with explanation, or null
   */
  public getOwlDeduction(): { step: Step, description: string } | null {
    if (this.status !== 'playing') {
      return null;
    }

    const { size } = this.puzzle;
    const state = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const mark = this.normalMarks[i];
      if (mark === MARK_STUMP) {
        state[i] = STUMP;
      } else if (mark === MARK_X || mark === MARK_RED_X) {
        state[i] = EXCLUDED;
      } else {
        state[i] = OPEN;
      }
    }

    const step = nextStep(this.puzzle, state);
    if (!step) {
      return null;
    }

    return {
      step,
      description: describeStep(step),
    };
  }

  /**
   * Applies an Owl hint deduction to the board.
   * @param step deduction step to apply
   */
  public applyOwlDeduction(step: Step): void {
    this.hintsUsed = { ...this.hintsUsed, owl: true };

    for (const cell of step.eliminated) {
      if (this.normalMarks[cell] === MARK_OPEN) {
        this.normalMarks[cell] = MARK_X;
      }
    }

    if (step.type === 'forced') {
      this.normalMarks[step.place] = MARK_STUMP;
    }

    this.checkNewlyCompletedUnits();
    const won = this.getRevealedStumps().length === this.puzzle.size;
    if (won) {
      this.status = 'won';
      this.completedAt = new Date().toISOString();
      this.perfectlyMarked = this.isAllMarked();
      this.recordBestTime();
    }

    this.persist();
  }

  /**
   * Updates elapsed playing time.
   * @param deltaMs milliseconds elapsed since last update
   */
  public updateElapsedTime(deltaMs: number): void {
    if (this.status === 'playing') {
      this.elapsedTimeMs += deltaMs;
    }
  }

  /**
   * Helper that records a completed solve to best times.
   */
  private recordBestTime(): void {
    const acornsLost = this.maxAcorns - this.acorns;
    const hintsUsedList: ('woodpecker' | 'owl' | 'squirrel')[] = [];
    if (this.hintsUsed.woodpecker) hintsUsedList.push('woodpecker');
    if (this.hintsUsed.owl) hintsUsedList.push('owl');
    if (this.hintsUsed.squirrel) hintsUsedList.push('squirrel');

    const clean = hintsUsedList.length === 0 && acornsLost === 0 && !this.isRepeat;

    const record: BestTimeRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      size: this.puzzle.size,
      difficulty: this.puzzle.tier,
      timeMs: Math.round(this.elapsedTimeMs),
      clean,
      hintsUsed: hintsUsedList,
      acornsLost,
      silver: this.puzzle.silver,
      repeat: this.isRepeat,
      date: new Date().toISOString(),
      code: this.puzzle.code,
    };

    saveBestTime(record);
    markCodePlayed(this.puzzle.code);
  }

  /**
   * Scans all units (rows, cols, regions) of revealed stumps and checks if any
   * newly became fully marked.
   * @returns array of newly completed units
   */
  private checkNewlyCompletedUnits(): Unit[] {
    const revealed = this.getRevealedStumps();
    const newlyCompleted: Unit[] = [];

    for (const stump of revealed) {
      const r = rowOf(this.puzzle.size, stump);
      const c = colOf(this.puzzle.size, stump);
      const reg = this.puzzle.regions[stump];

      const rowUnit: Unit = { kind: 'row', index: r };
      const colUnit: Unit = { kind: 'col', index: c };
      const regUnit: Unit = { kind: 'region', index: reg };

      for (const unit of [rowUnit, colUnit, regUnit]) {
        const key = `${unit.kind}-${unit.index}`;
        if (this.completedUnits.has(key)) {
          continue;
        }

        const cells = unitCells(this.puzzle, unit);
        const otherCells = cells.filter((cell) => cell !== stump);
        const allMarked = otherCells.every((cell) => {
          const mark = this.normalMarks[cell];
          return mark === MARK_X || mark === MARK_RED_X || mark === MARK_STUMP;
        });

        if (allMarked) {
          this.completedUnits.add(key);
          newlyCompleted.push(unit);
        }
      }
    }

    return newlyCompleted;
  }

  /**
   * Recalculates currently completed units on restore.
   */
  private recalculateCompletedUnits(): void {
    const revealed = this.getRevealedStumps();
    for (const stump of revealed) {
      const r = rowOf(this.puzzle.size, stump);
      const c = colOf(this.puzzle.size, stump);
      const reg = this.puzzle.regions[stump];

      for (const unit of [
        { kind: 'row', index: r },
        { kind: 'col', index: c },
        { kind: 'region', index: reg },
      ] as const) {
        const key = `${unit.kind}-${unit.index}`;
        const cells = unitCells(this.puzzle, unit);
        const otherCells = cells.filter((cell) => cell !== stump);
        const allMarked = otherCells.every((cell) => {
          const mark = this.normalMarks[cell];
          return mark === MARK_X || mark === MARK_RED_X || mark === MARK_STUMP;
        });
        if (allMarked) {
          this.completedUnits.add(key);
        }
      }
    }
  }
}
