import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { afterEach, expect, it, vi } from 'vitest';
import { bindItemPress } from './itemPress';

const setup = () => {
  vi.useFakeTimers();
  const input = new EventEmitter(); const events = new EventEmitter();
  const canvas = document.createElement('canvas');
  const target = Object.assign(new EventEmitter(), { scene: { input, events, game: { canvas } } });
  const tap = vi.fn(); const hold = vi.fn();
  bindItemPress(target as unknown as Phaser.GameObjects.GameObject, 2, tap, hold);
  const pointer = { id: 0, button: 0, x: 50, y: 50 };
  return { target, input, events, canvas, tap, hold, pointer };
};
afterEach(() => { window.dispatchEvent(new Event('blur')); vi.useRealTimers(); });

it('waits for release to tap, and consumes release after a hold', () => {
  const { target, pointer, tap, hold } = setup();
  target.emit('pointerdown', pointer); vi.advanceTimersByTime(100);
  expect(tap).not.toHaveBeenCalled(); target.emit('pointerup', pointer);
  expect(tap).toHaveBeenCalledTimes(1);
  target.emit('pointerdown', pointer); vi.advanceTimersByTime(500);
  expect(hold).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000); target.emit('pointerup', pointer);
  expect(tap).toHaveBeenCalledTimes(1); expect(hold).toHaveBeenCalledTimes(1);
  target.emit('destroy');
});

it.each(['move', 'out', 'outside', 'touchcancel', 'pointercancel', 'blur', 'shutdown', 'destroy'])('cancels %s without changing readiness or opening details', (reason) => {
  const { target, input, events, canvas, pointer, tap, hold } = setup();
  target.emit('pointerdown', pointer);
  if (reason === 'move') input.emit('pointermove', { ...pointer, x: 80 });
  else if (reason === 'out') target.emit('pointerout', pointer);
  else if (reason === 'outside') input.emit('pointerupoutside', pointer);
  else if (reason === 'touchcancel' || reason === 'pointercancel') canvas.dispatchEvent(new Event(reason));
  else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
  else if (reason === 'shutdown') events.emit('shutdown');
  else target.emit('destroy');
  vi.advanceTimersByTime(1000); target.emit('pointerup', pointer);
  expect(tap).not.toHaveBeenCalled(); expect(hold).not.toHaveBeenCalled();
  target.emit('destroy'); expect(input.eventNames()).toEqual([]); expect(events.eventNames()).toEqual([]);
});

it('ignores another pointer and secondary mouse buttons', () => {
  const { target, input, pointer, tap, hold } = setup();
  target.emit('pointerdown', { ...pointer, button: 2 }); vi.advanceTimersByTime(600);
  expect(hold).not.toHaveBeenCalled();
  target.emit('pointerdown', pointer);
  input.emit('pointerup', { ...pointer, id: 1 });
  target.emit('pointerup', pointer); expect(tap).toHaveBeenCalledTimes(1);
  target.emit('destroy');
});
