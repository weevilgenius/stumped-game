import { generate, type GeneratorSettings } from '../engine';

interface RequestMessage {
  id: number;
  settings: GeneratorSettings;
  seed: number;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<RequestMessage>): void => {
  const { id, settings, seed } = event.data;
  try {
    scope.postMessage({ id, puzzle: generate(settings, seed) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'generate failed';
    scope.postMessage({ id, error: message });
  }
};
