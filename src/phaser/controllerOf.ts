import type Phaser from 'phaser';
import type { Controller } from '../app/controller';

/**
 * @param scene any live scene
 * @returns the app controller stored on the game
 */
export function controllerOf(scene: Phaser.Scene): Controller {
  return scene.game.registry.get('controller') as Controller;
}
