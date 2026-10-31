# Stumped Adventure — Engine & Simulation Design

**Status:** Draft v0.3
**Scope:** Game engine, integration contracts, empirical resource model, simulation, and testing
**Out of scope:** Final game theme, artwork, story, equipment catalog, and numerical balancing

## 1. Overview

Stumped Adventure is an optional roguelike whose actions are powered by colored resources collected while solving Stumped puzzles.

The adventure engine is independent of the puzzle engine. It receives turns, resource collections, equipment commands, and player decisions, and produces state changes and events describing their consequences.

The same engine runs in two environments:

- **Interactive game:** Stumped supplies real player actions, and the UI displays the resulting adventure.
- **Simulator:** A testing harness supplies generated or recorded actions, allowing thousands of encounters and complete adventures to run without a UI.

Both use identical rules, equipment definitions, encounters, and random-number generation.

### Stumped terms used here

| Term | In the code |
|---|---|
| Stump | The one piece per row, column, and region (`puzzle.solution`). |
| Reveal | A double tap in normal play (`doubleTap()` in `src/game.ts`). A wrong reveal leaves a red X and costs an acorn. |
| Acorns | Puzzle lives: 3, or 1 in silver acorn mode. At 0 the puzzle is lost (`status: 'lost'`). |
| Region / color patch | `puzzle.regions[cell]`; its palette index is `puzzle.colors[region]`. |
| Tier | Logical difficulty: `'easy' \| 'medium' \| 'hard'`. Sizes are 5 to 10. |
| Freebie | A stump revealed at the start (`puzzle.givens`) or a one-square region. |
| Hints | Woodpecker (reveals a stump), Owl (explains the next deduction, and may reveal a forced stump), Squirrel (places X's). Each once per puzzle. |
| What if? | Hypothesis mode (`game.hypo`). Double taps place tentative stumps; nothing is revealed and hints are disabled. |
| Seed code | 11 characters that rebuild a puzzle exactly (`decodeSeedCode()` then `generate()`). |

### Design goals

- Deterministic and replayable game state.
- No dependency on puzzle rules or rendering.
- Minimal additional interaction during puzzles.
- Support for combat and noncombat encounters.
- Encounters independent of puzzle boundaries.
- Data-driven equipment, abilities, and encounters.
- Automated balancing using realistic collection sequences.
- Rare but achievable adventure victories, without reliance on permanent power progression.

## 2. Time and resource model

Three concepts must remain distinct.

| Concept | Definition |
|---|---|
| **Turn** | One tactical time step, initiated by the host game. |
| **Collect** | An optional resource pulse associated with a turn, containing a color and strength. |
| **Round** | A bounded group of turns, corresponding to one Stumped puzzle. |

An encounter can occupy part of a round or continue across multiple rounds. A round always runs to completion independently of the adventure's encounter state.

### Turn rules

Each turn:

1. Advances the tactical clock.
2. May produce one colored resource pulse.
3. Routes that pulse to the first eligible, readied equipment item or ability.
4. Applies its effect immediately.
5. Advances enemies, hazards, cooldowns, and other scheduled effects.

A turn without a collection still advances tactical time.

The order of player and enemy effects must be explicit. Initially, the collected pulse resolves before any enemy action due on that turn.

### Collect rules

A collection has:

- `color`: The region's palette index (see section 6, Color identity).
- `amount`: A positive integer, the number of squares in the region.

Amounts range from 1 (a one-square freebie region) up to most of the board: the sample's largest region is 65 squares on a 10×10. Generated regions otherwise have at least 2 squares.

A pulse is consumed by at most one item or ability. If nothing eligible accepts it, the pulse is discarded.

There is no general-purpose resource bank.

Specific abilities may store a pulse, accumulate progress, or create a persistent charge. These are explicit game mechanics, not exceptions implemented in the host game.

### Round rules

Each round supplies a finite set of possible collections: one per region.

At its end:

- Per-round equipment uses and cooldowns reset according to their definitions.
- Most temporary charges expire.
- The current encounter may remain active.
- Persistent health, inventory, currency, encounter progress, and world state remain.
- Between-round navigation, preparation, and event choices become available.

A round ends in one of three ways:

- **Completed:** every stump revealed (`status: 'won'`).
- **Failed:** the acorns ran out (`status: 'lost'`). Stumped stops the puzzle here, so "the puzzle always continues to completion" cannot hold for a lost puzzle; see section 16.
- **Abandoned:** the player starts a different puzzle while this one is in progress. Leaving for the menu does not abandon a puzzle; it resumes later.

### Prefilled collections

Some Stumped puzzles contain a stump already revealed when the puzzle begins (`puzzle.givens`, recorded with `found_by=given` at time 0).

These are included in the round's resource manifest but are not player-initiated turns.

The default assumption is that prefilled stumps do not activate adventure abilities or advance tactical time. Any alternate behavior must be an explicit rule.

A one-square region is the other kind of freebie. Its stump is not prefilled: the player reveals it like any other, producing a 1-unit pulse.

## 3. High-level architecture

The system has four main components.

### A. Adventure Engine

A deterministic state machine that implements the game rules.

Responsibilities:

- Character and equipment state.
- Pulse routing and ability resolution.
- Combat, hazards, and status effects.
- Noncombat encounter progress.
- Inventory, currency, and loot.
- Encounter and world progression.
- Adventure victory and death.

It does not know how a turn was generated. Like `src/engine/`, it is plain TypeScript with no Phaser or DOM imports, enforced by the same `no-restricted-imports` lint rule.

### B. Stumped Adapter

Connects Stumped's existing puzzle mechanics to the adventure engine.

Responsibilities:

- Map a correct reveal to a turn with a collection.
- Map a wrong reveal to a turn without a collection.
- Report hint reveals (Woodpecker, or an Owl forced stump) with their source, so the engine applies whatever rule section 16 settles on.
- Build the round manifest from the `Puzzle`: each region's palette index and size, and which are givens.
- Notify the engine when a round finishes, fails, or is abandoned.
- Request puzzles for the adventure's size and tier.

X marks, undo, and What if? never reveal anything, so they need no filtering.

Stumped remains responsible for puzzle validity, acorns, generation, and completion.

**Where it lives:** the controller (`src/controller.ts`), which already owns saving, puzzle preparation, and win recording, and is unit tested with injected dependencies. The puzzle scene calls `controller.changed()` after every change to the game. The adapter compares the game with the round state it last saw: a new stump on the board is a correct reveal (a new entry in `game.hints` says it came from a hint), and a higher `acornsLost` is a wrong reveal. This needs no changes to `src/puzzleScene.ts` and does not depend on the `VITE_COLLECT_SOLVE_DATA` build flag, which only gates the solve log.

The same comparison reconciles after a reload: the game and the adventure are saved under separate keys (section 5), so on launch the adapter replays any reveals the adventure state has not seen yet.

**Puzzle requests:** the controller prepares the next puzzle ahead of time in the generator worker (`prepare()`). An adventure fixes size and tier, and `silver` unless the adventure turns it on, so its requests go through the same path with fixed settings.

### C. Adventure Presenter

Converts engine state and events into user-visible behavior.

Responsibilities:

- Ambient animation strip.
- Equipment readiness controls.
- Health, cooldown, and encounter indicators.
- Maps, inventory, shops, and choices.
- Animation sequencing and sound.

The strip and readiness controls sit beside the board, so they belong in the Phaser puzzle scene (`src/puzzleScene.ts`), which already lays out the board and its buttons for phone, tablet, and desktop. Between-round screens (map, shop, inventory) are DOM screens like the menu in `src/index.ts`. Sounds go through `src/sound.ts`.

Animations never determine game outcomes. The engine resolves actions immediately; the presenter may queue, shorten, or skip animations without changing state. The scene already holds input briefly after a wrong reveal (`busyUntil`); adventure animations must never extend that hold.

### D. Simulation Harness

Runs the engine without Stumped or a graphical interface.

Responsibilities:

- Supply scripted, synthetic, or recorded turn sequences.
- Simulate equipment and adventure decisions.
- Generate encounters and loot.
- Execute batches of complete runs.
- Collect statistics and compare configurations.
- Reproduce and debug particular outcomes.

It can also import `src/engine/` to rebuild recorded puzzles from their seed codes and ask the solver which stumps are deducible (section 11.7).

## 4. Engine API

The initial implementation should expose a small, synchronous API.

Conceptually:

```ts
function step(
  state: AdventureState,
  command: AdventureCommand
): EngineResult;

interface EngineResult {
  state: AdventureState;
  events: AdventureEvent[];
}
```

`step` is a deterministic state transition. Given the same initial state, command sequence, configuration, and random seed, it must produce the same outcomes.

State is plain JSON, like `Game` in `src/game.ts`, so saving it is `JSON.stringify`. That includes the random generator: the repo's `mulberry32()` (`src/utils/mulberry.ts`) keeps its state in a closure, so the engine needs a variant that takes and returns its single 32-bit state. Independent streams (encounters, loot, and so on) can each hold their own state, seeded from the run seed.

### Commands

| Command | Purpose |
|---|---|
| `start-run` | Begin an adventure with a character and difficulty configuration. |
| `begin-round` | Supply the next round's resource manifest. |
| `turn` | Advance one tactical turn, optionally collecting energy. |
| `set-ready` | Ready or unready an equipment slot. |
| `set-priority` | Change equipment routing priority, if allowed. |
| `equip` / `unequip` | Modify the character's loadout. |
| `choose` | Select an encounter, navigation, or narrative option. |
| `use-item` | Consume an inventory item outside normal pulse routing. |
| `end-round` | Finish the current round and resolve boundary effects. |

Commands are validated against the current game phase. Invalid commands do not partially mutate state.

### Core TypeScript contracts

Following the repo conventions: `interface` for shapes, `type` for unions, string literal unions rather than enums, and discriminated unions on `type`.

```ts
/** Palette index of a region's color, 0 to size - 1. */
type ColorId = number;

/** Where a collection came from. Mirrors `FoundBy` in src/game.ts, minus 'given'. */
type CollectSource = 'player' | 'woodpecker' | 'owl';

interface Collection {
  /** Palette index of the region. */
  color: ColorId;
  /** Squares in the region. */
  amount: number;
}

interface RoundManifest {
  /** Identifier of the play (`game.id`), so a reload can match the round to its puzzle. */
  id: string;
  /** Puzzle size, which fixes the colors present (section 6). */
  size: number;
  /** Puzzle tier. */
  tier: Tier;
  /** One entry per region. */
  collections: Collection[];
  /** Colors whose stumps are prefilled. They are never collected by a turn. */
  givenColors: ColorId[];
}

type AdventureCommand =
  | {
      type: 'begin-round';
      round: RoundManifest;
    }
  | {
      type: 'turn';
      collect?: Collection;
      /** Defaults to 'player'. */
      source?: CollectSource;
    }
  | {
      type: 'set-ready';
      slot: number;
      ready: boolean;
    }
  | {
      type: 'set-priority';
      slots: number[];
    }
  | {
      type: 'choose';
      choiceId: string;
    }
  | {
      type: 'end-round';
      outcome: 'completed' | 'failed' | 'abandoned';
    };
```

The remaining commands will have their own typed payloads.

A `turn` and its optional `collect` are **one atomic input**, not two independently submitted commands. This prevents ambiguity about whether an enemy acts before or after a collection.

A round manifest describes the resources potentially available during the round, but not their collection order.

The adapter builds the manifest from the puzzle: for each region `r`, `{ color: puzzle.colors[r], amount }` where `amount` counts the cells with `puzzle.regions[cell] === r`, which is what `solveOf()` in `src/solves.ts` already computes as `patch`. Every color appears exactly once, because each region holds exactly one stump. The engine rejects a collection of a color that is absent, already collected, or given.

## 5. Game state

State is divided according to lifetime.

### Persistent metagame state

Survives between adventure runs:

- Unlocked playable characters.
- Completed adventure records.
- Previous deaths and historical world markers.
- Discovered lore or other non-power progression.
- Player preferences.

### Run state

Exists for one adventure:

- Character, health, and status.
- Equipment and inventory.
- Currency, supplies, and other persistent resources.
- World position, explored locations, and objectives.
- Current encounter.
- Random generator state.
- Run statistics.

### Round state

Exists for one puzzle:

- Round manifest.
- Tactical turn counter.
- Collections already consumed, and acorns lost seen so far, for the adapter's comparison.
- Equipment uses remaining.
- Active cooldowns.
- Charges and temporary effects.
- Current activity or encounter phase.

### Encounter state

May outlive the current round:

- Encounter type and participants.
- Enemy health, intent, and status.
- Scheduled attacks or hazards.
- Progress toward objectives.
- Deposited resources or completed stages.
- Available choices and outcomes.

An encounter may be in combat, exploration, recovery, negotiation, or another activity phase.

For example, killing an enemy can transition the active encounter into a recovery or scavenging phase without ending the round.

Run death or victory is terminal for the adventure, but does not interrupt the host puzzle. Starting another run occurs at an appropriate round boundary.

### Storage

Saves go through the controller's `storage` dependency, which adds the `stumped-main.` prefix in `src/index.ts`. That prefix must not change.

- Adventure state gets its own keys (for example `adventure` for the run and `adventure-meta` for the metagame), the way the solve log uses `solves`. Older versions of the game rewrite the whole `save` key and would drop fields they don't know.
- An unreadable save is kept as a recovery copy rather than overwritten, as `createController()` does for `save` and `solves`.
- `src/index.ts` stops a tab from saving once another tab writes `save` (`savedElsewhere()`). The adventure keys need the same guard, or two tabs could each advance the run.

## 6. Equipment and ability system

Equipment and abilities share a common activation model. They may eventually occupy generic or specialized slots; the slot configuration remains adjustable.

A useful initial assumption is four generic slots with ordered priority.

Each equipped item has:

- Definition ID and slot.
- Ready/unready state.
- Priority.
- Accepted colors.
- Current charge state.
- Cooldown or next eligible turn.
- Remaining uses, if limited.
- Active modifiers, including curses or forced readiness.

### Color identity

Two facts from the puzzle generator shape the whole color economy:

- **A board's colors are fixed by its size.** A board of size N always uses palette indexes 0 to N - 1, assigned to regions in random order (`generator.ts`; the palette is in priority order). Every 7×7 board has colors 0 to 6; only the amounts and which region gets which color vary. Color 9 exists only on 10×10 boards, so equipment needing it is dead on smaller adventures, and a 5×5 adventure has just five colors. Since the adventure difficulty fixes the size, it also fixes which colors exist.
- **Hues depend on the theme.** Each theme in `src/theme.ts` has its own palette: index 0 is yellow in Woods and orange in Vallarta. Equipment is defined by palette index, never by hue name, and draws its color swatch from the active theme. A "yellow dagger" is a presentation choice, not an engine fact. If the adventure gets its own visual theme, it is a new entry in `THEME_NAMES` with its own palette.
- **Colors can be reassigned after generation.** Which region gets which color has no effect on the puzzle's logic, so the adventure may permute `puzzle.colors` before play as a difficulty lever. For example, it can give a rare or powerful color to a small region so it stays low in number, or a common one to the largest region. This is optional, not a requirement. The seed code alone no longer reproduces the colors, so the permutation must be saved with the round (the saved `Game` already keeps the whole `Puzzle`). Recorded traces then reflect the permuted colors.

### Pulse routing

On a turn containing a collection:

1. Inspect equipped items in priority order.
2. Skip items that are unready, incompatible, cooling down, or out of uses.
3. Select the first eligible item.
4. Apply its collection behavior.
5. Consume the pulse.
6. If no item qualifies, discard the pulse.

An item may charge, attack, defend, heal, deposit energy into an encounter, generate currency, or produce another defined effect.

Readiness persists until changed or overridden by a game effect.

Passing is accomplished by leaving all compatible items unready or ineligible.

### Ability definitions

Definitions should be data-driven wherever practical.

Representative properties include:

| Property | Purpose |
|---|---|
| `acceptedColors` | Palette indexes that can activate or charge the ability |
| `scaling` | Converts pulse strength into effect magnitude |
| `cooldown` | Required turns between activations |
| `usesPerRound` | Maximum activations within a round |
| `chargeRecipe` | Required colors, order, and minimum strengths |
| `chargeLifetime` | When an incomplete charge expires |
| `effects` | Damage, block, healing, progress, resources, statuses, etc. |
| `conditions` | Additional activation requirements |
| `tags` | Combat, magic, utility, persuasion, traversal, and so forth |

Common effects should use reusable handlers rather than bespoke code for every item.

Special items can use custom, deterministic effect handlers where necessary.

### Balancing principles

- Single-color abilities are naturally limited to one collection per round.
- Multi-color abilities may require charging over several turns.
- Flexible abilities may need cooldowns or use limits.
- Small pulses should have useful potential, especially for setup and incremental effects. A 1-unit pulse is possible.
- Large pulses may produce stronger effects, often with diminishing returns.
- Loot should expand color coverage and tactical choices, within the colors the adventure's board size offers.
- Equipment slot limits should make loadout decisions consequential.

Equipment may also unlock alternative encounter choices without directly consuming a pulse.

## 7. Encounter system

Encounters should be data-driven and use shared mechanics rather than separate minigames.

### Common encounter mechanics

- **Progress:** Accumulate work toward a goal.
- **Threshold:** Apply a pulse meeting a minimum strength.
- **Sequence:** Supply specific colors in a required order.
- **Charge:** Prepare an action using multiple collections.
- **Deadline:** Complete an objective before a scheduled event.
- **Attrition:** Balance progress against health, fatigue, or other costs.
- **Choice:** Resolve a situation through alternative strategies.
- **Combat:** Damage, defense, enemy intent, and status effects.

An encounter may combine several mechanics.

### Encounter definitions

An encounter definition includes:

- Eligibility and difficulty tier.
- Initial state and participants.
- Available activities and objectives.
- Accepted pulse-driven effects.
- Timed or conditional events.
- Victory, failure, and partial-success conditions.
- Rewards, penalties, and possible follow-up encounters.
- Optional choices unlocked by equipment, character abilities, or world state.

### Telegraphs

The engine maintains a schedule of upcoming threats and opportunities.

Examples include an enemy attack in three turns, a collapsing passage in five turns, or a temporary vulnerability lasting two turns.

The presenter exposes appropriate information without changing the underlying schedule.

### Encounter boundaries

An encounter is not required to finish within one round.

- Early victory may unlock recovery, exploration, or resource collection for the remaining turns.
- Unfinished encounters carry over to the next round.
- Most world navigation and major decisions happen between rounds.
- Equipment adjustments, fleeing, and consumable use may remain available during ongoing encounters.
- Encounter outcomes can alter persistent world state.

The engine must prevent unlimited farming through repeated safe rounds. Reward generation, local resources, and recovery opportunities are governed by encounter and location rules.

## 8. Engine outputs

Each command returns updated state and an ordered collection of semantic events.

Representative events include:

| Event | Meaning |
|---|---|
| `turn-started` | Tactical time advances |
| `collected` | A colored pulse becomes available |
| `pulse-routed` | An item receives the pulse |
| `pulse-discarded` | No eligible item consumed it |
| `ability-charged` | An ability stores progress toward activation |
| `ability-activated` | An ability produces an effect |
| `damage-applied` | Health or another damageable resource changes |
| `status-changed` | A buff, curse, or other status changes |
| `enemy-acted` | An enemy executes a scheduled behavior |
| `objective-progressed` | A noncombat goal advances |
| `resource-changed` | Gold, supplies, or another resource changes |
| `equipment-changed` | Loot, equipment, or readiness changes |
| `encounter-transitioned` | The encounter changes phase or ends |
| `choices-available` | New decisions become possible |
| `round-ended` | A round boundary resolves |
| `run-ended` | The adventure ends in victory or death |

Events contain identifiers, values, and other relevant data, not rendering instructions.

For example, `ability-activated` might identify the Fireball ability and the amount of damage dealt. The presenter decides how to animate it.

### Output consumers

**Adventure UI:** Displays current state and available controls.

**Animation system:** Translates semantic events into visual sequences.

**Event log:** Records notable occurrences for replay, debugging, and possible in-game history.

**Simulator:** Extracts measurements and evaluates outcomes.

Animation playback must never block or reorder engine state changes. Rapid player inputs may generate events faster than they can be displayed.

## 9. Adventure progression

An adventure run alternates between rounds and between-round decisions.

### Between-round phase

The player may:

- Choose a route or destination.
- Review the map and encounter.
- Rearrange equipment and readiness.
- Visit a shop or use consumables.
- Resolve narrative events.
- Continue, retreat from, or otherwise respond to an unfinished encounter.

Some actions are free preparation; others consume resources or incur consequences.

### Round phase

The host provides a round manifest compatible with the selected adventure difficulty.

During the round, each turn is resolved immediately through the equipped abilities and current encounter.

After the round, the engine processes boundary effects and returns to the between-round phase.

### Run completion

A run may end through:

- Achieving the adventure's victory condition.
- Character death.
- Another explicit terminal failure condition.
- Voluntary abandonment.

A new run begins with the selected character's normal starting capabilities.

Permanent unlocks should primarily add characters with different abilities and tradeoffs, rather than steadily increasing starting power.

Historical world state may carry forward independently of run-specific resources.

---

## 10. Empirical collection behavior

The resource economy should be modeled using observed Stumped play rather than assuming that colors or pulse strengths arrive in random order.

The initial dataset is `tests/sample-games.csv`: 100 won puzzles played by an experienced player, exported from the game's solve log. It spans sizes 5×5 through 10×10 and all three tiers.

How it was recorded:

- A build with `VITE_COLLECT_SOLVE_DATA=true` keeps the order of every stump found (`game.found`) and adds each win to the solve log (`src/solves.ts`). `solvesCsv()` writes one row per stump.
- Only wins are logged. Lost or abandoned puzzles are absent.
- Times are play time, which pauses while the page is hidden, in tenths of a second.
- All 100 were played in the Vallarta theme, with no hints and no repeats. 12 were silver acorn puzzles, 2 lost an acorn, and 4 boards had a one-square region.
- The sample has 777 stumps: 5 given and 772 found by the player.

| Size | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---:|---:|---:|---:|---:|---:|
| Games | 8 | 17 | 19 | 16 | 26 | 14 |

Every seed code in the sample still rebuilds its exact board with the current generator (version 2): same stump squares, palette indexes, and region sizes for all 100. The simulator can therefore use the full boards, not just the recorded collections.

### 10.1 Main findings

The player's hypothesis was that small regions tend to be collected early, while larger regions become accessible later.

The data supports this, particularly on easy and medium puzzles.

| Measurement | Observed result |
|---|---:|
| Games analyzed | 100 |
| Player collections | 772 |
| Median first collection | 3.5 units |
| Median last collection | 8 units |
| First collections of 4 units or fewer | 67% |
| Games where last collection exceeds first | 70% |
| Games with largest region among last three collections (ties count) | 64% |
| Largest observed region | 65 units |

These are descriptive measurements from one player's sample, not universal probabilities.

### 10.2 Differences by logical difficulty

| Difficulty | Games | Median first collection | Median last collection |
|---|---:|---:|---:|
| Easy | 30 | 2 | 10 |
| Medium | 36 | 3.5 | 8 |
| Hard | 34 | 4 | 6 |

The early-small/late-large effect is strongest on easy puzzles.

Hard puzzles exhibit greater variability, including instances where substantial reasoning occurs before the player makes any collections.

### 10.3 Differences by board size

Larger boards show a particularly pronounced concentration of energy in later collections.

| Size | Energy in first three collections | Energy in last three collections |
|---|---:|---:|
| 8×8 | 22% | 50% |
| 9×9 | 18% | 52% |
| 10×10 | 20% | 42% |

These figures exclude prefilled collections. On boards of 7×7 and smaller the first and last three overlap or nearly cover the board, so the comparison says little there.

The same board's colors and region sizes would produce different tactical opportunities if collected in another order.

### 10.4 Important exceptions

The trend is probabilistic, not guaranteed.

Some puzzles produce a substantial early collection, including an observed first collection of 36 units.

Other puzzles finish with small collections after a large region has already been found.

The generator and adventure engine should preserve this variability. A lucky early large pulse should sometimes enable an exceptional attack or other dramatic result.

### 10.5 Timing and burst behavior

Some hard puzzles involve long periods of reasoning followed by a rapid sequence of collections.

In one recorded 8×8 hard puzzle, all eight collections occurred in approximately the final four seconds of a solve lasting more than nine minutes.

This has two consequences:

1. **Adventure time must remain turn-based.** Long thinking periods should not advance enemy attacks or encounter deadlines.
2. **Animations must tolerate bursts.** Several collections may arrive within a few seconds. Rendering must not delay or block Stumped input.

The presenter should support interruptible, compressed, or queued animations without changing engine outcomes.

### 10.6 Limitations

The initial sample represents one experienced player, over one evening, in one theme. Other family members may have different collection patterns.

The trace records when a stump was revealed, not when its location was first deduced. It therefore cannot directly measure deliberate withholding of known stumps. Because the boards can be rebuilt, the solver can estimate which stumps were deducible at each point, but not which ones the player had actually found.

Wrong reveals are not individually recorded. The `acorns_lost` count identifies the 2 affected games but not when their wrong turns happened.

X marks are not recorded, so the player's board state between reveals is unknown.

The first dataset is suitable for analyzing collection order and strength, but cannot exactly reconstruct every tactical turn in games containing wrong reveals.

### 10.7 Implications for game balance

These observations should influence, but not rigidly dictate, the economy.

- Starting equipment needs useful effects from 2–3-unit pulses.
- Charging, preparation, and incremental progress are natural uses for early collections.
- Large pulses often arrive late and can support finishing attacks or postcombat rewards.
- Purely linear scaling may produce extreme effects from unusually large regions.
- Enemy attack cadence must account for limited early offensive power.
- Encounters should sometimes be won quickly through exceptional early collections.
- Simulation should distinguish puzzle sizes and logical difficulties.
- Actual collection order must be preserved for baseline simulation.
- The generator's `sizeMix` setting (similar sizes up to one dominant region) directly shapes pulse strengths, so an adventure difficulty could fix it as well as size and tier.

**Balancing target:** The adventure should be viable under ordinary collection order, while allowing more deliberate ordering to provide a meaningful tactical advantage.

---

## 11. Simulation harness

The simulator depends on the adventure engine and the puzzle engine, not the other way around, and is never imported by the app.

Its primary purpose is to evaluate resource timing, equipment effectiveness, encounter difficulty, and overall adventure balance.

### 11.1 Input sources

**A. Scripted sequences**

Hand-authored scenarios with exact turn and collection order.

Useful for validating individual abilities, unusual encounters, and edge cases.

**B. Synthetic sequences**

Rounds built from real generated puzzles: `generate()` with chosen settings and seeds gives realistic region sizes for any size, tier, and size mix, so region sizes need not be invented. The collection order is then chosen by a model with configurable:

- Correlation between collection order and size.
- Use of the solver's deduction order (section 11.7).
- Wrong-turn probability and placement.
- Player decision policies.

Synthetic sequences should not assume uniformly random collection order unless intentionally testing that baseline. Generating a 10×10 board can take a second or more, so batch runs should cache generated puzzles by seed code.

**C. Recorded Stumped traces**

Real puzzle-solving sequences exported from the game and stored in the repository.

These are the preferred baseline for modeling realistic play.

The simulator should use the recordings directly rather than replacing them with an approximate statistical distribution.

### 11.2 Trace storage

Raw recordings are CSV exports from the game, kept unchanged with their original columns:

```text
tests/
  sample-games.csv    initial 100 solves
```

Later recordings go alongside it as additional files, named for their source (for example, per player). The importer converts them into a normalized representation. Future recordings can be added without changing the engine API.

### 11.3 Recorded trace schema

The columns are those written by `solvesCsv()` in `src/solves.ts`. Rows, columns, and colors count from 1.

| Field | Meaning |
|---|---|
| `solve` | Identifier of the play (a random UUID) |
| `date` | Completion time, ISO 8601 |
| `size` | Grid size, 5 to 10 |
| `difficulty` | Tier: `easy`, `medium`, or `hard` |
| `silver` | Silver acorn mode (one acorn) |
| `repeat` | The puzzle had been played before on this device |
| `theme` | Theme played in (`woods` or `vallarta`) |
| `hints` | Hints used, space separated (`woodpecker`, `owl`, `squirrel`); empty for none |
| `acorns_lost` | Wrong reveals |
| `total_seconds` | Play time to completion |
| `code` | Seed code, which rebuilds the puzzle |
| `order` | Order found, from 1, including givens |
| `row`, `col` | Stump square, from 1 |
| `color` | Palette index of its region, from 1 |
| `patch_size` | Squares in its region: the pulse strength |
| `found_seconds` | Play time when found |
| `found_by` | `player`, `given`, `woodpecker`, or `owl` |

The game also keeps the same data as JSON (the `Solve` type, validated by `parseSolves()`), so the importer can take either form.

A normalized model might look like:

```ts
interface RecordedCollection {
  /** Order found, from 1. */
  order: number;
  /** Palette index, from 0. */
  color: ColorId;
  /** Squares in the region. */
  amount: number;
  /** Stump square, `row * size + col`. */
  cell: number;
  /** Play time when found, in seconds. */
  atSeconds: number;
  /** How it was found. */
  source: FoundBy;
}

interface SolveTrace {
  /** Identifier of the play. */
  id: string;
  /** Recording it came from, such as the file name. */
  dataset: string;
  /** Seed code, to rebuild the puzzle. */
  code: string;
  size: number;
  tier: Tier;
  silver: boolean;
  totalSeconds: number;
  acornsLost: number;
  hints: Hint[];
  collections: RecordedCollection[];
}
```

`FoundBy`, `Hint`, and `Tier` are the existing types from `src/game.ts` and `src/engine/`. The normalized representation should retain enough metadata for statistical grouping while avoiding any requirement for the adventure engine to understand the puzzle.

### 11.4 Trace import and validation

The importer should group rows by solve identifier and validate:

- Exactly N stump entries per N×N solve (the log only records wins).
- N distinct palette indexes, 1 to N.
- Region sizes sum to N².
- Collection order is 1 to N with no gaps.
- Collection timestamps are nondecreasing.
- Puzzle metadata agrees across rows sharing an identifier.
- The seed code decodes and rebuilds a board whose stump squares, colors, and region sizes match the rows. All 100 sample codes do today. If `GENERATOR_VERSION` is bumped, old codes keep working only while the old generator is kept (see `src/engine/README.md`), and this check is what notices.
- Invalid or incomplete recordings are reported rather than silently repaired.

For a baseline simulation, only `found_by=player` entries generate collection turns. Given stumps appear in the round manifest but do not generate turns. Hint reveals follow the rule chosen in section 16; the sample has none.

### 11.5 Wrong reveals

The existing recordings do not locate wrong reveals within the turn sequence.

For initial tests:

- Use the 98 zero-loss recordings for exact successful-collection replay.
- Include all recordings in descriptive collection-order statistics.
- Model wrong turns synthetically when testing loss sensitivity.

To record them exactly, `reveal()` in `src/game.ts` can add wrong reveals to `game.found` as well (with a flag such as `wrong: true`), and `solvesCsv()` can write them as rows with a new column. This changes the solve log format, so `parseSolves()` must keep reading older logs.

### 11.6 Simulated player policies

Support several configurable policies.

| Policy | Behavior |
|---|---|
| **Passive** | Keep default equipment ready; make minimal tactical adjustments |
| **Reactive** | Adjust readiness in response to telegraphed threats |
| **Tactical** | Preserve valuable colors when possible; optimize equipment and encounters |
| **Oracle** | Assume advanced knowledge of collection opportunities and optimize ordering |

Policies can also vary equipment selection, risk tolerance, willingness to retreat, consumable use, and encounter choices.

An important distinction:

**The simulator must not grant a policy information it would not possess during real play.**

A player can observe the board's region colors and sizes, but may not know which stump locations are currently deducible.

Recorded collection order is therefore an external input, not evidence that every collection in that sequence was available at every earlier turn.

### 11.7 Fixed-order versus adaptive simulation

The first implementation should distinguish two kinds of simulation.

**Fixed-order simulation**

Replays real collection sequences while varying equipment, encounter parameters, and readiness policies.

This is useful for estimating the effectiveness of equipment under realistic collection timing.

However, the simulated player cannot influence the collection order.

**Adaptive-order simulation**

Allows a simulated player to choose which color to pursue next.

This requires a model of which stumps are deducible at each point. The puzzle engine provides one: rebuild the board from its seed code, mark the stumps revealed so far, and run the solver (`nextStep()`, `applyStep()`) to see which stumps it can place, and with which techniques. A policy may then choose only among stumps the solver can reach, optionally limited by technique tier to model a less thorough player.

This model is an assumption about the player, not a recording, so its results must be distinguished from real-trace replay. It can be checked against the sample: for each recorded reveal, was that stump within the solver's reach at that point, and how often did the player take the smallest reachable region?

An oracle with complete solution knowledge provides an upper-bound comparison rather than a realistic player model.

## 12. Simulation experiments

Before tuning individual weapons and enemies, the simulator should establish how much the observed collection order affects the adventure.

### Experiment A: Observed versus shuffled order

For each recorded puzzle:

1. Preserve its board size and difficulty.
2. Preserve each color and its associated region size.
3. Replay the original player collection order.
4. Generate alternative sequences by shuffling the color/amount pairs, and by following the solver's deduction order.
5. Run identical encounters and equipment configurations against each.
6. Compare outcomes across many random seeds.

This holds the resources available within the round constant while changing when they arrive.

Measurements should include:

- Damage dealt and received during early turns.
- Enemy survival time.
- Ability activation and resource waste.
- Successful multi-color charges.
- Recovery and economic opportunities after combat.
- Encounter and run success rates.

This experiment isolates the importance of ordering. A random shuffle is a counterfactual benchmark rather than a realistic alternative solving strategy; the solver's order is a plausible one.

### Experiment B: Equipment sensitivity to pulse timing

Test representative equipment archetypes against the real sequences:

- Single-color immediate attacks.
- Small-pulse-efficient weapons.
- High-scaling weapons.
- Multi-color charging abilities.
- Flexible any-color equipment with cooldowns.
- Defensive abilities and recovery equipment.

Measure effectiveness by board size, difficulty, and collection position.

A desirable outcome is meaningful tradeoffs rather than a universally dominant equipment type.

### Experiment C: Opening-turn survivability

Test enemies with different attack cadences against the first few collections of real traces.

Evaluate:

- How often characters have a useful action before an enemy's first attack.
- How frequently initial equipment coverage is inadequate.
- Whether defensive abilities provide meaningful value.
- Whether unlucky early colors create occasional failures without making most encounters hopeless.

The experiment should use weak starting equipment as well as stronger mid-run builds.

### Experiment D: Encounter duration and postcombat economy

Allow encounters to end partway through a round or continue across several rounds.

Measure:

- Fraction of each round spent in combat.
- Opportunities for recovery, scavenging, or earning currency afterward.
- Resource advantage from defeating enemies quickly.
- Differences between offensive, defensive, and economic builds.
- Potential farming or runaway accumulation.

### Experiment E: Strategy advantage

Compare passive, reactive, tactical, and oracle policies.

The goal is to determine how much benefit comes from equipment adjustments and deliberate collection ordering.

Optimized play should be rewarded, but the game should not require near-perfect resource sequencing for ordinary survival.

Ordering policies use the solver-based availability model from section 11.7.

### Simulation execution

A batch test should:

1. Select engine configuration, trace dataset, and random seeds.
2. Initialize a character and adventure.
3. Generate encounters, loot, and round manifests.
4. Supply turns from a trace or player model.
5. Apply player policy decisions.
6. Continue until victory, death, or a specified limit.
7. Record the result and intermediate metrics.
8. Repeat across seeds, configurations, and policies.

Randomness must be reproducible. Encounter generation, loot, and other stochastic systems use independently seeded streams so that unrelated changes do not unnecessarily alter all outcomes.

## 13. Simulation metrics

### Overall adventure balance

- Win rate by character, difficulty tier, and player policy.
- Rounds and turns until victory or death.
- Causes of death and failed objectives.
- Health remaining at major milestones.
- Route and encounter outcome distributions.

### Equipment effectiveness

- Activation frequency by item.
- Damage, block, recovery, and other effects produced.
- Resource coverage: percentage of collections with at least one possible use.
- Resource utilization: percentage actually consumed.
- Average value obtained per pulse.
- Cooldown and use-limit bottlenecks.
- Frequency of completed and abandoned charges.
- Equipment and character combinations associated with success.

### Resource timing

- Collection strength by turn position within a round.
- Distribution of collection strength by board size and difficulty.
- Frequency of useful early pulses.
- Time spent with no eligible actions.
- Value gained from adjusting readiness.
- Effect of delaying collections.
- Differences between observed, shuffled, solver-ordered, and optimized order.

### Encounter balance

- Turns and rounds per encounter.
- Damage taken and recovery obtained.
- Frequency of early victories.
- Persistent rewards earned after combat.
- Encounters that become impossible or trivial with particular builds.
- Frequency of encounters lasting several rounds.
- Resource constraints that most often determine success or failure.

### Economy balance

- Gold and other persistent resources earned and spent.
- Rate of equipment acquisition.
- Frequency of unused equipment slots.
- Effectiveness of scavenging-focused builds.
- Evidence of farming or runaway resource accumulation.

Results should be segmented by puzzle size, logical difficulty, character, equipment, and player policy.

Recorded-trace results should also retain source-dataset identifiers to support comparisons as additional players contribute data.

## 14. Automated testing

The engine should have extensive deterministic tests independent of the UI. Tests are Vitest files next to the code they cover (`*.test.ts`), run by `pnpm run test`, with `pnpm run check` before every change.

### Unit tests

Test individual mechanics:

- Pulse compatibility and priority routing.
- Readiness toggles and forced readiness.
- Correctly discarded pulses.
- Charges, activation sequences, and expiration.
- Cooldown and per-round use limits.
- Damage, healing, blocking, and status effects.
- Encounter progress and deadlines.
- Round-boundary effects.

### Invariant and property-based tests

Important invariants include:

- Every input turn advances tactical time exactly once.
- A collection is consumed at most once.
- A turn without a collection cannot create collection energy.
- Only eligible items receive pulses.
- An ability cannot exceed its use limits.
- An encounter can continue across round boundaries.
- Completing a round does not automatically complete an encounter.
- Invalid commands cannot partially change state.
- Identical inputs and seeds produce identical outputs.
- State survives a `JSON.stringify` round trip unchanged.
- Persistent resources do not change except through defined effects.

### Scenario and regression tests

Maintain scripted examples covering:

- Enemy defeated early in a round.
- Enemy surviving multiple rounds.
- Character death during an unfinished round.
- A wrong reveal triggering an enemy attack.
- A lost puzzle (acorns run out) ending the round as failed.
- Charge completion and failure due to color order.
- Equipment priority changes.
- Curses forcing items ready or unready.
- Noncombat objectives with deadlines or ordered deposits.
- Alternative encounter resolutions unlocked by equipment.

When a simulator discovers a bug or unexpected exploit, save its seed and command trace as a permanent regression test.

### Adapter tests

In `src/controller.test.ts` style, with fake storage and a fake generator:

- A correct reveal, a wrong reveal, a hint reveal, and a given each produce the right turn, or none.
- X marks, undo, and What if? produce no turns.
- A reload between saving the game and saving the adventure replays the missed reveals exactly once.
- Win, loss, and abandoning a puzzle end the round with the right outcome.

### Trace importer tests

Run against `tests/sample-games.csv` and small malformed inputs:

- Reproduces the section 10 statistics from the sample.
- Region-size totals and unique color counts.
- Valid ordering and timestamps.
- Prefilled stumps, and their exclusion from player turns.
- Every seed code rebuilds its recorded board.
- Incomplete solves and malformed CSV.
- Duplicate solve identifiers or inconsistent metadata.
- Reproducible conversion from recordings to simulator inputs.

### Balance tests

Run large batches comparing different equipment values, encounter configurations, and player policies.

Balance tests should produce reports and flag suspicious outcomes rather than require exact win rates, since some variance is desirable. They are too slow for `pnpm run test` and run on demand (section 15).

## 15. Source layout and workflow

The adventure follows the existing layout: a pure engine beside the puzzle engine, with the app wiring in the controller, scene, and DOM screens.

```text
src/
  adventure/
    engine/          pure, deterministic; no Phaser or DOM (lint enforced)
      state.ts       state types and constructors
      commands.ts    command types and validation
      step.ts        step(), pulse routing, round boundaries
      events.ts      event types
      rng.ts         mulberry32 with explicit state, named streams
      equipment.ts
      encounters.ts
      index.ts       barrel, like src/engine/index.ts
      *.test.ts
    content/         data-driven characters, equipment, encounters, world
    sim/             importer, policies, generators, metrics, experiments
      *.test.ts      importer and quick checks; balance batches run on demand
  controller.ts      Stumped adapter, adventure storage, puzzle requests
  puzzleScene.ts     adventure strip and readiness controls
  index.ts           between-round screens
scripts/
  simulate.ts        CLI for batch runs and reports
tests/
  sample-games.csv   recorded traces
docs/
  adventure-mode.md, adventure-mode-technical.md
```

This is a logical separation within the one package, not separate packages.

- Add `src/adventure/engine/` to the `no-restricted-imports` rule in `eslint.config.ts` that already guards `src/engine/`. The simulator imports both engines.
- Nothing in `src/` outside `sim/` imports `sim/`, so Vite leaves it out of the build.
- `src/` uses extensionless imports, which plain `node` cannot resolve, so `scripts/simulate.ts` runs through `jiti` (already a dev dependency), for example `node --import jiti/register scripts/simulate.ts`, exposed as `pnpm simulate`. Reports go to a gitignored folder, like `screenshots/`.
- A change under `scripts/` or `src/` triggers a deploy when pushed to `main`; the simulator ships nothing, but that is expected.
- Follow AGENTS.md for versioning and the changelog when the adventure becomes user-visible.

### Recommended development sequence

1. **Trace importer and analysis:** Validate `tests/sample-games.csv`, rebuild its boards, and reproduce the section 10 statistics.
2. **Core deterministic engine:** Turns, collections, equipment, and event output.
3. **Small encounter sandbox:** A character, a few items, combat, and one noncombat challenge.
4. **Simulator:** Replay real sequences, implement policies, and generate batch reports.
5. **Ordering experiments:** Compare observed, shuffled, solver-ordered, and synthetic resource sequences.
6. **Stumped integration:** The controller adapter and adventure storage.
7. **Balance iteration:** Tune using recorded traces and simulated runs.
8. **Adventure progression:** Add world navigation, inventory, loot, shops, and terminal conditions.
9. **Presentation:** Ambient strip, animation sequencing, and full adventure UI.

Simulation should continue to be used as new equipment and encounters are added.

## 16. Open design parameters

The engine should avoid hardcoding decisions that are still under consideration.

| Parameter | Initial working assumption |
|---|---|
| Equipment slots | 4 generic |
| Routing priority | Ordered, first eligible |
| Reordering | Allowed between rounds |
| Readiness | Persistent toggles |
| Collected energy | Immediate consumption or discard |
| Unused energy | Discard; explicit foraging abilities may capture it |
| Pulse scaling | Configurable per ability |
| Multi-color abilities | Charge and release over several turns |
| Cooldowns | Measured in turns |
| Per-round uses | Supported |
| Charge persistence | Configurable per ability |
| Healing and economy | Limited by abilities and encounter context |
| Encounter duration | Independent of round length |
| Difficulty | Fixes size and tier (and so the colors available). First version: 9×9 medium |
| Color identity | Palette index; hue comes from the theme |
| Color assignment | Generator's random order; the adventure may reorder it per puzzle to tune difficulty |
| What if? mode | Allowed; it reveals nothing, so it creates no turns |
| Hint reveals | Decided: a Woodpecker or Owl reveal is a turn with a collection, like a player reveal ([implementation plan](adventure-mode-plan.md), phase 1) |
| Lost puzzle | Decided for the first version: running out of acorns ends the run. Adventure puzzles cannot be retried or abandoned ([implementation plan](adventure-mode-plan.md), phase 1) |
| Silver acorns | Never chosen at random; only for a deliberate adventure reason, such as a challenge or curse |
| Freebies | Off (`freebies: 0`) unless the adventure adds one for a plot reason |
| Permanent progression | Characters, history, and variety rather than escalating power |
| Trace-driven balance | Observed collection sequences as baseline |
| Wrong turns | Exact events once recorded (section 11.5); synthetic otherwise |

Other unresolved decisions include character starting equipment, enemy timing, inventory constraints, map generation, and overall target win rates.

These are intended to be tuned experimentally.

## 17. Core engineering principle

**The engine models the adventure, not the puzzle.**

The host supplies turns, optional collections, and round boundaries. The engine resolves their consequences and emits deterministic events.

The Stumped UI and the simulation harness are simply two different sources of those inputs.

Recorded solving traces give the simulator an empirical model of when resources actually become available, and their seed codes give it the full boards behind them.

This separation allows the game mechanics to be tested, replayed, simulated, and balanced independently, while preserving the fluid experience of solving a puzzle and immediately seeing its effect on the adventure.
