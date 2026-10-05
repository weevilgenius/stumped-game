/* ========================================================= *\
 *  Puzzle Generator Service                                 *
\* ========================================================= */

import {
  decodeSeedCode, generate, type GeneratorSettings,
  type Puzzle, randomSettings,
} from '../engine';
import type { GameSettings } from '../state/types';

/** Request tracking for worker tasks. */
interface PendingRequest {
  resolve: (puzzle: Puzzle) => void;
  reject: (reason: unknown) => void;
}

/** Pre-prepared puzzle ready for instant start. */
let preparedPuzzle: { puzzle: Puzzle, settings: GeneratorSettings } | null = null;

/** Active web worker instance, if supported. */
let worker: Worker | null = null;
/** Map of request IDs to promise callbacks. */
const pendingRequests = new Map<string, PendingRequest>();

/**
 * Initializes the Web Worker if supported by the runtime environment.
 */
function getWorker(): Worker | null {
  if (worker) {
    return worker;
  }
  if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./generatorWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ id: string, puzzle: Puzzle, success: boolean, error?: string }>) => {
        const { id, puzzle, success, error } = event.data;
        const pending = pendingRequests.get(id);
        if (pending) {
          pendingRequests.delete(id);
          if (success) {
            pending.resolve(puzzle);
          } else {
            pending.reject(new Error(error ?? 'Generation failed'));
          }
        }
      };
    } catch {
      worker = null;
    }
  }
  return worker;
}

/**
 * Converts user preferences into complete GeneratorSettings.
 * @param settings user settings
 * @returns generator settings
 */
export function resolveSettings(settings: GameSettings): GeneratorSettings {
  const fixed: Partial<GeneratorSettings> = {
    ...(settings.size !== 'random' ? { size: settings.size } : {}),
    ...(settings.difficulty !== 'random' ? { tier: settings.difficulty } : {}),
    ...(settings.silverAcorn ? { silver: true } : {}),
  };
  return randomSettings(Math.random, fixed);
}

/**
 * Generates a puzzle asynchronously using the web worker or fallback.
 * @param genSettings generator settings
 * @param seed random seed (defaults to 32-bit unsigned integer)
 * @returns generated puzzle
 */
export async function generatePuzzleAsync(
  genSettings: GeneratorSettings,
  seed: number = Math.floor(Math.random() * 0xFFFFFFFF),
): Promise<Puzzle> {
  const activeWorker = getWorker();
  if (activeWorker) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return new Promise<Puzzle>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      activeWorker.postMessage({ id, settings: genSettings, seed });
    });
  }

  // Fallback for environments without Web Worker support (e.g. test environments)
  return Promise.resolve(generate(genSettings, seed));
}

/**
 * Starts background generation of the next puzzle according to current preferences.
 * @param settings user settings
 */
export function prepareNextPuzzle(settings: GameSettings): void {
  const genSettings = resolveSettings(settings);
  generatePuzzleAsync(genSettings).then((puzzle) => {
    preparedPuzzle = { puzzle, settings: genSettings };
  }).catch(() => {
    // Ignore background generation error
  });
}

/**
 * Gets a pre-prepared puzzle if it matches the requested settings,
 * or generates a new one. Immediately starts preparing the next puzzle.
 * @param settings user settings
 * @returns ready-to-play puzzle
 */
export async function getOrGeneratePuzzle(settings: GameSettings): Promise<Puzzle> {
  const genSettings = resolveSettings(settings);

  // Check if prepared puzzle matches requested size, difficulty, and silver mode
  if (
    preparedPuzzle
    && (settings.size === 'random' || preparedPuzzle.settings.size === settings.size)
    && (settings.difficulty === 'random' || preparedPuzzle.settings.tier === settings.difficulty)
    && (!settings.silverAcorn || preparedPuzzle.settings.silver === true)
  ) {
    const matched = preparedPuzzle.puzzle;
    preparedPuzzle = null;
    // Prepare next one in background
    prepareNextPuzzle(settings);
    return matched;
  }

  // Generate on demand
  const puzzle = await generatePuzzleAsync(genSettings);
  // Prepare next one in background
  prepareNextPuzzle(settings);
  return puzzle;
}

/**
 * Generates a puzzle deterministically from a shareable seed code.
 * @param code Crockford base32 seed code
 * @returns puzzle or null if code is invalid
 */
export function generateFromCode(code: string): Puzzle | null {
  const decoded = decodeSeedCode(code);
  if (!decoded) {
    return null;
  }
  const { settings, seed } = decoded;
  return generate(settings, seed);
}
