import acornIconUrl from '../assets/acorn_icon@4x.png';
import logoUrl from '../assets/logo.jpg';
import owlIconUrl from '../assets/owl_icon@4x.png';
import silverAcornIconUrl from '../assets/silver_acorn_icon@4x.png';
import squirrelIconUrl from '../assets/squirrel_icon@4x.png';
import stumpIconUrl from '../assets/stump_icon@4x.png';
import woodpeckerIconUrl from '../assets/woodpecker_icon@4x.png';

/** Phaser texture keys for preloaded game assets. */
export const TEXTURE_KEYS = {
  LOGO: 'logo',
  STUMP: 'stump_icon',
  ACORN: 'acorn_icon',
  SILVER_ACORN: 'silver_acorn_icon',
  WOODPECKER: 'woodpecker_icon',
  OWL: 'owl_icon',
  SQUIRREL: 'squirrel_icon',
} as const;

/** Bundled asset URLs resolved by Vite. */
export const ASSET_URLS = {
  logo: logoUrl,
  stump: stumpIconUrl,
  acorn: acornIconUrl,
  silverAcorn: silverAcornIconUrl,
  woodpecker: woodpeckerIconUrl,
  owl: owlIconUrl,
  squirrel: squirrelIconUrl,
} as const;
