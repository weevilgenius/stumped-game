import Phaser from 'phaser';
import './index.css';
import { BootScene } from './scenes/BootScene';
import { MainScene } from './scenes/MainScene';
import { PuzzleScene } from './scenes/PuzzleScene';
import { appController } from './state/appController';
import type { GameSession } from './state/gameSession';
import { openBestTimesModal, openSettingsModal } from './ui/modals';

/**
 * Global diagnostic and automation bridge exposed on `window.__STUMPED__`
 * for E2E tests and the screenshot utility.
 */
export interface StumpedAutomationBridge {
  /** True once Phaser has booted and transitioned to `MainScene` or `PuzzleScene`. */
  ready: boolean;
  /** Underlying Phaser Game instance. */
  readonly game: Phaser.Game;
  /** Shared application controller. */
  readonly appController: typeof appController;
  /** Returns the currently active Phaser scene key (`'MainScene'` or `'PuzzleScene'`). */
  getActiveSceneKey: () => string;
  /** Returns the current puzzle session, if any. */
  getSession: () => GameSession | null;
  /** Starts a puzzle from a seed code and switches to `PuzzleScene`. */
  playSeed: (seedCode: string) => void;
  /** Returns the screen coordinates `{ x, y }` of the center of `cell` on the puzzle board. */
  getCellCenter: (cell: number) => { x: number; y: number } | null;
  /** Programmatically taps a cell on the active `PuzzleScene`. */
  tapCell: (cell: number) => void;
  /** Programmatically double-taps a cell on the active `PuzzleScene`. */
  doubleTapCell: (cell: number) => void;
  /** Navigates to the main menu scene. */
  goToMain: () => void;
  /** Opens the Settings modal. */
  openSettings: () => void;
  /** Opens the Best Times modal. */
  openBestTimes: () => void;
}

declare global {
  interface Window {
    __STUMPED__?: StumpedAutomationBridge;
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#24160D',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: '100%',
    height: '100%',
  },
  scene: [BootScene, MainScene, PuzzleScene],
};

const game = new Phaser.Game(config);

const getActivePuzzleScene = (): PuzzleScene | null => {
  const scene = game.scene.getScene('PuzzleScene') as PuzzleScene | undefined;
  if (scene && game.scene.isActive('PuzzleScene')) {
    return scene;
  }
  return null;
};

const bridge: StumpedAutomationBridge = {
  ready: false,
  game,
  appController,
  getActiveSceneKey: () => {
    if (game.scene.isActive('PuzzleScene')) {
      return 'PuzzleScene';
    }
    if (game.scene.isActive('MainScene')) {
      return 'MainScene';
    }
    return 'BootScene';
  },
  getSession: () => appController.getSession(),
  playSeed: (seedCode: string) => {
    appController.startSeedPuzzle(seedCode);
    if (game.scene.isActive('PuzzleScene')) {
      game.scene.getScene('PuzzleScene').scene.restart();
    } else {
      game.scene.stop('MainScene');
      game.scene.start('PuzzleScene');
    }
  },
  getCellCenter: (cell: number) => {
    const puzzleScene = getActivePuzzleScene();
    const session = appController.getSession();
    if (!puzzleScene || !session) {
      return null;
    }
    const bv = puzzleScene.getBoardView();
    const size = session.puzzle.size;
    const cellPx = bv.getBoardPx() / size;
    const r = Math.floor(cell / size);
    const c = cell % size;
    return {
      x: bv.getBoardX() + (c + 0.5) * cellPx,
      y: bv.getBoardY() + (r + 0.5) * cellPx,
    };
  },
  tapCell: (cell: number) => {
    getActivePuzzleScene()?.tapCell(cell);
  },
  doubleTapCell: (cell: number) => {
    getActivePuzzleScene()?.doubleTapCellDirect(cell);
  },
  goToMain: () => {
    if (game.scene.isActive('PuzzleScene')) {
      game.scene.stop('PuzzleScene');
    }
    game.scene.start('MainScene');
  },
  openSettings: () => {
    openSettingsModal(appController.getSettings(), (updated) => {
      appController.updateSettings(updated);
    });
  },
  openBestTimes: () => {
    const s = appController.getSession();
    openBestTimesModal(s?.puzzle.size ?? 6, s?.puzzle.tier ?? 'medium');
  },
};

window.__STUMPED__ = bridge;

// Poll briefly until BootScene finishes transitioning to MainScene or PuzzleScene
const checkReady = (): void => {
  if (game.scene.isActive('MainScene') || game.scene.isActive('PuzzleScene')) {
    bridge.ready = true;
    return;
  }
  window.setTimeout(checkReady, 25);
};
checkReady();
