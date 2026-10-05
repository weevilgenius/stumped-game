import { generate } from '../engine';
import type { SeedCode } from '../engine';

self.onmessage = ({ data }: MessageEvent<SeedCode>): void => {
  try {
    self.postMessage({ puzzle: generate(data.settings, data.seed) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not grow this puzzle.' });
  }
};
