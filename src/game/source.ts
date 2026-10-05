import {
  type GeneratorSettings, type Puzzle, decodeSeedCode, generate, randomSettings,
} from '../engine';
import mulberry32 from '../utils/mulberry';
import { type Settings, fixedSettings } from './settings';

/** Something that can grow puzzles off the thread that draws the board. */
export interface PuzzleSource {
  /**
   * Starts the next puzzle for these settings if one is not already on the way.
   * @param settings current preferences
   */
  warm(settings: Settings): void;
  /**
   * Returns the prepared puzzle, waiting for it if needed, then starts another.
   * @param settings current preferences
   * @returns the puzzle
   */
  take(settings: Settings): Promise<Puzzle>;
  /**
   * Grows the puzzle a seed code names.
   * @param code a seed code, loosely typed
   * @returns the puzzle, or null when the code is invalid
   */
  fromCode(code: string): Promise<Puzzle | null>;
  /** Drops a prepared puzzle, for example after settings change. */
  invalidate(): void;
}

interface WorkerResponse {
  id: number;
  puzzle?: Puzzle;
  error?: string;
}

/**
 * Generates puzzles in a Web Worker, and on the main thread if the worker
 * cannot start. The next puzzle is prepared ahead of time so starting one does
 * not wait on a cold generate.
 */
export class WorkerSource implements PuzzleSource {
  private worker: Worker | null = null;

  private requestId = 0;

  private task: { key: string; promise: Promise<Puzzle> } | null = null;

  /**
   * @param randomSeed source of 32-bit seeds
   */
  constructor(private readonly randomSeed: () => number = cryptoSeed) {
    try {
      this.worker = new Worker(new URL('../worker/generate.ts', import.meta.url), { type: 'module' });
    } catch {
      this.worker = null;
    }
  }

  /** @inheritdoc */
  warm(settings: Settings): void {
    const fixed = fixedSettings(settings);
    const key = JSON.stringify(fixed);
    if (this.task?.key === key) {
      return;
    }
    const full = randomSettings(mulberry32(this.randomSeed()), fixed);
    this.task = { key, promise: this.generate(full, this.randomSeed()) };
  }

  /** @inheritdoc */
  async take(settings: Settings): Promise<Puzzle> {
    this.warm(settings);
    const pending = this.task?.promise;
    this.task = null;
    if (!pending) {
      throw new Error('No puzzle was prepared.');
    }
    const puzzle = await pending;
    this.warm(settings);
    return puzzle;
  }

  /** @inheritdoc */
  async fromCode(code: string): Promise<Puzzle | null> {
    const decoded = decodeSeedCode(code);
    if (!decoded) {
      return null;
    }
    return this.generate(decoded.settings, decoded.seed);
  }

  /** @inheritdoc */
  invalidate(): void {
    this.task = null;
  }

  /**
   * @param settings full generator settings
   * @param seed 32-bit seed
   * @returns the puzzle
   */
  private generate(settings: GeneratorSettings, seed: number): Promise<Puzzle> {
    const worker = this.worker;
    if (!worker) {
      return Promise.resolve(generate(settings, seed));
    }
    const id = ++this.requestId;
    return new Promise((resolve) => {
      const finish = (puzzle: Puzzle): void => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        resolve(puzzle);
      };
      const onMessage = (event: MessageEvent<WorkerResponse>): void => {
        if (event.data.id !== id) {
          return;
        }
        finish(event.data.puzzle ?? generate(settings, seed));
      };
      const onError = (): void => {
        finish(generate(settings, seed));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ id, settings, seed });
    });
  }
}

/**
 * @returns a 32-bit unsigned seed
 */
function cryptoSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] ?? 0;
}
