import acornUrl from './assets/acorn_icon@8x.png';
import owlUrl from './assets/owl_icon@8x.png';
import silverUrl from './assets/silver_acorn_icon@8x.png';
import squirrelUrl from './assets/squirrel_icon@8x.png';
import stumpUrl from './assets/stump_icon.png';
import woodpeckerUrl from './assets/woodpecker_icon@8x.png';

import parrotUrl from './assets/vallarta/parrot.svg';
import margaritaUrl from './assets/vallarta/margarita.svg';
import silverMargaritaUrl from './assets/vallarta/silver-margarita.svg';
import calaveraUrl from './assets/vallarta/calavera.svg';
import limeUrl from './assets/vallarta/lime.svg';
import homeUrl from './assets/vallarta/home.svg';
import woodlandHomeUrl from './assets/logo_menu.jpg';

/** Region colors in priority order. A board of size N uses the first N. */
export const PALETTE: readonly number[] = [
  0xE4BB49, 0x5B75B2, 0xD57374, 0xAED994, 0x48B5B2, 0xFAB4D0, 0xA7BFD7, 0x9778D6, 0xAD6F48, 0xFEAA6C,
];

/** Icon image URLs, shared with the main screen. */
export const ICONS = {
  stump: stumpUrl, acorn: acornUrl, silver: silverUrl, woodpecker: woodpeckerUrl, owl: owlUrl, squirrel: squirrelUrl,
} as const;

/** Shared presentation for the home screen, help, and puzzle canvas. */
export interface Theme {
  /** Stable name used for styling and texture cache keys. */
  readonly id: 'woodland' | 'vallarta';
  /** Region colors, in priority order. */
  readonly palette: readonly number[];
  /** Artwork keyed by the existing game actions. */
  readonly icons: typeof ICONS;
  /** Home screen illustration. */
  readonly home: string;
  /** Canvas and browser chrome background. */
  readonly background: number;
  /** Control fill. */
  readonly button: number;
  /** Control border. */
  readonly border: number;
  /** Adapts presentation nouns without changing saved game data. */
  readonly text: (text: string) => string;
}

/** Default woodland presentation. */
export const WOODLAND: Theme = {
  id: 'woodland', palette: PALETTE, icons: ICONS, home: woodlandHomeUrl,
  background: 0x20382a, button: 0x8a5a33, border: 0x5e3b1f,
  text: (text) => text,
};

const WORDS: Record<string, string> = {
  stump: 'parrot', stumps: 'parrots', acorn: 'margarita', acorns: 'margaritas',
  woodpecker: 'parrot', owl: 'calavera', squirrel: 'lime', forest: 'coast', woods: 'bay',
};

/** Puerto Vallarta holiday presentation; puzzle rules and seed codes stay the same. */
export const VALLARTA: Theme = {
  id: 'vallarta',
  palette: [0xF4BD55, 0x72B8DC, 0xEF8A91, 0xB8D88A, 0x63C6BD, 0xF8B8D1, 0xADC9E0, 0xB89BDB, 0xC8997D, 0xF5AA73],
  icons: { stump: parrotUrl, acorn: margaritaUrl, silver: silverMargaritaUrl,
    woodpecker: parrotUrl, owl: calaveraUrl, squirrel: limeUrl },
  home: homeUrl, background: 0x153f50, button: 0x9c3f65, border: 0x612a48,
  text: (text) => text.replace(/\b(stumps?|acorns?|woodpecker|owl|squirrel|forest|woods)\b/gi, (word) => {
    const replacement = WORDS[word.toLowerCase()];
    return word.startsWith(word[0].toUpperCase()) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  }),
};

/** Resolves the optional saved toggle; older saves keep the woodland theme. */
export function themeFor(vallarta = false): Theme {
  return vallarta ? VALLARTA : WOODLAND;
}
