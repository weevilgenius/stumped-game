import { UPDATE_CHECK_MS, watchForUpdates } from './updates';

/** Watches a fake page, recording its listeners, timer, update checks, and refresh offers. */
const watch = async (controlled: boolean): Promise<{
  fire: (type: string) => void;
  tick: () => void;
  page: { hidden: boolean };
  counts: { updates: number; checks: number };
  intervals: number[];
}> => {
  const listeners = new Map<string, () => void>();
  const listen = (type: string, listener: () => void): void => void listeners.set(type, listener);
  const page = { hidden: false };
  const counts = { updates: 0, checks: 0 };
  const intervals: number[] = [];
  let tick = (): void => undefined;
  const registration = Promise.resolve({
    update: (): Promise<unknown> => {
      counts.checks += 1;
      return Promise.reject(new Error('offline'));
    },
  });
  watchForUpdates({
    container: { controller: controlled ? {} : null, register: () => registration, addEventListener: listen },
    document: {
      get hidden() {
        return page.hidden;
      },
      addEventListener: listen,
    },
    setInterval: (callback, ms) => {
      tick = callback;
      intervals.push(ms);
    },
    onUpdate: () => counts.updates += 1,
  });
  await registration;
  return { fire: (type) => listeners.get(type)?.(), tick: () => tick(), page, counts, intervals };
};

describe('update watcher', () => {
  it('offers a refresh when a new worker replaces the one running this page', async () => {
    const { fire, counts } = await watch(true);
    fire('controllerchange');
    expect(counts.updates).toBe(1);
  });

  it('does not offer a refresh when a first visit gains its worker', async () => {
    const { fire, counts } = await watch(false);
    fire('controllerchange');
    expect(counts.updates).toBe(0);
    fire('controllerchange');
    expect(counts.updates).toBe(1);
  });

  it('checks for a new version when shown and on a timer, but not while hidden', async () => {
    const { fire, tick, page, counts, intervals } = await watch(true);
    expect(intervals).toEqual([UPDATE_CHECK_MS]);
    fire('visibilitychange');
    tick();
    expect(counts.checks).toBe(2);
    page.hidden = true;
    fire('visibilitychange');
    tick();
    expect(counts.checks).toBe(2);
  });
});
