import './index.css';
import { Controller, type Panel } from './app/controller';
import type { Tier } from './engine';
import { createGame } from './phaser/createGame';
import { registerServiceWorker } from './pwa';
import { mountSeedDialog } from './ui/seedDialog';

const controller = new Controller();
createGame(controller);
mountSeedDialog(controller);

const root = document.querySelector<HTMLElement>('#app');

controller.subscribe(() => {
  publish(controller, root);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    controller.onHide();
  } else {
    controller.onShow();
  }
});

void controller.boot().then(() => {
  publish(controller, root);
});

if (import.meta.env.PROD) {
  registerServiceWorker();
}

/**
 * Mirrors the controller onto the page so tests and screenshots can see which
 * screen is up without reading pixels.
 * @param app the controller
 * @param host the game's parent element
 */
function publish(app: Controller, host: HTMLElement | null): void {
  if (host) {
    host.dataset.ready = app.booted ? 'true' : 'false';
    host.dataset.screen = app.screen;
    host.dataset.panel = app.panel;
    host.dataset.growing = app.growing ? 'true' : 'false';
    const session = app.session;
    if (session) {
      host.dataset.code = session.puzzle.code;
      host.dataset.status = session.status;
      host.dataset.stumps = `${session.revealedCount()}/${session.puzzle.size}`;
      host.dataset.acorns = String(session.acornsLeft);
    } else {
      delete host.dataset.code;
      delete host.dataset.status;
      delete host.dataset.stumps;
      delete host.dataset.acorns;
    }
  }
  window.__stumped = {
    get ready() {
      return app.booted;
    },
    startNew: () => app.requestNewPuzzle(),
    setSize: (size) => {
      app.updateSettings({ size });
    },
    setTier: (tier) => {
      app.updateSettings({ tier });
    },
    showPanel: (panel) => {
      app.showPanel(panel);
    },
    home: () => {
      app.showMain();
    },
    suppose: () => {
      app.session?.enterHypothesis();
      app.persist();
    },
    revealAll: () => {
      app.revealSolution();
    },
    get session() {
      const session = app.session;
      if (!session) {
        return null;
      }
      return {
        code: session.puzzle.code,
        stumps: `${session.revealedCount()}/${session.puzzle.size}`,
        status: session.status,
        acorns: session.acornsLeft,
      };
    },
  };
}

declare global {
  interface Window {
    /** Present so screenshots and end-to-end tests can drive the game. */
    __stumped?: {
      readonly ready: boolean;
      startNew: () => Promise<void>;
      setSize: (size: number | null) => void;
      setTier: (tier: Tier | null) => void;
      showPanel: (panel: Panel) => void;
      home: () => void;
      suppose: () => void;
      revealAll: () => void;
      readonly session: { code: string; stumps: string; status: string; acorns: number } | null;
    };
  }
}
