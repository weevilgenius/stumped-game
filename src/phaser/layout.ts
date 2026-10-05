/** A rectangle in game pixels. */
export interface Box {
  /** Left edge. */
  x: number;
  /** Top edge. */
  y: number;
  /** Width. */
  w: number;
  /** Height. */
  h: number;
}

/** Safe-area insets, in CSS pixels. */
export interface Insets {
  /** Top inset. */
  top: number;
  /** Right inset. */
  right: number;
  /** Bottom inset. */
  bottom: number;
  /** Left inset. */
  left: number;
}

/** How much chrome the puzzle screen is showing under the board. */
export type PuzzleChrome = 'play' | 'hypothesis' | 'explain';

/** Places the puzzle screen's controls around the largest board that fits. */
export interface PuzzleLayout {
  /** Back button. */
  back: Box;
  /** Stump count. */
  count: Box;
  /** Timer. */
  timer: Box;
  /** Acorn icons. */
  acorns: Box;
  /** The board. */
  board: Box;
  /** Woodpecker, owl, and squirrel. */
  hints: [Box, Box, Box];
  /** Undo. */
  undo: Box;
  /** Hypothesis toggle. */
  hypothesis: Box;
  /** Discard, shown while hypothesizing. */
  discard: Box;
  /** Keep, shown while hypothesizing. */
  keep: Box;
  /** Explanation or end-of-puzzle message. */
  banner: Box;
}

/** Places the main screen as a centered column. `card` is null when nothing is in progress. */
export interface MainLayout {
  /** Width of the column. */
  columnW: number;
  /** Left edge of the column. */
  columnX: number;
  /** Logo. */
  logo: Box;
  /** New puzzle. */
  newPuzzle: Box;
  /** Current-puzzle card. */
  card: Box | null;
  /** Share. */
  share: Box | null;
  /** Retry. */
  retry: Box | null;
  /** Seed entry. */
  seed: Box;
  /** Best times. */
  times: Box;
  /** Settings. */
  settings: Box;
  /** Height of the column, including the bottom inset. */
  contentHeight: number;
}

/**
 * Reads the safe-area insets published as CSS variables on the document element.
 * @returns the insets, or zeros when the variables are unset
 */
export function readInsets(): Insets {
  const style = getComputedStyle(document.documentElement);
  const px = (name: string): number => {
    const value = parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : 0;
  };
  return { top: px('--sat'), right: px('--sar'), bottom: px('--sab'), left: px('--sal') };
}

/**
 * Lays out the puzzle screen. The board is the largest square that fits once
 * the header and the controls have taken their rows.
 * @param width game width
 * @param height game height
 * @param insets safe area
 * @param chrome which controls are showing
 * @returns the layout
 */
export function layoutPuzzle(width: number, height: number, insets: Insets, chrome: PuzzleChrome): PuzzleLayout {
  const margin = 14;
  const left = insets.left + margin;
  const top = insets.top + margin;
  const right = width - insets.right - margin;
  const bottom = height - insets.bottom - margin;
  const innerW = Math.max(0, right - left);
  const innerH = Math.max(0, bottom - top);
  const landscape = innerW > innerH * 1.15;
  const headerH = 52;
  const bannerH = Math.min(230, Math.max(150, innerH * 0.32));
  const slots = chrome === 'hypothesis' ? 7 : 5;
  const button = landscape
    ? Math.min(76, Math.max(40, (innerH - headerH - 8) / slots))
    : Math.min(68, Math.max(44, (innerW - 24) / 5));
  const footerH = chrome === 'explain' || landscape
    ? 0
    : chrome === 'hypothesis' ? button + button * 0.78 + 16 : button + 8;
  const sideW = landscape && chrome !== 'explain' ? button : 0;
  const explainH = chrome === 'explain' ? bannerH : 0;
  const boardMaxW = Math.max(0, innerW - (sideW > 0 ? sideW + 16 : 0));
  const boardMaxH = Math.max(0, innerH - headerH - footerH - explainH - 8);
  const boardSize = Math.floor(Math.min(boardMaxW, boardMaxH));
  const boardX = left + (boardMaxW - boardSize) / 2;
  const boardY = top + headerH + Math.max(0, (boardMaxH - boardSize) / 2);

  const back = { x: left, y: top + (headerH - 40) / 2, w: 76, h: 40 };
  const acorns = { x: right - 120, y: top + (headerH - 40) / 2, w: 120, h: 40 };
  const midX = back.x + back.w + 8;
  const midW = Math.max(0, acorns.x - midX - 8);
  const count = { x: midX, y: top, w: midW * 0.46, h: headerH };
  const timer = { x: midX + midW * 0.46, y: top, w: midW * 0.54, h: headerH };

  const hints = [0, 1, 2].map((index) => controlBox(index));
  const undo = controlBox(3);
  const hypothesis = controlBox(4);
  const discard = { x: 0, y: 0, w: 0, h: 0 };
  const keep = { x: 0, y: 0, w: 0, h: 0 };
  if (!landscape) {
    const gap = 8;
    const rowW = button * 5 + gap * 4;
    const start = left + (innerW - rowW) / 2;
    const y = bottom - footerH + 2;
    for (let index = 0; index < 5; index++) {
      const box = index < 3 ? hints[index] : index === 3 ? undo : hypothesis;
      if (box) {
        box.x = start + index * (button + gap);
        box.y = y;
        box.w = button;
        box.h = button;
      }
    }
    const wide = (innerW - gap) / 2;
    discard.x = left;
    discard.y = y + button + 8;
    discard.w = wide;
    discard.h = button * 0.72;
    keep.x = left + wide + gap;
    keep.y = discard.y;
    keep.w = wide;
    keep.h = discard.h;
  } else {
    const x = right - button;
    let y = top + headerH;
    const gap = 8;
    for (let index = 0; index < 5; index++) {
      const box = index < 3 ? hints[index] : index === 3 ? undo : hypothesis;
      if (box) {
        box.x = x;
        box.y = y;
        box.w = button;
        box.h = button;
      }
      y += button + gap;
    }
    discard.x = x;
    discard.y = y;
    discard.w = button;
    discard.h = button * 0.72;
    keep.x = x;
    keep.y = y + button * 0.72 + gap;
    keep.w = button;
    keep.h = discard.h;
  }

  const banner = {
    x: left,
    y: chrome === 'explain' ? bottom - bannerH : boardY + boardSize - 8,
    w: landscape && chrome !== 'explain' ? boardMaxW : innerW,
    h: chrome === 'explain' ? bannerH : 72,
  };

  return {
    back, count, timer, acorns, board: { x: boardX, y: boardY, w: boardSize, h: boardSize },
    hints: hints as [Box, Box, Box], undo, hypothesis, discard, keep, banner,
  };

  function controlBox(_index: number): Box {
    return { x: 0, y: 0, w: button, h: button };
  }
}

/**
 * Lays out the main screen's column. The logo keeps `logoAspect` (height / width)
 * and never takes more than about a third of the screen.
 * @param width game width
 * @param height game height
 * @param insets safe area
 * @param hasPuzzle whether a current puzzle card is shown
 * @param logoAspect logo height divided by its width
 * @returns the layout, in content coordinates before scrolling
 */
export function layoutMain(
  width: number, height: number, insets: Insets, hasPuzzle: boolean, logoAspect: number,
): MainLayout {
  const columnW = Math.min(460, Math.max(220, width - insets.left - insets.right - 28));
  const columnX = (width - columnW) / 2;
  let y = insets.top + 18;
  const logoH = Math.min(columnW * logoAspect, Math.max(140, height * 0.34));
  const logo = { x: columnX, y, w: columnW, h: logoH };
  y += logoH + 18;
  const buttonH = 54;
  const gap = 12;
  const newPuzzle = { x: columnX, y, w: columnW, h: buttonH };
  y += buttonH + gap;
  let card: Box | null = null;
  let share: Box | null = null;
  let retry: Box | null = null;
  if (hasPuzzle) {
    card = { x: columnX, y, w: columnW, h: 176 };
    y += 176 + gap;
    const half = (columnW - gap) / 2;
    share = { x: columnX, y, w: half, h: 48 };
    retry = { x: columnX + half + gap, y, w: half, h: 48 };
    y += 48 + gap;
  }
  const seed = { x: columnX, y, w: columnW, h: buttonH };
  y += buttonH + gap;
  const times = { x: columnX, y, w: columnW, h: buttonH };
  y += buttonH + gap;
  const settingsBox = { x: columnX, y, w: columnW, h: buttonH };
  y += buttonH + insets.bottom + 20;
  return {
    columnW, columnX, logo, newPuzzle, card, share, retry, seed, times, settings: settingsBox, contentHeight: y,
  };
}
