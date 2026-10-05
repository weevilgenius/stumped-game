import { GENERATOR_VERSION, type GeneratorSettings, MAX_SIZE, MIN_SIZE, TIERS } from './board';

/* ========================================================= *\
 *  Seed codes                                               *
 *                                                           *
 *  50 bits, most significant first: version 5, size-5 3,    *
 *  tier 2, silver 1, sizeMix 2, shape 2, freebies 2,        *
 *  seed 32, padding 1 (always 0). Written as 10 Crockford   *
 *  base32 characters plus one Luhn mod 32 check character.  *
\* ========================================================= */

/** A decoded seed code. */
export interface SeedCode {
  /** Generator settings. */
  readonly settings: GeneratorSettings;
  /** 32-bit unsigned PRNG seed. */
  readonly seed: number;
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BODY_LENGTH = 10;

/** Luhn mod 32 check character for a code body. */
const checkChar = (body: string): string => {
  let factor = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    const addend = factor * ALPHABET.indexOf(body[i]);
    factor = 3 - factor;
    sum += Math.floor(addend / 32) + (addend % 32);
  }
  return ALPHABET[(32 - (sum % 32)) % 32];
};

/**
 * Encodes generator settings and a seed as an 11-character code.
 * @param settings generator settings
 * @param seed 32-bit unsigned seed
 * @returns the seed code
 * @throws RangeError if a setting or the seed is out of range
 */
export function encodeSeedCode(settings: GeneratorSettings, seed: number): string {
  const { size, tier, silver, sizeMix, shape, freebies } = settings;
  const fields: [number, number][] = [
    [5, GENERATOR_VERSION],
    [3, size - MIN_SIZE],
    [2, TIERS.indexOf(tier)],
    [1, silver ? 1 : 0],
    [2, sizeMix],
    [2, shape],
    [2, freebies],
    [32, seed],
    [1, 0],
  ];
  // Numbers are exact up to 2^53, plenty for 50 bits.
  let value = 0;
  for (const [bits, field] of fields) {
    if (!Number.isInteger(field) || field < 0 || field >= 2 ** bits) {
      throw new RangeError(`Seed code field out of range: ${field}`);
    }
    value = value * 2 ** bits + field;
  }
  if (size > MAX_SIZE) {
    throw new RangeError(`Size out of range: ${size}`);
  }
  let body = '';
  for (let i = BODY_LENGTH - 1; i >= 0; i--) {
    body += ALPHABET[Math.floor(value / 32 ** i) % 32];
  }
  return body + checkChar(body);
}

/**
 * Decodes a seed code typed or pasted by a person. Ignores case, spaces, and
 * hyphens, and reads I and L as 1 and O as 0.
 * @param code the seed code
 * @returns settings and seed, or null if the code is invalid or from an unknown generator version
 */
export function decodeSeedCode(code: string): SeedCode | null {
  const clean = code.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (clean.length !== BODY_LENGTH + 1 || [...clean].some((ch) => !ALPHABET.includes(ch))) {
    return null;
  }
  const body = clean.slice(0, BODY_LENGTH);
  if (checkChar(body) !== clean[BODY_LENGTH]) {
    return null;
  }
  let value = 0;
  for (const ch of body) {
    value = value * 32 + ALPHABET.indexOf(ch);
  }
  // Read fields from the least significant end.
  const take = (bits: number): number => {
    const field = value % 2 ** bits;
    value = Math.floor(value / 2 ** bits);
    return field;
  };
  const padding = take(1);
  const seed = take(32);
  const freebies = take(2);
  const shape = take(2);
  const sizeMix = take(2);
  const silver = take(1) === 1;
  const tierIndex = take(2);
  const size = take(3) + MIN_SIZE;
  const version = take(5);
  if (padding !== 0 || version !== GENERATOR_VERSION || size > MAX_SIZE || tierIndex >= TIERS.length) {
    return null;
  }
  return { settings: { size, tier: TIERS[tierIndex], silver, sizeMix, shape, freebies }, seed };
}
