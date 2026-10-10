import type { Puzzle } from './engine';
import type { GenerateRequest, WorkerReply, WorkerRequest } from './worker';

/* ========================================================= *\
 *  Main-thread client for the generator worker. Every       *
 *  request resolves with its own puzzle or rejects; none    *
 *  is left waiting.                                         *
\* ========================================================= */

/** The parts of a Worker the client uses. Tests pass a fake. */
export type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;

/** Generates a puzzle; aborting the signal rejects the request and stops any work on it. */
export type Generate = (request: GenerateRequest, signal?: AbortSignal) => Promise<Puzzle>;

/**
 * Creates a generate function backed by a worker.
 * @param createWorker starts a worker; called again after one fails or is stopped
 * @returns a function that generates a puzzle in the worker
 */
export function createWorkerGenerator(createWorker: () => WorkerLike): Generate {
  const pending = new Map<number, {
    request: GenerateRequest;
    resolve: (puzzle: Puzzle) => void;
    reject: (error: Error) => void;
  }>();
  let worker: WorkerLike | null = null;
  let nextId = 0;

  const stop = (): void => {
    worker?.terminate();
    worker = null;
  };

  /** Rejects everything outstanding and discards the worker, so the next request starts a fresh one. */
  const fail = (message: string): void => {
    stop();
    const failed = [...pending.values()];
    pending.clear();
    failed.forEach(({ reject }) => reject(new Error(message)));
  };

  const start = (): WorkerLike => {
    const started = createWorker();
    started.onmessage = (event: MessageEvent<WorkerReply>): void => {
      const reply = event.data;
      const waiting = pending.get(reply.id);
      pending.delete(reply.id);
      if ('puzzle' in reply) {
        waiting?.resolve(reply.puzzle);
      } else {
        waiting?.reject(new Error(reply.error));
      }
    };
    started.onerror = (event): void => {
      event.preventDefault();
      fail(event.message || 'Puzzle generator failed');
    };
    started.onmessageerror = (): void => fail('Puzzle generator reply could not be read');
    return started;
  };

  const send = (id: number, request: GenerateRequest): void => {
    worker ??= start();
    const message: WorkerRequest = { ...request, id };
    worker.postMessage(message);
  };

  /** Drops a request. The worker cannot abandon a puzzle midway, so it is replaced and sent what is still wanted. */
  const cancel = (id: number): void => {
    const cancelled = pending.get(id);
    if (!cancelled) {
      return;
    }
    pending.delete(id);
    cancelled.reject(new Error('Puzzle generation cancelled'));
    // ponytail: restarts even if the cancelled request was still queued; cheap, since the worker module is cached
    stop();
    pending.forEach(({ request }, wanted) => send(wanted, request));
  };

  return (request, signal) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { request, resolve, reject });
    send(id, request);
    signal?.addEventListener('abort', () => cancel(id), { once: true });
  });
}
