/* ========================================================= *\
 *  Stumped Game Entry Point: Phaser 4 Initialization        *
\* ========================================================= */

import './index.css';
import Phaser from 'phaser';
import { BootScene } from './game/BootScene';
import { GameScene } from './game/GameScene';
import { MainScene } from './game/MainScene';
import { getActiveTheme } from './ui/theme';

const theme = getActiveTheme();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: theme.background,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MainScene, GameScene],
  render: {
    antialias: true,
    roundPixels: false,
  },
};

/** The active Phaser Game instance. */
export const game = new Phaser.Game(config);
