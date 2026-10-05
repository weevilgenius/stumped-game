/* ========================================================= *\
 *  Stumped Background Puzzle Generator Worker               *
\* ========================================================= */

import { generate, type GeneratorSettings } from '../engine';

interface WorkerRequest {
  id: string;
  settings: GeneratorSettings;
  seed: number;
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const { id, settings, seed } = event.data;
  try {
    const puzzle = generate(settings, seed);
    self.postMessage({ id, puzzle, success: true });
  } catch (error) {
    self.postMessage({ id, error: String(error), success: false });
  }
};
