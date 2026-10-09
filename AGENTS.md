# AGENTS.md

This file provides guidance to AI coding agents when working with code
in this repository.

## Project Overview

This is a personal remake of the region-based cat placement puzzle "Meowdoku",
built for one family that likes the puzzle and dislikes the ads. The puzzle is
mechanically the same as a one-star Star Battle (also known as Queens): an N by N
grid, N colored regions, one piece per row, column, and region, with no two pieces
touching.

## Development Commands

Ensure the project compiles, lint checks, and unit tests pass when making
changes:
- Check compilation: `pnpm run typecheck`
- Check linting: `pnpm run lint`
- Run tests: `pnpm run test`
- Check all three: `pnpm run check`
- Build project: `pnpm run build`

## Hosting (GitHub Pages)

The game is published to GitHub Pages from the `gh-pages` branch, alongside
the frozen agent bake-off builds (see README):

```
https://weevilgenius.github.io/stumped-game/          main
https://weevilgenius.github.io/stumped-game/<agent>/  gemini, grok, fable, astra
```

All five apps, and any other project site under `weevilgenius.github.io`,
share one origin, which means:
- **localStorage is shared.** Main uses the key prefix `stumped-main.`
  (`STORAGE_PREFIX` in `src/index.ts`) and must not
  reuse the agent keys (`stumped_*`, `stumped-save-v1`, `stumped.game`,
  `stumped.settings`, `stumped.v1`, etc.), even when porting code from an agent
  branch, or saves will clobber each other. Never call `localStorage.clear()`
  or iterate over all keys.
- **Cache Storage is shared.** Main's service worker (emitted by
  `vite.config.ts` in production builds) names its caches with the prefix
  `stumped-main-`. It must keep a unique prefix (the agents use `stumped-grok-`, `stumped-fable-`, and
  `stumped-astra-`),
  only delete caches with that prefix, and only read from its own cache (open
  it by name; do not use the global `caches.match`).
- **Main's service worker scope contains the agent folders.** Agent pages with
  their own service worker are controlled by it, but gemini has none, so
  main's worker controls gemini's pages too. Its fetch handler should answer
  only from its own cache and otherwise fall through to the network.

## Source Layout

Main is built from the Fable bake-off implementation (step 1 of the
consolidation plan in `docs/summary.md`).

- `src/engine/` - pure puzzle generator, solver, and seed codes (see its README)
- `src/game.ts` - plain-JSON game model: marks, undo, hints, explanations
- `src/puzzleScene.ts` - Phaser scene: board drawing, gestures, animations
- `src/controller.ts` - app controller: storage, puzzle prefetch, navigation,
  play-time clock, win recording (injected dependencies, unit tested)
- `src/index.ts` - DOM screens, localStorage adapter, generator worker, service
  worker registration
- `src/worker.ts` - generates puzzles off the main thread

`src/engine/fixtures.test.ts` records the puzzles that fixed seed codes build.
Never update its snapshot to make it pass: if a change alters the board an
existing code produces, bump `GENERATOR_VERSION` instead.

## Visual Validation (Screenshots / Prints)

To inspect the rendered UI (light/dark mode, mobile layout, general layout),
capture a screenshot and view the resulting PNG. To inspect print layout,
capture a print-formatted PDF or PNG. Uses Playwright (Chromium). If a dev
server is already running it is reused; otherwise a temporary one is started
for the capture and stopped afterwards.

- Capture a screenshot: `pnpm screenshot [options]`
  - `--path <p>` route to capture (default `/`)
  - `--out <file>` output path (default `screenshots/screenshot.png`, or
    `screenshots/screenshot.pdf` with `--print` unless `--png` is set)
  - `--theme <light|dark>` color scheme (default `light`)
  - `--device <name>` Playwright device, e.g. `"iPhone 15"`, `"Pixel 7"`
  - `--width <n>` / `--height <n>` viewport size (ignored with `--device`)
  - `--full-page` capture the full scrollable page
  - `--print` output a US Letter print-formatted PDF instead of a PNG
  - `--png` output a PNG when used with `--print`
  - `--pages <range>` PDF page ranges, e.g. `"1-5, 8"` (requires `--print`)
  - `--wait <selector>` wait for a CSS selector before capturing
  - `--until <js>` wait until a JavaScript expression is truthy, e.g.
    `"window.stumped"` (the puzzle scene, exposed in dev once a puzzle is open)
  - `--eval <js>` run JavaScript in the page before capturing, to put the app
    in the state to capture; a returned promise is awaited
  - `--delay <ms>` extra settle delay before capturing
  - `--url <base>` target an explicit base URL (disables auto-start)

  Examples:
  ```sh
  pnpm screenshot --theme dark --out screenshots/dark.png
  pnpm screenshot --device "iPhone 15" --out screenshots/mobile.png
  pnpm screenshot --print --pages "1-2,4" --out screenshots/print.pdf
  pnpm screenshot --print --png --out screenshots/print.png
  # A puzzle from its seed code, with the owl hint open:
  pnpm screenshot --device "iPhone 15" --path "/?code=1D580000048" \
    --until "window.stumped" --eval "stumped.useHint('owl')" --out screenshots/owl.png
  ```

  Output goes to `screenshots/` (gitignored). After capturing, read the PNG or
  PDF to inspect the layout. For this game, prefer tests with the following devices:

  - "Desktop Chrome HiDPI"
  - "Pixel 10 Pro"
  - "iPad 11 Pro landscape"

### End-to-end tests

Functional Playwright tests live in `e2e/*.e2e.ts` (separate from the Vitest
unit tests in `tests/`) and run on desktop + mobile viewports. They assert
behaviour/structure, not pixels, so they are stable across platforms and need
no committed baseline images. For visual checks, use `pnpm screenshot` above.

- Run e2e tests: `pnpm test:e2e`
- `e2e/offline.e2e.ts` runs against the production build, because only that
  has the service worker. The other tests run against the dev server, where the
  puzzle scene is exposed as `window.stumped` so tests can find squares and
  buttons on the canvas.
- Interactive UI mode: `pnpm test:e2e:ui`

## Coding Conventions

- **Types & Interfaces**: PascalCase
- **Variables & Functions**: camelCase
- **Constants**: UPPER_SNAKE_CASE

### TypeScript Patterns

- **Use `interface`** for object shapes, especially extensible ones
- **Use `type`** for type aliases, unions, and tuples
- **Avoid enums** - prefer string literal unions with constants for type safety without runtime overhead
- **Use discriminated unions** with a `type` property for variant types
- **Import types separately** using `import type { ... }` for type-only imports

### Documentation

- **JSDoc required** on all exported interfaces, types, and functions
- **JSDoc encouraged** on complex internal functions and non-obvious logic
- **Property documentation** - use JSDoc `/** description */` above each interface property
- **Section headers** - use visual comment blocks for major sections in long files
  ```ts
  /* ========================================================= *\
   *  Half-edge data model                                     *
  \* ========================================================= */
  ```

### Function Declarations

- **Arrow functions** for internal/helper functions and factory functions. Lint rules
  require parens for all arrow functions.
- **Function keyword** for exported utility functions

### General Style

- **Avoid emoji** in code (comments, strings, etc.) unless explicitly required by the domain
- **Explicit return types** on exported functions
- **Readonly where appropriate** - use `readonly` modifier for immutable arrays/tuples
- **Callback naming** - use `on<Event>` pattern for callbacks (`onChange`, `onPuzzleChanged`)
- **Optional chaining** - prefer `?.` for potentially null/undefined values, enforced by lint rule
- **Nullish coalescing** - prefer `??` over `||` when dealing with null/undefined, enforced by lint rule

## Phaser 4 agent skills

Use the bundled guides in `node_modules/phaser/skills/` for Phaser work:

- Read the relevant `SKILL.md` below before implementing or debugging a subsystem.
  Follow its related-skill links and read `references/REFERENCE.md` where present
  for additional APIs, patterns, gotchas, and source maps.
- Use idiomatic Phaser 4 APIs. Read **v4 new features** for rendering work and
  **v3 to v4 migration** when adapting Phaser 3 examples or encountering old APIs.
- Check exact signatures and behavior against the installed
  [types](./node_modules/phaser/types/phaser.d.ts) and
  [source](./node_modules/phaser/src/) if guidance conflicts. These docs track the
  installed dependency; check its [version](./node_modules/phaser/package.json)
  and rescan the skills folder after upgrades. Run `pnpm install` if it is missing.

### Setup, lifecycle, and state

| Skill | Use for |
| --- | --- |
| [Game setup and config](./node_modules/phaser/skills/game-setup-and-config/SKILL.md) | GameConfig, renderer/canvas setup, scaling, FPS, boot. |
| [Scenes](./node_modules/phaser/skills/scenes/SKILL.md) | Lifecycle, transitions, parallel scenes, pause/restart, communication. |
| [Loading assets](./node_modules/phaser/skills/loading-assets/SKILL.md) | Images, atlases, audio, JSON, fonts, loading progress and caches. |
| [Scale and responsive](./node_modules/phaser/skills/scale-and-responsive/SKILL.md) | Scale modes, centering, resizing, orientation, fullscreen. |
| [Input: keyboard, mouse, touch](./node_modules/phaser/skills/input-keyboard-mouse-touch/SKILL.md) | Interactive objects, hit areas, pointers, dragging, keyboard, touch, gamepads. |
| [Data manager](./node_modules/phaser/skills/data-manager/SKILL.md) | Object/scene data, global registry, change events. |
| [Events system](./node_modules/phaser/skills/events-system/SKILL.md) | Emitters, scene/game/custom events, listener cleanup. |
| [Time and timers](./node_modules/phaser/skills/time-and-timers/SKILL.md) | Delays, loops, timelines, pausing, time scaling. |

### Game objects and presentation

| Skill | Use for |
| --- | --- |
| [Sprites and images](./node_modules/phaser/skills/sprites-and-images/SKILL.md) | Sprite/Image creation, textures, transforms; NineSlice, TileSprite, Video. |
| [Game object components](./node_modules/phaser/skills/game-object-components/SKILL.md) | Shared transforms, bounds, tint, depth, masks, lighting. |
| [Graphics and shapes](./node_modules/phaser/skills/graphics-and-shapes/SKILL.md) | Lines, shapes, fills/strokes, gradients, generated textures. |
| [Text and BitmapText](./node_modules/phaser/skills/text-and-bitmaptext/SKILL.md) | Fonts, styling, wrapping, alignment, dynamic text, bitmap fonts. |
| [Groups and containers](./node_modules/phaser/skills/groups-and-containers/SKILL.md) | Object organization, pooling, batch operations, nested transforms. |
| [Animations](./node_modules/phaser/skills/animations/SKILL.md) | Sprite frames, spritesheets/atlases, playback, chaining, events. |
| [Tweens](./node_modules/phaser/skills/tweens/SKILL.md) | Property animation, easing, stagger, chains, yoyo/repeat, callbacks. |
| [Audio and sound](./node_modules/phaser/skills/audio-and-sound/SKILL.md) | Playback, music, volume, spatial audio, browser autoplay. |
| [Cameras](./node_modules/phaser/skills/cameras/SKILL.md) | Scroll, zoom, follow, bounds, viewports, effects, filters. |

### Rendering and Phaser 4 changes

| Skill | Use for |
| --- | --- |
| [v4 new features](./node_modules/phaser/skills/v4-new-features/SKILL.md) | RenderNodes, Filters, new game objects, GPU layers, Lighting, RenderSteps. |
| [v3 to v4 migration](./node_modules/phaser/skills/v3-to-v4-migration/SKILL.md) | Breaking changes, removed APIs, renderer/FX/mask changes, checklist. |
| [Filters and post-processing](./node_modules/phaser/skills/filters-and-postfx/SKILL.md) | Bloom, blur, glow, color effects, distortion, custom shaders. |
| [Render textures](./node_modules/phaser/skills/render-textures/SKILL.md) | Offscreen drawing, DynamicTexture, stamps, capture, snapshots. |
| [Particles](./node_modules/phaser/skills/particles/SKILL.md) | Emitters, emission/death zones, particle properties and motion. |

### Physics, maps, math, and utilities

| Skill | Use for |
| --- | --- |
| [Arcade physics](./node_modules/phaser/skills/physics-arcade/SKILL.md) | Bodies, movement, gravity, collisions/overlap, physics groups. |
| [Matter physics](./node_modules/phaser/skills/physics-matter/SKILL.md) | Rigid/compound bodies, constraints, sensors, collision filtering. |
| [Tilemaps](./node_modules/phaser/skills/tilemaps/SKILL.md) | Tiled/CSV/array maps, tilesets, CPU/GPU layers, tile collisions and queries. |
| [Geometry and math](./node_modules/phaser/skills/geometry-and-math/SKILL.md) | Vectors, shapes, distances, angles, randomness, interpolation, snapping. |
| [Curves and paths](./node_modules/phaser/skills/curves-and-paths/SKILL.md) | Curves, path sampling/drawing, PathFollower. |
| [Actions and utilities](./node_modules/phaser/skills/actions-and-utilities/SKILL.md) | Batch operations, grid layout, alignment, array/object/string helpers. |

## Important Notes

- The package manager is **pnpm** (version pinned via `packageManager` field)
- TypeScript strict mode is enabled
- ESLint is configured with `@stylistic/eslint-plugin` for code style
- Some pre-made sprites are in `src/assets`
