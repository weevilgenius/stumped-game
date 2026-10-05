import type { GeneratorSettings } from './board';
import { decodeSeedCode, encodeSeedCode } from './seedCode';

const MIN: GeneratorSettings = { size: 5, tier: 'easy', silver: false, sizeMix: 0, shape: 0, freebies: 0 };
const MAX: GeneratorSettings = { size: 10, tier: 'hard', silver: true, sizeMix: 3, shape: 3, freebies: 3 };
const MID: GeneratorSettings = { size: 8, tier: 'medium', silver: false, sizeMix: 2, shape: 1, freebies: 3 };

describe('encodeSeedCode', () => {
  // Vectors computed independently; changing them breaks every shared code.
  it('matches known vectors', () => {
    expect(encodeSeedCode(MIN, 0)).toBe('1000000000Z');
    expect(encodeSeedCode(MAX, 0xFFFFFFFF)).toBe('1PZZZZZZZYW');
    expect(encodeSeedCode(MID, 123456789)).toBe('1D9R7BF6HAE');
  });

  it('rejects out-of-range settings', () => {
    expect(() => encodeSeedCode({ ...MIN, size: 11 }, 0)).toThrow();
    expect(() => encodeSeedCode({ ...MIN, shape: 4 }, 0)).toThrow();
    expect(() => encodeSeedCode(MIN, -1)).toThrow();
    expect(() => encodeSeedCode(MIN, 2 ** 32)).toThrow();
  });
});

describe('decodeSeedCode', () => {
  it('round-trips every field', () => {
    for (const [settings, seed] of [[MIN, 0], [MAX, 0xFFFFFFFF], [MID, 123456789]] as const) {
      expect(decodeSeedCode(encodeSeedCode(settings, seed))).toEqual({ settings, seed });
    }
  });

  it('is lenient about case, separators, and look-alike letters', () => {
    expect(decodeSeedCode(' 1d9r7-bf6ha-e ')).toEqual({ settings: MID, seed: 123456789 });
    expect(decodeSeedCode('i0000ooooOZ')).toEqual({ settings: MIN, seed: 0 });
    expect(decodeSeedCode('L000000000z')).toEqual({ settings: MIN, seed: 0 });
  });

  it('rejects every single-character typo', () => {
    const code = '1D9R7BF6HAE';
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let i = 0; i < code.length; i++) {
      for (const ch of alphabet) {
        if (ch !== code[i]) {
          expect(decodeSeedCode(code.slice(0, i) + ch + code.slice(i + 1))).toBeNull();
        }
      }
    }
  });

  it('rejects malformed codes', () => {
    expect(decodeSeedCode('')).toBeNull();
    expect(decodeSeedCode('1D9R7BF6HA')).toBeNull(); // too short
    expect(decodeSeedCode('1D9R7BF6HAEE')).toBeNull(); // too long
    expect(decodeSeedCode('1D9R7BF6HA!')).toBeNull(); // bad character
    expect(decodeSeedCode('1D9R7BF6HAU')).toBeNull(); // U is not in the alphabet
  });

  it('rejects codes with valid checks but unsupported contents', () => {
    expect(decodeSeedCode(withCheck('0000000000'))).toBeNull(); // version 0
    expect(decodeSeedCode(withCheck('Z000000000'))).toBeNull(); // version 31
    expect(decodeSeedCode(withCheck('1R00000000'))).toBeNull(); // size 11
    expect(decodeSeedCode(withCheck('1300000000'))).toBeNull(); // tier 3
    expect(decodeSeedCode(withCheck('1000000001'))).toBeNull(); // padding bit set
  });
});

/** Appends a Luhn mod 32 check character (independent reference implementation). */
const withCheck = (body: string): string => {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let factor = 2;
  let sum = 0;
  for (const ch of [...body].reverse()) {
    const addend = factor * alphabet.indexOf(ch);
    factor = 3 - factor;
    sum += Math.floor(addend / 32) + (addend % 32);
  }
  return body + alphabet[(32 - (sum % 32)) % 32];
};
