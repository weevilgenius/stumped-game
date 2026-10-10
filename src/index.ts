import './index.css';
import type { Tier } from './engine';
import { createController } from './controller';
import { bestTimes, formatTime, type Game, isClean, MARK_STUMP, type Result, resultOf } from './game';
import { ICONS, openPuzzle, PALETTE } from './puzzleScene';
import { createWorkerGenerator } from './generator';

/* ========================================================= *\
 *  Main screen and DOM glue. App state lives in the         *
 *  controller (controller.ts); the puzzle screen is the     *
 *  Phaser scene in puzzleScene.ts.                          *
\* ========================================================= */

/** Prefix for main's localStorage keys; the bake-off apps on the same origin use their own. */
const STORAGE_PREFIX = 'stumped-main.';

/* ========================================================= *\
 *  Puzzle generation, in a worker                           *
\* ========================================================= */

const generateInWorker = createWorkerGenerator(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
);

const controller = createController({
  storage: {
    getItem: (key) => localStorage.getItem(`${STORAGE_PREFIX}${key}`),
    setItem: (key, value) => localStorage.setItem(`${STORAGE_PREFIX}${key}`, value),
  },
  generate: generateInWorker,
  now: () => performance.now(),
  date: () => Date.now(),
  createId: () => crypto.randomUUID(),
  random: Math.random,
  confirm: (question) => confirm(question),
});

/* ========================================================= *\
 *  Screens                                                  *
\* ========================================================= */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const menu = $('menu');
const stage = $('game');
const storageNotice = $('storageNotice');
const sizeStorageNotice = (): void => document.documentElement.style.setProperty(
  '--storage-height', `${storageNotice.hidden ? 0 : Math.ceil(storageNotice.getBoundingClientRect().height)}px`,
);
new ResizeObserver(sizeStorageNotice).observe(storageNotice);

const icon = (name: keyof typeof ICONS, label: string): string => (
  `<img class="icon" src="${ICONS[name]}" alt="${label}" title="${label}">`);

/** Icons for whatever qualified a solve: a star if clean, else hints, acorns lost, and repeat. */
const badges = (result: Result): string => [
  isClean(result) ? '<span class="star" title="Clean solve">★</span>' : '',
  ...result.hints.map((hint) => icon(hint, `Used the ${hint}`)),
  result.acornsLost > 0 ? `${icon('acorn', 'Acorns lost')}−${result.acornsLost}` : '',
  result.silver ? icon('silver', 'Silver acorn mode') : '',
  result.repeat ? '<span title="Repeat play">↻</span>' : '',
].join(' ');

const renderMenu = (): void => {
  const { game } = controller;
  $('current').hidden = !game;
  if (!game) {
    return;
  }
  const { puzzle, marks, status, elapsed } = game;
  const thumb = $<HTMLButtonElement>('thumb');
  thumb.disabled = status !== 'playing';
  thumb.style.gridTemplateColumns = `repeat(${puzzle.size}, 1fr)`;
  // A lost puzzle can be retried, so the thumbnail only ever shows stumps the player revealed.
  thumb.replaceChildren(...marks.map((mark, cell) => {
    const square = document.createElement('i');
    square.style.backgroundColor = `#${PALETTE[puzzle.colors[puzzle.regions[cell]]].toString(16).padStart(6, '0')}`;
    if (mark === MARK_STUMP) {
      square.style.backgroundImage = `url("${ICONS.stump}")`;
    }
    return square;
  }));
  const state = {
    playing: `In progress, ${formatTime(elapsed)}`,
    won: `Solved in <b>${formatTime(elapsed)}</b> ${badges(resultOf(game))}`,
    lost: 'Stumped.',
  }[status];
  $('info').innerHTML = `<b>${puzzle.size}×${puzzle.size} ${puzzle.tier}</b>`
    + `${puzzle.silver && status !== 'won' ? ` ${icon('silver', 'Silver acorn mode')}` : ''}`
    + `<br>${state}<br><code>${puzzle.code}</code>`;
};

/** The game the puzzle screen was last opened on. */
let opened: Game | null = null;

/** Shows whichever screen the controller is on. */
const render = (): void => {
  storageNotice.textContent = [controller.recoveryNotice, controller.storageError, controller.generationError].filter(Boolean).join(' ');
  storageNotice.hidden = !storageNotice.textContent;
  sizeStorageNotice();
  menu.classList.toggle('busy', controller.busy);
  const { game, screen } = controller;
  if (screen === 'puzzle' && game) {
    if (stage.hidden || opened !== game) {
      opened = game;
      menu.hidden = true;
      stage.hidden = false;
      openPuzzle(stage, {
        model: game,
        showTimer: controller.settings.timer,
        onChange: controller.changed,
        elapsed: controller.tick,
        onExit: controller.showMenu,
      });
    }
  } else {
    opened = null;
    stage.hidden = true;
    menu.hidden = false;
    renderMenu();
  }
};

/* ========================================================= *\
 *  Main screen controls                                     *
\* ========================================================= */

$('new').onclick = (): void => void controller.newPuzzle();
$('thumb').onclick = controller.resume;
$('retry').onclick = controller.retry;

$('share').onclick = (): void => {
  if (!controller.game) {
    return;
  }
  const { code } = controller.game.puzzle;
  const url = `${location.origin}${location.pathname}?code=${code}`;
  if (typeof navigator.share === 'function') {
    // Rejects when the player closes the share sheet, which is fine.
    navigator.share({ title: 'Stumped', text: `Stumped puzzle ${code}`, url }).catch(() => undefined);
  } else {
    const button = $('share');
    void navigator.clipboard.writeText(url).then(() => {
      button.textContent = 'Link copied';
      setTimeout(() => button.textContent = 'Share', 1500);
    });
  }
};

const codeInput = $<HTMLInputElement>('code');
codeInput.oninput = (): void => codeInput.setCustomValidity('');
$<HTMLFormElement>('codeForm').onsubmit = (event): void => {
  event.preventDefault();
  if (controller.playCode(codeInput.value)) {
    codeInput.value = '';
  } else {
    codeInput.setCustomValidity('That is not a valid seed code.');
    codeInput.reportValidity();
  }
};

/* ========================================================= *\
 *  Settings                                                 *
\* ========================================================= */

const settingsDialog = $<HTMLDialogElement>('settings');
const settingsForm = settingsDialog.querySelector('form')!;
const SELECTS = ['size', 'tier', 'sizeMix', 'shape', 'freebies'] as const;

$('settingsButton').onclick = (): void => {
  for (const name of SELECTS) {
    (settingsForm.elements.namedItem(name) as HTMLSelectElement).value = String(controller.settings[name] ?? '');
  }
  for (const name of ['timer', 'silver'] as const) {
    (settingsForm.elements.namedItem(name) as HTMLInputElement).checked = controller.settings[name];
  }
  settingsDialog.showModal();
};

settingsForm.onchange = (): void => {
  const data = new FormData(settingsForm);
  const level = (name: string): number | undefined => (data.get(name) ? Number(data.get(name)) : undefined);
  controller.updateSettings({
    timer: data.has('timer'),
    silver: data.has('silver'),
    size: level('size'),
    tier: (data.get('tier') as Tier | '') || undefined,
    sizeMix: level('sizeMix'),
    shape: level('shape'),
    freebies: level('freebies'),
  });
};

/* ========================================================= *\
 *  Best times                                               *
\* ========================================================= */

const timesDialog = $<HTMLDialogElement>('times');
const timesForm = timesDialog.querySelector('form')!;
const timesSize = timesForm.elements.namedItem('size') as HTMLSelectElement;
const timesTier = timesForm.elements.namedItem('tier') as HTMLSelectElement;

const renderTimes = (): void => {
  const times = bestTimes(controller.results, Number(timesSize.value), timesTier.value as Tier);
  $('timesList').innerHTML = times.map((result) => (
    `<li><b>${formatTime(result.time)}</b> ${badges(result)}`
    + `<time>${new Date(result.date).toLocaleDateString()}</time></li>`
  )).join('') || '<li>No times yet.</li>';
};

$('timesButton').onclick = (): void => {
  // Open on the current puzzle's list, or the latest result's.
  const shown = controller.game?.puzzle ?? controller.results.at(-1);
  if (shown) {
    timesSize.value = String(shown.size);
    timesTier.value = shown.tier;
  }
  renderTimes();
  timesDialog.showModal();
};

timesForm.onchange = renderTimes;

/* ========================================================= *\
 *  Startup                                                  *
\* ========================================================= */

controller.subscribe(render);
controller.setHidden(document.hidden);
document.addEventListener('visibilitychange', () => controller.setHidden(document.hidden));
render();

// A link with a seed code starts that puzzle. The code is dropped from the URL so a reload does not restart it.
const linked = new URLSearchParams(location.search).get('code');
if (linked) {
  history.replaceState(null, '', location.pathname);
}
controller.boot(linked);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js');
}
