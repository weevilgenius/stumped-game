import { decodeSeedCode, generate, type GeneratorSettings, type Puzzle, randomSettings } from '../engine';
import { toFixedGeneratorSettings } from '../state/storage';
import type { AppSettings } from '../state/types';
import type { WorkerGenerateRequest, WorkerGenerateResponse } from './puzzleWorker';

interface PendingJob {
  readonly resolve: (puzzle: Puzzle) => void;
  readonly reject: (err: unknown) => void;
}

interface PreparedEntry {
  readonly settingsKey: string;
  readonly promise: Promise<Puzzle>;
  resolved?: Puzzle;
}

const randomSeed = (): number => Math.floor(Math.random() * 0x1_0000_0000) >>> 0;

const settingsKeyOf = (settings: AppSettings): string => JSON.stringify({
  size: settings.size,
  tier: settings.tier,
  silver: settings.silver,
  sizeMix: settings.sizeMix,
  shape: settings.shape,
  freebies: settings.freebies,
});

/**
 * Background puzzle generator service.
 * Runs generation in a Web Worker (with a main-thread fallback for test environments)
 * and prepares the next puzzle ahead of time so starting a new puzzle is instant.
 */
export class PuzzleService {
  private worker: Worker | null = null;
  private workerFailed = false;
  private nextJobId = 1;
  private readonly pending = new Map<number, PendingJob>();
  private prepared: PreparedEntry | null = null;

  /**
   * Starts preparing the next puzzle in the background for the given player settings.
   * @param appSettings current player settings
   * @returns promise for the prepared puzzle
   */
  public prepareNext(appSettings: AppSettings): Promise<Puzzle> {
    const key = settingsKeyOf(appSettings);
    if (this.prepared?.settingsKey === key) {
      return this.prepared.promise;
    }
    const genSettings = randomSettings(Math.random, toFixedGeneratorSettings(appSettings));
    const seed = randomSeed();
    const promise = this.runGenerate(genSettings, seed);
    const entry: PreparedEntry = { settingsKey: key, promise };
    this.prepared = entry;
    void promise.then((puzzle) => {
      if (this.prepared === entry) {
        entry.resolved = puzzle;
      }
    });
    return promise;
  }

  /**
   * Returns a puzzle matching the player's current settings, using the pre-generated
   * puzzle if available, and immediately queues preparation of the following puzzle.
   * @param appSettings current player settings
   * @returns promise resolving to a playable puzzle
   */
  public async takeNextPuzzle(appSettings: AppSettings): Promise<Puzzle> {
    const key = settingsKeyOf(appSettings);
    let currentPromise: Promise<Puzzle>;
    if (this.prepared?.settingsKey === key) {
      currentPromise = this.prepared.promise;
      this.prepared = null;
    } else {
      this.prepared = null;
      const genSettings = randomSettings(Math.random, toFixedGeneratorSettings(appSettings));
      currentPromise = this.runGenerate(genSettings, randomSeed());
    }
    const puzzle = await currentPromise;
    // Immediately begin preparing the next puzzle in the background.
    void this.prepareNext(appSettings);
    return puzzle;
  }

  /**
   * Returns a puzzle synchronously, using the background-prepared puzzle if it has
   * already resolved, and immediately queues preparation of the following puzzle.
   * @param appSettings current player settings
   * @returns a playable puzzle
   */
  public takeNextPuzzleSync(appSettings: AppSettings): Puzzle {
    const key = settingsKeyOf(appSettings);
    if (this.prepared?.settingsKey === key && this.prepared.resolved) {
      const readyPuzzle = this.prepared.resolved;
      this.prepared = null;
      void this.prepareNext(appSettings);
      return readyPuzzle;
    }
    this.prepared = null;
    const genSettings = randomSettings(Math.random, toFixedGeneratorSettings(appSettings));
    const puzzle = generate(genSettings, randomSeed());
    void this.prepareNext(appSettings);
    return puzzle;
  }

  /**
   * Decodes a seed code and generates its identical board synchronously.
   * @param code user-entered or URL seed code
   * @returns the puzzle, or null if the seed code is invalid
   */
  public fromSeedCodeSync(code: string): Puzzle | null {
    const decoded = decodeSeedCode(code);
    if (!decoded) {
      return null;
    }
    return generate(decoded.settings, decoded.seed);
  }

  /**
   * Decodes a seed code and generates its identical board.
   * @param code user-entered or URL seed code
   * @returns the puzzle, or null if the seed code is invalid
   */
  public async fromSeedCode(code: string): Promise<Puzzle | null> {
    const decoded = decodeSeedCode(code);
    if (!decoded) {
      return null;
    }
    return this.runGenerate(decoded.settings, decoded.seed);
  }

  private ensureWorker(): Worker | null {
    if (this.workerFailed || typeof Worker === 'undefined') {
      return null;
    }
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./puzzleWorker.ts', import.meta.url), { type: 'module' });
        this.worker.addEventListener('message', (event: MessageEvent<WorkerGenerateResponse>) => {
          const { id, puzzle } = event.data;
          const job = this.pending.get(id);
          if (job) {
            this.pending.delete(id);
            job.resolve(puzzle);
          }
        });
        this.worker.addEventListener('error', (err) => {
          this.workerFailed = true;
          for (const [, job] of this.pending) {
            job.reject(err);
          }
          this.pending.clear();
        });
      } catch {
        this.workerFailed = true;
        this.worker = null;
      }
    }
    return this.worker;
  }

  private runGenerate(settings: GeneratorSettings, seed: number): Promise<Puzzle> {
    const worker = this.ensureWorker();
    if (!worker) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(generate(settings, seed));
        }, 0);
      });
    }
    return new Promise<Puzzle>((resolve, reject) => {
      const id = this.nextJobId++;
      this.pending.set(id, { resolve, reject });
      const req: WorkerGenerateRequest = { id, settings, seed };
      worker.postMessage(req);
    }).catch(() => generate(settings, seed));
  }
}

/** Shared singleton puzzle service instance. */
export const puzzleService = new PuzzleService();
