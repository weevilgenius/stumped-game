# Puzzle engine

The rules, solver, generator, and seed codes for Stumped, as described in the
"Game rules" and "Puzzle engine" sections of
[the product requirements](../../docs/Stumped%20Product%20Requirements.md).

It is plain TypeScript with no Phaser or other UI imports, so it can run in a
Web Worker. A lint rule (`no-restricted-imports` in `eslint.config.ts`) fails
the build if anything under `src/engine/` imports Phaser or UI assets. Import
from the barrel, `src/engine/index.ts`.

Cells are indexed `row * size + col`. A board state is a `Uint8Array` of
`OPEN`, `EXCLUDED` (an X, normal or red), or `STUMP` per cell.

## Files

| File | What it does |
| --- | --- |
| `board.ts` | Core types (`Board`, `Puzzle`, `Tier`, `Unit`, `GeneratorSettings`), the `GENERATOR_VERSION`, geometry helpers, and the placement rules. `conflicts()` says which rule a stump would break and against which stump, for the wrong-reveal line and for flagging tentative stumps. `isValidSolution()` checks a full set of stumps. |
| `solver.ts` | A rule-based solver that works like a person and never guesses. `nextStep()` returns the simplest deduction that makes progress from the player's marks, which drives the explain (owl) hint. `solve()` runs it to the end and rates the tier. `describeStep()` explains a step in words. `findSolutions()` and `countSolutions()` are a fast backtracking check used by the generator and tests. |
| `generator.ts` | `generate(settings, seed)` builds a puzzle with exactly one solution that the solver can finish. `randomSettings()` fills in whatever the player hasn't fixed. |
| `seedCode.ts` | `encodeSeedCode()` and `decodeSeedCode()` turn settings plus seed into a short shareable code, and back. |
| `index.ts` | The public API. |
| `testBoards.ts` | Test helper that parses ASCII boards and marks. |
| `*.test.ts` | Vitest tests, next to the code they cover. |

## Solver

The techniques run in this order, simplest first. The order is one constant,
`TECHNIQUES` in `solver.ts`, so tiers are easy to retune after real play.

| Order | Technique | Step `type` | Tier |
| --- | --- | --- | --- |
| 1 | Stump elimination | `elimination` | Easy |
| 2 | Forced square | `forced` | Easy |
| 3 | One region in one line, and the reverse | `confinement`, `k` 1 | Easy |
| 4 | Two in two | `confinement`, `k` 2 | Medium |
| 5 | One-step blocking | `blocking` | Medium |
| 6 | Three in three | `confinement`, `k` 3 | Medium |
| 7 | Four in four, five in five | `confinement`, `k` 4 or 5 | Hard |
| 8 | Multi-step chain | `chain` | Hard |

- A puzzle's tier is the hardest technique `solve()` needed.
- If `solve()` finishes, the solution is unique, because every step is a sound
  deduction.
- A chain step carries its easy sub-steps in `steps`, so its explanation can be
  stepped backward and forward. The finder picks the shortest chain.
- `nextStep()` expects marks that agree with the solution. Check for a player X
  on a stump's square first, as the explain hint requires.

## Generator

Each attempt does the following, all drawn from one `mulberry32(seed)` stream:

1. Place a legal set of stumps.
2. Grow a region around each one. Region size mix and shape are steered by
   `sizeMix` and `shape`.
3. Repair the regions until the board has one solution. Each repair takes an
   alternate solution and moves one of its stump squares into a neighboring
   region, which breaks that solution and leaves ours valid. Growing regions
   at random alone almost never gives a unique board at size 8 and up.
4. Maybe add a freebie, a revealed stump or a one-square region. Freebies come
   up less often at hard.
5. Solve and rate the board, and keep it if its tier matches the request.

- **Attempt cap:** generation stops after 2000 attempts. The cap counts
  attempts, never time, so a seed always gives the same board. If the requested
  tier is never hit, the closest one found is used, and `puzzle.tier` always
  reports the actual rating.
- **Speed:**

  | Size | Average | Worst case |
  | --- | --- | --- |
  | 5 to 8 | milliseconds | |
  | 10 | 0.2 to 0.5 s | a few seconds |

  Run it in a Web Worker and prepare the next puzzle ahead of time.
- **Colors:** `colors` maps each region to a palette index from 0 to 9. The UI
  owns the actual palette.
- **Tuning constants:** at the top of `generator.ts`.

## Seed codes

A seed code is 11 Crockford base32 characters, such as `1D9R7BF6HAE`. It packs
50 bits, most significant first:

| Field | Bits |
| --- | --- |
| Generator version | 5 |
| Size minus 5 | 3 |
| Tier | 2 |
| Silver acorn | 1 |
| Size mix | 2 |
| Shape | 2 |
| Freebies | 2 |
| Seed | 32 |
| Padding (always 0) | 1 |

After those comes one Luhn mod 32 check character, which catches every
single-character typo.

- **Decoding:** case, spaces, and hyphens are ignored, and I, L, and O read as
  1, 1, and 0. `decodeSeedCode()` returns `null` for anything invalid,
  including codes from another generator version.
- **Generator version:** bump `GENERATOR_VERSION` whenever a change to the
  generator would turn the same code into a different board. Old codes are
  refused until something keeps the old generator around.
