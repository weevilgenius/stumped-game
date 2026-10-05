import mulberry32 from '../utils/mulberry';
import { type GeneratorSettings, isValidSolution, MAX_SIZE, MIN_SIZE, type Puzzle, TIERS } from './board';
import { generate, randomSettings } from './generator';
import { decodeSeedCode } from './seedCode';
import { countSolutions, solve } from './solver';

const BASE: GeneratorSettings = { size: 7, tier: 'medium', silver: false, sizeMix: 1, shape: 1, freebies: 1 };

const regionSizes = (puzzle: Puzzle): number[] => {
  const sizes = new Array<number>(puzzle.size).fill(0);
  puzzle.regions.forEach((region) => sizes[region]++);
  return sizes;
};

const isConnected = (puzzle: Puzzle, region: number): boolean => {
  const { size, regions } = puzzle;
  const cells = regions.flatMap((r, cell) => (r === region ? [cell] : []));
  const seen = new Set([cells[0]]);
  const queue = [cells[0]];
  while (queue.length) {
    const cell = queue.pop() ?? 0;
    const r = Math.floor(cell / size);
    const c = cell % size;
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const next = nr * size + nc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[next] === region && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === cells.length;
};

/** Region cell edges that face another region or the border, per cell. Higher means thinner. */
const perimeterRatio = (puzzle: Puzzle): number => {
  const { size, regions } = puzzle;
  let edges = 0;
  regions.forEach((region, cell) => {
    const r = Math.floor(cell / size);
    const c = cell % size;
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (nr < 0 || nr >= size || nc < 0 || nc >= size || regions[nr * size + nc] !== region) {
        edges++;
      }
    }
  });
  return edges / regions.length;
};

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

describe('generate', () => {
  it('is deterministic for a seed and settings', () => {
    expect(generate(BASE, 42)).toEqual(generate(BASE, 42));
    expect(generate(BASE, 43).regions).not.toEqual(generate(BASE, 42).regions);
  });

  describe.each(Array.from({ length: MAX_SIZE - MIN_SIZE + 1 }, (_, i) => i + MIN_SIZE))('size %i', (size) => {
    it.each(TIERS)('makes valid, unique %s puzzles of the requested tier', (tier) => {
      for (const seed of [1, 2, 3]) {
        const settings = { ...BASE, size, tier };
        const puzzle = generate(settings, seed);
        const label = `${puzzle.code} (${tier}, seed ${seed})`;

        expect(puzzle.size, label).toBe(size);
        expect(regionSizes(puzzle).every((n) => n > 0), label).toBe(true);
        expect(Array.from({ length: size }, (_, r) => isConnected(puzzle, r)).every(Boolean), label).toBe(true);
        expect(isValidSolution(puzzle, puzzle.solution), label).toBe(true);
        expect(countSolutions(puzzle), label).toBe(1);
        expect(puzzle.givens.every((cell) => puzzle.solution.includes(cell)), label).toBe(true);
        expect(new Set(puzzle.colors).size, label).toBe(size);
        expect([...puzzle.colors].sort((a, b) => a - b), label).toEqual(Array.from({ length: size }, (_, i) => i));
        expect(decodeSeedCode(puzzle.code), label).toEqual({ settings, seed });

        const result = solve(puzzle, puzzle.givens);
        expect(result.solved, label).toBe(true);
        expect(result.stumps, label).toEqual(puzzle.solution);
        expect(result.tier, label).toBe(puzzle.tier);
        expect(puzzle.tier, label).toBe(tier);

        // Solver soundness: no step ever rules out a stump or places one wrongly.
        for (const step of result.steps) {
          expect(step.eliminated.some((cell) => puzzle.solution.includes(cell)), label).toBe(false);
          if (step.type === 'forced') {
            expect(puzzle.solution, label).toContain(step.place);
          }
        }
      }
    }, 30_000); // generation is heavy-tailed at size 10; it runs in the background in the app
  });

  it('honors the freebies setting', () => {
    const hasFreebie = (puzzle: Puzzle): boolean => puzzle.givens.length > 0 || regionSizes(puzzle).includes(1);
    const seeds = Array.from({ length: 12 }, (_, i) => i);
    const none = seeds.map((seed) => generate({ ...BASE, tier: 'easy', freebies: 0 }, seed));
    const often = seeds.map((seed) => generate({ ...BASE, tier: 'easy', freebies: 3 }, seed));
    expect(none.some(hasFreebie)).toBe(false);
    expect(often.filter(hasFreebie).length).toBeGreaterThanOrEqual(3);
  });

  it('honors the region size mix setting', () => {
    const largest = (sizeMix: number): number => mean([1, 2, 3, 4, 5, 6].map((seed) => (
      Math.max(...regionSizes(generate({ ...BASE, size: 8, sizeMix, freebies: 0 }, seed))))));
    expect(largest(3)).toBeGreaterThan(largest(0) + 4);
  });

  it('honors the region shape setting', () => {
    const thinness = (shape: number): number => mean([1, 2, 3, 4, 5, 6].map((seed) => (
      perimeterRatio(generate({ ...BASE, size: 8, shape, freebies: 0 }, seed)))));
    expect(thinness(3)).toBeGreaterThan(thinness(0) + 0.3);
  });

  it('carries the silver flag', () => {
    expect(generate({ ...BASE, silver: true }, 5).silver).toBe(true);
    expect(generate(BASE, 5).silver).toBe(false);
  });
});

describe('randomSettings', () => {
  it('keeps fixed fields and picks the rest in range', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const fixed = randomSettings(rng, { size: 9, tier: 'hard' });
      expect(fixed).toMatchObject({ size: 9, tier: 'hard' });
      const settings = randomSettings(rng);
      expect(settings.size).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(settings.size).toBeLessThanOrEqual(MAX_SIZE);
      expect(TIERS).toContain(settings.tier);
      for (const level of [settings.sizeMix, settings.shape, settings.freebies]) {
        expect([0, 1, 2, 3]).toContain(level);
      }
    }
  });

  it('makes about one puzzle in five silver when silver is not fixed', () => {
    const rng = mulberry32(11);
    const silver = Array.from({ length: 1000 }, () => randomSettings(rng).silver).filter(Boolean).length;
    expect(silver).toBeGreaterThan(150);
    expect(silver).toBeLessThan(250);
    expect(randomSettings(rng, { silver: true }).silver).toBe(true);
  });
});
