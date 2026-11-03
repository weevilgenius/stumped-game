# Phase 4: strategic simulation

The simulator tests the phase 4 decisions in [the implementation plan](adventure-mode-plan.md). It runs the same pure engine as the future interactive mode. It does not simulate a campaign, loot drops, curses, or bosses; those await progression content.

## Reproduce the experiments

```sh
pnpm simulate
pnpm simulate tests/barry-phone.csv --seed 4 --shuffles 8 --generated 12 --rounds 3
pnpm simulate --wrong 2 --out reports/phase4-wrong
```

Defaults: every `tests/*.csv`, seed 4, eight shuffles per opening board, twelve generated 9×9 medium boards, and a three-puzzle encounter limit. `--generated 0` disables generation. `--wrong 1` or `2` replaces recorded mistakes with seeded synthetic mistakes, and adds that many to generated boards. Wrong turns are placed before collections, never after the final reveal. All order variants retain those wrong-turn positions; they do not optimize mistake timing.

`reports/phase4/report.md` contains matched comparisons and detailed groups. `results.json` contains the configuration, dataset SHA-256 fingerprints, experimental equipment/enemy definitions, excluded plays, summaries, and per-trial metrics with every input dataset, play id, seed code, and sequence label. A trial's `sources` lists its planned inputs; `metrics.rounds` indicates the prefix actually entered. Reports are gitignored. There are no timestamps or unseeded random choices in the output.

Each recording is validated and its puzzle rebuilt. Unknown mistake order excludes a recording from exact replay; it can still supply a synthetic experiment with `--wrong`. Givens remain givens and generate no turns. Generated boards turn freebies off, preserving the adventure rule. Shuffles preserve color/size pairs, and a separate named stream supplies each puzzle's shuffle or synthetic mistakes; adding equipment does not change the inputs.

One trial starts a fresh character and one encounter. An unfinished encounter carries health and countdowns into subsequent, distinct puzzles in the same dataset/tier, in dataset order. A short pool is not repeated to pad the limit. After success, the simulator finishes the current puzzle to measure healing and scavenging, then stops. Live encounters at the limit are censored, not wins. Trials overlap and recordings come from one player; neither trials nor shuffle replicates are independent player samples.

## Policies and information boundaries

- **Passive:** Every item stays ready, with its original priority.
- **Reactive:** Before each collection, preview that turn with each possible receiving slot, or no item. Score health, effective attack/progress, block against the next telegraph, viable partial charges, and supplies. This greedy heuristic sees only current adventure state and the public pulse/manifest. It has no future reveal order or hidden solution. It can make poor choices; it is not an optimal player.
- **Solver:** Rebuild puzzle marks from actually revealed stumps, apply `nextStep()`/`applyStep()` eliminations until the first forced placement, and enumerate simultaneously forced squares. Reveal the first. No unrevealed placement is used to unlock another option.
- **Tactical:** Choose among those same solver candidates using the reactive one-turn score. This is a conservative player model with the solver's full technique repertoire, not a reconstruction of the recorded player's knowledge.
- **Oracle:** Use all remaining hidden solution cells with that same greedy score. This is an explicitly privileged benchmark, not an exhaustive optimal upper bound.

Solver and tactical orders are modeled even when their source is a recording. The oracle is always separate. Random shuffles are counterfactuals, not feasible player strategies. Fixed-order readiness can observe the pulse being considered, but cannot change which pulse comes next. Modeled hint reveals become player reveals, since the solver is making the choice; exact replay retains hint sources.

The five experimental loadouts are the existing Wanderer, a broader coverage set, a deliberately overlapping set (herbs/shield/dagger share colors), a specialist charge weapon with an any-color cooldown weapon, and the Hunter. The Hunter has 20 health and prioritizes an any-color sling (two-turn cooldown; damage 2/3/4/5 across the usual size bands), followed by the dagger, shield, and herbs. This tests readiness choices when a flexible attack competes with every other item. The ordinary wolf, a faster wolf, a slower harder-hitting brute, and the rockfall objective test different pressures. These variants live in the simulation harness; they do not expand the game's equipment catalog.

## What the metrics mean

Survival through a resolved encounter, encounter success, death, live-at-limit, and solver stall are distinct. Survival lies between the resolved-survivor fraction and that fraction plus live-at-limit/stalled trials. Surviving an objective failure is survival, but not success. The roughly 95% opening target applies to sensible management of starting equipment against the ordinary first encounter; it is not a hard unit-test threshold.

Raw metrics include effective outgoing damage, net incoming damage (including overkill), damage in the first three turns, blocked damage, effective healing, resolution turn, combat turns, resources and their postcombat subset, per-item activations, completed charges, readiness changes, and actions before the first enemy attack.

Energy is counted in region squares. Discarded energy is split into uncovered colors, cooldowns, and other context/readiness restrictions. Energy accepted into an unfinished charge is consumed but separately counted as abandoned at a round boundary or death. Full-health healing is routed but restores zero health. Thus a low discard percentage alone does not establish useful equipment. Supplies totals also depend on how many puzzles an encounter lasts; compare combat fraction, resolution time, and resource income together.

## Evidence from the extended sample, before tuning

`pnpm simulate` with seed 4, after the tablet sample grew to 141 wins, produces 41,320 trials across the five loadouts: 83 exact 9×9 recordings (60 medium) and 12 generated medium boards. One 9×9 phone recording still has an unlocated mistake and is excluded from exact replay. No equipment or enemy values were tuned to obtain these results. An earlier run on 43 exact recordings (26 medium) produced 23,720 trials; the comparisons below replace that write-up. The twelve generated boards are unchanged, because they depend on the seed rather than the recordings.

For the 60 medium recorded openings against the ordinary wolf, pooling the two datasets with equal weight per play:

| Loadout | Passive mean damage taken | Reactive mean damage taken | Passive encounter successes | Reactive encounter successes |
|---|---:|---:|---:|---:|
| Wanderer | 13.62 | 13.62 | 60/60 | 60/60 |
| Broader coverage | 10.98 | 10.98 | 60/60 | 60/60 |
| Overlapping colors | 34.93 | 22.00 | 54/60, one death and five unresolved | 60/60 |
| Specialist | 11.88 | 13.37 | 59/60 | 59/60 |
| Hunter | 18.25 | 15.68 | 51/60, nine deaths | 59/60, one death |

This supports loadout-dependent management benefits: overlapping equipment improves substantially, while balanced equipment needs little tending. The specialist also demonstrates the limits of the simple greedy readiness heuristic: it takes more damage than passive play and does not save the one death, despite ending with more health on average. Damage alone is not the survival criterion.

The Hunter still benefits from readiness management. Reactive play avoids eight of the nine passive deaths in these observed medium openings. One tablet opening still kills the Hunter under reactive play, so management is a large advantage here and not a guarantee.

With the specialist on those same 60 medium openings, reactive solver order loses one character (a phone recording); choosing among solver-reachable stumps wins all 60 and reduces mean incoming damage from 12.88 to 12.50. The oracle reduces it further to 8.15. Tactical ordering is not universally better. On the Wanderer it is a small improvement (14.00 to 13.97) and it avoids the one solver death, but broader coverage takes slightly more damage under tactical order while also avoiding a solver death. On the twelve generated medium boards, Wanderer tactical ordering reduces damage slightly (14.58 to 14.42), while the overlapping loadout's tactical heuristic performs worse than solver order (22.00 to 23.58). Report these mixed results, rather than assuming tactical labels imply optimal decisions.

Starting equipment survives the ordinary wolf in all 60 observed medium trials and all twelve generated solver/tactical trials, with no unresolved fights. This is a plausible opening, but cannot distinguish a true 95% survival rate from an overly forgiving enemy. More players and later progression are needed before claiming the target is calibrated. The larger pool did not create a Wanderer loss on observed order.

As a mistake sensitivity check, `pnpm simulate tests/barry-phone.csv --shuffles 1 --generated 0 --wrong 2 --out reports/phase4-wrong` includes all eighteen medium phone recordings with two seeded wrong turns per puzzle. Three of the eighteen observed-order, reactive Wanderer/wolf trials die. This is modeled stress evidence, not the ordinary zero-mistake opening target. Repeating this command produces byte-identical JSON.

Broader coverage reduces discarded energy in observed/reactive medium trials from 10.0% for the Wanderer to 1.6%, with average supplies increasing from 5.03 to 10.32 per trial. However, the current starter already covers eight of nine colors. It does not yet demonstrate the intended substantial early waste, and a broader loadout can dominate a weak one as expected for better loot. These are progression/content questions to revisit when choosing starting equipment and actual loot, rather than evidence to alter pulse routing now.

The strategic premise is supported for readiness with overlapping equipment, and more modestly for solver-constrained ordering. There is no evidence here that ordinary survival requires oracle ordering. Keep the existing mechanics for integration/playtesting, retain the faster enemies as stress cases, and revisit starting coverage and greedy-policy limitations before declaring balance complete. Bounded experiments cannot establish campaign economy safety or the relative value of actual loot draws.

Regression scenarios in `src/adventure/sim/simulation.test.ts` preserve overlapping full-health healing starving a lethal attack, multi-round continuity, postcombat rewards, cooldown loss, expiring charges, wrong-turn timing, censored outcomes, deterministic replay, and the solver/oracle information boundary. No engine changes were required by these experiments.

### Interactive loadout comparison

Enable **Show adventure mode** in Settings, then choose a **New run loadout** on the menu before pressing **New run**. All five simulator loadouts share their definitions with the playtest; the selector shows a one-sentence description and equipment in priority order. Changing the selection affects the next run, while Continue keeps the current run's equipment.

**Export adventure data** exports the current and last ten runs. New runs include `loadout` (the character id, starting health, and complete item definitions in priority order), in addition to the existing `start`, timestamped commands, and current state. Group runs by `loadout.id`; use `start.character` for older runs without that field, and `start.slots` for their exact equipment. The saved snapshot preserves colors, bands, cooldowns, and charge recipes even if shared content changes later. Solve JSON and CSV also include a `loadout` id for adventure wins; older and ordinary solve rows leave it blank. Use the run JSON to discuss deaths and unfinished encounters as well as wins.
