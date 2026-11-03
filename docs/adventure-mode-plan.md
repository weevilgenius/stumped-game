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
- **Tablet sample extended (2026-11-01):** A later export from the same tablet was deduplicated against the original 100 solves (identical plays; the new file only adds the `wrong` column) and merged into `tests/sample-games.csv`, now 141 wins. Forty of the 41 new games are 9×9 (34 medium, 6 hard). Exact replay is 139 games. The original two acorn losses are still statistics only. With the phone file, the 9×9 pool is 84 games, 61 of them medium, and 83 of the 84 have a known turn order. The phase 4 batch has been rerun on that pool: `pnpm simulate` with seed 4 writes 41,320 trials to `reports/phase4/`, and [the simulation note](adventure-mode-simulation.md) records the comparisons. Section 10 of the technical design has the updated measurements. The new medium 9×9 games repeat the early-small/late-large shape; the phone's medium games stay flatter.

### Implementation

`src/adventure/sim/traces.ts` imports solve log CSVs (with or without the `wrong` column), validates each play, rebuilds its board from the seed code, builds replay and synthetic round inputs that keep their dataset and play identifiers, and computes the section 10 statistics. `pnpm traces [files...]` prints the report, including the 9×9 breakdown by tier and the median pulse at each collection number, writes the replay rounds to `reports/rounds.json` (gitignored), and exits with an error listing any invalid recordings. All 141 sample games import and rebuild, and the statistics match section 10.

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

### Decisions

- **Readiness:** Evaluate the benefit by loadout, without a universal percentage target. Balanced equipment from lucky loot may need little tending; overlapping colors, specialist weapons, and unlucky draws can require active management to avoid wasting pulses. At normal difficulty, active management is generally necessary for survival, while loot luck strongly affects the outcome.
- **Reveal order:** Deliberate ordering is usually an advantage, rather than necessary for survival. Exceptional circumstances such as a curse, boss fight, or particularly unfortunate equipment may require it. Compare solver-reachable choices separately from full-solution oracle choices.
- **Opening survival:** Target roughly 95% survival through the first encounter with ordinary starting equipment and sensible management. Randomness may still cause occasional initial failure. Measure encounter completion separately from surviving a single puzzle, and report unfinished encounters at the simulation limit.
- **Unused energy:** Expect substantial unused energy early on a fixed 9×9 board. Finding and selecting equipment should improve coverage; colors consumed can matter more than raw damage. Measure early and improved loadouts separately, without a fixed waste percentage target.
- **Tuning versus rules:** Adjust numbers when equipment choices and management offer interesting tradeoffs but the difficulty is wrong. Revisit mechanics when sensible equipment choices and active management consistently offer little control. Occasional unwinnable draws are acceptable.

These are provisional acceptance criteria set before phase 4 tuning. Exact complete-run win-rate targets wait for progression content. The roughly 95% opening-survival target is descriptive, not a hard test threshold for this small, single-player dataset.

### Implementation

`pnpm simulate [files...]` runs deterministic encounter experiments against validated 9×9 recordings and generated 9×9 medium boards. It compares passive/reactive readiness by loadout, observed/shuffled order, solver-constrained tactical choices, and separately labeled oracle choices. Reports retain provenance, censor unfinished encounters, and include opening survival, damage, energy loss, charges, and postcombat income. See [simulation instructions and initial evidence](adventure-mode-simulation.md) for assumptions, reproduction commands, results, and the review checkpoint. The initial results support loadout-dependent management and modest reveal-order advantages; starting color coverage and balance still need progression content and human playtesting.

### Results review (2026-11-01)

Barry reviewed the rerun on the extended sample (83 exact 9×9 recordings) before phase 5:

- **Starting equipment:** The sandbox Wanderer is too strong to be a starter (60 of 60 medium openings beat the wolf, 6 to 10% of energy discarded); the simulator's loadouts represent mid-game equipment. The intended starting loadout has two abilities that together consume two to four colors and deal low damage (clarified after phase 6). An early player is desperate for equipment that widens the color range, possibly more than for extra damage, and an unlucky roll that uses only two colors must survive to the end of the puzzle for the color reset that a new board brings. That suits a difficult roguelike. Early waste may reach about 80% as a natural consequence rather than a target. The point is scope for equipment growth, not forcing color management. Early enemies are tuned so such a loadout mostly survives, judging early encounters by survival across puzzles rather than a first-puzzle win. This replaces the 25 to 40% early-waste expectation.
- **Reveal order:** Solver-reachable tactical order barely helps (about 0.05 damage saved of roughly 14 for the Wanderer), while the oracle saves about 5. The tactical model only chooses among simultaneously forced stumps and never keeps deducing past a known stump it holds back. Players can bank reveals for strategic reasons, so the simulator should model banking before reveal order is judged; the long-term goal is an adventure that is tough to win.
- **Objectives:** Rockfall succeeds 12 to 25% of the time with the Wanderer, and the oracle adds about 70 points, but failure costs only health. For phase 4, objectives are mostly a bonus. An objective that needs colors in a set order, like a charge weapon, would reward strategic solving.
- **Policy comparisons:** The greedy reactive policy can underperform skilled management (with the specialist it takes more damage than passive play). Oracle order is a privileged comparison, not an optimal upper bound: it knows every solution cell but still chooses with a greedy score. With What if? mode allowed, Barry estimated he could play about 70% of boards with full-solution knowledge if necessary. Whether to disable or limit What if? mode in an adventure is an open question.

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

### Decisions

- **Action record:** Adventure games always keep `found` (stumps in order, with who found them) and `misses` (wrong reveals placed among them), which otherwise are only kept when the solve log is on. The adventure remembers how many of those entries it has already played as turns, so missed reveals replay in order exactly once. An Owl reveal is written when its explanation closes, which is when its turn happens; opening an Owl explanation only uses the hint.
- **Saves:** The adventure's puzzle is saved inside the `adventure` key together with the run, so every change is one write that cannot be half done. The regular `save` key is unchanged, so older versions of the game cannot drop adventure data.
- **Commands:** Readiness changes and other commands apply to the run immediately and are saved in the same write. Every reveal becomes a turn before the next command can arrive; a save found with unplayed reveals plays them first. The save also keeps a log of every command since the run began, in order with the turns, so an adventure can be replayed exactly for debugging or simulation.
- **Unfinished puzzles:** Ordinary play and the adventure each keep their own unfinished puzzle (decided in phase 1).
- **Updates:** A run continues under a new version's rules. Items are copied into the save, so content changes don't break it. The save has a format number; a save the app cannot read is kept as a recovery copy with a notice, as for the regular save.
- **Retries, links, settings, tabs:** Adventure puzzles cannot be retried. A seed code link always opens ordinary play. The adventure ignores the size, difficulty, single-acorn, and freebie settings (9×9 medium, three acorns, no freebies) and prepares its own next puzzle, while timer and sound settings apply. When another tab saves either regular play or the adventure, this tab stops saving both.

### Implementation

`src/adventurePlay.ts` is the adapter: `turnsOf()` turns a puzzle's `found` and `misses` into turn commands in order, `sync()` plays the ones not yet played and ends the round on a win or loss, and `command()` applies a command and appends it to the log. The controller keeps the adventure apart from ordinary play (`adventure`, `startAdventure()`, `playAdventure()`, `setReady()`, `abandonAdventure()`, and an `'adventure'` screen), prepares its next 9×9 medium puzzle itself, times it separately, keeps its solves out of best times and stats, and passes engine events to an optional `onAdventure` callback. Development builds show an Adventure section on the home screen (start, continue, give up), log events to the console, and expose `window.controller` for readiness changes until phase 6 adds the strip. A run is the sandbox Wanderer against a fresh wolf whenever the last encounter is over. Giving up between rounds discards the run, since the engine can only end one during a round; phase 7 adds proper run endings.

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

### Decisions

- **Strip:** The strip's size is flexible, but the most constrained layout drives it: phone portrait, in the space between the top bar and the board, which makes it at least 3:1. The character and equipment chips sit on the left, the enemy or enemies on the right. The final version reads at a glance: ambient animation for the character and enemy, health bars and tiered animations instead of numbers, item pictures instead of names, and a revealed patch's squares swirling down into the readied item. For phase 6: health bars, a block badge, the enemy's health and a countdown to its next attack with the hit shown as a size tier, and one chip per slot in priority order with its color swatches. Tapping a chip toggles readiness, a cooldown shows as a turn count, and a charge item fills its recipe swatches as it takes them. Resources show only between rounds.
- **Routing:** Players work out where a color goes from the readied chips in order. Nothing is dimmed apart from unreadied chips, and the puzzle board is never marked.
- **Discards and wrong turns:** A discarded pulse fizzles as a swatch of its color on the character's side. A wrong reveal is simply a turn, so the enemy's countdown ticks as usual. An attack drops the health bar with a red flash, and block shrinks the shield badge. A more elaborate wastage animation, and perhaps a sound, can come with the final presentation.
- **Rapid reveals:** The strip always shows the latest state at once. A new effect or sound cuts off the one running and replaces it; nothing queues, and nothing delays input. Special short animations for rapid play may come during polishing.
- **Terminal outcomes:** A beaten enemy or met objective shows greyed with a check, and a supplies bag shows that the remaining patches scavenge; a failed objective shows a cross. Death locks the board under a Defeated banner instead of jumping to the main screen; running out of acorns shows the usual Stumped banner and also ends the run. Solving a puzzle with the enemy alive shows the usual win banner, and the between-round summary says the fight continues. The final version could have an elaborate death screen with statistics about the run, perhaps compared with recent runs, so even a defeat feels worth something.
- **Theme:** Not yet. Phase 6 uses the current puzzle theme's colors with simple placeholders: a shape per effect and a plain enemy silhouette.
- **What if?:** Fully available during the playtest, since tentative stumps are not reveals and spend no turns. Whether to limit it is decided in phase 7, once runs have real stakes. Recording What if? use in the solve trace would help that analysis.

### Implementation

The puzzle scene draws the strip when it is given an adventure (`AdventureView` in `src/puzzleScene.ts`): above the board in the stacked layout, or in the side panel under the top bar, in place of the theme's flags. It is redrawn whole from the run after each change, and the controller's engine events, passed in through `showAdventureEvents()`, add brief chip flashes, fizzles, and hit flashes; a redraw cuts off any still running. Death locks the board under a Defeated banner. Settings has a Show adventure mode switch (saved as optional `adventure`), and the main screen's Adventure section doubles as the between-round summary: health, supplies, the encounter ahead, and Next puzzle.

For analysis, each logged command has a timestamp (`times`, beside `log`), a replaced or dropped run is kept under `adventureRuns` (last ten), and Settings has Export adventure data (current and earlier runs as JSON). Adventure wins go into the solve log flagged `adventure`, and every solve records when What if? mode was turned on (`whatIfs`; CSV columns `mode` and `what_if_seconds`).

### Playtest review (2026-11-02)

Barry played two logged runs with the Wanderer against back-to-back wolves (plus an earlier unlogged run), and the runs were replayed through the engine.

- **Overall:** Encounters feel about right for an early-to-mid-game fight. One wolf is not hard; a chain of them is very hard, which is good. Ignoring the strip is unwise, and the disjoint-color loadout needs no readiness tending.
- **Attrition sets run length:** A fresh wolf that survives all nine turns lands 13 damage (4, 5, 4). That is not a fixed per-puzzle rate: its countdown carries over, so nine more uninterrupted turns land 18 damage (5, 4, 5, 4). Killing it early prevents later hits. The shield blocks about 6 and herbs heal 2 to 7 in typical puzzles, but attrition depends on attack timing and when the fight ends. The logged runs died to the seventh and sixth wolves, after entering 14 and 9 puzzles. Most wolves take two puzzles (about 19 damage dealt per puzzle against 24 health).
- **Reveal order matters a lot:** Replaying the 23 recorded puzzles with the stumps of each puzzle in random order kills 2.2 wolves on average and dies by about puzzle 6, against 6 wolves and 14 puzzles with Barry's planned orders. Random order is a counterfactual stress comparison, not a model of a player revealing the most obvious stump first; this does not quantify the advantage over ordinary solving.
- **Pre-solving:** When low, Barry marked the whole puzzle and then chose the reveal order. In the solve log, adventure puzzles took about twice as long as ordinary 9x9 medium ones (about 139s against 65s), the first stump came about halfway through instead of about a quarter, and in 4 of 21 puzzles all nine stumps came in the last fifth of the time. This is accepted as competitive play. There will be no real-time element, which would break the take-your-time feel; limiting What if? would reduce it but not stop it. What if? was used in 6 of 21 adventure puzzles, about a fifth of adventure play time.
- **Unusable colors:** A color no item takes (brown here) is part of the game. Planning when to take it feels right.
- **Cooldowns:** A single-color item or a charge item is already once per puzzle, so a cooldown only means anything on a multi-color item that fires on any of its colors. The "1" shown after an item fired was a display bug (the engine's same-turn lock); fixed so only real cooldowns show, dimmed like an unreadied chip.
- **Urgency:** "Hits in 1" was ambiguous; it now reads "Attacking!" (or "Falling!") in red. The fatal turn of one run came from this: entering a puzzle at 3 health against a wolf about to hit for 5, a shield color first would have survived.
- **Several effects in one turn:** Seeing only the result was unsatisfying and sometimes confusing ("did my purple do anything?"). The strip now shows lingering markers for heals, blocks, and damage, appearing in order. Staggered animations come with the final presentation.
- **Layout:** The strip needed more height on the smallest phone, where the attack pips were tiny. In the stacked layout it now grows into spare height (up to 124px, scaling its bars, text, and pips), and where there is not enough, the buttons under the board shrink (40px rows instead of 52px) and only there. A single button row with icons for Undo and What if? stays an option if more room is needed.
- **Pacing:** The full game needs ways to lower tension and regroup between high-stakes encounters, even without always healing (FTL's empty sectors and neutral encounters), and ways to spend supplies. Runs ended with 23 and 41 supplies and nothing to spend them on.

### Playtest review: loadouts (2026-11-02)

Barry then played the Overlap loadout (20 puzzles, nine wolves defeated and the tenth still active, alive at 18 of 20 health) and started a Hunter run (2 puzzles, too short to judge). The logs were replayed through the engine.

- **Many-color items are hard to read:** The Hunter's any-color sling showed nine tiny dots. Final UI rule: an item that takes every color shows a single wildcard symbol; every other item takes at most four colors, so swatches never need a second row. Avoid "all but one or two" items; if one is ever wanted, show the wildcard with the excluded colors crossed out. The playtest now draws any-color items as a small color wheel.
- **Solve, then plan:** At this difficulty it is unwise to reveal the first stump deduced. The rhythm that works is to solve the whole puzzle without marking it, then turn to the strip and choose the reveal and readiness order. The cause is perfect information: sizes and enemy attacks are all visible, so the best order can be worked out once the puzzle is solved. Accepted for now; weaving the two halves together would need fundamental changes, such as information that appears only as you reveal.
- **Options are the fun:** The samples range from no readiness tending (Wanderer: disjoint colors) to many choices (Overlap: four colors shared by herbs, shield, and dagger, with 123 readiness changes over the run). Overlap's endurance came from healing and blocking on demand rather than extra damage: after a wolf died, the rest of the puzzle could heal 7 to 12, and big colors went to the shield just before attacks (9 to 11 blocked). Shared "swing" colors are one way for acquired gear to add options. These early/mid-game samples are not starter candidates and were not balanced against the wolves. Starter and recovery tuning waits for phase 7, when rest, consumables, and healing encounters can be evaluated alongside equipment.
- **Block versus healing:** When a color can block or heal, the better choice was not obvious, and healing was equal or stronger at every size band. Block is riskier (it only meets the next hit, excess is lost when that hit lands, and it clears at the end of the puzzle), so at the same tier block is one step above healing. The shield is now 3/4/6/8 against the herbs' 2/3/5/7.
- **Harvest is anticlimactic:** After a win every color scavenges with nearly flat bands, so order no longer matters. Ideas for later: only some colors are harvestable, harvest that charges up like the staff, and charge that carries between puzzles.

### Extended phone trace review (2026-11-03)

The latest phone export contains the same two Wanderer runs and Overlap run, plus Hunter extended to 13 puzzles. All four command logs replay exactly to their saved engine states, with no rejected commands. These are repeated observations from one experienced player, not independent balance trials. All four runs retain the old shield bands (2/3/4/6); the later buff to 3/4/6/8 does not change equipment already copied into a save.

| Loadout | Puzzles entered | Wolves defeated | Saved outcome | Readiness changes |
|---|---:|---:|---|---:|
| Wanderer, first run | 9 | 5 | Died during puzzle 9 | 0 |
| Wanderer, second run | 14 | 6 | Died during puzzle 14 | 0 |
| Overlap | 20 | 9 | Alive at 18/20 health; tenth wolf active | 123 |
| Hunter | 13 | 7 | Alive at 16/20 health; seventh wolf cleared | 10 |

- **Purpose and intended opening:** These loadouts are early/mid-game concept samples, not proposed starters or evidence that equipment and enemies are balanced. They validate interactions and expose the next design questions. The intended starter has two abilities consuming two to four colors in total. The early game is a desperate race to find equipment with a better color spread before dying. Progression must test that race directly; a broadly equipped sample surviving wolves cannot establish opening difficulty.
- **Control need not mean constant toggling:** Hunter's ten readiness changes all occur in its first four puzzles; the following nine use none. Keeping the recorded reveal order but removing every readiness change causes death in puzzle 3. This shows that the early choices mattered, while later control could come from reveal order and cooldown timing. It does not show that passive readiness is generally sufficient, or make Hunter a starter recommendation.
- **Recovery depends on how combat ends:** Overlap restores 93 health in total, 58 after kills; Hunter restores 41, 23 after kills. Early kills preserve colors for recovery and prevent attacks. Evaluate effective healing, blocked damage, remaining colors, and health across successive encounters together, rather than ranking builds by damage output or color utilization alone.
- **Survival and progress are separate:** Keeping Overlap's recorded reveal order but leaving every item ready survives the 20 recorded puzzles at 15 health, while defeating six wolves instead of nine. Both are counterfactual replays of fixed inputs, not new player runs. A campaign must measure progress and its costs as well as survival, and decide whether indefinitely sustaining an unfinished encounter is possible or desirable.
- **Economy remains untested:** Hunter holds 64 supplies after 13 puzzles, and Overlap holds 58 after 20. These totals show income without spending, not an appropriate price scale. Gear acquisition, recovery, spending opportunities, and rewards need to be designed together before judging economy balance.
- **Balance versions must stay separate:** Substituting only the buffed shield while keeping all recorded commands leaves Hunter at 20 health and Overlap at 19; both Wanderers survive their previously fatal recorded turns at 5 health. Their logs stop there, so eventual survival is unknown. These fixed-command comparisons illustrate the buff's effect, not optimized play or a calibrated difficulty. Preserve original definitions and label any substitutions in future reports.
- **Simulation needs planning and progression:** The phase 4 tactical policy stops deducing at the first forced reveal; it does not bank deductions as Barry does. The oracle sees every solution cell but still uses a greedy one-turn score, so it is not an optimal upper bound. Extend evaluation to banked deductions and planned reveal/readiness sequences, then successive encounters with loot and recovery. Single-encounter results cannot establish campaign endurance or the opening gear race.
- **Recording needs more puzzle context:** The export retains resource manifests and timestamped commands for every puzzle, but only the latest full puzzle. It supports exact adventure replay under the checked rules, not reconstruction of earlier deduction opportunities. Preserve each puzzle's seed code and generation settings (plus any color permutation), active solve time, hint and What if? history, and the application/rules version. Wall-clock gaps include breaks and cannot measure planning time reliably. Retain deaths and unfinished runs alongside wins, and archive exports before the ten-run history rolls over.
- **Presentation still needs independent validation:** Expert play establishes useful choices, not that a new player understands routing, cooldowns, and turn consequences without explanation. Verify that separately. Before hiding exact values in the final presentation, decide how players inspect item bands, threat strength, health, and the next receiving item well enough to make the accepted deliberate plans.

### Completion criteria

Someone can play several puzzles without developer explanation, understand the consequences, and make useful tactical adjustments. Keyboard/accessibility behavior, responsive layout, and rapid input have been verified.

**Review checkpoint:** Decide whether the extra interaction improves Stumped. Resolve that before building a campaign around it.

## Phase 7 — Build one complete, bounded adventure

Add enough progression to support a real start-to-finish run: route choices, encounters, loot, equipment management, shops or equivalent spending, and explicit victory and failure. Follow the encounter and progression model in sections 7 and 9 of the technical design.

### Decisions required

- **Opening gear race:** Which two starting abilities consume two to four colors, and how do early enemies, loot timing, and equipment offers create the intended race to widen coverage before death? How much can unlucky offers delay that growth? Measure surviving to useful gear and completing early encounters across puzzles, not just winning the first puzzle. Keep experimental early/mid-game loadouts separate from actual starter trials.
- **Run and encounter budgets:** What are the target run length and variation in puzzles, tactical turns, and active play time? Budget multi-puzzle fights, quiet encounters, and between-round decisions as well as map nodes. The phase 6 average of about 139 seconds per adventure puzzle implies roughly 23 minutes for ten puzzles before navigation; it is one player's observation, not a population estimate. What bounds a fight that a build can sustain without finishing?
- **World and route information:** Use a short branching route, generated map, or another bounded structure? What can the player see about danger, rewards, shops, and recovery before choosing? Route choices should let the player respond to missing colors and low health, with explicit consequences for risk and detours.
- **Preparation during unfinished encounters:** Can the player navigate, flee, replace or reorder gear, buy recovery, or use consumables between puzzles while an enemy remains alive? What does each action cost? Preserve countdown continuity explicitly: a new puzzle resets block, cooldowns, and ordinary charges, but is not automatically a safe preparation phase.
- **Recovery and pacing:** How do healing equipment, rests, consumables, and neutral encounters complement one another? Which quiet locations require a puzzle, and which resolve as a between-round choice? Give opportunities to lower tension without assuming every quiet location restores health. Evaluate health across encounters and builds before setting recovery amounts.
- **Inventory, loot, and economy:** What are inventory capacity, replacement and selling rules, reward timing, prices, and consumable timing? When is the first useful equipment offer reachable, and how often can supplies be spent? What tradeoffs make wider coverage, shared colors, stronger effects, and recovery worth buying? Specify whether consumables take tactical turns or can rescue a character before an immediate carried-over attack.
- **Farming limits:** What bounds supplies and healing from safe locations, revisits, extended fights, and postcombat puzzles? Can a player deliberately avoid finishing an encounter to heal or forage repeatedly? Define finite rewards, access costs, or other rules as needed; banning puzzle retries alone does not establish a bounded economy.
- **Postcombat role:** Should the remaining puzzle provide tactical harvest choices, recovery planning, or a deliberate respite? If harvest needs more choices, test selective harvest colors before assuming charge or carry-over mechanics are necessary. Explain harvest opportunities before the player commits colors during combat.
- **Planning and information:** Keep the accepted solve-then-plan rhythm for the first campaign, or test reveal-time information to encourage interleaving? Is What if? unrestricted in the bounded adventure? Limiting the tool does not eliminate pre-solving. Define what tactical information remains inspectable if the final strip uses pictures, health bars, and animation tiers.
- **Outcomes and rewards:** What do failed objectives cost, and can the run continue afterward? When are rewards granted, and when does final victory occur: on the decisive reveal or after finishing that puzzle? Define abandonment between rounds as well as during a puzzle, and make rewards and terminal outcomes occur exactly once after reload.
- **Evaluation and compatibility:** Which actual starters, loot paths, weak builds, recovery-heavy builds, and player policies must complete-run experiments cover? Include planned sequences, ordinary reveal behavior, exact or labeled synthetic mistakes, and unlucky gear paths. Measure encounter progress, health, gear acquisition, income/spending, and unfinished runs separately. Which rules/content version does an active run use after an update, and what metadata preserves reproducible reports?
- **Release scope:** Which puzzle difficulties are supported, and does permanent progression belong in the first release?

### Decisions

- **Opening gear race:** Each character starts with one skill (possibly thematic) and one starter weapon. As in FTL, the first characters are conventional: damage and block, with variations in colors, overlap, and charges. Finishing runs, which is never guaranteed, unlocks further starting characters that are more specialized, such as healing with no block, double attacks, early scavenging, or extra health with a weaker attack. The earliest enemies are roughly one-puzzle kills, with enough variance for both quick kills and slogs of two or more puzzles. Loot is random, with no guarantee of quality or color overlap, but follows tiers: harder enemies drop better gear, more of it, or both. Every enemy drops 2 to 4 items, and every enemy also drops some harvestable supplies (gold or XP), so a combat-focused build still has something to spend at a shop.
- **Run and encounter budgets:** A run targets 12 to 18 puzzles (about 30 to 45 minutes at the observed pace, 120 to 180 turns): 6 to 9 fights of one or two puzzles each, 2 or 3 quiet stops, and a boss. Fight length supplies most of the variation. Playtesting will tune the length. An endless fight is bounded per enemy type, chosen thematically: some enemies enrage (attacks grow with each new puzzle they survive into), others flee after a telegraphed number of puzzles, taking their loot with them. More bounding behaviors may come later for variety.
- **World and route information:** A layered map in the style of FTL or Slay the Spire: about 15 columns from start to boss, 2 or 3 choices at each step, with paths that cross and merge, generated from the run's seed so it replays exactly. Before choosing, the player sees each node's type (fight, elite, shop, rest, event, or unknown) and a fight's danger tier, but not the specific enemy, its favored colors, or its drops. Routing toward shops when weak and elites when strong is the main response to low health and missing colors. A scout ability that reveals more may come later as an unlockable character's ability.
- **Preparation during unfinished encounters:** The player stays on the same node, and the enemy's countdown carries into the next puzzle. Between those puzzles the player may reorder items, set readiness, and swap gear between the loadout and the pack for free. Swapping or reordering never resets a cooldown or charge: an item keeps its state while packed. Consumables can be used there without spending a turn, so one can prevent an attack that would land on the first reveal. Map movement, shopping, and resting wait until the fight is over. The player may flee a normal enemy, not a boss: it lands one parting attack (its current telegraphed hit), drops no loot, and the player moves on. The pack holds reserve items for now; phase 7 playtesting decides whether reserves stay.
- **Recovery and pacing:** Four sources, each with its own role. Healing gear is the in-fight option and must be found, since the conventional starters lack it. Rest nodes resolve between puzzles without one: heal about a third of maximum health, or improve one item by one band step. Consumables (heal, block, damage potions) come from shops and loot as the emergency option. Events are short text choices without a puzzle, mostly trades such as supplies for health or damage for an item, and some are simply calm. Only treasure or forage nodes take a puzzle: no enemy, every color harvests, and the yield is finite. Nothing heals automatically after a fight.
- **Inventory, loot, and economy:** Four equipped slots in priority order, a pack of three reserve items, and three separate consumable slots. Loot that does not fit is left behind or swapped out. Items sell at shops only, for half price. A shop offers three gear items and three consumables plus paid healing; starting prices are about 25 to 45 supplies for gear by tier, 10 to 15 for consumables, and 2 per health point, against the observed income of about 5 supplies per puzzle, so a run affords roughly three or four meaningful purchases. The first shop is guaranteed in columns 3 to 5. Consumables can be used at any time, including mid-puzzle, and never cost a turn. An item's worth comes from new colors, shared swing colors, bigger bands, or recovery; prices are tuned by playtesting.
- **Farming limits:** The map only moves forward and each node resolves once, so rests, shops, and events cannot be revisited. Forage nodes are the only enemy-free puzzles, two or three per run, each yielding at most one puzzle's harvest. Stalling a fight to heal or forage is allowed but risky, because enrage outpaces healing and a fleeing enemy takes its loot. Postcombat harvest happens once per fight and shrinks the longer the fight lasts. Retries and abandonment follow phase 1: none, and abandoning ends the run. A shop's stock is fixed on arrival, with no paid reroll. Every source of supplies, healing, and gear is therefore finite per run.
- **Postcombat role:** Selective harvest plus gear leveling. Each enemy has 2 or 3 harvestable colors, shown on the strip from the start of the fight so the player knows them before committing colors in combat. After a kill, each color goes to the first readied item that takes it as experience (squares count toward a threshold that earns one band step, the same upgrade a rest node gives). A harvestable color with no readied taker becomes supplies, sized by patch, and any other color fizzles; unreadying an item is how the player chooses to harvest instead. Healing items still heal after a kill rather than leveling, and an item gains at most one level per fight. Playtesting checks whether this adds real postcombat decisions; a side benefit may be catch-up, where an item little used in combat becomes more appealing after a puzzle or two. Charged or carry-over harvest waits until this has been tested.
- **Planning and information:** The first campaign keeps the solve-then-plan rhythm; reveal-time information stays in Ideas for later. What if? stays unrestricted, since limiting it would make pre-solving tedious rather than prevent it; its use keeps being recorded. The strip stays glanceable, and tapping an item or enemy opens a small card with exact values: an item's colors, band values, cooldown or charge, and level progress; an enemy's health, next hit and its timing, enrage or flee timing, and harvestable colors. The final art can hide numbers without hiding what planning needs.
- **Outcomes and rewards:** Each objective names its own failure penalty (damage, lost supplies, or a lost item) and forfeits its bonus reward; the run continues unless the penalty kills. Loot is rolled from the run's seed at the moment of the kill, so a reload cannot reroll it, and is collected on the between-round screen after the puzzle. Final victory locks in on the reveal that kills the boss; the player still finishes that puzzle for harvest and leveling, which count toward end-of-run statistics. Abandoning a run is possible between rounds and mid-puzzle behind a confirmation, and counts as a defeat in the run history. Noncombat encounters may have no separate abandon; leaving can be one of the choices they offer. Every reward and outcome is an engine event saved atomically with the run after each turn, so none happens twice after a reload. Tuning option: if fleeing is ever allowed mid-puzzle, restrict it to between puzzles.
- **Evaluation and compatibility:** Complete-run experiments cover each conventional starter on the same seeded maps and loot, report results by loot luck with the unluckiest tenth of loot paths shown separately, and run two player policies: planned (banked deductions and chosen order) and ordinary (reveal as deduced), each with no mistakes and with labeled synthetic mistakes. Reports separate survival, fights won, health across fights, gear gained and leveled, supplies earned and spent, and unfinished runs. After an update a run continues under the new rules (phase 5); old content is not frozen for active runs. Each puzzle's record stores the app and content version, seed code, generation settings, active solve time, and hint and What if? history, so reports can label mixed-version runs and earlier puzzles can be reconstructed.
- **Release scope:** The first release supports 9×9 medium only; other sizes stay in Ideas for later. Permanent progression is limited to unlocking starting characters, with no permanent power boosts, and the first release keeps the total small: three or four starters at most. Phase 7 builds the unlock mechanism with one or two conventional starters and one unlockable character; the remaining characters come in phase 8. Unlocks are stored apart from runs, so they survive deaths, abandonment, and run history rolling over.

### Implementation

- **Engine** (`src/adventure/engine`): items gain levels (one band step each, continuing past the top band) and experience; enemies may define harvest colors (one fewer per extra puzzle), `enrage`, `flee`, and `boss`; a `forage` encounter harvests every color. New commands: `use-consumable` (any time, no turn), `move-item` and `drop-item` (between rounds, slots and pack swap with items keeping their state), `flee` (between rounds, telegraphed parting hit, never a boss), and `abandon` (any time). Killing the boss sets the `victory` outcome on that reveal; the run ends when the puzzle does.
- **Campaign** (`src/adventure/campaign.ts`, content in `src/adventure/content/campaign.ts`): `advance()` wraps `step()` and adds `move`, `take-loot`, `buy`, `buy-health`, `sell`, `rest`, and `answer`, so one command log replays the whole run. The map has 15 columns of 2 or 3 nodes (3 at the start, rests before the boss, a shop in columns 3 to 5), with enemies, harvest colors, loot (rolled at the kill), shop stock (fixed on arrival), and events all drawn from the run's seed. Starters: Knight and Scout, plus the Herbalist, unlocked by one win and recorded under its own `adventureUnlocks` key. Content version 1.
- **Play**: the home Adventure section shows the stop here (fight details and flee, loot, shop, rest, event), gear management (move, ready, drop, sell, upgrade), consumables, and the map. Tapping a strip item, the enemy, or the health bar opens a card with exact values, readiness, and consumables. Each finished puzzle is recorded in the save's `puzzles` list with app and content version, seed code, time, hints, and What if? times.
- **Not yet built**: unknown map nodes, noncombat objectives on the map, and named objective penalties; the sandbox objective type still exists in the engine. Runs from before this version continue as sandbox runs with repeating wolves.
- **Simulation**: `pnpm runs` plays every starter on the same seeded maps with a simple player (planned and ordinary reveals, exact and with one synthetic mistake), reporting victories, columns reached, fights won, escapes, health after fights, gear gained, levels, and supplies, with the unluckiest tenth of loot paths separately. First numbers (30 seeds, 2026-11-03): the simple player wins about 10% to 47% of runs depending on starter and policy and plays about 13 puzzles; the Scout is weakest. The simple player never flees or plans routes beyond a health check, so treat these as a floor for tuning in phase 8.

### Recommended starting point

Use one character, 9×9 medium puzzles, and a small branching adventure. Start with two abilities consuming two to four colors, and make finding gear with wider coverage the immediate survival pressure. Add enough loot, recovery, and spending to test that progression together. Keep the existing samples as concept probes; choose equipment and enemy values for the new progression rather than treating the samples as balanced targets. Defer permanent unlocks and historical world changes unless they are essential to the first release's appeal.

### Completion criteria

Both the simulator and interactive game can complete whole runs using identical rules. All routes reach valid outcomes, rewards and recovery opportunities are bounded, and saved runs resume throughout progression. Reports distinguish survival from encounter completion and show the opening gear race, health across encounters, equipment growth, resources earned and spent, and unresolved runs. Compare actual starters and equipment paths under both ordinary reveal behavior and deliberate planning, with original definitions and any counterfactual substitutions labeled. Independent playtesting checks whether the loop is understandable without developer explanation; final balance and victory-rate tuning remain in phase 8.

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

Hint behavior, puzzle-loss behavior, retry/abandonment rules, and the prototype's initial difficulty have been decided. Phase 6 supports continuing with progression experiments; it does not establish starter or enemy balance. The next priorities are the opening gear race, a bounded run structure, recovery and spending, and preparation rules during unfinished encounters.

Final theme, elaborate map generation, permanent progression, and exact win rates can wait. Resolve the phase 7 contracts before building their dependent systems, and extend trace collection and player policies enough to evaluate progression. Equipment values and encounter numbers should continue to evolve through simulation and playtesting.

## Ideas for later

Ideas raised during planning, not yet part of any phase.

- **Hint-based equipment and effects:** A weapon with a special attack that consumes one of the puzzle's hints, or a curse that disables hints.
- **Silver acorn encounters:** Enable silver acorn mode (one acorn) for specific adventure reasons, such as a challenge room, a curse, or a special boss fight.
- **Multiple adventure slots:** Keep more than one adventure run in progress at once.
- **Varying puzzle sizes:** Offer a range of board sizes, perhaps driven by particular enemies or power-ups.
- **Run statistics on defeat:** A death screen showing statistics about the run, perhaps compared with recent runs.
- **Ordered-color objectives:** A challenge that needs colors in a set order, like a charge weapon, rewarding strategic reveal order.
- **Quiet sectors:** Empty sectors and neutral encounters between fights, so a run has room to regroup.
- **Staggered strip animations:** Effects that land in the same turn play one after another, so a heal before a hit reads clearly.
- **Reveal-time information:** Show the enemy's next attack only one step ahead, or let a reveal trigger a small event, so pre-solved plans must adapt and the puzzle and adventure interleave.
- **Harvestable colors:** Only some colors scavenge after a win, explained up front, so players try to save them for the end. Different enemies could drop different colors.
- **Charged harvest:** A harvest that charges like the staff, with a bonus for collecting colors in the right order.
- **Carry-over charge:** Some charge carries from one puzzle to the next.
