import type { AccessibleControl } from './accessibility';

/** Semantic companion to the adventure canvas; Phaser owns layout and actions. */
export function createAccessibleAdventure(parent: HTMLElement, onSelect: (name: string, details?: boolean) => void): {
  render: (title: string, description: string, controls: readonly AccessibleControl[], current?: string) => void;
  focus: () => void;
  destroy: () => void;
} {
  const root = document.createElement('section');
  root.className = 'accessible-adventure';
  root.setAttribute('aria-label', 'Adventure screens');
  const heading = document.createElement('h1'); heading.className = 'sr-only';
  const description = document.createElement('p'); description.className = 'sr-only';
  const status = document.createElement('p'); status.className = 'sr-only'; status.setAttribute('role', 'status');
  const buttons = document.createElement('div');
  root.append(heading, description, buttons, status); parent.append(root);
  const controls = new Map<string, HTMLButtonElement>();
  return {
    render: (title, body, actions, current) => {
      const focused = root.contains(document.activeElement);
      const previous = (document.activeElement as HTMLElement | null)?.dataset.action;
      const changed = heading.textContent !== title;
      heading.textContent = title; description.textContent = body;
      if (changed) status.textContent = title;
      const names = new Set(actions.map((action) => action.name));
      for (const [name, button] of controls) if (!names.has(name)) { button.remove(); controls.delete(name); }
      for (const { name, label, disabled, details, bounds: [x, y, width, height] } of actions) {
        let button = controls.get(name);
        if (!button) {
          button = document.createElement('button'); button.type = 'button'; button.dataset.action = name;
          button.onclick = () => { if (!controls.get(name)?.disabled) onSelect(name); };
          button.onkeydown = (event) => {
            if (event.shiftKey && event.key === 'Enter' && button!.hasAttribute('aria-keyshortcuts')) {
              event.preventDefault();
              if (!event.repeat && !button!.disabled) onSelect(name, true);
            }
          };
          controls.set(name, button);
        }
        button.setAttribute('aria-label', label); button.disabled = disabled;
        if (details) { button.setAttribute('aria-keyshortcuts', 'Shift+Enter'); button.title = 'Tap to toggle readiness; hold or Shift+Enter for details'; }
        else { button.removeAttribute('aria-keyshortcuts'); button.removeAttribute('title'); }
        if (name === current) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
        button.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
        buttons.append(button);
      }
      if (focused) (controls.get(previous ?? '') ?? [...controls.values()].find((button) => !button.disabled))?.focus({ preventScroll: true });
    },
    focus: () => [...controls.values()].find((button) => !button.disabled)?.focus({ preventScroll: true }),
    destroy: () => root.remove(),
  };
}
