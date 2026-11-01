# Adventure Mode Implementation Plan

**Status:** Proposed implementation sequence and decision checkpoints.

This plan builds on:

- [Adventure mode concept](adventure-mode.md): the intended experience, puzzle-powered actions, and roguelike progression.
- [Engine and simulation design](adventure-mode-technical.md): architecture, engine contracts, empirical resource model, integration, and testing.

Each phase ends with a concrete review checkpoint. The first four establish whether the mechanics work; the next two establish whether they feel good in Stumped; the last two build and finish the roguelike.

The technical design provides the starting architecture. This plan moves a small integrated playtest ahead of full adventure progression so the tactical interaction can be evaluated before building a campaign around it.

## Phase 1 — Agree on the experimental rules

Write down the rules needed for the first prototype, distinguishing firm contracts from values expected to change during tuning. Resolve the relevant open parameters in section 16 of the technical design.

### Decisions required

- **Hints:** Do hint reveals produce normal turns and collections, or follow different rules?
- **Puzzle loss:** Does losing end the adventure, impose a penalty and start a fresh puzzle, or allow continued solving?
- **Abandonment and retries:** What happens when the player leaves an unfinished puzzle for another one? Can retries replenish resources?
- **Adventure death:** Confirm that the current puzzle remains playable, with adventure effects stopped until the next run.
- **Difficulty:** Start with one fixed size/tier combination, or support several immediately?
- **Equipment:** Confirm slot count, priority rules, and which adjustments are allowed during puzzles.
- **Timing:** Define exactly when cooldowns, block, charges, and enemy attacks advance or expire.

### Recommended starting point

Use four ordered slots, readiness adjustable during puzzles, and reordering between puzzles. Givens produce no turns; ordinary one-square reveals do. Retain generated color assignments. Keep numerical values provisional.

### Decisions

- **Hints:** A stump revealed by Woodpecker or Owl is a normal turn with a collection, exactly like a player reveal. The player doesn't choose the region, so the pulse color can help or hurt. Squirrel and an Owl explanation without a reveal reveal nothing and produce no turn.
- **Puzzle loss:** For the first version, losing a puzzle (running out of acorns) ends the adventure run. Adventure puzzles never get silver acorn mode by random selection; it is enabled only for a deliberate adventure reason.
- **Freebies:** Adventure puzzles are generated without freebies (one-square regions or stumps revealed at the start), using the generator's existing `freebies: 0` setting, except when the adventure adds one for a plot reason.
- **Abandonment and retries:** An adventure puzzle cannot be abandoned or retried; it ends only when solved, lost, or when the whole run is abandoned. The home screen has an Adventure Mode entry the player can exit and resume at any time, which neither ends the run nor quits the current puzzle. Regular puzzles are started, restarted, and resumed from the home screen independently of the adventure. There is one adventure slot. (This also answers phase 5's question: ordinary play and an adventure each keep their own unfinished puzzle.)
- **Adventure death:** When the character dies, the current puzzle ends with the run and the player goes straight to the run summary. (This replaces the concept's "the puzzle always continues to completion" for adventure puzzles.)
- **Stats:** Adventure puzzle solves are kept out of the main solve stats and times for now.
- **Difficulty:** The first version uses 9×9 boards, starting with medium tier. Size and tier remain engine parameters.
- **Equipment:** As recommended below: ordered slots, each pulse goes to the first eligible readied item, readiness toggles freely during puzzles without using a turn, and reordering happens between puzzles. The number of slots, and whether all are generic or some are restricted to certain kinds of items, is left to tuning (start with four generic slots).
- **Timing:** Each turn resolves in a fixed order: the player's pulse first, then enemy actions and timed effects (such as poison) that are due, then all cooldowns, countdowns, and timed effects advance by one. The player's pulse resolving first is the "Millennium Falcon effect": a last-moment block, attack, or heal can land in the same turn an attack goes off. Block absorbs the next attack, then any remainder is lost, and it expires at round end. Cooldowns count turns and reset between rounds. Charges persist within a round and expire at its end unless an item says otherwise. Unfinished enemy countdowns carry into the next round unchanged. All numbers remain provisional.

### Rules table

| Event | Turn? | Collection? | Notes |
|---|---|---|---|
| Correct reveal | Yes | Yes, region color and size | Pulse resolves before enemy actions due that turn |
| Wrong reveal | Yes | No | Costs an acorn |
| Woodpecker or Owl reveal | Yes | Yes | Same as a correct reveal; region not chosen by the player |
| Owl explanation without a reveal, Squirrel | No | No | |
| Given stump at puzzle start | No | No | |
| X marks, What if? mode | No | No | |
| Readiness toggle | No | No | Free during a puzzle |
| Equipment reordering | No | No | Between rounds only |
| Leave for home screen | No | No | Adventure and puzzle resume later |
| Puzzle solved | Round ends: completed | | Round-end resets apply; encounter may continue |
| Acorns run out | Run ends | | |
| Character dies | Run ends | | Puzzle ends with it; straight to run summary |
| New puzzle or retry | Not available | | Only abandoning the whole run ends an adventure puzzle early |


### Completion criteria

A short rules table covers every player action and round-ending condition. Theme, campaign structure, and the full equipment catalog can remain open.

## Phase 2 — Validate the resource model

Build the trace importer and analysis command around `tests/sample-games.csv`, following sections 10 and 11 of the technical design.

Validate recordings against rebuilt puzzles, reproduce the documented statistics, and produce deterministic round inputs. Keep source dataset identifiers in the output.

### Decisions required

- What counts as an exact replay versus a modeled sequence?
- How should synthetic wrong turns be inserted for sensitivity testing?
- Which size/tier combination will supply the first sandbox?
- Is the current sample sufficient for experimentation, or should recording additional players begin now?

### Recommended starting point

Use the 98 zero-loss recordings for exact collection replay, all 100 for descriptive statistics, and clearly labeled synthetic wrong turns. Defer changing the solve-log format until exact mistake recording is needed.

### Decisions

- **Exact replay:** Only plays whose every turn is known replay exactly, in recorded order: in the current sample, the 98 zero-loss recordings. The 2 games that lost an acorn count toward statistics but are never replayed, unless given labeled synthetic wrong turns. Any other order (shuffled, solver-ordered, synthetic) is a modeled sequence and is labeled as such in reports. Givens are part of the board but produce no turns. If exact wrong turns become useful, the solve log can be extended to record them.
- **Synthetic wrong turns:** A test asks for a fixed number of wrong turns (0 to 2, since 3 acorns lost ends the run), each placed in a random gap between collections chosen from a seed, so runs repeat exactly. Reports label these sequences synthetic. A worst-case placement (just before an enemy attack) can be added later as a stress test. Barry's experience is that wrong guesses mostly happen when playing fast and not X-ing out all of a revealed color, which may not hold for careful adventure play.
- **First sandbox data:** All 26 9×9 recordings form the baseline, reported by tier so the 9 medium games stay visible. Generated 9×9 medium boards with a modeled order are added in phase 4 when solver-ordered experiments need them.
- **More data:** Barry will record more games to extend the sample. The solve log records wrong guesses first (version 0.11.5), so new recordings with lost acorns are exact replays too. Recordings from other players go in separate files. The first addition, `tests/barry-phone.csv`, has 20 games by Barry on a phone (18 of them 9×9 medium, recorded before wrong guesses were logged), bringing the 9×9 baseline to 44 games, 27 of them medium.

### Implementation

`src/adventure/sim/traces.ts` imports solve log CSVs (with or without the `wrong` column), validates each play, rebuilds its board from the seed code, builds replay and synthetic round inputs that keep their dataset and play identifiers, and computes the section 10 statistics. `pnpm traces [files...]` prints the report, including the 9×9 breakdown by tier and the median pulse at each collection number, writes the replay rounds to `reports/rounds.json` (gitignored), and exits with an error listing any invalid recordings. All 100 sample games import and rebuild, and the statistics match section 10.

### Completion criteria

Valid traces reproduce reliably, malformed recordings fail clearly, and the report confirms the available pulse sizes, colors, and arrival order.

This phase establishes the simulator's input quality. It cannot establish general player behavior: the sample contains successful games from one experienced player.

## Phase 3 — Build the deterministic encounter sandbox

Implement the pure engine and the smallest content set that exercises its essential rules:

- One character and a small equipment selection.
- Immediate attack, defense, a multi-color charge, and recovery or scavenging.
- One telegraphed enemy and one noncombat objective.
- Early encounter completion, encounter carryover, round failure, and character death.

Add mechanics as this content needs them; avoid building a general-purpose ability language upfront. Use the engine contracts and semantic event model in sections 4–8 of the technical design.

### Decisions required

- Pulse scaling, including useful handling of 1-unit and unusually large pulses.
- Whether a cooling-down or incompletely charged item accepts a pulse.
- Charge expiration and round-boundary behavior.
- What remaining pulses can accomplish after combat.
- Invalid-command behavior and the semantic events consumers receive.

### Decisions

- **Pulse scaling:** Size bands. Each item lists its own bands, such as 1-3, 4-7, 8-14, and 15+ squares, with an effect size for each. A 1-square pulse falls in the first band, so it always does something, and the top band caps a huge region. The final UI will probably not show raw damage, healing, or block numbers, but animation tiers that suggest the power, so every effect event carries its band number as well as its value.
- **Eligibility:** A cooling-down item is skipped, and the pulse goes to the next eligible readied item. A charging item takes only the colors its recipe still needs. Items whose effect has nothing to act on are skipped too: attack and block need an active enemy (or an objective that accepts them), while heal and forage always apply.
- **Charges:** A multi-color charge takes its recipe's colors in any order (each color appears only once per puzzle) and fires on the turn its last color arrives, sized by the band of the total squares it took. As decided in phase 1, unfinished charges, block, and cooldowns reset at round end, while an unfinished encounter, its health, and its countdowns carry over unchanged.
- **After combat:** Defeating the enemy, or completing an objective, starts a scavenge phase for the rest of that puzzle. Pulses still go to readied items that apply (heal, forage), and an unclaimed pulse goes to the encounter's scavenge rules, which turn some colors into a resource by size band. Which colors scavenge into what is still to be decided; it might be only certain colors (for example yellow for coins, purple for experience). The sandbox maps every color to supplies. The encounter ends with that round. Farming stays bounded because each puzzle has only nine regions.
- **Invalid commands:** `step()` returns the unchanged state and a single `command-rejected` event with a reason code, never throws, so a bad input can't break the puzzle. Events follow section 8 of the technical design, trimmed to what this content uses, and carry identifiers and values, never rendering instructions.

### Implementation

`src/adventure/engine/` holds the pure engine: `types.ts` (definitions, state, commands, events), and `step.ts` (`startRun()`, `step()`, `bandOf()`). State is plain JSON, and items are copied into their slots so a save doesn't depend on content. `src/adventure/content/sandbox.ts` holds the 9×9 sandbox content: the Wanderer (20 health) with a dagger (attack, colors 0-1), shield (block, 2-3), staff (attack charge needing 4, 5, and 6), and herbs (heal, 7), plus a satchel (forage, 8) outside the starting loadout; a wolf that alternates telegraphed attacks; and a rockfall objective with a deadline. The lint rule that keeps Phaser and UI assets out of `src/engine/` now covers both folders.

The engine has no random generator yet, because nothing in this content is random. Encounters start with a `begin-encounter` command between rounds until phase 7 adds navigation. Runs end in death, a lost puzzle, or abandonment; victory comes with phase 7.

### Completion criteria

Scripted scenarios demonstrate the complete turn lifecycle. Tests establish determinism, JSON save round trips, single pulse consumption, valid command handling, and encounter continuity.

The engine remains independent of Phaser and DOM code, with the lint boundary extended accordingly.

## Phase 4 — Test the strategic premise in simulation

Replay real sequences through the sandbox. Start with passive and reactive equipment policies, then compare observed order with shuffled order.

Add solver-based ordering when testing deliberate reveal-order strategy; label oracle results separately. Use the experiments and metrics in sections 12 and 13 of the technical design.

### Decisions required

- How much benefit should readiness changes provide?
- How much benefit should deliberate reveal order provide?
- What early failure rate feels acceptable for starting equipment?
- How much unused energy is desirable?
- What results justify revising a mechanic instead of adjusting numbers?

Set provisional acceptance ranges before tuning. Exact win-rate targets can wait for complete runs.

### Completion criteria

Reproducible reports show useful equipment tradeoffs, plausible opening survival, and a measurable strategic advantage without requiring oracle knowledge. Save any discovered exploit or engine bug as a regression scenario.

**Review checkpoint:** If the interaction is mostly determined by lucky color coverage, revise it here before expanding content.

## Phase 5 — Integrate reliable turns, saves, and resumption

Connect the sandbox through `src/controller.ts`, reuse puzzle prefetching, and add adventure persistence and a minimal development entry point.

This phase needs a refinement to the proposed adapter contract in sections 3 and 5 of the technical design. Comparing board state and `acornsLost` works for individual live changes, but cannot recover the order of multiple missed reveals and wrong attempts. That order affects combat. Owl also records hint use when an explanation opens, while a forced reveal happens when it closes.

### Decisions required

- What durable record preserves action order and hint source?
- What is the save commit/recovery protocol across puzzle and adventure keys?
- How are adventure commands, such as readiness changes, included in that protocol?
- Can ordinary play and an adventure each retain an unfinished puzzle?
- What happens to an active run after an application or content update?
- How do retries, linked seed codes, settings changes, and multiple tabs interact with an adventure?

### Recommended starting point

Keep the controller as the integration owner, but permit a small game-model change if reliable action records require it. Do not make “no scene changes” a constraint that compromises recovery.

### Completion criteria

Controller tests cover action mapping, duplicate prevention, interrupted writes, reloads, terminal actions, generation failures, and tab conflicts. Existing saves, ordinary play, and storage prefixes remain compatible.

## Phase 6 — Playtest a complete puzzle-to-adventure loop

Add the minimal adventure strip, equipment controls, threat indicators, and a simple between-round screen. Use placeholder visuals.

Test on the repository's preferred desktop, phone, and tablet devices. Keep animation separate from immediate engine resolution, as required by the technical design.

### Decisions required

- What must remain visible while solving: health, next attack, readiness, cooldowns, charges?
- Can players understand which item will receive a color?
- How are discarded energy and wrong-turn consequences communicated?
- What happens when reveals arrive faster than animations can play?
- How should terminal adventure outcomes appear while the puzzle continues?
- Does the theme need to be selected now to make the presentation understandable?

### Completion criteria

Someone can play several puzzles without developer explanation, understand the consequences, and make useful tactical adjustments. Keyboard/accessibility behavior, responsive layout, and rapid input have been verified.

**Review checkpoint:** Decide whether the extra interaction improves Stumped. Resolve that before building a campaign around it.

## Phase 7 — Build one complete, bounded adventure

Add enough progression to support a real start-to-finish run: route choices, encounters, loot, equipment management, shops or equivalent spending, and explicit victory and failure. Follow the encounter and progression model in sections 7 and 9 of the technical design.

### Decisions required

- Target run length in puzzles, tactical turns, and approximate play time.
- World structure: a short branching route, generated map, or another bounded structure.
- How navigation works while an encounter remains unfinished.
- Inventory capacity, replacement rules, prices, rewards, and consumable timing.
- What prevents farming through safe rounds, retries, or abandonment?
- Starting loadout and color coverage for each supported difficulty.
- Whether permanent progression belongs in the first release.

### Recommended starting point

Use one character and a small branching adventure. Defer permanent unlocks and historical world changes unless they are essential to the first release's appeal.

### Completion criteria

Both the simulator and interactive game can complete whole runs using identical rules. All routes reach valid outcomes, rewards are bounded, and saved runs resume throughout progression.

## Phase 8 — Balance, finish presentation, and release

Expand content only where testing exposes a missing strategic role. Finish the chosen theme, artwork, sound, onboarding, and release behavior.

### Decisions required

- Target victory rates by difficulty and player policy.
- Acceptable unavoidable losses versus preventable mistakes.
- Final launch content and supported puzzle settings.
- Active-run compatibility when balance or content changes.
- Whether release begins as an explicitly experimental mode.

### Completion criteria

Complete-run simulations and human playtests support the intended difficulty. Save recovery and offline behavior work. Screenshots have been captured and inspected on the preferred devices. Relevant e2e tests, `pnpm run check`, and the production build pass.

Apply versioning and changelog updates as required by `AGENTS.md`.

## Decision priorities

The most consequential decisions to make first are hint behavior, puzzle-loss behavior, retry/abandonment rules, and the initial difficulty.

Final theme, map generation, permanent progression, and exact win rates can wait for evidence from the sandbox. Timing and persistence contracts need explicit decisions before their implementation phases complete; equipment values and encounter numbers should continue to evolve through simulation and playtesting.

## Ideas for later

Ideas raised during planning, not yet part of any phase.

- **Hint-based equipment and effects:** A weapon with a special attack that consumes one of the puzzle's hints, or a curse that disables hints.
- **Silver acorn encounters:** Enable silver acorn mode (one acorn) for specific adventure reasons, such as a challenge room, a curse, or a special boss fight.
- **Multiple adventure slots:** Keep more than one adventure run in progress at once.
- **Varying puzzle sizes:** Offer a range of board sizes, perhaps driven by particular enemies or power-ups.
