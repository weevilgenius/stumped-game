import './index.css';
import type { Tier } from './engine';
import { createController } from './controller';
import { bestTimes, formatTime, type Game, isClean, MARK_STUMP, type Result, resultOf } from './game';
import { openPuzzle } from './puzzleScene';
import { themeFor } from './theme';
import type { Theme } from './theme';
import { createWorkerGenerator } from './generator';
import { fillHelpBoards } from './help';
import { watchForUpdates } from './updates';

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

/** Presentation is a preference, independent of puzzle generation and saved marks. */
const theme = (): Theme => themeFor(controller.settings.vallarta);
const themedText = (text: string): string => theme().text(text);
const originalHome = new Map<Element, string>();
for (const selector of ['.panel > .eyebrow', 'h1', '.intro', '.caption', 'footer > span:last-child', '#status']) {
  const element = document.querySelector(selector)!;
  originalHome.set(element, element.innerHTML);
}
// Keep the source text so toggling either direction never compounds substitutions.
const helpText = new Map<Text, string>();
const helpWalker = document.createTreeWalker($('helpBody'), NodeFilter.SHOW_TEXT);
while (helpWalker.nextNode()) {
  const node = helpWalker.currentNode as Text;
  helpText.set(node, node.data);
}
const helpIcons = new Map<HTMLImageElement, string>();
for (const image of $('helpBody').querySelectorAll('img')) {
  helpIcons.set(image, image.src);
}
let appliedTheme = '';
const applyTheme = (): void => {
  const current = theme();
  if (appliedTheme === current.id) {
    return;
  }
  appliedTheme = current.id;
  document.documentElement.dataset.theme = current.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
    `#${current.background.toString(16).padStart(6, '0')}`);
  const art = document.querySelector<HTMLImageElement>('.art > img')!;
  art.src = current.home;
  art.alt = current.id === 'vallarta'
    ? 'Puerto Vallarta: a parrot by the bay, margarita, sugar skull, and papel picado'
    : 'Stumped: a woodland sudoku, illustrated among the trees';
  const holidayCopy = [
    'Our annual Mexico getaway', 'A little time <br>in Vallarta.',
    'Parrots by the bay. Margaritas at sunset. <br>A little logic between adventures.',
    '<span class="eyebrow">Puerto Vallarta · México</span><span>¡Salud to a little logic!</span>',
    'Made for our family getaway', 'Preparing a puzzle&hellip;',
  ];
  [...originalHome].forEach(([element, original], i) => {
    element.innerHTML = current.id === 'vallarta' ? holidayCopy[i] : original;
  });
  helpText.forEach((original, node) => node.data = current.text(original));
  helpIcons.forEach((original, image) => {
    const name = original.includes('silver') ? 'silver' : original.includes('acorn') ? 'acorn'
      : original.includes('woodpecker') ? 'woodpecker' : original.includes('owl') ? 'owl' : 'squirrel';
    image.src = current.icons[name];
  });
  fillHelpBoards($('help'), current.palette, current.icons.stump, current.text);
  const silverLabel = settingsForm.querySelector('input[name="silver"]')?.parentElement?.firstChild;
  if (silverLabel) {
    silverLabel.textContent = current.text('Silver acorn mode ');
  }
};

const icon = (name: keyof ReturnType<typeof theme>['icons'], label: string): string => (
  `<img class="icon" src="${theme().icons[name]}" alt="${themedText(label)}" title="${themedText(label)}">`);

/** Icons for whatever qualified a solve: a star if clean, else hints, acorns lost, and repeat. */
const badges = (result: Result): string => [
  isClean(result) ? '<span class="star" title="Clean solve">★</span>' : '',
  ...result.hints.map((hint) => icon(hint, `Used the ${hint}`)),
  result.acornsLost > 0 ? `${icon('acorn', 'Acorns lost')}−${result.acornsLost}` : '',
  result.silver ? icon('silver', 'Silver acorn mode') : '',
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
    silver ? themedText('Silver acorn') : 'A fresh puzzle every time',
  ].join(' · ');
};

/** The line above the current puzzle, by its status. */
const EYEBROWS = {
  playing: 'Your forest is waiting',
  won: 'A forest well found',
  lost: 'Stumped.',
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
    square.style.backgroundColor = `#${theme().palette[puzzle.colors[puzzle.regions[cell]]].toString(16).padStart(6, '0')}`;
    if (mark === MARK_STUMP) {
      square.style.backgroundImage = `url("${theme().icons.stump}")`;
    }
    return square;
  }));
  $('resume').hidden = status !== 'playing';
  $('currentEyebrow').textContent = themedText(EYEBROWS[status]);
  const state = {
    playing: `In progress, ${formatTime(elapsed)}`,
    won: `Solved in <b>${formatTime(elapsed)}</b> ${badges(resultOf(game))}`,
    lost: themedText('Another walk through the woods?'),
  }[status];
  $('info').innerHTML = `<b>${puzzle.size}×${puzzle.size} ${puzzle.tier}</b>`
    + `${puzzle.silver && status !== 'won' ? ` ${icon('silver', 'Silver acorn mode')}` : ''}`
    + `<br>${state}<br><code>${puzzle.code}</code>`;
};

/** The game the puzzle screen was last opened on. */
let opened: Game | null = null;

/** Shows whichever screen the controller is on. */
const render = (): void => {
  applyTheme();
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
        vallarta: controller.settings.vallarta,
        onChange: controller.changed,
        elapsed: controller.tick,
        onExit: controller.showMenu,
        onHelp: openHelp,
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
  for (const name of ['timer', 'silver', 'vallarta'] as const) {
    (settingsForm.elements.namedItem(name) as HTMLInputElement).checked = controller.settings[name] ?? false;
  }
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
    vallarta: data.has('vallarta'),
    sizes: chosen('sizes')?.map(Number),
    tiers: chosen('tiers') as Tier[] | undefined,
    sizeMix: level('sizeMix'),
    shape: level('shape'),
    freebies: level('freebies'),
  });
  applyTheme();
  renderMenu();
};

/* ========================================================= *\
 *  Best times                                               *
\* ========================================================= */

const timesDialog = $<HTMLDialogElement>('times');
const timesTiers: readonly Tier[] = ['easy', 'medium', 'hard'];
const timesViewport = $('timesViewport');

const renderTimes = (): void => {
  const { game, results } = controller;
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

/** Shows the rules. Play time stops while they are open over a puzzle. */
const openHelp = (): void => {
  if (helpDialog.open) {
    return;
  }
  if (!helpDialog.querySelector('.mini-board')) {
    fillHelpBoards(helpDialog, theme().palette, theme().icons.stump, theme().text);
  }
  controller.setHidden(true);
  $('helpBody').scrollTo({ top: 0 });
  helpDialog.showModal();
};

helpDialog.onclose = (): void => controller.setHidden(document.hidden);
$('helpButton').onclick = openHelp;

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
