import {
  type Board, describeStep, type Step, unitCells,
} from '../engine';

/** One page of the owl's explanation. */
export interface ExplainPage {
  /** The sentence shown to the player. */
  readonly text: string;
  /** Squares to highlight, including the ones the deduction uses as evidence. */
  readonly cells: readonly number[];
  /** Squares the deduction will mark when the explanation closes. */
  readonly focus: readonly number[];
}

/** What closing the explanation writes onto the board. */
export type ExplainEffect =
  | { readonly type: 'clear-x'; readonly cells: readonly number[] }
  | { readonly type: 'step'; readonly step: Step };

/**
 * Pages for a deduction. A chain can be stepped backward and forward: each
 * easy sub-step is its own page, and the last page states the conclusion.
 * Only the conclusion is applied; the sub-steps are hypothetical.
 * @param board the board
 * @param step the deduction `nextStep` returned
 * @returns one or more pages
 */
export function pagesForStep(board: Board, step: Step): ExplainPage[] {
  if (step.type !== 'chain') {
    return [pageFor(board, step)];
  }
  const pages = step.steps.map((sub, index) => {
    const page = pageFor(board, sub);
    const text = index === 0 ? `Suppose a stump is here. ${page.text}` : page.text;
    return {
      text,
      cells: unique([step.cell, ...page.cells]),
      focus: page.focus,
    };
  });
  pages.push({
    text: describeStep(step),
    cells: unique([step.cell, ...unitCells(board, step.unit)]),
    focus: [step.cell],
  });
  return pages;
}

/**
 * @param cells cell indexes that may repeat
 * @returns the same cells with duplicates removed, order preserved
 */
function unique(cells: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const cell of cells) {
    if (!seen.has(cell)) {
      seen.add(cell);
      result.push(cell);
    }
  }
  return result;
}

/**
 * @param board the board
 * @param step a single deduction
 * @returns the page that shows it
 */
function pageFor(board: Board, step: Step): ExplainPage {
  switch (step.type) {
  case 'elimination':
    return {
      text: describeStep(step),
      cells: unique([step.stump, ...step.eliminated]),
      focus: [...step.eliminated],
    };
  case 'forced':
    return {
      text: describeStep(step),
      cells: unitCells(board, step.unit),
      focus: [step.place],
    };
  case 'confinement': {
    const cells = new Set<number>(step.eliminated);
    for (const line of step.lines) {
      for (const cell of unitCells(board, { kind: step.axis, index: line })) {
        cells.add(cell);
      }
    }
    for (const region of step.regions) {
      for (const cell of unitCells(board, { kind: 'region', index: region })) {
        cells.add(cell);
      }
    }
    return { text: describeStep(step), cells: [...cells], focus: [...step.eliminated] };
  }
  case 'blocking':
    return {
      text: describeStep(step),
      cells: unique([step.cell, ...unitCells(board, step.unit)]),
      focus: [step.cell],
    };
  case 'chain':
    return {
      text: describeStep(step),
      cells: unique([step.cell, ...unitCells(board, step.unit)]),
      focus: [step.cell],
    };
  }
}
