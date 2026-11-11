import { puzzleService } from '../worker/puzzleService';
import { GameSession } from './gameSession';
import {
  hasPlayedCode,
  loadActiveScreen,
  loadCurrentPuzzle,
  loadSettings,
  markCodePlayed,
  recordSolve,
  saveActiveScreen,
  saveCurrentPuzzle,
  saveSettings,
} from './storage';
import type { AppSettings } from './types';

/**
 * Extracts a raw seed code from either a bare seed code string or a full URL with `?code=...`.
 * @param input user-supplied string
 * @returns trimmed seed code string
 */
export function extractSeedCode(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('code=')) {
    try {
      const url = new URL(trimmed, 'https://stumped.local');
      const param = url.searchParams.get('code');
      if (param) {
        return param.trim().toUpperCase();
      }
    } catch {
      const match = /[?&]code=([^&#\s]+)/i.exec(trimmed);
      if (match?.[1]) {
        return decodeURIComponent(match[1]).trim().toUpperCase();
      }
    }
  }
  return trimmed.toUpperCase();
}

/**
 * Central application state coordinator shared across Phaser scenes.
 */
export class AppController {
  private settings: AppSettings;
  private session: GameSession | null = null;
  private activeScreen: 'main' | 'puzzle';
  private recordedWinKey: string | null = null;

  constructor() {
    this.settings = loadSettings();
    this.activeScreen = loadActiveScreen();

    const saved = loadCurrentPuzzle();
    if (saved) {
      this.session = GameSession.fromSaved(saved);
      if (this.session.getStatus() === 'won') {
        this.recordedWinKey = `${this.session.puzzle.code}:${this.session.getElapsedMs()}`;
      }
    }

    // Start background pre-generation immediately
    void puzzleService.prepareNext(this.settings);
  }

  /** Returns the current user settings. */
  getSettings(): AppSettings {
    return this.settings;
  }

  /**
   * Updates user settings, persists them, and refreshes the pre-generated background puzzle.
   * @param updated new settings object
   */
  updateSettings(updated: AppSettings): void {
    this.settings = updated;
    saveSettings(updated);
    void puzzleService.prepareNext(updated);
  }

  /** Returns the current puzzle session (in progress or finished), or `null` if none exists. */
  getSession(): GameSession | null {
    return this.session;
  }

  /** Returns whether there is currently an unfinished puzzle in progress. */
  hasPuzzleInProgress(): boolean {
    return this.session?.getStatus() === 'in_progress';
  }

  /** Returns which screen should be shown on boot (`'main'` or `'puzzle'`). */
  getInitialScreen(): 'main' | 'puzzle' {
    if (this.activeScreen === 'puzzle' && this.session?.getStatus() === 'in_progress') {
      return 'puzzle';
    }
    return 'main';
  }

  /**
   * Persists the active screen (`'main'` or `'puzzle'`).
   * @param screen active screen identifier
   */
  setActiveScreen(screen: 'main' | 'puzzle'): void {
    this.activeScreen = screen;
    saveActiveScreen(screen);
  }

  /**
   * Starts a brand-new puzzle using the current settings (and pre-generated worker buffer).
   * @returns newly created {@link GameSession}
   */
  startNewPuzzle(): GameSession {
    const puzzle = puzzleService.takeNextPuzzleSync(this.settings);
    const isRepeat = hasPlayedCode(puzzle.code);
    markCodePlayed(puzzle.code);
    this.session = GameSession.fromPuzzle(puzzle, isRepeat);
    this.recordedWinKey = null;
    this.persistSession();
    this.setActiveScreen('puzzle');
    return this.session;
  }

  /**
   * Starts a puzzle from a seed code or share URL.
   * @param rawInput seed code or share URL
   * @returns newly created {@link GameSession}
   * @throws Error if the seed code is invalid
   */
  startSeedPuzzle(rawInput: string): GameSession {
    const code = extractSeedCode(rawInput);
    const puzzle = puzzleService.fromSeedCodeSync(code);
    if (!puzzle) {
      throw new Error(`Invalid seed code: ${code}`);
    }
    const isRepeat = hasPlayedCode(puzzle.code);
    markCodePlayed(puzzle.code);
    this.session = GameSession.fromPuzzle(puzzle, isRepeat);
    this.recordedWinKey = null;
    this.persistSession();
    this.setActiveScreen('puzzle');
    return this.session;
  }

  /**
   * Restarts the current puzzle from a clean board (marked as a repeat play).
   * @returns restarted {@link GameSession}, or `null` if there is no current puzzle
   */
  retryCurrentPuzzle(): GameSession | null {
    if (!this.session) {
      return null;
    }
    const { puzzle } = this.session;
    markCodePlayed(puzzle.code);
    this.session = GameSession.fromPuzzle(puzzle, true);
    this.recordedWinKey = null;
    this.persistSession();
    this.setActiveScreen('puzzle');
    return this.session;
  }

  /**
   * Saves the current session to `localStorage` and records the solve on a win.
   */
  persistSession(): void {
    if (!this.session) {
      saveCurrentPuzzle(null);
      return;
    }
    saveCurrentPuzzle(this.session.toSavedState());
    if (this.session.getStatus() === 'won') {
      const key = `${this.session.puzzle.code}:${this.session.getElapsedMs()}`;
      if (this.recordedWinKey !== key) {
        this.recordedWinKey = key;
        recordSolve(this.session.toSolveRecord());
      }
    }
  }
}

/** Shared singleton application controller. */
export const appController = new AppController();
