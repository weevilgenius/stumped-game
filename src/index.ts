import './index.css';
import type { Tier } from './engine';
import { createController } from './controller';
import { bestTimes, formatTime, type Game, isClean, MARK_STUMP, type Result, resultOf } from './game';
import { openPuzzle } from './puzzleScene';
import { cssColor, type IconName, parseTheme, THEMES, type ThemeName } from './theme';
import { createWorkerGenerator } from './generator';
import { fillHelpBoards } from './help';
import { setMuted } from './sound';
import { watchForUpdates } from './updates';
import { parseChangelog, renderChangelog, releasesAfter } from './changelog';
import { solvesCsv } from './solves';

/* ========================================================= *\
 *  Main screen and DOM glue. App state lives in the         *
 *  controller (controller.ts); the puzzle screen is the     *
 *  Phaser scene in puzzleScene.ts.                          *
\* ========================================================= */

/** Prefix for main's localStorage keys; the bake-off apps on the same origin use their own. */
const STORAGE_PREFIX = 'stumped-main.';

/* ========================================================= *\
 *  Theme. Kept apart from the save, so older versions       *
 *  never see it and changing it never touches a puzzle.     *
\* ========================================================= */

const THEME_KEY = `${STORAGE_PREFIX}theme`;

let theme = THEMES[parseTheme((() => {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
})())];

/** Shows the main screen and dialogs in the current theme. The puzzle screen reads it when opened. */
const applyTheme = (): void => {
  document.documentElement.dataset.theme = theme.name;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', cssColor(theme.background));
  for (const image of document.querySelectorAll<HTMLImageElement>('img[data-icon]')) {
    image.src = theme.icons[image.dataset.icon as IconName];
  }
  // Piece names in the help text: one or many, capitalized when the placeholder is.
  for (const word of document.querySelectorAll<HTMLElement>('[data-piece]')) {
    const form = word.dataset.piece ?? '';
    const name = form.toLowerCase() === 'many' ? theme.piece.many : theme.piece.one;
    word.textContent = form === form.toLowerCase() ? name : `${name[0].toUpperCase()}${name.slice(1)}`;
  }
  for (const words of document.querySelectorAll<HTMLElement>('[data-silver]')) {
    words.textContent = words.dataset.silver === 'lower' ? theme.silverName.toLowerCase() : theme.silverName;
  }
};

const setTheme = (name: ThemeName): void => {
  theme = THEMES[name];
  try {
    localStorage.setItem(THEME_KEY, name);
  } catch {
    // The theme still applies until the page is closed.
  }
  applyTheme();
  renderMenu();
};

applyTheme();

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
  theme: () => theme.name,
});
setMuted(controller.settings.muted ?? false);

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

const icon = (name: IconName, label: string): string => (
  `<img class="icon" src="${theme.icons[name]}" alt="${label}" title="${label}">`);

/** Icons for whatever qualified a solve: a star if clean, else hints, acorns lost, and repeat. */
const badges = (result: Result): string => [
  isClean(result) ? '<span class="star" title="Clean solve">★</span>' : '',
  ...result.hints.map((hint) => icon(hint, `Used the ${theme.hintNames[hint].toLowerCase()}`)),
  result.acornsLost > 0 ? `${icon('acorn', 'Acorns lost')}−${result.acornsLost}` : '',
  result.silver ? icon('silver', `${theme.silverName} mode`) : '',
  result.repeat ? '<span title="Repeat play">↻</span>' : '',
].join(' ');

/** Joins choices as prose: "a", "a or b", "a, b or c". */
const either = (choices: readonly string[]): string => (
  choices.length > 1 ? `${choices.slice(0, -1).join(', ')} or ${choices.at(-1)}` : choices.join(''));

/** The kind of puzzle New puzzle deals, from the settings. */
const summary = (): string => {
  const { sizes, tiers, silver } = controller.settings;
  return [
    sizes ? either(sizes.map((size) => `${size}×${size}`)) : 'Any size',
    tiers ? `${either(tiers.map((tier, index) => (index ? tier : `${tier[0].toUpperCase()}${tier.slice(1)}`)))} difficulty`
      : 'Any difficulty',
    silver ? theme.silverName : 'A fresh puzzle every time',
  ].join(' · ');
};

/** The line above the current puzzle, by theme and status. */
const EYEBROWS = {
  woods: { playing: 'Your forest is waiting', won: 'A forest well found', lost: 'Stumped.' },
  vallarta: { playing: 'Your fiesta is waiting', won: '¡Bien hecho!', lost: 'Stumped.' },
} as const;

/** The invitation to try a lost puzzle again, by theme. */
const RETRY_LINES = {
  woods: 'Another walk through the woods?',
  vallarta: 'Another stroll down the Malecón?',
} as const;

const renderMenu = (): void => {
  $('summary').textContent = summary();
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
    square.style.backgroundColor = cssColor(theme.palette[puzzle.colors[puzzle.regions[cell]]]);
    if (mark === MARK_STUMP) {
      square.style.backgroundImage = `url("${theme.icons.stump}")`;
    }
    return square;
  }));
  $('resume').hidden = status !== 'playing';
  $('currentEyebrow').textContent = EYEBROWS[theme.name][status];
  const state = {
    playing: `In progress, ${formatTime(elapsed)}`,
    won: `Solved in <b>${formatTime(elapsed)}</b> ${badges(resultOf(game))}`,
    lost: RETRY_LINES[theme.name],
  }[status];
  $('info').innerHTML = `<b>${puzzle.size}×${puzzle.size} ${puzzle.tier}</b>`
    + `${puzzle.silver && status !== 'won' ? ` ${icon('silver', `${theme.silverName} mode`)}` : ''}`
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
  menu.inert = controller.busy;
  const { game, screen } = controller;
  if (screen === 'puzzle' && game) {
    if (stage.hidden || opened !== game) {
      opened = game;
      menu.hidden = true;
      stage.hidden = false;
      openPuzzle(stage, {
        model: game,
        results: controller.results,
        showTimer: controller.settings.timer,
        onChange: controller.changed,
        elapsed: controller.tick,
        onExit: controller.showMenu,
        onHelp: openHelp,
        theme,
      });
    }
  } else {
    const leavingPuzzle = !stage.hidden;
    opened = null;
    stage.hidden = true;
    menu.hidden = false;
    renderMenu();
    if (leavingPuzzle) {
      $('new').focus();
    }
  }
};

/* ========================================================= *\
 *  Main screen controls                                     *
\* ========================================================= */

$('new').onclick = (): void => void controller.newPuzzle();
$('thumb').onclick = controller.resume;
$('resume').onclick = controller.resume;
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
const SELECTS = ['sizeMix', 'shape', 'freebies'] as const;
/** Groups of toggles where checking none means Any, which has the empty value. */
const TOGGLES = ['sizes', 'tiers'] as const;

/** The toggles in a group, Any first. */
const toggles = (name: typeof TOGGLES[number]): HTMLInputElement[] => [
  ...settingsForm.querySelectorAll<HTMLInputElement>(`input[name=${name}]`),
];

$('settingsButton').onclick = (): void => {
  for (const name of SELECTS) {
    (settingsForm.elements.namedItem(name) as HTMLSelectElement).value = String(controller.settings[name] ?? '');
  }
  for (const name of ['timer', 'silver'] as const) {
    (settingsForm.elements.namedItem(name) as HTMLInputElement).checked = controller.settings[name];
  }
  (settingsForm.elements.namedItem('theme') as HTMLSelectElement).value = theme.name;
  (settingsForm.elements.namedItem('sound') as HTMLInputElement).checked = !controller.settings.muted;
  $('copySolvesStatus').textContent = '';
  for (const name of TOGGLES) {
    const chosen: readonly string[] = controller.settings[name]?.map(String) ?? [''];
    for (const toggle of toggles(name)) {
      toggle.checked = chosen.includes(toggle.value);
    }
  }
  settingsDialog.showModal();
};

settingsForm.onchange = (event): void => {
  const changed = event.target as HTMLInputElement;
  // The theme is saved on its own, so changing it leaves the puzzle being prepared alone.
  if (changed.name === 'theme') {
    setTheme(parseTheme(changed.value));
    return;
  }
  const group = TOGGLES.find((name) => name === changed.name);
  if (group) {
    // Any clears the other choices; any other choice clears Any; clearing them all brings Any back.
    const [any, ...others] = toggles(group);
    if (changed === any) {
      others.forEach((toggle) => (toggle.checked = false));
    }
    any.checked = !others.some((toggle) => toggle.checked);
  }
  const data = new FormData(settingsForm);
  const chosen = (name: typeof TOGGLES[number]): string[] | undefined => {
    const values = data.getAll(name).filter((value): value is string => typeof value === 'string' && value !== '');
    return values.length ? values : undefined;
  };
  const level = (name: string): number | undefined => (data.get(name) ? Number(data.get(name)) : undefined);
  controller.updateSettings({
    timer: data.has('timer'),
    silver: data.has('silver'),
    muted: !data.has('sound'),
    sizes: chosen('sizes')?.map(Number),
    tiers: chosen('tiers') as Tier[] | undefined,
    sizeMix: level('sizeMix'),
    shape: level('shape'),
    freebies: level('freebies'),
  });
  setMuted(!data.has('sound'));
  $('summary').textContent = summary();
};

/** Copies the solve log as CSV, for pasting into a spreadsheet or a message. */
if (import.meta.env.VITE_COLLECT_SOLVE_DATA === 'true') {
  $('solveData').hidden = false;
  $('copySolves').onclick = (): void => {
    const status = $('copySolvesStatus');
    const { solves } = controller;
    const count = solves.length;
    const failed = (): void => {
      status.textContent = 'Could not copy.';
    };
    // The clipboard is missing outside secure pages.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      failed();
      return;
    }
    clipboard.writeText(solvesCsv(solves)).then(() => {
      status.textContent = `Copied ${count} ${count === 1 ? 'solve' : 'solves'}.`;
    }, failed);
  };
}

/* ========================================================= *\
 *  Best times                                               *
\* ========================================================= */

const timesDialog = $<HTMLDialogElement>('times');
const timesTiers: readonly Tier[] = ['easy', 'medium', 'hard'];
const timesViewport = $('timesViewport');

const renderTimes = (): void => {
  const { game, results } = controller;
  $('gamesPlayed').textContent = controller.stats.gamesPlayed.toLocaleString();
  $('perfectSolves').textContent = controller.stats.perfectSolves.toLocaleString();
  const current = game?.status === 'playing';
  const solve = results.find((result) => result.id === game?.id) ?? results.at(-1);
  const shown = current ? game.puzzle : solve;
  $('timesContext').textContent = shown
    ? `${current ? 'Current puzzle' : 'Latest solve'}: ${shown.size} × ${shown.size} · ${shown.tier}`
    : 'No times yet. Completed games will appear here.';
  const sizes = [...new Set([...results.map((result) => result.size), ...(shown ? [shown.size] : [])])]
    .sort((a, b) => a - b);
  $('timesList').innerHTML = '<div class="times-headings">'
    + timesTiers.map((tier) => `<b>${tier}</b>`).join('') + '</div>'
    + sizes.map((size) => `<section class="times-size" aria-label="${size} by ${size}">`
      + timesTiers.map((tier) => {
        const active = current && size === shown?.size && tier === shown.tier;
        const times = bestTimes(results, size, tier);
        return `<div class="times-band" aria-label="${tier}">`
          + `<h3${active ? ' class="times-focus" aria-current="true"' : ''}>${size} × ${size}`
          + `${active ? '<small>Current puzzle</small>' : ''}</h3>`
          + `<ol>${times.map((result) => {
            const highlighted = !current && result.id === solve?.id;
            return `<li${highlighted ? ' class="times-focus" aria-current="true"' : ''}>`
              + `<div><b>${formatTime(result.time)}</b> ${badges(result)}</div>`
              + `<time>${new Date(result.date).toLocaleDateString()}</time>`
              + `${highlighted ? '<small>Latest solve</small>' : ''}</li>`;
          }).join('') || '<li class="times-empty">No times yet</li>'}</ol></div>`;
      }).join('') + '</section>').join('');
};

$('timesButton').onclick = (): void => {
  renderTimes();
  timesDialog.showModal();
  const target = timesDialog.querySelector<HTMLElement>('.times-focus');
  timesViewport.scrollTo({ left: 0, top: 0 });
  if (target) {
    const viewport = timesViewport.getBoundingClientRect();
    const bounds = target.getBoundingClientRect();
    timesViewport.scrollTo({
      left: bounds.left - viewport.left - (timesViewport.clientWidth - bounds.width) / 2,
      top: bounds.top - viewport.top - Math.max(56, (timesViewport.clientHeight - bounds.height) / 2),
    });
  }
};

/* ========================================================= *\
 *  How to play                                              *
\* ========================================================= */

const helpDialog = $<HTMLDialogElement>('help');
/** The theme the example boards were last drawn in. */
let helpTheme: ThemeName | null = null;

/** Shows the rules. Play time stops while they are open over a puzzle. */
const openHelp = (): void => {
  if (helpDialog.open) {
    return;
  }
  if (helpTheme !== theme.name) {
    helpTheme = theme.name;
    fillHelpBoards(helpDialog, theme.palette, theme.icons.stump, theme.piece);
  }
  controller.setHidden(true);
  $('helpBody').scrollTo({ top: 0 });
  helpDialog.showModal();
};

helpDialog.onclose = (): void => controller.setHidden(document.hidden);
$('helpButton').onclick = openHelp;

/* ========================================================= *\
 *  Release history                                          *
\* ========================================================= */

const changelogDialog = $<HTMLDialogElement>('changelog');
let changelogRequest = 0;

const openChangelog = async (updatesOnly: boolean): Promise<void> => {
  const request = ++changelogRequest;
  const body = $('changelogBody');
  $('changelogTitle').textContent = updatesOnly ? "What's new" : 'History';
  body.textContent = 'Loading release notes…';
  body.setAttribute('aria-busy', 'true');
  changelogDialog.showModal();
  body.scrollTop = 0;
  try {
    // The active service worker serves its build's changelog, even while this
    // page still runs the previous build. Fetch anew on every opening.
    const response = await fetch('./CHANGELOG.md', { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error('Release notes unavailable');
    }
    const releases = parseChangelog(await response.text());
    if (!releases.length) {
      throw new Error('Missing release notes');
    }
    if (request !== changelogRequest) {
      return;
    }
    renderChangelog(body, updatesOnly ? releasesAfter(releases, $('appVersion').dataset.version!) : releases);
  } catch {
    if (request === changelogRequest) {
      body.textContent = 'Release notes could not be loaded. Please close this window and try again.';
    }
  } finally {
    if (request === changelogRequest) {
      body.setAttribute('aria-busy', 'false');
    }
  }
};

$('historyButton').onclick = (): void => void openChangelog(false);
$('whatsNew').onclick = (): void => void openChangelog(true);

/* ========================================================= *\
 *  Startup                                                  *
\* ========================================================= */

controller.subscribe(render);
controller.setHidden(document.hidden);
document.addEventListener('visibilitychange', () => controller.setHidden(document.hidden || helpDialog.open));
render();

// A link with a seed code starts that puzzle. The code is dropped from the URL so a reload does not restart it.
const linked = new URLSearchParams(location.search).get('code');
if (linked) {
  history.replaceState(null, '', location.pathname);
}
controller.boot(linked);

// A new version shows a bar on the main screen only, so it never interrupts a puzzle.
$('refresh').onclick = (): void => {
  // Saves the game and stops its clock, as leaving the app would.
  controller.setHidden(true);
  location.reload();
};
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  watchForUpdates({
    container: navigator.serviceWorker,
    document,
    setInterval: (callback, ms) => setInterval(callback, ms),
    onUpdate: () => $('updateNotice').hidden = false,
  });
}
