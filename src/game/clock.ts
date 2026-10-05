/**
 * Elapsed play time that can pause while the app is hidden or the player has
 * left the puzzle. The caller supplies the timestamps, so tests stay deterministic.
 */
export class Clock {
  /** Milliseconds accumulated while the clock was running, not counting the open span. */
  elapsed = 0;

  private runningFrom: number | null = null;

  /**
   * Starts the clock if it is paused.
   * @param now timestamp in the same units as later calls
   */
  start(now: number): void {
    this.runningFrom ??= now;
  }

  /**
   * Folds the open span into `elapsed` and pauses.
   * @param now timestamp
   */
  pause(now: number): void {
    if (this.runningFrom !== null) {
      this.elapsed += Math.max(0, now - this.runningFrom);
      this.runningFrom = null;
    }
  }

  /**
   * @param now timestamp
   * @returns elapsed milliseconds, including the span since the last start
   */
  read(now: number): number {
    if (this.runningFrom === null) {
      return this.elapsed;
    }
    return this.elapsed + Math.max(0, now - this.runningFrom);
  }

  /** Whether the clock is currently running. */
  get running(): boolean {
    return this.runningFrom !== null;
  }
}
