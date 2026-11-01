import {
  type AdventureCommand, type AdventureEvent, type AdventureState, type Collection, type RoundManifest, startRun, step,
} from './adventure/engine';
import { WANDERER, WOLF } from './adventure/content/sandbox';
import type { Game } from './game';

/* ========================================================= *\
 *  Adventure adapter: turns an adventure puzzle's reveals   *
 *  into engine turns, and keeps the run, its puzzle, and    *
 *  its command log in one save. The controller owns when    *
 *  these run; see docs/adventure-mode-plan.md, phase 5.     *
\* ========================================================= */

/** Format of the `adventure` save. A save in any other format is set aside as a recovery copy. */
export const ADVENTURE_VERSION = 1;

/** One adventure, saved whole under its own key so one write keeps the run and its puzzle together. */
export interface AdventureSave {
  /** Save format. */
  version: typeof ADVENTURE_VERSION;
  /** The run as it began, so the log can replay it. */
  start: AdventureState;
  /** Every accepted command since the run began, in order, turns included. */
  log: AdventureCommand[];
  /** The run now. */
  state: AdventureState;
  /** The adventure's puzzle: in progress, or the last one played. Null before the first. */
  game: Game | null;
  /** Reveals of `game` already played as turns, counting wrong ones but not givens. */
  played: number;
  /** True while the adventure's puzzle is on screen, so a relaunch returns to it. */
  open: boolean;
}

/**
 * Starts a sandbox run: the Wanderer against a wolf.
 * @returns the new adventure, between rounds with no puzzle yet
 */
export function newAdventure(): AdventureSave {
  const state = startRun(WANDERER);
  return { version: ADVENTURE_VERSION, start: state, log: [], state, game: null, played: 0, open: false };
}

/**
 * Applies a command, logging it if the engine accepts it.
 * @param save the adventure, updated in place
 * @param command the command
 * @returns the engine's events
 */
export function command(save: AdventureSave, command: AdventureCommand): readonly AdventureEvent[] {
  const { state, events } = step(save.state, command);
  if (state !== save.state) {
    save.state = state;
    save.log.push(command);
  }
  return events;
}

const regionSize = (game: Game, region: number): number => game.puzzle.regions.filter((r) => r === region).length;

/**
 * What a puzzle could collect: each region's color and size, and which are given.
 * @param game the adventure puzzle
 * @returns its round manifest
 */
export function manifestOf(game: Game): RoundManifest {
  const { colors, regions, givens } = game.puzzle;
  return {
    id: game.id,
    size: game.puzzle.size,
    collections: colors.map((color, region): Collection => ({ color, amount: regionSize(game, region) })),
    givenColors: givens.map((cell) => colors[regions[cell]]),
  };
}

/**
 * Every turn the puzzle's reveals make, in the order they happened: one per
 * stump found (givens excepted) and one per wrong reveal.
 * @param game the adventure puzzle
 * @returns its turn commands
 */
export function turnsOf(game: Game): AdventureCommand[] {
  const { colors, regions } = game.puzzle;
  const found = game.found ?? [];
  const wrong = (index: number): AdventureCommand[] => (game.misses ?? [])
    .filter((miss) => miss.after === index).map(() => ({ type: 'turn' }));
  return [
    ...found.flatMap(({ cell, by }, index): AdventureCommand[] => [
      ...wrong(index),
      ...(by === 'given' ? [] : [{
        type: 'turn', collect: { color: colors[regions[cell]], amount: regionSize(game, regions[cell]) }, source: by,
      } as const]),
    ]),
    ...wrong(found.length),
  ];
}

/**
 * Catches the run up with its puzzle: plays reveals not yet played as turns,
 * then ends the round once the puzzle is won or lost. Safe to call any time;
 * it does nothing when there is nothing new.
 * @param save the adventure, updated in place
 * @returns the engine's events
 */
export function sync(save: AdventureSave): AdventureEvent[] {
  const { game, state } = save;
  if (!game || state.round?.manifest.id !== game.id) {
    return [];
  }
  const events: AdventureEvent[] = [];
  for (const turn of turnsOf(game).slice(save.played)) {
    if (save.state.phase !== 'round') {
      break;
    }
    events.push(...command(save, turn));
    save.played++;
  }
  if (save.state.phase === 'round' && game.status !== 'playing') {
    events.push(...command(save, { type: 'end-round', outcome: game.status === 'won' ? 'completed' : 'failed' }));
  }
  return events;
}

/**
 * Starts a round on a new puzzle, with a fresh wolf if the last encounter is over.
 * @param save the adventure, between rounds; updated in place
 * @param game the new puzzle, which must keep `found` and `misses`
 * @returns the engine's events
 */
export function beginRound(save: AdventureSave, game: Game): AdventureEvent[] {
  const events = save.state.encounter ? [] : [...command(save, { type: 'begin-encounter', encounter: WOLF })];
  events.push(...command(save, { type: 'begin-round', round: manifestOf(game) }));
  save.game = game;
  save.played = 0;
  return events;
}

/**
 * Reads a saved adventure.
 * @param raw the stored text
 * @returns the adventure, null for none, or undefined if it cannot be read
 */
export function parseAdventure(raw: string): AdventureSave | null | undefined {
  try {
    const value = JSON.parse(raw) as Partial<AdventureSave> | null;
    if (value === null) {
      return null;
    }
    const valid = value.version === ADVENTURE_VERSION && typeof value.state === 'object' && value.state !== null
      && typeof value.start === 'object' && Array.isArray(value.log) && Number.isInteger(value.played)
      && typeof value.open === 'boolean' && (value.game === null || typeof value.game === 'object');
    return valid ? value as AdventureSave : undefined;
  } catch {
    return undefined;
  }
}
