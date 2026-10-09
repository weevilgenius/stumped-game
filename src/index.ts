import './index.css';
import {
  decodeSeedCode, encodeSeedCode, type GeneratorSettings, type Puzzle, randomSettings, type Tier,
} from './engine';
import { bestTimes, formatTime, type Game, isClean, MARK_STUMP, newGame, type Result, resultOf } from './game';
import { ICONS, openPuzzle, PALETTE } from './puzzleScene';
import type { GenerateRequest } from './worker';

/* ========================================================= *\
 *  Main screen and app glue: storage, puzzle generation,    *
 *  and everything outside of play. The puzzle screen is     *
 *  the Phaser scene in puzzleScene.ts.                      *
\* ========================================================= */

/** Player settings. A missing generator setting means random. */
interface Settings extends Partial<Pick<GeneratorSettings, 'size' | 'tier' | 'sizeMix' | 'shape' | 'freebies'>> {
  /** Show the timer during play. */
  timer: boolean;
  /** Give every puzzle a single acorn. */
  silver: boolean;
}

/* ========================================================= *\
 *  Storage: everything lives in localStorage on the device  *
\* ========================================================= */

/** Prefix for main's localStorage keys; the bake-off apps on the same origin use their own. */
const STORAGE_PREFIX = 'stumped-main.';

const load = <T>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${key}`) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
};

const save = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Storage is full or blocked. Play goes on, unsaved.
  }
};

let settings = load<Settings>('settings', { timer: true, silver: false });
/** The current puzzle: the most recent one, in progress or finished. */
let game = load<Game | null>('game', null);
/** Every completed play. */
const results = load<Result[]>('results', []);
/** Seed codes of every puzzle started on this device. */
const played = load<string[]>('played', []);

/* ========================================================= *\
 *  Puzzle generation, in a worker                           *
\* ========================================================= */

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
// The worker answers requests in the order they were sent.
const waiting: ((puzzle: Puzzle) => void)[] = [];
worker.onmessage = (event: MessageEvent<Puzzle>): void => waiting.shift()?.(event.data);

const generateInWorker = (request: GenerateRequest): Promise<Puzzle> => new Promise((resolve) => {
  waiting.push(resolve);
  worker.postMessage(request);
});

/** The next puzzle, generated ahead of time for the settings it was made under. */
let prepared: { key: string; puzzle: Promise<Puzzle> } | null = null;

const prepare = (): Promise<Puzzle> => {
  const { timer: _timer, silver, ...fixed } = settings;
  const key = JSON.stringify([silver, fixed]);
  if (prepared?.key !== key) {
    // With the setting off, about one puzzle in five is still silver, unless size and difficulty are both fixed.
    const always = silver || (fixed.size !== undefined && fixed.tier !== undefined ? false : undefined);
    const request = {
      settings: randomSettings(Math.random, { ...fixed, silver: always }),
      seed: Math.floor(Math.random() * 2 ** 32),
    };
    prepared = { key, puzzle: generateInWorker(request) };
  }
  return prepared.puzzle;
};

const takePrepared = (): Promise<Puzzle> => {
  const puzzle = prepare();
  prepared = null;
  void prepare();
  return puzzle;
};

/* ========================================================= *\
 *  Screens                                                  *
\* ========================================================= */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const menu = $('menu');
const stage = $('game');

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

const showMenu = (): void => {
  save('open', false);
  stage.hidden = true;
  menu.hidden = false;
  renderMenu();
};

const showPuzzle = (): void => {
  const current = game;
  if (!current) {
    return;
  }
  // Remembered so a relaunch mid-puzzle lands back on the puzzle.
  save('open', true);
  menu.hidden = true;
  stage.hidden = false;
  openPuzzle(stage, {
    model: current,
    showTimer: settings.timer,
    onChange: () => save('game', current),
    onWin: () => {
      results.push(resultOf(current));
      save('results', results);
    },
    onExit: showMenu,
  });
};

/** Starts a puzzle from a blank board. Any play after the first on this device is a repeat. */
const play = (puzzle: Puzzle): void => {
  game = newGame(puzzle, played.includes(puzzle.code));
  if (!game.repeat) {
    played.push(puzzle.code);
    save('played', played);
  }
  save('game', game);
  showPuzzle();
};

const mayAbandon = (question: string): boolean => game?.status !== 'playing' || confirm(question);

const generating = async (puzzle: Promise<Puzzle>): Promise<void> => {
  menu.classList.add('busy');
  try {
    play(await puzzle);
  } finally {
    menu.classList.remove('busy');
  }
};

/**
 * Plays the puzzle a seed code stands for. Resumes instead if it is already in progress.
 * @returns false if the code is not valid
 */
const playCode = (text: string): boolean => {
  const decoded = decodeSeedCode(text);
  if (!decoded) {
    return false;
  }
  if (game?.status === 'playing' && game.puzzle.code === encodeSeedCode(decoded.settings, decoded.seed)) {
    showPuzzle();
  } else if (mayAbandon('Abandon the puzzle in progress and play this one?')) {
    void generating(generateInWorker(decoded));
  }
  return true;
};

/* ========================================================= *\
 *  Main screen controls                                     *
\* ========================================================= */

$('new').onclick = (): void => {
  if (mayAbandon('Abandon the puzzle in progress and start a new one?')) {
    void generating(takePrepared());
  }
};

$('thumb').onclick = showPuzzle;

$('retry').onclick = (): void => {
  if (game && mayAbandon('Start this puzzle over from a blank board?')) {
    play(game.puzzle);
  }
};

$('share').onclick = (): void => {
  if (!game) {
    return;
  }
  const { code } = game.puzzle;
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
  if (playCode(codeInput.value)) {
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
    (settingsForm.elements.namedItem(name) as HTMLSelectElement).value = String(settings[name] ?? '');
  }
  for (const name of ['timer', 'silver'] as const) {
    (settingsForm.elements.namedItem(name) as HTMLInputElement).checked = settings[name];
  }
  settingsDialog.showModal();
};

settingsForm.onchange = (): void => {
  const data = new FormData(settingsForm);
  const level = (name: string): number | undefined => (data.get(name) ? Number(data.get(name)) : undefined);
  settings = {
    timer: data.has('timer'),
    silver: data.has('silver'),
    size: level('size'),
    tier: (data.get('tier') as Tier | '') || undefined,
    sizeMix: level('sizeMix'),
    shape: level('shape'),
    freebies: level('freebies'),
  };
  save('settings', settings);
  void prepare();
};

/* ========================================================= *\
 *  Best times                                               *
\* ========================================================= */

const timesDialog = $<HTMLDialogElement>('times');
const timesForm = timesDialog.querySelector('form')!;
const timesSize = timesForm.elements.namedItem('size') as HTMLSelectElement;
const timesTier = timesForm.elements.namedItem('tier') as HTMLSelectElement;

const renderTimes = (): void => {
  const times = bestTimes(results, Number(timesSize.value), timesTier.value as Tier);
  $('timesList').innerHTML = times.map((result) => (
    `<li><b>${formatTime(result.time)}</b> ${badges(result)}`
    + `<time>${new Date(result.date).toLocaleDateString()}</time></li>`
  )).join('') || '<li>No times yet.</li>';
};

$('timesButton').onclick = (): void => {
  // Open on the current puzzle's list, or the latest result's.
  const shown = game?.puzzle ?? results.at(-1);
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

renderMenu();
void prepare();

// A link with a seed code starts that puzzle. The code is dropped from the URL so a reload does not restart it.
const linked = new URLSearchParams(location.search).get('code');
if (linked) {
  history.replaceState(null, '', location.pathname);
  playCode(linked);
} else if (game?.status === 'playing' && load('open', false)) {
  showPuzzle();
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js');
}
