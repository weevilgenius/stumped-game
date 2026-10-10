import { generate, type Puzzle } from './engine';
import { createWorkerGenerator, type WorkerLike } from './generator';
import type { WorkerReply, WorkerRequest } from './worker';

const SETTINGS = { size: 5, tier: 'easy', silver: false, sizeMix: 1, shape: 1, freebies: 1 } as const;
const PUZZLE_1 = generate(SETTINGS, 1);
const PUZZLE_2 = generate(SETTINGS, 2);

/** A worker the test answers by hand. */
interface FakeWorker extends WorkerLike {
  readonly sent: WorkerRequest[];
  terminated: boolean;
  reply: (reply: WorkerReply) => void;
  crash: () => void;
}

const fakeWorkers = () => {
  const workers: FakeWorker[] = [];
  const createWorker = (): WorkerLike => {
    const worker: FakeWorker = {
      sent: [],
      terminated: false,
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage: (message: WorkerRequest) => {
        worker.sent.push(message);
      },
      terminate: () => {
        worker.terminated = true;
      },
      reply: (reply) => {
        worker.onmessage?.call(worker as unknown as Worker, { data: reply } as MessageEvent);
      },
      crash: () => {
        worker.onerror?.call(worker as unknown as Worker, { message: 'boom', preventDefault: () => undefined } as ErrorEvent);
      },
    };
    workers.push(worker);
    return worker;
  };
  return { workers, generator: createWorkerGenerator(createWorker) };
};

describe('worker generator', () => {
  it('matches replies to requests by ID, even out of order', async () => {
    const { workers, generator } = fakeWorkers();
    const first = generator({ settings: SETTINGS, seed: 1 });
    const second = generator({ settings: SETTINGS, seed: 2 });
    const [a, b] = workers[0].sent;
    workers[0].reply({ id: b.id, puzzle: PUZZLE_2 });
    workers[0].reply({ id: a.id, puzzle: PUZZLE_1 });
    expect(await first).toBe(PUZZLE_1);
    expect(await second).toBe(PUZZLE_2);
    expect(workers).toHaveLength(1);
  });

  it('rejects only the request whose generation threw', async () => {
    const { workers, generator } = fakeWorkers();
    const failed = generator({ settings: SETTINGS, seed: 1 });
    const fine = generator({ settings: SETTINGS, seed: 2 });
    workers[0].reply({ id: workers[0].sent[0].id, error: 'bad settings' });
    workers[0].reply({ id: workers[0].sent[1].id, puzzle: PUZZLE_2 });
    await expect(failed).rejects.toThrow('bad settings');
    expect(await fine).toBe(PUZZLE_2);
  });

  it('rejects everything pending when the worker fails, then starts a fresh worker', async () => {
    const { workers, generator } = fakeWorkers();
    const pending: Promise<Puzzle>[] = [generator({ settings: SETTINGS, seed: 1 }), generator({ settings: SETTINGS, seed: 2 })];
    workers[0].crash();
    await Promise.all(pending.map((puzzle) => expect(puzzle).rejects.toThrow('boom')));
    expect(workers[0].terminated).toBe(true);
    const retried = generator({ settings: SETTINGS, seed: 1 });
    expect(workers).toHaveLength(2);
    workers[1].reply({ id: workers[1].sent[0].id, puzzle: PUZZLE_1 });
    expect(await retried).toBe(PUZZLE_1);
  });

  it('rejects everything pending when a reply cannot be read', async () => {
    const { workers, generator } = fakeWorkers();
    const pending = generator({ settings: SETTINGS, seed: 1 });
    workers[0].onmessageerror?.call(workers[0] as unknown as Worker, {} as MessageEvent);
    await expect(pending).rejects.toThrow();
  });

  it('cancels a request by restarting the worker and resending the rest', async () => {
    const { workers, generator } = fakeWorkers();
    const abort = new AbortController();
    const stale = generator({ settings: SETTINGS, seed: 1 }, abort.signal);
    const wanted = generator({ settings: SETTINGS, seed: 2 });
    abort.abort();
    await expect(stale).rejects.toThrow('cancelled');
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].sent).toEqual([expect.objectContaining({ seed: 2 })]);
    workers[1].reply({ id: workers[1].sent[0].id, puzzle: PUZZLE_2 });
    expect(await wanted).toBe(PUZZLE_2);
  });

  it('ignores an abort after the reply', async () => {
    const { workers, generator } = fakeWorkers();
    const abort = new AbortController();
    const puzzle = generator({ settings: SETTINGS, seed: 1 }, abort.signal);
    workers[0].reply({ id: workers[0].sent[0].id, puzzle: PUZZLE_1 });
    abort.abort();
    expect(await puzzle).toBe(PUZZLE_1);
    expect(workers[0].terminated).toBe(false);
  });
});
