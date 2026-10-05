import type { Controller } from '../app/controller';

/**
 * The seed field is a real input so the phone keyboard opens. Everything else
 * on the two screens is drawn by Phaser.
 * @param controller the app
 */
export function mountSeedDialog(controller: Controller): void {
  const root = document.createElement('div');
  root.id = 'seed-dialog';
  root.hidden = true;
  root.innerHTML = `
    <form>
      <label for="seed-input">Seed code</label>
      <input id="seed-input" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" />
      <p></p>
      <div class="row">
        <button type="button">Cancel</button>
        <button type="submit">Play</button>
      </div>
    </form>
  `;
  document.body.append(root);
  const form = root.querySelector('form');
  const input = root.querySelector('input');
  const error = root.querySelector('p');
  const cancel = root.querySelector('button[type="button"]');
  if (!form || !input || !error || !cancel) {
    return;
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void controller.submitSeed(input.value);
  });
  cancel.addEventListener('click', () => {
    controller.cancelPanel();
  });
  let open = false;
  controller.subscribe(() => {
    const next = controller.panel === 'seed';
    root.hidden = !next;
    error.textContent = controller.seedError ?? '';
    if (next && !open) {
      input.value = '';
      input.focus();
    }
    open = next;
  });
}
