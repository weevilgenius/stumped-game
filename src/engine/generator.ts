import mulberry32 from '../utils/mulberry';
import {
  type Board, type GeneratorSettings, MAX_SIZE, MIN_SIZE, neighbors, type Puzzle, type Tier, TIERS,
} from './board';
import { encodeSeedCode } from './seedCode';
import { findSolutions, solve } from './solver';

/* ========================================================= *\
 *  Tuning                                                   *
\* ========================================================= */

/**
 * Attempts before settling for the closest tier found. Count-based, never
 * time-based, so the same seed always gives the same board.
 */
const MAX_ATTEMPTS = 2000;

/** Growth weight of the dominant region, by size mix level; other regions weigh 1. */
const DOMINANT_WEIGHT = [1, 3, 8, 20];

/**
 * Exponent applied to a frontier square's count of same-region neighbors, by
 * shape level. Diagonals count, so extending a run's tip scores lower than
 * bulging its side. Positive favors compact blobs, negative long thin runs.
 */
const SHAPE_EXPONENT = [3, 1, -2, -5];

/** Chance an attempt gets a freebie, by freebies level. Quartered at hard. */
const FREEBIE_CHANCE = [0, 0.15, 0.3, 0.5];

/** Region repairs allowed per attempt before giving up on it. */
const MAX_REPAIRS = 60;

/** Number of distinct region colors in the palette. */
const PALETTE_SIZE = 10;

/* ========================================================= *\
 *  Random helpers                                           *
\* ========================================================= */

type Rng = () => number;

const randInt = (rng: Rng, n: number): number => Math.floor(rng() * n);

/** Picks an index with probability proportional to its weight; -1 if all weights are 0. */
const pickWeighted = (rng: Rng, weights: readonly number[]): number => {
  let roll = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (weights[i] > 0 && roll < 0) {
      return i;
    }
  }
  // Floating-point leftovers land on the last positive weight.
  return weights.findLastIndex((w) => w > 0);
};

const shuffle = <T>(rng: Rng, items: T[]): T[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

/* ========================================================= *\
 *  Board construction                                       *
\* ========================================================= */

/** The up to four squares sharing a side with `cell`. */
const sideNeighbors = (size: number, cell: number): number[] => {
  const r = Math.floor(cell / size);
  const c = cell % size;
  return [
    r > 0 ? cell - size : -1,
    r < size - 1 ? cell + size : -1,
    c > 0 ? cell - 1 : -1,
    c < size - 1 ? cell + 1 : -1,
  ].filter((n) => n >= 0);
};

/** Places one stump per row and column with no two touching, as cells ordered by row. */
const placeStumps = (rng: Rng, size: number): number[] => {
  const cols: number[] = [];
  const place = (row: number): boolean => {
    if (row === size) {
      return true;
    }
    for (const col of shuffle(rng, Array.from({ length: size }, (_, c) => c))) {
      if (!cols.includes(col) && (row === 0 || Math.abs(col - cols[row - 1]) > 1)) {
        cols.push(col);
        if (place(row + 1)) {
          return true;
        }
        cols.pop();
      }
    }
    return false;
  };
  place(0);
  return cols.map((col, row) => row * size + col);
};

/**
 * Grows one connected region around each stump until every square is taken.
 * Region i starts at stumps[i]. The `single` region, if any, never grows.
 */
const growRegions = (
  rng: Rng, size: number, stumps: readonly number[], settings: GeneratorSettings, single: number,
): number[] => {
  const regions = new Array<number>(size * size).fill(-1);
  stumps.forEach((cell, region) => {
    regions[cell] = region;
  });
  const dominant = randInt(rng, size);
  const exponent = SHAPE_EXPONENT[settings.shape];
  // ponytail: frontiers rebuilt every step, O(cells^2) per board; fine for 100 cells.
  for (let remaining = size * size - size; remaining > 0; remaining--) {
    const frontiers: number[][] = Array.from({ length: size }, () => []);
    regions.forEach((region, cell) => {
      if (region < 0) {
        for (const n of new Set(sideNeighbors(size, cell).map((nb) => regions[nb]))) {
          if (n >= 0 && n !== single) {
            frontiers[n].push(cell);
          }
        }
      }
    });
    // Region and square are picked together, so a region with no square of
    // the wanted shape yields to one that has. Dividing by frontier size keeps
    // big regions from growing faster just for having a longer edge.
    const candidates = frontiers.flatMap((cells, region) => cells.map((cell) => ({ cell, region })));
    const weights = candidates.map(({ cell, region }) => (
      (region === dominant ? DOMINANT_WEIGHT[settings.sizeMix] : 1) / frontiers[region].length
      * neighbors(size, cell).filter((n) => regions[n] === region).length ** exponent));
    const { cell, region } = candidates[pickWeighted(rng, weights)];
    regions[cell] = region;
  }
  return regions;
};

/** True if the region stays connected (and keeps 2+ squares) without `cell`. */
const canGiveAway = (size: number, regions: readonly number[], cell: number): boolean => {
  const region = regions[cell];
  const rest = regions.flatMap((r, i) => (r === region && i !== cell ? [i] : []));
  if (rest.length < 2) {
    return false;
  }
  const seen = new Set([rest[0]]);
  const queue = [rest[0]];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const n of sideNeighbors(size, next)) {
      if (n !== cell && regions[n] === region && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size === rest.length;
};

/**
 * Edits regions until `solution` is the only solution. Each round takes an
 * alternative solution and hands one of its stump squares (not one of ours) to
 * a neighboring region, which leaves that solution with two stumps in one
 * region while ours stays valid.
 * @returns true if the board ended up unique
 */
const makeUnique = (
  rng: Rng, size: number, regions: number[], solution: readonly number[], single: number,
): boolean => {
  for (let repair = 0; repair < MAX_REPAIRS; repair++) {
    const other = findSolutions({ size, regions }, 2).find((s) => s.some((cell, row) => cell !== solution[row]));
    if (!other) {
      return true;
    }
    const moves = other.filter((cell) => !solution.includes(cell)).flatMap((cell) => (
      canGiveAway(size, regions, cell)
        ? [...new Set(sideNeighbors(size, cell).map((n) => regions[n]))]
          .filter((r) => r !== regions[cell] && r !== single)
          .map((r) => [cell, r])
        : []));
    if (!moves.length) {
      return false;
    }
    const [cell, region] = moves[randInt(rng, moves.length)];
    regions[cell] = region;
  }
  return false;
};

/* ========================================================= *\
 *  Generator                                                *
\* ========================================================= */

/**
 * Generates a puzzle with exactly one solution that the solver finishes by
 * deduction alone. The same settings, seed, and generator version always give
 * the same puzzle. The returned tier is the actual rating: if the requested
 * tier is not found within the attempt budget (hard on small boards is rare),
 * the closest tier found is used.
 * @param settings generator settings
 * @param seed 32-bit unsigned seed
 * @returns the puzzle, including its seed code
 * @throws RangeError if a setting or the seed is out of range
 */
export function generate(settings: GeneratorSettings, seed: number): Puzzle {
  const code = encodeSeedCode(settings, seed);
  const { size, tier } = settings;
  const rng = mulberry32(seed);
  const wanted = TIERS.indexOf(tier);
  const freebieChance = FREEBIE_CHANCE[settings.freebies] * (tier === 'hard' ? 0.25 : 1);

  let best: { board: Board; solution: number[]; givens: number[]; tier: Tier; distance: number } | null = null;
  // Keep going past the cap until at least one valid board exists.
  for (let attempt = 0; best?.distance !== 0 && (attempt < MAX_ATTEMPTS || !best); attempt++) {
    const solution = placeStumps(rng, size);
    const freebie = rng() < freebieChance ? (rng() < 0.5 ? 'single' : 'given') : null;
    const single = freebie === 'single' ? randInt(rng, size) : -1;
    const givens = freebie === 'given' ? [solution[randInt(rng, size)]] : [];
    const regions = growRegions(rng, size, solution, settings, single);
    if (!makeUnique(rng, size, regions, solution, single)) {
      continue;
    }
    const board: Board = { size, regions };

    // One-square regions only appear as deliberate freebies.
    const sizes = new Array<number>(size).fill(0);
    board.regions.forEach((region) => sizes[region]++);
    if (sizes.some((n, region) => n === 1 && region !== single)) {
      continue;
    }
    const result = solve(board, givens);
    if (!result.solved) {
      continue;
    }
    const distance = Math.abs(TIERS.indexOf(result.tier) - wanted);
    if (!best || distance < best.distance) {
      best = { board, solution, givens, tier: result.tier, distance };
    }
  }

  if (!best) {
    throw new Error('unreachable: the loop runs until a board is found');
  }
  const colors = shuffle(rng, Array.from({ length: PALETTE_SIZE }, (_, i) => i)).slice(0, size);
  const { board, solution, givens, tier: rated } = best;
  return { ...board, solution, givens, colors, tier: rated, silver: settings.silver, code };
}

/**
 * Picks generator settings for a new puzzle, keeping any fixed by the player.
 * Unfixed silver mode comes up about one time in five.
 * @param rng random source returning [0, 1)
 * @param fixed settings the player has fixed
 * @returns complete settings
 */
export function randomSettings(rng: Rng, fixed: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    size: fixed.size ?? MIN_SIZE + randInt(rng, MAX_SIZE - MIN_SIZE + 1),
    tier: fixed.tier ?? TIERS[randInt(rng, TIERS.length)],
    silver: fixed.silver ?? rng() < 0.2,
    sizeMix: fixed.sizeMix ?? randInt(rng, 4),
    shape: fixed.shape ?? randInt(rng, 4),
    freebies: fixed.freebies ?? randInt(rng, 4),
  };
}
