import type { GeneratorSettings } from './board';
import { decodeSeedCode, encodeSeedCode } from './seedCode';

const MIN: GeneratorSettings = { size: 5, tier: 'easy', silver: false, sizeMix: 0, shape: 0, freebies: 0 };
const MAX: GeneratorSettings = { size: 10, tier: 'hard', silver: true, sizeMix: 3, shape: 3, freebies: 3 };
const MID: GeneratorSettings = { size: 8, tier: 'medium', silver: false, sizeMix: 2, shape: 1, freebies: 3 };

describe('encodeSeedCode', () => {
  // Vectors computed independently; changing them breaks every shared code.
  it('matches known vectors', () => {
    expect(encodeSeedCode(MIN, 0)).toBe('2000000000Y');
    expect(encodeSeedCode(MAX, 0xFFFFFFFF)).toBe('2PZZZZZZZYV');
    expect(encodeSeedCode(MID, 123456789)).toBe('2D9R7BF6HAD');
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
    expect(decodeSeedCode(' 2d9r7-bf6ha-d ')).toEqual({ settings: MID, seed: 123456789 });
    expect(decodeSeedCode('2oooooooI0X')).toEqual({ settings: MIN, seed: 16 });
    expect(decodeSeedCode('2oooooooL0x')).toEqual({ settings: MIN, seed: 16 });
  });

  it('rejects every single-character typo', () => {
    const code = '2D9R7BF6HAD';
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
    expect(decodeSeedCode('2D9R7BF6HADE')).toBeNull(); // too long
    expect(decodeSeedCode('1D9R7BF6HA!')).toBeNull(); // bad character
    expect(decodeSeedCode('1D9R7BF6HAU')).toBeNull(); // U is not in the alphabet
  });

  it('rejects codes with valid checks but unsupported contents', () => {
    expect(decodeSeedCode(withCheck('0000000000'))).toBeNull(); // version 0
    expect(decodeSeedCode('1000000000Z')).toBeNull(); // version 1 used a different color assignment
    expect(decodeSeedCode(withCheck('Z000000000'))).toBeNull(); // version 31
    expect(decodeSeedCode(withCheck('2R00000000'))).toBeNull(); // size 11
    expect(decodeSeedCode(withCheck('2300000000'))).toBeNull(); // tier 3
    expect(decodeSeedCode(withCheck('2000000001'))).toBeNull(); // padding bit set
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
