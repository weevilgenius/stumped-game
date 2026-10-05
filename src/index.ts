import Phaser from 'phaser';
import { decodeSeedCode, EXCLUDED, OPEN, randomSettings, STUMP, TIERS } from './engine';
import type { GeneratorSettings, Puzzle, SeedCode, Tier } from './engine';
import { BoardScene, BOARD_SIZE, PALETTE } from './game/BoardScene';
import { bestTimes, closeExplanation, createPlay, explanationPages, formatTime, layer, markCells, newSave, parseSave, recordWin, setHypothesis, tentativeConflicts, undo, useHint, WRONG } from './game/state';
import type { Play, Result } from './game/state';
import logoUrl from './assets/logo-web.jpg';
import stumpUrl from './assets/stump_icon@2x.png';
import acornUrl from './assets/acorn_icon@2x.png';
import silverUrl from './assets/silver_acorn_icon@2x.png';
import owlUrl from './assets/owl_icon@2x.png';
import squirrelUrl from './assets/squirrel_icon@2x.png';
import woodpeckerUrl from './assets/woodpecker_icon@2x.png';
import './index.css';

const STORAGE_KEY = 'stumped.v1';
const icons = { reveal: woodpeckerUrl, explain: owlUrl, eliminate: squirrelUrl };
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
let save = newSave();
let storageMessage = '';
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = parseSave(raw);
    if (parsed) save = parsed;
    else {
      localStorage.setItem('stumped.recovery', raw);
      storageMessage = 'This save could not be opened. A recovery copy has been kept on this device.';
    }
  }
} catch { storageMessage = 'Device storage is unavailable. Keep this page open to keep your progress.'; }

const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
const leaf = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M26 5C11 3 3 9 7 20c10 5 18-1 19-15Z" fill="currentColor"/><path d="m5 28 15-17" stroke="var(--paper)" stroke-width="2"/></svg>';
const brand = `<span class="brand-leaf">${leaf}</span><span class="wordmark">stumped<span>.</span></span>`;
$('#app').innerHTML = `
  <main id="home" class="home">
    <header class="home-header"><a class="brand" href="./" aria-label="Stumped home">${brand}</a><nav aria-label="Main"><button class="text-button" id="times-button">Best times</button><button class="text-button" id="settings-button">Settings</button></nav></header>
    <div class="home-content">
      <section class="forest-art"><img src="${logoUrl}" alt="Stumped: a woodland sudoku, illustrated among the trees"/><div class="art-caption"><span>A QUIET LITTLE CHALLENGE</span><span>Rooted in logic.</span></div></section>
      <section class="welcome"><p class="eyebrow">YOUR PATCH OF PEACE</p><h1>A little time <br>in the woods.</h1><p class="intro">A fresh forest. A few hidden stumps. <br>Find your way, one square at a time.</p>
        <button id="new-puzzle" class="primary new-puzzle">New puzzle ${arrow}</button><p id="selection-summary" class="selection-summary"></p>
        <section id="current-card" class="current-card" hidden aria-label="Current puzzle"></section>
        <form id="seed-form" class="seed-form"><label for="seed">HAVE A PUZZLE CODE?</label><div class="input-row"><input id="seed" name="seed" placeholder="Enter a code or link" autocomplete="off" spellcheck="false" maxlength="2048" required aria-describedby="seed-error"/><button type="submit" aria-label="Play seed code">${arrow}</button></div><p id="seed-error" class="error" role="alert"></p></form>
      </section>
    </div>
    <footer><span>A puzzle. A pause. Just for you.</span><span id="offline-status">Grown on your device</span></footer>
  </main>
  <main id="puzzle-screen" class="puzzle-screen" tabindex="-1" aria-label="Puzzle" hidden>
    <header class="play-header"><button id="back" class="back-button" aria-label="Back to main screen">${arrow}<span>Back</span></button><span class="brand">${brand}</span><span id="puzzle-label" class="puzzle-label"></span></header>
    <section class="play-layout">
      <div class="board-column"><div class="play-stats"><span class="stump-count"><img src="${stumpUrl}" alt=""/><strong id="stump-count"></strong><span>stumps</span></span><span id="lives" class="lives"></span><time id="timer">0:00</time></div>
        <div class="board-wrap"><div id="board"></div><div id="accessible-board" class="accessible-board" role="grid" aria-label="Puzzle board" aria-describedby="keyboard-help"></div><div id="end-message" class="end-message" hidden role="status"></div></div>
        <p class="gesture-help">Tap to mark <span>·</span> Double tap to reveal <span>·</span> Drag to sweep</p><p id="keyboard-help" class="sr-only">Arrow keys move between squares. Space marks or erases. Enter reveals a stump.</p>
      </div>
      <aside class="play-tools" aria-label="Puzzle tools"><div class="tool-heading"><span class="eyebrow">A LITTLE HELP</span><span>One of each</span></div><div class="hints">
        <button id="hint-reveal" class="hint" title="Reveal a stump in the patch with the fewest open squares"><img src="${woodpeckerUrl}" alt=""/><strong>Reveal</strong><span>Woodpecker</span></button>
        <button id="hint-explain" class="hint" title="Explain the simplest next deduction"><img src="${owlUrl}" alt=""/><strong>Explain</strong><span>Owl</span></button>
        <button id="hint-eliminate" class="hint" title="Mark up to three random empty squares"><img src="${squirrelUrl}" alt=""/><strong>Eliminate</strong><span>Squirrel</span></button>
      </div><div class="mark-tools"><button id="undo" class="secondary" aria-label="Undo">↶ <span>Undo</span></button><button id="hypothesis" class="secondary" aria-label="Hypothesis" aria-pressed="false">◇ <span>Hypothesis</span></button></div>
      <div id="hypothesis-actions" class="hypothesis-actions" hidden><p>A scratch layer. Try an idea.</p><div><button id="discard" class="text-button">Discard</button><button id="keep" class="secondary">Keep Xs</button></div></div>
      <section id="explanation" class="explanation" hidden aria-label="Owl explanation"><div class="explain-heading"><img src="${owlUrl}" alt=""/><strong>A word from the owl</strong></div><p id="explanation-text" aria-live="polite"></p><div class="explain-nav"><button id="explain-prev" class="text-button" aria-label="Previous explanation step">←</button><span id="explain-page"></span><button id="explain-next" class="text-button" aria-label="Next explanation step">→</button></div><button id="explain-close" class="secondary">Got it · apply</button></section>
      <p id="play-message" class="play-message" role="status"></p><span id="play-code" class="play-code"></span></aside>
    </section>
  </main>
  <div id="notice" class="notice" role="status" hidden></div>
  <p id="storage-warning" class="storage-warning" role="alert" hidden></p>
  <dialog id="dialog" aria-labelledby="dialog-title"><div class="dialog-header"><h2 id="dialog-title"></h2><button id="dialog-close" class="text-button" aria-label="Close dialog">✕</button></div><div id="dialog-body"></div></dialog>
`;

let screen: 'home' | 'play' = 'home';
let runningSince: number | null = null;
let boardScene: BoardScene | null = null;
let game: Phaser.Game | null = null;
let explanationIndex = 0;
let ending: ReturnType<typeof setTimeout> | null = null;
let busy = false;
let prepared: Promise<Puzzle> | null = null;
let prepareWorker: Worker | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
const play = (): Play => save.current!;
const resizeBoard = (): void => {
  if (!game?.canvas || $('#puzzle-screen').hidden) return;
  game.scale.getParentBounds();
  game.scale.refresh();
};
const checkpoint = (): void => {
  if (runningSince !== null && save.current) {
    save.current.elapsed += performance.now() - runningSince;
    runningSince = performance.now();
  }
};
const persist = (): void => {
  checkpoint();
  recordWin(save);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); }
  catch { storageMessage = 'Progress could not be saved. Device storage may be full; keep this page open.'; }
  $('#storage-warning').textContent = storageMessage;
  $('#storage-warning').hidden = !storageMessage;
};
const notify = (message: string): void => {
  $('#notice').textContent = message;
  $('#notice').hidden = false;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 4500);
};
const syncClock = (): void => {
  checkpoint();
  runningSince = screen === 'play' && !document.hidden && save.current?.status === 'playing' ? performance.now() : null;
};
const imageIcon = (url: string, label: string): string => `<img class="result-icon" src="${url}" alt="${label}" title="${label}"/>`;
const badges = (result: Result): string => `${result.clean ? '<span title="Clean solve" aria-label="Clean solve">★</span>' : ''}${result.hints.map((hint) => imageIcon(icons[hint], `${hint} hint used`)).join('')}${result.lost ? `${imageIcon(acornUrl, 'Acorns lost')}<span>${result.lost}</span>` : ''}${result.silver ? imageIcon(silverUrl, 'Silver acorn') : ''}${result.repeat ? '<span title="Repeat play" aria-label="Repeat play">↻</span>' : ''}`;

const renderHome = (): void => {
  const settings = save.settings;
  $('#selection-summary').textContent = `${settings.size ? `${settings.size} × ${settings.size}` : 'Any size'} · ${settings.tier === 'random' ? 'Any difficulty' : settings.tier} · ${settings.silver ? 'Silver acorn' : 'A fresh puzzle every time'}`;
  const card = $('#current-card');
  card.hidden = !save.current;
  if (!save.current) return;
  const p = play();
  const result = save.results.find((r) => r.id === p.id);
  const size = p.puzzle.size;
  const thumb = p.marks.map((mark, cell) => `<span style="background:#${PALETTE[p.puzzle.colors[p.puzzle.regions[cell]]].toString(16).padStart(6, '0')}">${mark === STUMP ? `<img src="${stumpUrl}" alt=""/>` : mark === OPEN ? '' : '×'}</span>`).join('');
  card.innerHTML = `<button id="resume" class="thumbnail" style="--size:${size}" aria-label="${p.status === 'playing' ? 'Resume puzzle' : 'View finished puzzle'}" ${p.status !== 'playing' ? 'disabled' : ''}>${thumb}</button><div class="current-info"><span class="eyebrow">${p.status === 'playing' ? 'YOUR FOREST IS WAITING' : p.status === 'won' ? 'A FOREST WELL FOUND' : 'STUMPED.'}</span><strong>${size} × ${size} <span>·</span> ${p.puzzle.tier}</strong><span class="current-time">${p.status === 'won' ? `Solved in ${formatTime(p.elapsed)}` : p.status === 'lost' ? 'Another walk through the woods?' : `${p.marks.filter((m) => m === STUMP).length} of ${size} stumps found`}</span>${result ? `<span class="badges">${badges(result)}</span>` : ''}<div class="current-actions">${p.status === 'playing' ? '<button id="resume-text" class="text-button">Resume →</button>' : ''}<button id="share" class="text-button">Share</button><button id="retry" class="text-button">Retry</button></div></div>`;
  $('#resume').onclick = showPlay;
  if (p.status === 'playing') $('#resume-text').onclick = showPlay;
  $('#share').onclick = () => { void sharePuzzle(); };
  $('#retry').onclick = () => confirmReplace(() => startPuzzle(p.puzzle));
};

const updateAccessibleBoard = (): void => {
  const p = play();
  const n = p.puzzle.size;
  const grid = $('#accessible-board');
  if (grid.dataset.play !== p.id) {
    grid.dataset.play = p.id;
    grid.innerHTML = Array.from({ length: n }, (_, row) => `<div role="row">${Array.from({ length: n }, (_, col) => `<button role="gridcell" data-cell="${row * n + col}" tabindex="${row + col === 0 ? 0 : -1}"></button>`).join('')}</div>`).join('');
  }
  const flagged = tentativeConflicts(p);
  grid.querySelectorAll<HTMLButtonElement>('button').forEach((button, cell) => {
    const mark = p.marks[cell];
    const state = mark === STUMP ? 'revealed stump' : mark === WRONG ? 'wrong reveal, permanent X' : mark === EXCLUDED ? 'X' : 'open';
    const scratch = p.pencil[cell] === STUMP ? ', tentative stump' : p.pencil[cell] === EXCLUDED ? ', hypothesis X' : '';
    button.setAttribute('aria-label', `Row ${Math.floor(cell / n) + 1}, column ${cell % n + 1}, patch ${p.puzzle.regions[cell] + 1}: ${state}${scratch}${flagged.includes(cell) ? ', rule conflict' : ''}`);
    button.setAttribute('aria-disabled', String(p.status !== 'playing' || !!boardScene?.blocked || !!p.explanation));
  });
};
const updatePlay = (): void => {
  if (!save.current) return;
  const p = play();
  $('#puzzle-label').textContent = `${p.puzzle.size} × ${p.puzzle.size} / ${p.puzzle.tier}`;
  $('#stump-count').textContent = `${p.marks.filter((mark) => mark === STUMP).length}/${p.puzzle.size}`;
  const total = p.puzzle.silver ? 1 : 3;
  $('#lives').innerHTML = Array.from({ length: total }, (_, i) => `<img src="${p.puzzle.silver ? silverUrl : acornUrl}" class="${i < p.lives ? '' : 'spent'}" alt=""/>`).join('');
  $('#lives').setAttribute('aria-label', `${p.lives} ${p.puzzle.silver ? 'silver ' : ''}acorn${p.lives === 1 ? '' : 's'} remaining`);
  $('#timer').textContent = formatTime(p.elapsed);
  $('#timer').hidden = !save.settings.timer;
  $('#play-code').textContent = p.puzzle.code;
  const disabled = !!boardScene?.blocked || p.status !== 'playing' || !!p.explanation;
  $('#back').toggleAttribute('disabled', !!boardScene?.blocked || p.status !== 'playing');
  for (const hint of ['reveal', 'explain', 'eliminate'] as const) {
    const button = $<HTMLButtonElement>(`#hint-${hint}`);
    const used = p.hints.includes(hint);
    button.disabled = disabled || p.hypothesis || used;
    button.classList.toggle('used', used);
    button.querySelector('span')!.textContent = used ? 'Used' : { reveal: 'Woodpecker', explain: 'Owl', eliminate: 'Squirrel' }[hint];
  }
  $<HTMLButtonElement>('#undo').disabled = disabled || (p.hypothesis ? p.pencilUndo : p.undo).length === 0;
  $<HTMLButtonElement>('#hypothesis').disabled = disabled;
  $('#hypothesis').setAttribute('aria-pressed', String(p.hypothesis));
  $('#hypothesis-actions').hidden = !p.hypothesis;
  $('#puzzle-screen').classList.toggle('hypothesizing', p.hypothesis);
  $('#explanation').hidden = !p.explanation;
  const pages = explanationPages(p);
  if (pages.length) {
    explanationIndex = Math.min(explanationIndex, pages.length - 1);
    $('#explanation-text').textContent = pages[explanationIndex].text;
    $('#explain-page').textContent = `${explanationIndex + 1} / ${pages.length}`;
    $<HTMLButtonElement>('#explain-prev').disabled = explanationIndex === 0;
    $<HTMLButtonElement>('#explain-next').disabled = explanationIndex === pages.length - 1;
  }
  boardScene?.setHighlights(pages[explanationIndex]?.cells ?? []);
  updateAccessibleBoard();
};
const onChange = (message?: string): void => {
  syncClock();
  persist();
  if (message) $('#play-message').textContent = message;
  updatePlay();
  if (play().status !== 'playing' && !ending && screen === 'play') {
    const perfect = play().status === 'won' && play().marks.every((mark) => mark !== OPEN);
    $('#end-message').textContent = play().status === 'lost' ? 'Stumped.' : perfect ? 'Perfectly Marked' : 'Forest found.';
    $('#end-message').hidden = false;
    ending = setTimeout(() => { ending = null; showHome(); }, 1500);
  }
};
function showPlay(): void {
  if (!save.current || play().status !== 'playing' || busy) return;
  screen = 'play';
  $('#home').hidden = true;
  $('#puzzle-screen').hidden = false;
  $('#end-message').hidden = true;
  $('#play-message').textContent = '';
  if (!game) {
    boardScene = new BoardScene(play, onChange);
    game = new Phaser.Game({ type: Phaser.AUTO, parent: 'board', width: BOARD_SIZE, height: BOARD_SIZE, scene: [boardScene], backgroundColor: '#303c32', banner: false, audio: { noAudio: true }, input: { activePointers: 1, smoothFactor: 0 }, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, expandParent: false }, render: { antialias: true }, disableContextMenu: true });
    new ResizeObserver(resizeBoard).observe($('#board'));
  } else {
    game.resume();
    resizeBoard();
    boardScene?.cancelGesture();
  }
  syncClock();
  updatePlay();
  $('#puzzle-screen').focus();
}
function showHome(): void {
  checkpoint();
  screen = 'home';
  syncClock();
  boardScene?.cancelGesture();
  game?.pause();
  $('#home').hidden = false;
  $('#puzzle-screen').hidden = true;
  persist();
  renderHome();
  $('#new-puzzle').focus();
}
const startPuzzle = (puzzle: Puzzle): void => {
  checkpoint();
  runningSince = null;
  save.current = createPlay(puzzle, save.played.includes(puzzle.code));
  if (!save.played.includes(puzzle.code)) save.played.push(puzzle.code);
  explanationIndex = 0;
  if (boardScene) { boardScene.blocked = false; boardScene.focused = -1; }
  persist();
  showPlay();
};

/* ========================================================= *\
 *  Puzzle generation: one prefetched puzzle, off the UI.     *
\* ========================================================= */
const generatePuzzle = (request: SeedCode, onWorker?: (worker: Worker) => void): Promise<Puzzle> => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./game/generate.worker.ts', import.meta.url), { type: 'module' });
  onWorker?.(worker);
  worker.onmessage = ({ data }: MessageEvent<{ puzzle?: Puzzle; error?: string }>) => {
    worker.terminate();
    if (data.puzzle) resolve(data.puzzle);
    else reject(new Error(data.error ?? 'The forest could not be prepared. Try again.'));
  };
  worker.onerror = () => { worker.terminate(); reject(new Error('Puzzle preparation failed. Please try again.')); };
  worker.postMessage(request);
});
const prepare = (): void => {
  prepareWorker?.terminate();
  const s = save.settings;
  const fixed: Partial<GeneratorSettings> = {
    ...(s.size ? { size: s.size } : {}), ...(s.tier !== 'random' ? { tier: s.tier } : {}),
    ...(s.silver ? { silver: true } : s.size && s.tier !== 'random' ? { silver: false } : {}),
    ...(s.sizeMix >= 0 ? { sizeMix: s.sizeMix } : {}), ...(s.shape >= 0 ? { shape: s.shape } : {}), ...(s.freebies >= 0 ? { freebies: s.freebies } : {}),
  };
  prepared = generatePuzzle({ settings: randomSettings(Math.random, fixed), seed: crypto.getRandomValues(new Uint32Array(1))[0] }, (worker) => { prepareWorker = worker; });
  void prepared.catch(() => { /* Report a generation error when the player requests this puzzle. */ });
};
const launch = async (request?: SeedCode): Promise<void> => {
  if (busy) return;
  busy = true;
  $('#home').inert = true;
  $('#new-puzzle').textContent = 'Growing your forest…';
  $<HTMLButtonElement>('#new-puzzle').disabled = true;
  try {
    const puzzle = await (request ? generatePuzzle(request) : prepared ?? generatePuzzle({ settings: randomSettings(Math.random), seed: crypto.getRandomValues(new Uint32Array(1))[0] }));
    busy = false;
    startPuzzle(puzzle);
    if (!request) prepare();
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not prepare a puzzle. Try again.');
    prepare();
  } finally {
    busy = false;
    $('#home').inert = false;
    $('#new-puzzle').innerHTML = `New puzzle ${arrow}`;
    $<HTMLButtonElement>('#new-puzzle').disabled = false;
  }
};

/* ========================================================= *\
 *  Main-screen dialogs, local times, sharing, preferences.   *
\* ========================================================= */
const dialog = $<HTMLDialogElement>('#dialog');
const openDialog = (title: string, html: string): void => {
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = html;
  dialog.showModal();
};
const confirmReplace = (onConfirm: () => void): void => {
  if (busy) return;
  if (save.current?.status !== 'playing') { onConfirm(); return; }
  openDialog('Leave this forest?', '<p>Your current marks will be replaced. You can always play its code again.</p><div class="dialog-actions"><button id="cancel-replace" class="secondary">Keep playing</button><button id="confirm-replace" class="primary">Start fresh</button></div>');
  $('#cancel-replace').onclick = () => dialog.close();
  $('#confirm-replace').onclick = () => { dialog.close(); onConfirm(); };
};
const selectOptions = (options: readonly (readonly [string | number, string])[], value: string | number): string => options.map(([key, label]) => `<option value="${key}" ${String(key) === String(value) ? 'selected' : ''}>${label}</option>`).join('');
const settingsDialog = (): void => {
  const s = save.settings;
  const field = (key: string, label: string, options: readonly (readonly [string | number, string])[], value: string | number): string => `<div class="setting"><label for="setting-${key}">${label}</label><select id="setting-${key}" name="${key}">${selectOptions(options, value)}</select></div>`;
  openDialog('Make yourself at home', `<p class="dialog-intro">Your preferences, for the next patch of forest.</p><form id="settings-form">
    <label class="setting">Show timer<input type="checkbox" name="timer" ${s.timer ? 'checked' : ''}/></label>
    ${field('size', 'Board size', [[0, 'Random'], ...[5, 6, 7, 8, 9, 10].map((n): [number, string] => [n, `${n} × ${n}`])], s.size)}
    ${field('tier', 'Difficulty', [['random', 'Random'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], s.tier)}
    <label class="setting">Silver acorn mode<input type="checkbox" name="silver" ${s.silver ? 'checked' : ''}/></label><p class="setting-note">One acorn. Every reveal counts.</p>
    <h3>A little variety</h3>
    ${field('sizeMix', 'Patch sizes', [[-1, 'Random'], [0, 'Balanced'], [1, 'A little variety'], [2, 'Mixed'], [3, 'One big patch']], s.sizeMix)}
    ${field('shape', 'Patch shapes', [[-1, 'Random'], [0, 'Compact'], [1, 'Softly winding'], [2, 'Winding'], [3, 'Long and thin']], s.shape)}
    ${field('freebies', 'Starting clues', [[-1, 'Random'], [0, 'Never'], [1, 'Occasional'], [2, 'Sometimes'], [3, 'Often']], s.freebies)}
    <button class="primary dialog-save" type="submit">Save preferences</button></form>`);
  $('#settings-form').onsubmit = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    save.settings = { timer: data.has('timer'), silver: data.has('silver'), size: Number(data.get('size')), tier: data.get('tier') as Tier | 'random', sizeMix: Number(data.get('sizeMix')), shape: Number(data.get('shape')), freebies: Number(data.get('freebies')) };
    persist(); renderHome(); prepare(); dialog.close();
  };
};
const timesDialog = (): void => {
  openDialog('Time well spent', `<p class="dialog-intro">Clean solves first. Every finish belongs here.</p><div class="times-filters"><label>Size<select id="times-size">${selectOptions([5, 6, 7, 8, 9, 10].map((n) => [n, `${n} × ${n}`]), save.current?.puzzle.size ?? 5)}</select></label><label>Difficulty<select id="times-tier">${selectOptions(TIERS.map((t) => [t, t]), save.current?.puzzle.tier ?? 'easy')}</select></label></div><div id="times-list"></div><p class="times-key">★ Clean &nbsp; ↻ Repeat &nbsp; Woodland helpers show hints used.</p>`);
  const render = (): void => {
    const results = bestTimes(save.results, Number($<HTMLSelectElement>('#times-size').value), $<HTMLSelectElement>('#times-tier').value as Tier);
    $('#times-list').innerHTML = results.length ? `<ol class="times-list">${results.map((result) => `<li><div><strong>${formatTime(result.elapsed)}</strong><span class="badges">${badges(result)}</span></div><span>${result.code}<small>${new Date(result.date).toLocaleDateString()}</small></span></li>`).join('')}</ol>` : '<div class="empty-times">A fresh page.<br><span>Your finished puzzles will find a home here.</span></div>';
  };
  $('#times-size').onchange = render;
  $('#times-tier').onchange = render;
  render();
};
const sharePuzzle = async (): Promise<void> => {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('code', play().puzzle.code);
  if (navigator.share) {
    try { await navigator.share({ title: 'Stumped', text: `A little woodland puzzle: ${play().puzzle.code}`, url: url.href }); return; }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url.href); notify('Puzzle link copied. A little forest to share.'); }
  catch {
    openDialog('Share this forest', '<p>Copy this link to share the identical puzzle.</p><input id="share-link" aria-label="Puzzle link" readonly/>');
    $<HTMLInputElement>('#share-link').value = url.href;
    $<HTMLInputElement>('#share-link').select();
  }
};

$('#new-puzzle').onclick = () => confirmReplace(() => { void launch(); });
$('#back').onclick = showHome;
$('#settings-button').onclick = settingsDialog;
$('#times-button').onclick = timesDialog;
$('#dialog-close').onclick = () => dialog.close();
$('#seed-form').onsubmit = (event) => {
  event.preventDefault();
  let input = $<HTMLInputElement>('#seed').value.trim();
  try { input = new URL(input).searchParams.get('code') ?? input; } catch { /* A plain code needs no URL parsing. */ }
  const request = decodeSeedCode(input);
  $('#seed-error').textContent = request ? '' : 'That code is not recognized. Check all 11 characters and try again.';
  if (request) confirmReplace(() => { void launch(request); });
};
$('#undo').onclick = () => { boardScene?.cancelGesture(); undo(play()); onChange(); };
$('#hypothesis').onclick = () => {
  boardScene?.cancelGesture();
  if (!play().hypothesis) setHypothesis(play(), 'start');
  else $('#keep').focus();
  onChange();
};
for (const action of ['keep', 'discard'] as const) $('#'+action).onclick = () => { boardScene?.cancelGesture(); setHypothesis(play(), action); onChange(); };
for (const hint of ['reveal', 'explain', 'eliminate'] as const) $(`#hint-${hint}`).onclick = () => {
  boardScene?.cancelGesture();
  explanationIndex = 0;
  useHint(play(), hint);
  onChange();
  if (play().explanation) $('#explain-close').focus();
};
$('#explain-prev').onclick = () => { explanationIndex--; updatePlay(); };
$('#explain-next').onclick = () => { explanationIndex++; updatePlay(); };
$('#explain-close').onclick = () => { closeExplanation(play()); onChange(); };
$('#accessible-board').addEventListener('focusin', (event) => {
  const cell = Number((event.target as HTMLElement).dataset.cell);
  if (!boardScene || !Number.isInteger(cell)) return;
  boardScene.focused = cell; boardScene.draw();
});
$('#accessible-board').addEventListener('focusout', () => { if (boardScene) { boardScene.focused = -1; boardScene.draw(); } });
$('#accessible-board').addEventListener('keydown', (event) => {
  const button = event.target as HTMLButtonElement;
  const cell = Number(button.dataset.cell);
  if (!Number.isInteger(cell) || boardScene?.blocked || play().explanation || play().status !== 'playing') return;
  const n = play().puzzle.size;
  const offset: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -n, ArrowDown: n };
  if (event.key in offset) {
    event.preventDefault();
    const next = Math.max(0, Math.min(n * n - 1, cell + offset[event.key]));
    button.tabIndex = -1;
    const target = $<HTMLButtonElement>(`[data-cell="${next}"]`);
    target.tabIndex = 0; target.focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (event.repeat) return;
    boardScene?.cancelGesture();
    if (event.key === 'Enter') boardScene?.attempt(cell);
    else { markCells(play(), [cell], layer(play())[cell] === OPEN ? EXCLUDED : OPEN); onChange(); }
  }
});
$('#accessible-board').addEventListener('click', (event) => {
  const cell = Number((event.target as HTMLElement).dataset.cell);
  if (!Number.isInteger(cell) || boardScene?.blocked) return;
  markCells(play(), [cell], layer(play())[cell] === OPEN ? EXCLUDED : OPEN); onChange();
});
document.addEventListener('visibilitychange', () => { boardScene?.cancelGesture(); syncClock(); persist(); });
window.addEventListener('pagehide', () => { checkpoint(); runningSince = null; persist(); });
window.addEventListener('pageshow', syncClock);
setInterval(() => {
  if (runningSince !== null) { persist(); $('#timer').textContent = formatTime(play().elapsed); }
}, 1000);

renderHome();
if (storageMessage) { $('#storage-warning').textContent = storageMessage; $('#storage-warning').hidden = false; }
prepare();
const sharedCode = new URL(location.href).searchParams.get('code');
if (sharedCode) {
  const request = decodeSeedCode(sharedCode);
  if (request) {
    if (save.current?.status === 'playing' && decodeSeedCode(save.current.puzzle.code)?.seed === request.seed && save.current.puzzle.code === sharedCode.toUpperCase()) showPlay();
    else confirmReplace(() => { void launch(request); });
  } else { $('#seed-error').textContent = 'This puzzle link has an invalid or unsupported code.'; }
  history.replaceState(null, '', location.pathname);
} else if (save.current?.status === 'playing') showPlay();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(() => navigator.serviceWorker.ready).then(() => {
    $('#offline-status').textContent = 'Ready for offline play';
  }).catch(() => { $('#offline-status').textContent = 'Offline setup unavailable'; });
}
