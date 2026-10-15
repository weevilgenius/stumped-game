/* ========================================================= *\
 *  New-version detection                                    *
 *  Each deploy changes sw.js, so a new service worker is a  *
 *  new version. It takes over at once (see                  *
 *  scripts/offline.ts) while this page keeps running the    *
 *  old code, so the page offers a refresh.                  *
\* ========================================================= */

/** How often an open, visible page asks for a new version. */
export const UPDATE_CHECK_MS = 30 * 60 * 1000;

/** The service worker registration methods the update watcher uses. */
export interface UpdateRegistration {
  /** Asks the server for a newer `sw.js`. */
  update: () => Promise<unknown>;
}

/** The browser pieces the update watcher uses, injected for tests. */
export interface UpdateDeps {
  /** `navigator.serviceWorker`. */
  readonly container: {
    /** The worker running this page, or null on a first visit. */
    readonly controller: object | null;
    register: (url: string) => Promise<UpdateRegistration>;
    addEventListener: (type: 'controllerchange', listener: () => void) => void;
  };
  /** Whether the page is hidden, and its visibility changes. */
  readonly document: {
    readonly hidden: boolean;
    addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  };
  /** Repeats a callback. */
  readonly setInterval: (callback: () => void, ms: number) => unknown;
  /** Called when a new version has taken over, so a reload would run it. */
  readonly onUpdate: () => void;
}

/**
 * Registers the service worker and watches for new versions.
 * An installed app is often resumed rather than relaunched, and the browser only
 * checks for a new worker on launch, so this also checks whenever the page comes
 * back into view and periodically while it is shown.
 * @param deps service worker container, document, timer, and update callback
 */
export function watchForUpdates(deps: UpdateDeps): void {
  const { container, document, onUpdate } = deps;
  // A first visit gains a controller too, but is already running the latest code.
  let controlled = container.controller !== null;
  container.addEventListener('controllerchange', () => {
    if (controlled) {
      onUpdate();
    }
    controlled = true;
  });
  container.register('./sw.js').then((registration) => {
    const check = (): void => {
      if (!document.hidden) {
        // Rejects when offline, which just means no update yet.
        registration.update().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', check);
    deps.setInterval(check, UPDATE_CHECK_MS);
  }).catch(() => undefined);
}
