import { describe, expect, it } from 'vitest';
import { HINTS } from './game';
import { cssColor, parseTheme, THEME_NAMES, THEMES } from './theme';

describe('themes', () => {
  it('reads saved names and falls back to the woods', () => {
    expect(parseTheme('vallarta')).toBe('vallarta');
    expect(parseTheme('woods')).toBe('woods');
    expect(parseTheme(null)).toBe('woods');
    expect(parseTheme('beach')).toBe('woods');
  });

  it('gives every theme ten distinct region colors and every icon', () => {
    for (const name of THEME_NAMES) {
      const theme = THEMES[name];
      expect(theme.name).toBe(name);
      expect(new Set(theme.palette).size, name).toBe(10);
      for (const icon of ['stump', 'acorn', 'silver', ...HINTS] as const) {
        expect(theme.icons[icon], `${name} ${icon}`).toBeTruthy();
      }
    }
  });

  it('formats colors for CSS', () => {
    expect(cssColor(0x0a1b2c)).toBe('#0a1b2c');
  });
});
