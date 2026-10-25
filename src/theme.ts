import { type PieceNames, STUMP_NAMES } from './engine';
import type { Hint } from './game';
import { type SoundSet, VALLARTA_SOUNDS, WOODS_SOUNDS } from './sound';
import acornUrl from './assets/acorn_icon@8x.png';
import owlUrl from './assets/owl_icon@8x.png';
import silverUrl from './assets/silver_acorn_icon@8x.png';
import squirrelUrl from './assets/squirrel_icon@8x.png';
import stumpUrl from './assets/stump_icon.png';
import woodpeckerUrl from './assets/woodpecker_icon@8x.png';
import calaveraUrl from './assets/vallarta/calavera.svg?no-inline';
import geckoUrl from './assets/vallarta/gecko.svg?no-inline';
import margaritaUrl from './assets/vallarta/margarita.svg?no-inline';
import pinaColadaUrl from './assets/vallarta/pina-colada.svg?no-inline';
import tecoloteUrl from './assets/vallarta/owl.svg?no-inline';
import parrotUrl from './assets/vallarta/parrot.svg?no-inline';

/* ========================================================= *\
 *  Themes: the look of the board, its pieces, and the main  *
 *  screen. The rules and the names in code stay the same.   *
\* ========================================================= */

/** Every theme, the default first. */
export const THEME_NAMES = ['woods', 'vallarta'] as const;

/** A theme's name, as saved and as set on `<html data-theme>`. */
export type ThemeName = typeof THEME_NAMES[number];

/** The pictures a theme draws, by what they stand for in the game. */
export type IconName = 'stump' | 'acorn' | 'silver' | Hint;

/** Colors and art for one theme. */
export interface Theme {
  /** Saved name. */
  readonly name: ThemeName;
  /** Region colors in priority order. A board of size N uses the first N. */
  readonly palette: readonly number[];
  /** Icon image URLs, shared by the puzzle screen and the main screen. */
  readonly icons: Readonly<Record<IconName, string>>;
  /** Puzzle screen background, which also fills the safe areas around it. */
  readonly background: number;
  /** Button face. */
  readonly wood: number;
  /** Button edge. */
  readonly woodDark: number;
  /** End-of-puzzle banner fill. */
  readonly ink: number;
  /** Text and the banner edge. */
  readonly cream: number;
  /** Papel picado flag colors strung above the board, or empty for none. */
  readonly flags: readonly number[];
  /** What the Owl calls the pieces. */
  readonly piece: PieceNames;
  /** What the one-life mode is called, without "mode", as at the start of a sentence. */
  readonly silverName: string;
  /** What each hint button is called, for screen readers. */
  readonly hintNames: Readonly<Record<Hint, string>>;
  /** Sound effects. */
  readonly sounds: SoundSet;
}

/** Every theme, by name. */
export const THEMES: Readonly<Record<ThemeName, Theme>> = {
  woods: {
    name: 'woods',
    palette: [0xE4BB49, 0x5B75B2, 0xD57374, 0xAED994, 0x48B5B2, 0xFAB4D0, 0xA7BFD7, 0x9778D6, 0xAD6F48, 0xFEAA6C],
    icons: {
      stump: stumpUrl, acorn: acornUrl, silver: silverUrl, woodpecker: woodpeckerUrl, owl: owlUrl, squirrel: squirrelUrl,
    },
    background: 0x20382a,
    wood: 0x8a5a33,
    woodDark: 0x5e3b1f,
    ink: 0x2b1d12,
    cream: 0xf7edd5,
    flags: [],
    piece: STUMP_NAMES,
    silverName: 'Silver acorn',
    hintNames: { woodpecker: 'Woodpecker', owl: 'Owl', squirrel: 'Squirrel' },
    sounds: WOODS_SOUNDS,
  },
  vallarta: {
    name: 'vallarta',
    // Marigold, rosa mexicano, turquoise, lime, cobalt, sun yellow, lilac, mole brown, jade, rosa pastel.
    // Spread in hue and lightness so neighboring patches stay easy to tell apart. No red: it would hide mistake marks.
    palette: [0xF7941D, 0xE8489A, 0x20B2C0, 0x7CC63E, 0x3A5BD0, 0xFBE36A, 0xB98FEE, 0x9A5B34, 0x0F6B4E, 0xF9C6D8],
    icons: {
      stump: calaveraUrl, acorn: margaritaUrl, silver: pinaColadaUrl,
      woodpecker: parrotUrl, owl: tecoloteUrl, squirrel: geckoUrl,
    },
    background: 0x2a1d4a,
    wood: 0xb5532e,
    woodDark: 0x7a3218,
    ink: 0x2a1d4a,
    cream: 0xfff3d6,
    piece: { one: 'skull', many: 'skulls', a: 'a skull' },
    silverName: 'Piña colada',
    flags: [0xe8458b, 0xf5a623, 0x18a7b5, 0x8e44ad, 0x59b83a, 0xff7a1a, 0xf6c21b, 0x3d6fd1],
    hintNames: { woodpecker: 'Parrot', owl: 'Owl', squirrel: 'Gecko' },
    sounds: VALLARTA_SOUNDS,
  },
};

/**
 * Reads a saved theme name.
 * @param saved the stored value, or null if there is none
 * @returns the theme it names, or the default theme
 */
export function parseTheme(saved: string | null): ThemeName {
  return THEME_NAMES.find((name) => name === saved) ?? THEME_NAMES[0];
}

/**
 * Formats a color for CSS.
 * @param color a 0xRRGGBB number
 * @returns the color as #rrggbb
 */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
