/* ========================================================= *\
 *  Stumped Visual Theme & Styling Constants                 *
\* ========================================================= */

/** The 10 official Meowdoku / Stumped region palette colors. */
export const REGION_COLORS: readonly number[] = [
  0xE4BB49, // 0: Gold
  0x5B75B2, // 1: Blue
  0xD57374, // 2: Rose
  0xAED994, // 3: Green
  0x48B5B2, // 4: Teal
  0xFAB4D0, // 5: Pink
  0xA7BFD7, // 6: Light blue
  0x9778D6, // 7: Purple
  0xAD6F48, // 8: Brown
  0xFEAA6C, // 9: Orange
];

/** Color scheme definition. */
export interface ThemePalette {
  readonly background: number;
  readonly backgroundCss: string;
  readonly surface: number;
  readonly surfaceCss: string;
  readonly surfaceHover: number;
  readonly border: number;
  readonly borderCss: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textAccent: string;
  readonly buttonPrimary: number;
  readonly buttonPrimaryHover: number;
  readonly buttonSecondary: number;
  readonly buttonSecondaryHover: number;
  readonly buttonText: string;
  readonly gridBorder: number;
  readonly gridInnerLine: number;
  readonly gridInnerAlpha: number;
  readonly markX: number;
  readonly markRedX: number;
  readonly hypoX: number;
  readonly conflictLine: number;
  readonly modalOverlay: number;
  readonly modalOverlayAlpha: number;
}

/** Warm woodland light theme. */
export const LIGHT_THEME: ThemePalette = {
  background: 0xF5EFEB,
  backgroundCss: '#F5EFEB',
  surface: 0xFFFFFF,
  surfaceCss: '#FFFFFF',
  surfaceHover: 0xF0E9E1,
  border: 0xD8CFC4,
  borderCss: '#D8CFC4',
  textPrimary: '#2D251E',
  textSecondary: '#6B5E52',
  textAccent: '#2F663B',
  buttonPrimary: 0x366A42,
  buttonPrimaryHover: 0x2A5433,
  buttonSecondary: 0xE8DFD5,
  buttonSecondaryHover: 0xDBCFC2,
  buttonText: '#FFFFFF',
  gridBorder: 0x251E17,
  gridInnerLine: 0xFFFFFF,
  gridInnerAlpha: 0.45,
  markX: 0x251E17,
  markRedX: 0xC83232,
  hypoX: 0x385B82,
  conflictLine: 0xC83232,
  modalOverlay: 0x14100C,
  modalOverlayAlpha: 0.65,
};

/** Deep woodland dark theme. */
export const DARK_THEME: ThemePalette = {
  background: 0x182018,
  backgroundCss: '#182018',
  surface: 0x232C22,
  surfaceCss: '#232C22',
  surfaceHover: 0x2C372B,
  border: 0x3B483A,
  borderCss: '#3B483A',
  textPrimary: '#EAE5DC',
  textSecondary: '#A2ACA0',
  textAccent: '#6CB07E',
  buttonPrimary: 0x3E7A4C,
  buttonPrimaryHover: 0x4D945E,
  buttonSecondary: 0x2D382C,
  buttonSecondaryHover: 0x374436,
  buttonText: '#FFFFFF',
  gridBorder: 0x111611,
  gridInnerLine: 0xFFFFFF,
  gridInnerAlpha: 0.25,
  markX: 0x111611,
  markRedX: 0xE54545,
  hypoX: 0x5E84B5,
  conflictLine: 0xE54545,
  modalOverlay: 0x0A0E0A,
  modalOverlayAlpha: 0.75,
};

/**
 * Checks whether the user's system prefers a dark color scheme.
 * @returns true if dark mode is active
 */
export function isDarkMode(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Returns active theme palette based on system preferences.
 * @returns current ThemePalette
 */
export function getActiveTheme(): ThemePalette {
  return isDarkMode() ? DARK_THEME : LIGHT_THEME;
}
