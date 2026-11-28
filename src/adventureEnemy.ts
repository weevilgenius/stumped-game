import Phaser from 'phaser';
import type { AdventureEvent } from './adventure/engine';
import sheet from './assets/adventure-enemies.png';

const TEXTURE = 'adventure-enemies';
// Each row holds four frames per pose, all facing the player.
const ENEMIES = ['wolf', 'boar', 'rats', 'bandit', 'bear', 'wisp', 'troll', 'wraith', 'wyvern', 'hag', 'golem', 'ancient-warden'];
const POSES = ['idle', 'attack', 'hit'] as const;

/** Load the encounter portraits alongside the adventurer. */
export function preloadEnemies(scene: Phaser.Scene): void {
  if (!scene.textures.exists(TEXTURE)) scene.load.spritesheet(TEXTURE, sheet, { frameWidth: 32, frameHeight: 32 });
}

/** Play this enemy's turn in event order. A defeated enemy rests after its last hit. */
export function drawEnemy(scene: Phaser.Scene, id: string, defeated: boolean, x: number, y: number, size: number,
  events: readonly AdventureEvent[]): Phaser.GameObjects.Sprite | undefined {
  const row = ENEMIES.indexOf(id);
  if (row < 0) return;
  const key = (pose: typeof POSES[number]): string => `${TEXTURE}-${id}-${pose}`;
  const first = row * POSES.length * 4;
  if (!scene.anims.exists(key('idle'))) {
    scene.textures.get(TEXTURE).setFilter(Phaser.Textures.FilterMode.NEAREST);
    POSES.forEach((pose, index) => {
      const start = first + index * 4;
      scene.anims.create({ key: key(pose), frames: scene.anims.generateFrameNumbers(TEXTURE, { start, end: start + 3 }),
        frameRate: pose === 'idle' ? 3 : 12, repeat: pose === 'idle' ? -1 : 0 });
    });
  }
  const sprite = scene.add.sprite(x, y, TEXTURE, first).setDisplaySize(size, size);
  const queue: string[] = [];
  for (const event of events) {
    if (event.type === 'damage-applied' && event.target === 'enemy' && event.amount > 0) queue.push(key('hit'));
    else if (event.type === 'enemy-acted' && event.encounter === id) queue.push(key('attack'));
  }
  if (defeated) sprite.setAlpha(0.55);
  else queue.push(key('idle'));
  if (queue.length) sprite.play(queue[0]).chain(queue.slice(1));
  return sprite;
}
