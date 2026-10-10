import { generate, type GeneratorSettings, type Puzzle } from './engine';

/* ========================================================= *\
 *  Generator worker: builds puzzles off the main thread so  *
 *  generation never stalls the board.                       *
\* ========================================================= */

/** A request to generate one puzzle. */
export interface GenerateRequest {
  /** Generator settings. */
  readonly settings: GeneratorSettings;
  /** 32-bit unsigned seed. */
  readonly seed: number;
}

/** A request as sent to the worker, tagged so its reply can find it. */
export interface WorkerRequest extends GenerateRequest {
  /** Request ID, echoed in the reply. */
  readonly id: number;
}

/** The worker's reply: the puzzle, or why it could not be made. */
export type WorkerReply =
  | { readonly id: number; readonly puzzle: Puzzle }
  | { readonly id: number; readonly error: string };

// Only runs inside a worker; the main thread imports this file for its types alone.
self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const { id, settings, seed } = event.data;
  let reply: WorkerReply;
  try {
    reply = { id, puzzle: generate(settings, seed) };
  } catch (error) {
    reply = { id, error: String(error) };
  }
  self.postMessage(reply);
};
