import { type GeneratorSettings, TIERS } from './board';
import { generate } from './generator';
import { decodeSeedCode, encodeSeedCode } from './seedCode';

/* ========================================================= *\
 *  Generator fixtures: a seed code must always build the    *
 *  same puzzle. Never update the snapshot to make this      *
 *  pass; bump GENERATOR_VERSION instead.                    *
\* ========================================================= */

interface SeedFixture {
  settings: GeneratorSettings;
  seed: number;
}

/** One settings combination per size, cycling tiers, silver, and shape knobs. */
const FIXTURES: readonly SeedFixture[] = [5, 6, 7, 8, 9, 10].map((size, i) => ({
  settings: {
    size,
    tier: TIERS[i % TIERS.length],
    silver: i % 2 === 1,
    sizeMix: i % 4,
    shape: (i + 1) % 4,
    freebies: (i + 2) % 4,
  },
  seed: (0x9e3779b9 ^ (size * 7919)) >>> 0,
}));

describe('generator fixtures', () => {
  it.each(FIXTURES)('size $settings.size builds the recorded puzzle', ({ settings, seed }) => {
    const code = encodeSeedCode(settings, seed);
    expect(decodeSeedCode(code)).toEqual({ settings, seed });
    expect(generate(settings, seed)).toMatchSnapshot();
  });
});
