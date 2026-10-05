import {
  encodeSeedCode, type Puzzle, type Tier, decodeSeedCode,
} from '../engine';
import { Clock } from '../game/clock';
import { makeRecord, type TimeRecord } from '../game/records';
import { CELL_STUMP, Session } from '../game/session';
import { type PuzzleSource, WorkerSource } from '../game/source';
import { DEFAULT_SETTINGS, type Settings } from '../game/settings';
import { readSave, writeSave } from '../game/storage';

/** Which overlay the main screen is showing. */
export type Panel = 'none' | 'settings' | 'times' | 'confirm-new' | 'confirm-retry' | 'seed';

/** Which screen is up. `boot` covers the moment before local data has loaded. */
export type Screen = 'boot' | 'main' | 'puzzle';

interface ControllerOptions {
  /** Backing store. Defaults to localStorage in the browser. */
  storage?: Storage;
  /** Puzzle generator. Defaults to a Web Worker. */
  source?: PuzzleSource;
  /** Clock source, in milliseconds. */
  now?: () => number;
  /** Timestamp source for recorded results. */
  at?: () => number;
}

/**
 * Owns the current puzzle, settings, records, and the clock. Scenes read it
 * and call it; they do not save or generate on their own.
 */
export class Controller {
  /** Preferences. */
  settings: Settings = { ...DEFAULT_SETTINGS };

  /** The current puzzle, in progress or finished. */
  session: Session | null = null;

  /** Every recorded win. */
  records: TimeRecord[] = [];

  /** Seed codes this device has started. */
  played = new Set<string>();

  /** The visible screen. */
  screen: Screen = 'boot';

  /** The open panel on the main screen. */
  panel: Panel = 'none';

  /** Message under the seed field. */
  seedError: string | null = null;

  /** A short notice such as "Copied". */
  notice: string | null = null;

  /** True once `boot` has finished. */
  booted = false;

  /** True while a puzzle is being generated. */
  growing = false;

  /** Size shown in the best-times list. */
  timesSize = 5;

  /** Difficulty shown in the best-times list. */
  timesTier: Tier = 'easy';

  private clock = new Clock();

  private readonly listeners = new Set<() => void>();

  private readonly storage: Storage;

  private readonly source: PuzzleSource;

  private readonly now: () => number;

  private readonly at: () => number;

  private starting = false;

  /**
   * @param options storage, generator, and clocks. Tests pass all three.
   */
  constructor(options: ControllerOptions = {}) {
    this.storage = options.storage ?? localStorage;
    this.source = options.source ?? new WorkerSource();
    this.now = options.now ?? (() => performance.now());
    this.at = options.at ?? (() => Date.now());
  }

  /**
   * @param listener called after every change
   * @returns a function that removes the listener
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Loads the save and, when the address carries a seed code, starts that puzzle.
   * A code that matches the puzzle already in progress resumes it.
   * @param href the page address
   */
  async boot(href = globalThis.location?.href ?? 'http://local/'): Promise<void> {
    this.load();
    const code = codeFromHref(href);
    if (code && this.session?.status === 'playing' && sameCode(this.session.puzzle.code, code)) {
      this.screen = 'puzzle';
      this.resumeClock();
    } else if (code) {
      const puzzle = await this.source.fromCode(code);
      if (puzzle) {
        this.begin(puzzle);
      } else {
        this.seedError = 'That seed code is not valid.';
        this.screen = this.session?.status === 'playing' ? 'puzzle' : 'main';
        if (this.screen === 'puzzle') {
          this.resumeClock();
        }
      }
    } else if (this.session?.status === 'playing') {
      this.screen = 'puzzle';
      this.resumeClock();
    } else {
      this.screen = 'main';
    }
    if (this.screen !== 'puzzle') {
      this.source.warm(this.settings);
    }
    this.booted = true;
    this.emit();
  }

  /**
   * Asks to start a new puzzle, confirming first when one is in progress.
   * @returns a promise that resolves once a puzzle is up, or immediately if the player must confirm
   */
  requestNewPuzzle(): Promise<void> {
    if (this.session?.status === 'playing') {
      this.panel = 'confirm-new';
      this.emit();
      return Promise.resolve();
    }
    return this.startFresh();
  }

  /**
   * Confirms the new-puzzle prompt.
   * @returns a promise that resolves once the new puzzle is ready
   */
  confirmNewPuzzle(): Promise<void> {
    this.panel = 'none';
    return this.startFresh();
  }

  /** Asks to replay the current puzzle from a blank board. */
  requestRetry(): void {
    if (!this.session) {
      return;
    }
    if (this.session.status === 'playing') {
      this.panel = 'confirm-retry';
      this.emit();
      return;
    }
    void this.replay();
  }

  /** Confirms the retry prompt. */
  confirmRetry(): void {
    this.panel = 'none';
    void this.replay();
  }

  /** Closes whatever panel is open. */
  cancelPanel(): void {
    this.panel = 'none';
    this.seedError = null;
    this.emit();
  }

  /**
   * Opens a main-screen panel.
   * @param panel the panel
   */
  showPanel(panel: Panel): void {
    this.panel = panel;
    this.screen = 'main';
    this.emit();
  }

  /**
   * Starts the puzzle a code names.
   * @param code the seed code
   */
  async submitSeed(code: string): Promise<void> {
    const puzzle = await this.source.fromCode(code);
    if (!puzzle) {
      this.seedError = 'That seed code is not valid.';
      this.emit();
      return;
    }
    this.seedError = null;
    this.panel = 'none';
    this.begin(puzzle);
  }

  /** Returns to an in-progress puzzle. */
  resume(): void {
    if (this.session?.status !== 'playing') {
      return;
    }
    this.screen = 'puzzle';
    this.panel = 'none';
    this.resumeClock();
    this.emit();
  }

  /** Leaves the puzzle. Progress is saved and the timer pauses. */
  showMain(): void {
    if (this.session?.status === 'playing') {
      this.clock.pause(this.now());
      this.session.elapsedMs = this.clock.elapsed;
    }
    this.screen = 'main';
    this.panel = 'none';
    this.save();
    this.emit();
  }

  /**
   * Applies preference changes and drops any puzzle prepared under the old ones.
   * @param patch the fields to change
   */
  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.source.invalidate();
    this.source.warm(this.settings);
    this.save();
    this.emit();
  }

  /**
   * Saves after a mark, reveal, or hint, and records a win the first time it happens.
   */
  persist(): void {
    const session = this.session;
    if (!session) {
      return;
    }
    if (session.status === 'playing') {
      session.elapsedMs = this.clock.read(this.now());
    } else if (session.status === 'won' && !session.recorded) {
      this.clock.pause(this.now());
      session.elapsedMs = this.clock.elapsed;
      this.records.push(makeRecord(session, this.at()));
      session.recorded = true;
    } else if (session.status === 'lost') {
      this.clock.pause(this.now());
      session.elapsedMs = this.clock.elapsed;
    }
    this.save();
    this.emit();
  }

  /**
   * @returns the time to show, in milliseconds
   */
  elapsed(): number {
    if (this.screen === 'puzzle' && this.session?.status === 'playing') {
      return this.clock.read(this.now());
    }
    return this.session?.elapsedMs ?? 0;
  }

  /** Pauses the timer because the app went to the background. */
  onHide(): void {
    if (this.screen === 'puzzle' && this.session?.status === 'playing') {
      this.clock.pause(this.now());
      this.session.elapsedMs = this.clock.elapsed;
      this.save();
    }
  }

  /** Resumes the timer when the app comes back. */
  onShow(): void {
    if (this.screen === 'puzzle' && this.session?.status === 'playing') {
      this.clock.start(this.now());
    }
  }

  /** Shares the current puzzle's code and link, or copies them. */
  async share(): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    const url = shareUrl(session.puzzle.code);
    const text = `Stumped ${session.puzzle.code}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Stumped', text, url });
        return;
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'AbortError') {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      this.flash('Copied');
    } catch {
      this.flash(session.puzzle.code);
    }
  }

  /**
   * Reveals every stump through the normal rules. Used by screenshots and tests.
   */
  revealSolution(): void {
    const session = this.session;
    if (session?.status !== 'playing') {
      return;
    }
    for (const cell of session.puzzle.solution) {
      if (session.marks[cell] !== CELL_STUMP) {
        session.doubleTap(cell);
      }
    }
    this.persist();
  }

  private async startFresh(): Promise<void> {
    if (this.starting) {
      return;
    }
    this.starting = true;
    this.growing = true;
    this.panel = 'none';
    this.emit();
    try {
      const puzzle = await this.source.take(this.settings);
      this.growing = false;
      this.begin(puzzle);
    } catch {
      this.growing = false;
      this.flash('Could not grow a puzzle.');
    } finally {
      this.starting = false;
    }
  }

  private async replay(): Promise<void> {
    const current = this.session;
    if (!current || this.starting) {
      return;
    }
    this.starting = true;
    this.growing = true;
    this.emit();
    try {
      const puzzle = await this.source.fromCode(current.puzzle.code);
      this.growing = false;
      if (puzzle) {
        this.begin(puzzle);
      } else {
        this.flash('Could not regrow that puzzle.');
      }
    } catch {
      this.growing = false;
      this.flash('Could not regrow that puzzle.');
    } finally {
      this.starting = false;
    }
  }

  private begin(puzzle: Puzzle): void {
    const isRepeat = this.played.has(puzzle.code);
    this.played.add(puzzle.code);
    this.session = new Session(puzzle, { isRepeat });
    this.screen = 'puzzle';
    this.panel = 'none';
    this.seedError = null;
    this.clock = new Clock();
    this.clock.start(this.now());
    this.timesSize = puzzle.size;
    this.timesTier = puzzle.tier;
    this.save();
    this.source.warm(this.settings);
    this.emit();
  }

  private resumeClock(): void {
    if (!this.session) {
      return;
    }
    this.clock.elapsed = this.session.elapsedMs;
    this.clock.start(this.now());
  }

  private load(): void {
    const saved = readSave(this.storage);
    if (!saved) {
      return;
    }
    this.settings = saved.settings;
    this.records = [...saved.records];
    this.played = new Set(saved.played);
    if (saved.session) {
      this.session = Session.revive(saved.session);
      if (this.session) {
        this.timesSize = this.session.puzzle.size;
        this.timesTier = this.session.puzzle.tier;
      }
    }
  }

  private save(): void {
    writeSave(this.storage, {
      version: 1,
      settings: this.settings,
      session: this.session?.toJSON() ?? null,
      records: this.records,
      played: [...this.played],
    });
  }

  private flash(notice: string): void {
    this.notice = notice;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * @param code the puzzle's code
 * @param href page address the link should point at
 * @returns a link that opens the same puzzle
 */
export function shareUrl(code: string, href = globalThis.location?.href ?? 'http://local/'): string {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('code', code);
  return url.toString();
}

/**
 * Reads a seed code from a `code` query parameter or from the hash.
 * @param href a page address
 * @returns the code text, or null when the address has none
 */
export function codeFromHref(href: string): string | null {
  const url = new URL(href, 'http://local');
  const query = url.searchParams.get('code');
  if (query) {
    return query;
  }
  const hash = url.hash.replace(/^#/, '');
  return hash ? decodeURIComponent(hash) : null;
}

/**
 * @param stored the canonical code on the saved puzzle
 * @param typed a code from a link or the keyboard
 * @returns true when both name the same puzzle
 */
function sameCode(stored: string, typed: string): boolean {
  const decoded = decodeSeedCode(typed);
  if (!decoded) {
    return stored.replace(/[\s-]/g, '').toUpperCase() === typed.replace(/[\s-]/g, '').toUpperCase();
  }
  return encodeSeedCode(decoded.settings, decoded.seed) === stored;
}

