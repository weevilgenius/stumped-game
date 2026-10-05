import Phaser from 'phaser';
import acornUrl from '../assets/acorn_icon.png';
import logoUrl from '../assets/logo.jpg';
import owlUrl from '../assets/owl_icon.png';
import silverUrl from '../assets/silver_acorn_icon.png';
import squirrelUrl from '../assets/squirrel_icon.png';
import stumpUrl from '../assets/stump_icon.png';
import woodpeckerUrl from '../assets/woodpecker_icon.png';
import { FONT } from './widgets';
import { controllerOf } from './controllerOf';

const ICONS = ['stump', 'acorn', 'silverAcorn', 'woodpecker', 'owl', 'squirrel'] as const;

/**
 * Loads the logo and the icons, knocks the flat black out of the icons, and
 * starts whichever screen the controller settled on.
 */
export class BootScene extends Phaser.Scene {
  private left = false;

  constructor() {
    super('boot');
  }

  preload(): void {
    this.load.image('logo', logoUrl);
    this.load.image('stump', stumpUrl);
    this.load.image('acorn', acornUrl);
    this.load.image('silverAcorn', silverUrl);
    this.load.image('woodpecker', woodpeckerUrl);
    this.load.image('owl', owlUrl);
    this.load.image('squirrel', squirrelUrl);
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.text(width / 2, height / 2, 'Growing a forest…', {
      fontFamily: FONT, fontSize: '28px', color: '#F4EBD4',
    }).setOrigin(0.5);
    for (const key of ICONS) {
      knockOutBackground(this, key);
    }
    const controller = controllerOf(this);
    const leave = (): void => {
      if (this.left || !controller.booted) {
        return;
      }
      this.left = true;
      unsubscribe();
      this.scene.start(controller.screen === 'puzzle' ? 'puzzle' : 'main');
    };
    const unsubscribe = controller.subscribe(leave);
    this.events.once('shutdown', unsubscribe);
    leave();
  }
}

/**
 * The icon files are painted on black. The corner pixel is that black, and
 * pixels close to it become transparent so the artwork can sit on the board.
 * @param scene the boot scene
 * @param key texture key
 */
function knockOutBackground(scene: Phaser.Scene, key: string): void {
  const source = scene.textures.get(key).getSourceImage() as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context || canvas.width === 0) {
    return;
  }
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  const baseR = data[0] ?? 0;
  const baseG = data[1] ?? 0;
  const baseB = data[2] ?? 0;
  const limit = 22 * 22;
  for (let i = 0; i < data.length; i += 4) {
    const dr = (data[i] ?? 0) - baseR;
    const dg = (data[i + 1] ?? 0) - baseG;
    const db = (data[i + 2] ?? 0) - baseB;
    if (dr * dr + dg * dg + db * db <= limit) {
      data[i + 3] = 0;
    }
  }
  context.putImageData(image, 0, 0);
  scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
}
