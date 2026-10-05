/* ========================================================= *\
 *  Boot Scene: Asset Loading & Startup Navigation           *
\* ========================================================= */

import Phaser from 'phaser';
import acornIcon from '../assets/acorn_icon@4x.png';
import logoSquare from '../assets/logo_square.jpg';
import logoImg from '../assets/logo.jpg';
import owlIcon from '../assets/owl_icon@4x.png';
import silverAcornIcon from '../assets/silver_acorn_icon@4x.png';
import squirrelIcon from '../assets/squirrel_icon@4x.png';
import stumpIcon from '../assets/stump_icon@4x.png';
import woodpeckerIcon from '../assets/woodpecker_icon@4x.png';
import { generateFromCode, getOrGeneratePuzzle, prepareNextPuzzle } from '../generator/generatorService';
import { loadSavedGame, loadSettings } from '../state/storage';

/**
 * Boots the game, loads core visual assets, and directs navigation based on URL parameters.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  public preload(): void {
    this.load.image('logo', logoImg);
    this.load.image('logo_square', logoSquare);
    this.load.image('stump', stumpIcon);
    this.load.image('acorn', acornIcon);
    this.load.image('silver_acorn', silverAcornIcon);
    this.load.image('woodpecker', woodpeckerIcon);
    this.load.image('owl', owlIcon);
    this.load.image('squirrel', squirrelIcon);
  }

  public create(): void {
    const settings = loadSettings();
    prepareNextPuzzle(settings);

    // Check for query parameters e.g. ?code=... or ?scene=game
    let code: string | null = null;
    let targetScene: string | null = null;

    if (typeof window !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search);
      code = params.get('code');
      targetScene = params.get('scene');
    }

    if (code) {
      const puzzle = generateFromCode(code);
      if (puzzle) {
        this.scene.start('GameScene', { puzzle });
        return;
      }
    }

    if (targetScene === 'game') {
      const saved = loadSavedGame();
      if (saved?.status === 'playing') {
        this.scene.start('GameScene', { puzzle: saved.puzzle, savedState: saved });
        return;
      }
      getOrGeneratePuzzle(settings).then((puzzle) => {
        this.scene.start('GameScene', { puzzle });
      }).catch(() => {
        this.scene.start('MainScene');
      });
      return;
    }

    this.scene.start('MainScene');
  }
}
