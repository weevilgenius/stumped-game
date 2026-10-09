import { generate, type GeneratorSettings } from './engine';

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

self.onmessage = (event: MessageEvent<GenerateRequest>): void => {
  self.postMessage(generate(event.data.settings, event.data.seed));
};
