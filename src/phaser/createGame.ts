import Phaser from 'phaser';
import type { Controller } from '../app/controller';
import { BootScene } from './BootScene';
import { MainScene } from './MainScene';
import { PuzzleScene } from './PuzzleScene';

/**
 * Starts the Phaser game full-window. The boot scene loads the icons, then
 * the controller decides between the main screen and a puzzle.
 * @param controller the app
 * @returns the game
 */
export function createGame(controller: Controller): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'app',
    backgroundColor: '#1E3326',
    banner: false,
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: '100%',
      height: '100%',
    },
    scene: [BootScene, MainScene, PuzzleScene],
    callbacks: {
      postBoot: (game) => {
        game.registry.set('controller', controller);
      },
    },
  });
}
