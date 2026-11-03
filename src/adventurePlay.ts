import type { AdventureCommand, AdventureEvent, AdventureState, CharacterDef, Collection, RoundManifest } from './adventure/engine';
import { WOLF } from './adventure/content/sandbox';
import { CONTENT_VERSION, STARTERS } from './adventure/content/campaign';
import { advance, newCampaign, type RunCommand } from './adventure/campaign';
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
  /** Starting character, including its exact definitions. Missing in older saves; use `start` there. */
  loadout?: CharacterDef;
  /** The run as it began, so the log can replay it. */
  start: AdventureState;
  /** Every accepted command since the run began, in order, turns included. */
  log: RunCommand[];
  /** When each command in `log` was applied, as epoch milliseconds; 0 where unknown. Missing in older saves. */
  times?: number[];
  /** The run now. */
  state: AdventureState;
  /** The adventure's puzzle: in progress, or the last one played. Null before the first. */
  game: Game | null;
  /** Reveals of `game` already played as turns, counting wrong ones but not givens. */
  played: number;
  /** True while the adventure's puzzle is on screen, so a relaunch returns to it. */
  open: boolean;
  /** One record per finished puzzle, so reports can reconstruct it and label mixed-version runs. Missing in older saves. */
  puzzles?: PuzzleRecord[];
}

/** How one adventure puzzle was played, and under which versions. */
export interface PuzzleRecord {
  /** Play identifier (`game.id`). */
  readonly id: string;
  /** App version it was played on. */
  readonly app: string;
  /** Adventure content version. */
  readonly content: number;
  /** Seed code, which also fixes the generation settings. */
  readonly code: string;
  /** Size and difficulty it was generated at. */
  readonly size: number;
  readonly tier: string;
  /** Active solve time, in milliseconds. */
  readonly elapsed: number;
  /** Hints used, in order. */
  readonly hints: readonly string[];
  /** Play times at which What if? was used. */
  readonly whatIfs: readonly number[];
  /** Solved or out of acorns. */
  readonly status: Game['status'];
}

/**
 * Starts a campaign run with a starting character on a seeded map.
 * @param starterId starting character identifier
 * @param seed map, enemy, and loot seed
 * @returns the new adventure, before the first move
 */
export function newAdventure(starterId: string, seed: number): AdventureSave {
  const starter = STARTERS.find((entry) => entry.id === starterId);
  if (!starter) throw new Error(`Unknown adventure character: ${starterId}`);
  const state = newCampaign(structuredClone(starter), seed);
  const loadout: CharacterDef = { id: starter.id, health: starter.health, loadout: structuredClone(starter.loadout) };
  return {
    version: ADVENTURE_VERSION, loadout, start: state, log: [], times: [], state: structuredClone(state), game: null, played: 0, open: false, puzzles: [],
  };
}

/**
 * True when the run needs a puzzle next: a fight or forage is waiting, or a puzzle is under way.
 * @param state the run
 * @returns whether to offer the next puzzle
 */
export function needsPuzzle(state: Readonly<AdventureState>): boolean {
  return state.phase === 'round' || (state.phase === 'between' && (state.encounter !== null || !state.campaign));
}

/**
 * Applies a command, logging it if the engine accepts it.
 * @param save the adventure, updated in place
 * @param command the command
 * @param at when, as epoch milliseconds
 * @returns the engine's events
 */
export function command(save: AdventureSave, command: RunCommand, at: number): readonly AdventureEvent[] {
  const { state, events } = advance(save.state, command);
  if (state !== save.state) {
    save.state = state;
    save.times ??= save.log.map(() => 0);
    save.log.push(command);
    save.times.push(at);
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
 * @param at when, as epoch milliseconds
 * @param app app version, recorded with the finished puzzle
 * @returns the engine's events
 */
export function sync(save: AdventureSave, at: number, app = ''): AdventureEvent[] {
  const { game, state } = save;
  if (!game || state.round?.manifest.id !== game.id) {
    return [];
  }
  const events: AdventureEvent[] = [];
  for (const turn of turnsOf(game).slice(save.played)) {
    if (save.state.phase !== 'round') {
      break;
    }
    events.push(...command(save, turn, at));
    save.played++;
  }
  if (save.state.phase === 'round' && game.status !== 'playing') {
    events.push(...command(save, { type: 'end-round', outcome: game.status === 'won' ? 'completed' : 'failed' }, at));
  }
  if (game.status !== 'playing' && !save.puzzles?.some((record) => record.id === game.id)) {
    (save.puzzles ??= []).push({
      id: game.id, app, content: CONTENT_VERSION, code: game.puzzle.code, size: game.puzzle.size, tier: game.puzzle.tier,
      elapsed: game.elapsed, hints: [...game.hints], whatIfs: [...game.whatIfs ?? []], status: game.status,
    });
  }
  return events;
}

/**
 * Starts a round on a new puzzle. A sandbox run from before the campaign gets a fresh wolf if the last encounter is over.
 * @param save the adventure, between rounds; updated in place
 * @param game the new puzzle, which must keep `found` and `misses`
 * @param at when, as epoch milliseconds
 * @returns the engine's events
 */
export function beginRound(save: AdventureSave, game: Game, at: number): AdventureEvent[] {
  const events = save.state.encounter || save.state.campaign ? [] : [...command(save, { type: 'begin-encounter', encounter: WOLF }, at)];
  events.push(...command(save, { type: 'begin-round', round: manifestOf(game) }, at));
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
