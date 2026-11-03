import {
  type AdventureCommand, type AdventureEvent, type AdventureState, type CharacterDef, type Collection, type RoundManifest, startRun, step,
} from './adventure/engine';
import { WOLF } from './adventure/content/sandbox';
import { CONTENT_VERSION, STARTERS } from './adventure/content/campaign';
import { createCampaign, refreshCampaignContent } from './adventure/engine/campaign';
import { decodeSeedCode } from './engine';
import type { GeneratorSettings } from './engine';
import { version as APP_VERSION } from '../package.json';
import { LOADOUTS } from './adventure/content/loadouts';
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
  /** Reconstructible puzzle history, including deaths and unfinished puzzles. */
  puzzles?: AdventurePuzzleRecord[];
  /** Selected simulator loadout, including its exact definitions. Missing in older saves; use `start` there. */
  loadout?: CharacterDef;
  /** The run as it began, so the log can replay it. */
  start: AdventureState;
  /** Every accepted command since the run began, in order, turns included. */
  log: AdventureCommand[];
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
}

/** Puzzle context retained after moving on, independently of solve-data settings. */
export interface AdventurePuzzleRecord {
  /** Stable play identifier. */
  id: string;
  /** Application version that last observed this puzzle. */
  app: string;
  /** Campaign content revision at observation. */
  content: number;
  /** Puzzle seed code, including generator version. */
  code: string;
  /** Exact generation settings. */
  settings: GeneratorSettings | null;
  /** Explicit palette mapping, for future permutations. */
  colors: readonly number[];
  /** Active solve time in milliseconds. */
  elapsed: number;
  /** Hint history. */
  hints: Game['hints'];
  /** Hypothesis entry times. */
  whatIfs: number[];
  /** Reveal history, including source and active time. */
  found: NonNullable<Game['found']>;
  /** Exact wrong reveal history. */
  misses: NonNullable<Game['misses']>;
  /** Application versions that touched this puzzle. */
  versions: string[];
  /** App/content pairs observed, so mixed-version puzzles stay identifiable. */
  rules: string[];
}

/** Refresh the current puzzle's trace without losing earlier puzzles. */
export function recordPuzzle(save: AdventureSave): void {
  const game = save.game;
  if (!game) return;
  save.puzzles ??= [];
  const old = save.puzzles.findIndex((record) => record.id === game.id);
  const previous = save.puzzles[old];
  const record: AdventurePuzzleRecord = {
    id: game.id, app: APP_VERSION, content: CONTENT_VERSION, code: game.puzzle.code,
    settings: decodeSeedCode(game.puzzle.code)?.settings ?? null, colors: [...game.puzzle.colors], elapsed: game.elapsed,
    hints: [...game.hints], whatIfs: [...game.whatIfs ?? []], found: structuredClone(game.found ?? []),
    misses: structuredClone(game.misses ?? []), rules: [...new Set([...previous?.rules ?? [], `${APP_VERSION}/content-${CONTENT_VERSION}`])], versions: [...new Set([...previous?.versions ?? [], APP_VERSION])],
  };
  if (old < 0) save.puzzles.push(record);
  else save.puzzles[old] = record;
}

/**
 * Starts a bounded campaign or an explicitly selected legacy sandbox.
 * @param loadoutId starter or sandbox identifier; defaults to Ranger
 * @param seed campaign map and loot seed
 * @returns the new adventure, between rounds with no puzzle yet
 */
export function newAdventure(loadoutId = 'ranger', seed = 1): AdventureSave {
  const definition = [...STARTERS, ...LOADOUTS].find((loadout) => loadout.id === loadoutId);
  if (!definition) throw new Error(`Unknown adventure loadout: ${loadoutId}`);
  const loadout = structuredClone(definition);
  const state = startRun(loadout);
  if (STARTERS.some((starter) => starter.id === loadoutId)) state.campaign = createCampaign(seed);
  return { version: ADVENTURE_VERSION, loadout, start: state, log: [], times: [], state, game: null, played: 0, open: false, puzzles: [] };
}

/**
 * Applies a command, logging it if the engine accepts it.
 * @param save the adventure, updated in place
 * @param command the command
 * @param at when, as epoch milliseconds
 * @returns the engine's events
 */
export function command(save: AdventureSave, command: AdventureCommand, at: number): readonly AdventureEvent[] {
  const { state, events } = step(save.state, command);
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
 * @returns the engine's events
 */
export function sync(save: AdventureSave, at: number): AdventureEvent[] {
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
  return events;
}

/**
 * Starts a round on a new puzzle, with a fresh wolf if the last encounter is over.
 * @param save the adventure, between rounds; updated in place
 * @param game the new puzzle, which must keep `found` and `misses`
 * @param at when, as epoch milliseconds
 * @returns the engine's events
 */
export function beginRound(save: AdventureSave, game: Game, at: number): AdventureEvent[] {
  const events = save.state.encounter || save.state.campaign ? [] : [...command(save, { type: 'begin-encounter', encounter: WOLF }, at)];
  events.push(...command(save, { type: 'begin-round', round: manifestOf(game) }, at));
  if (save.state.phase !== 'round') return events;
  recordPuzzle(save);
  save.game = game;
  save.played = 0;
  recordPuzzle(save);
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
    if (!valid) return undefined;
    const save = value as AdventureSave;
    const state = save.state;
    if (!['between', 'round', 'ended'].includes(state.phase) || !Number.isFinite(state.health)
      || !Array.isArray(state.slots) || !state.slots.every((slot) => slot?.item && Array.isArray(slot.item.bands) && Array.isArray(slot.item.colors))) return undefined;
    const campaign = state.campaign;
    if (campaign && (!Array.isArray(campaign.map) || !Array.isArray(campaign.visited) || !Array.isArray(campaign.pack)
      || !Array.isArray(campaign.potions) || !Array.isArray(campaign.loot) || !Array.isArray(campaign.stock)
      || typeof campaign.active !== 'boolean' || !Number.isInteger(campaign.seed) || !Number.isInteger(campaign.rng))) return undefined;
    refreshCampaignContent(state);
    return save;
  } catch {
    return undefined;
  }
}
