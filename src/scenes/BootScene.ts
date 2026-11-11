import Phaser from 'phaser';
import { appController } from '../state/appController';
import { ASSET_URLS, TEXTURE_KEYS } from '../ui/assets';
import { showToast } from '../ui/modals';

/**
 * Initial Phaser scene that preloads all sprite/logo textures and routes to
 * either `MainScene` or `PuzzleScene`.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    this.load.image(TEXTURE_KEYS.LOGO, ASSET_URLS.logo);
    this.load.image(TEXTURE_KEYS.STUMP, ASSET_URLS.stump);
    this.load.image(TEXTURE_KEYS.ACORN, ASSET_URLS.acorn);
    this.load.image(TEXTURE_KEYS.SILVER_ACORN, ASSET_URLS.silverAcorn);
    this.load.image(TEXTURE_KEYS.WOODPECKER, ASSET_URLS.woodpecker);
    this.load.image(TEXTURE_KEYS.OWL, ASSET_URLS.owl);
    this.load.image(TEXTURE_KEYS.SQUIRREL, ASSET_URLS.squirrel);
  }

  create(): void {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');

    if (codeParam) {
      // Clean URL query parameter without reloading so refreshes don't re-trigger
      const cleanUrl = `${window.location.pathname}${window.location.hash}`;
      window.history.replaceState({}, '', cleanUrl);

      const current = appController.getSession();
      if (current?.getStatus() === 'in_progress' && current.puzzle.code !== codeParam.trim().toUpperCase()) {
        this.scene.start('MainScene', { pendingSeedCode: codeParam.trim() });
        return;
      }

      try {
        appController.startSeedPuzzle(codeParam);
        this.scene.start('PuzzleScene');
        return;
      } catch {
        showToast('Invalid puzzle seed code in URL.');
      }
    }

    if (appController.getInitialScreen() === 'puzzle') {
      this.scene.start('PuzzleScene');
    } else {
      this.scene.start('MainScene');
    }
  }
}
