# Stumped

A woodland logic puzzle built with Phaser 4 and the local deduction engine.
Find one stump in every row, column, and colored patch; stumps cannot touch.
No accounts, ads, sound, or network services.

## Run

```sh
pnpm install
pnpm dev --host 127.0.0.1 --port 5178 --strictPort
```

Tap or drag to mark/erase Xs; double tap to reveal. Keyboard users can tab to
the board, move with arrow keys, mark with Space, and reveal with Enter.
Hypothesis mode has its own scratch marks and undo history. Its Keep button
keeps only Xs. Each woodland helper can be used once per puzzle.

Progress, preferences, played codes, and every completed time are stored in
`localStorage` under `stumped.v1`. Back pauses the timer; returning to the app
restores an unfinished puzzle. Background time does not count. Seed links use
`?code=205000002ME` and are independent of device preferences.

## Verify

```sh
pnpm run check
pnpm run build
pnpm run test:e2e
pnpm run screenshot --code 205000002ME --device "iPhone 15" --out screenshots/phone.png
pnpm run screenshot --code 205000002ME --device "iPhone 15" --landscape --out screenshots/landscape.png
pnpm run screenshot --code 205000002ME --theme dark --click '#hint-explain' --out screenshots/owl.png
```

The browser suite covers desktop and phone input, complete solves, loss/retry,
separate undo layers, saved explanations, settings, resizing, and offline
production reloads. It uses ports 5178 (development) and 4178 (production).
The screenshot utility can restore a saved JSON fixture with `--storage`,
perform repeated `--click` actions, and fails on browser JavaScript errors.

## Offline

```sh
pnpm run build
pnpm run preview --host 127.0.0.1 --port 4178 --strictPort
```

Serve `dist/` over HTTPS (localhost also works). The production service worker
precaches the app, worker, and images. Once the home screen says “Ready for
offline play,” it can be installed to the home screen and used without a
connection. Updates activate after existing app tabs close. Development mode
does not register a service worker.

The game code lives in `src/game/`, with native accessible controls in
`src/index.ts`. The engine API is documented in [src/engine/README.md](src/engine/README.md).
Generator version 2 fixes palette selection to the first N colors for size N;
version 1 seed codes are rejected rather than silently producing different colors.
