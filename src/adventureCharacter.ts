import Phaser from 'phaser';
import sheet from './assets/adventurer.png';
import type { AdventureEvent, RunOutcome } from './adventure/engine';

const TEXTURE = 'adventure-character';
// Four frames per row, in sprite sheet order.
const POSES = ['idle', 'attack', 'block', 'hit', 'forage', 'death', 'victory'] as const;
type Pose = typeof POSES[number];
const key = (pose: Pose): string => `${TEXTURE}-${pose}`;

/** Load the encounter strip's woodland traveler. */
export function preloadCharacter(scene: Phaser.Scene): void {
  if (!scene.textures.exists(TEXTURE)) scene.load.spritesheet(TEXTURE, sheet, { frameWidth: 32, frameHeight: 32 });
}

/** Draw the player and play the turn's actions before idling or holding the final pose. */
export function drawCharacter(scene: Phaser.Scene, x: number, y: number, size: number,
  outcome: RunOutcome | null, events: readonly AdventureEvent[] = []): Phaser.GameObjects.Sprite {
  if (!scene.anims.exists(key('idle'))) {
    scene.textures.get(TEXTURE).setFilter(Phaser.Textures.FilterMode.NEAREST);
    POSES.forEach((pose, row) => scene.anims.create({
      key: key(pose), frames: scene.anims.generateFrameNumbers(TEXTURE, { start: row * 4, end: row * 4 + 3 }),
      frameRate: pose === 'idle' ? 3 : pose === 'death' || pose === 'victory' ? 5 : 12, repeat: pose === 'idle' ? -1 : 0,
    }));
  }
  const player = scene.add.sprite(x, y, TEXTURE).setDisplaySize(size, size);
  const poses: Pose[] = [];
  const show = (pose: Pose): void => {
    if (poses.at(-1) !== pose) poses.push(pose);
  };
  // Supplies awarded for defeating an enemy are also reported as a resource gain.
  const harvesting = events.some((event) => event.type === 'collected')
    && !events.some((event) => event.type === 'encounter-transitioned' && event.to === 'scavenge');
  for (const event of events) {
    if (event.type === 'ability-activated' && event.effect !== 'heal') show(event.effect);
    else if (event.type === 'damage-applied') {
      if (event.target === 'enemy') show('attack');
      else if (event.amount > event.blocked) show('hit');
      else if (event.blocked > 0) show('block');
    } else if (event.type === 'potion-used' && event.potion === 'block-potion') show('block');
    else if (event.type === 'experience-gained' || (event.type === 'resource-changed' && harvesting && event.amount > 0)) show('forage');
  }
  poses.push(outcome === 'death' || outcome === 'victory' ? outcome : 'idle');
  player.play(key(poses[0])).chain(poses.slice(1).map(key));
  return player;
}
