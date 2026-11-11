import { generate, type GeneratorSettings, type Puzzle } from '../engine';

/** Request message sent to the puzzle generation Web Worker. */
export interface WorkerGenerateRequest {
  /** Unique request identifier. */
  readonly id: number;
  /** Generator settings for the requested puzzle. */
  readonly settings: GeneratorSettings;
  /** 32-bit unsigned PRNG seed. */
  readonly seed: number;
}

/** Response message posted back from the puzzle generation Web Worker. */
export interface WorkerGenerateResponse {
  /** Matching request identifier. */
  readonly id: number;
  /** Generated playable puzzle. */
  readonly puzzle: Puzzle;
}

self.addEventListener('message', (event: MessageEvent<WorkerGenerateRequest>) => {
  const { id, settings, seed } = event.data;
  const puzzle = generate(settings, seed);
  const response: WorkerGenerateResponse = { id, puzzle };
  self.postMessage(response);
});
