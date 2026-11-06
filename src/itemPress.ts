import type Phaser from 'phaser';

/** Bind a canvas tap and optional 500ms hold, cancelling drags and interrupted presses. */
export function bindItemPress(target: Phaser.GameObjects.GameObject, scale: number, onTap: () => void, onHold?: () => void): void {
  const scene = target.scene;
  const canvas = scene.game.canvas;
  let press: { id: number; x: number; y: number; held: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => { clearTimeout(timer); timer = undefined; press = null; };
  const down = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.button !== 0 || press) return;
    press = { id: pointer.id, x: pointer.x, y: pointer.y, held: false };
    if (onHold) timer = setTimeout(() => {
      if (!press) return;
      press.held = true;
      onHold();
    }, 500);
  };
  const up = (pointer: Phaser.Input.Pointer): void => {
    if (press?.id !== pointer.id) return;
    const held = press.held;
    cancel();
    if (!held) onTap();
  };
  const move = (pointer: Phaser.Input.Pointer): void => {
    if (press?.id === pointer.id && Math.hypot(pointer.x - press.x, pointer.y - press.y) > 12 * scale) cancel();
  };
  const released = (pointer: Phaser.Input.Pointer): void => { if (press?.id === pointer.id) cancel(); };
  const destroy = (): void => {
    cancel();
    target.off('pointerdown', down).off('pointerup', up).off('pointerout', released);
    scene.input.off('pointermove', move).off('pointerup', released).off('pointerupoutside', released).off('gameout', cancel);
    scene.events.off('shutdown', destroy);
    target.off('destroy', destroy);
    canvas.removeEventListener('touchcancel', cancel, true);
    canvas.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('blur', cancel);
  };
  target.on('pointerdown', down).on('pointerup', up).on('pointerout', released).once('destroy', destroy);
  scene.input.on('pointermove', move).on('pointerup', released).on('pointerupoutside', released).on('gameout', cancel);
  scene.events.once('shutdown', destroy);
  canvas.addEventListener('touchcancel', cancel, true);
  canvas.addEventListener('pointercancel', cancel, true);
  window.addEventListener('blur', cancel);
}
