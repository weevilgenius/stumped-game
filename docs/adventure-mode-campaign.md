# Phase 7 hybrid playtest

The hybrid starts from current `main`, using PR #80's single engine command path,
controller, ongoing puzzle records, replay reports, and tested press handling.
It uses PR #79's tier-specific gear and enemy tables, varied text events, and
level-as-data calculation. Run management has three destinations: **Here** for
the encounter, loot and current location; **Gear** for equipped items, reserves
and consumables; and **Map** for the route. Cards scroll without truncating exact
values, with wheel, touch and keyboard buttons. The map shows three columns on
phones or five on larger screens, and derives its bounds from the saved map.

## Rules and provisional content

New maps have 23 columns, including a guaranteed first shop in column 4, three
forage locations, recovery choices, elites, and a final Warden fight. This adds
room for the revised 18–27 puzzle target; it does not establish the eventual
balance or duration. Existing maps retain their original routes on import.
Zones, acts, real-time rules and changes to the puzzle/combat relationship remain
outside this experiment.

The conventional starters remain Ranger and Sentinel. Winning unlocks Herbalist
in storage separate from the run history. Campaign puzzles are 9×9 medium with
no freebies or random silver mode. Ordinary puzzles keep their independent save,
clock and statistics. The original concept-probe sandbox loadouts remain available
for explicitly labeled comparisons.

Four ordered equipment slots route each pulse to the first eligible readied
item. Three pack slots hold reserve items, and three consumable slots hold
emergency healing, block or damage. Consumables are rare: shops, elites (one
per kill) and some events are the only sources. Readiness is free during puzzles. Equipment
swaps and reordering are allowed between puzzles, including during unfinished
fights; the whole item state moves with the item. Countdown continuity and normal
round resets still apply. Movement and shopping wait until combat is over.

Equipment rolls use tier-specific definitions and independently shuffled colors.
Enemies draw from tier-specific attack patterns and either enrage or escape to
bound stalling. Enemy selection, harvest colors, text events and loot use seeded
streams. Shops have fixed stock. Elite kills provide more gear, higher danger
tiers where possible, and more harvest colors. Numerical balance remains
provisional, especially healing and the economy.

After combat, matching readied attack/block equipment earns experience. Ten
harvested squares earn one band step, at most once per item per fight, with a
maximum of three levels. Base band definitions never change: activation and
inspection apply the stored level. Above the top band, each step repeats that
band's increase. Rest improvement uses the same cap. Healing and forage items
continue their effects after combat, including any rest-earned improvement.
Unclaimed harvest colors become supplies; other colors fizzle. Extra combat
puzzles reduce the harvest. Forage locations provide one puzzle of supplies.

Replaced and dropped equipment stays at the current stop with its level,
experience, readiness and timers intact. Shop purchases can directly replace an
equipped item even with a full pack. Moving on leaves unclaimed items behind.
Loot and rewards are committed with the engine state, so reloads do not reroll
or award them again. Consumables cost no tactical turn. Boss victory locks on
the kill; remaining harvest finishes before the terminal summary.

## Save compatibility and evidence

The adventure save format is now **2**, and campaign content revision is **2**.
Both version-1 phase-7 prototypes and older sandbox saves can be imported. PR #79
numeric maps, inventories, consumables and current stops convert to the shared
engine representation. PR #80's baked-in item improvements convert back to base
bands plus a level. Imported levels obey the new cap. The original save remains
verbatim under `previous`, including its historical commands and puzzle records.
The imported current state becomes a new replay baseline, avoiding the false
claim that historical commands replay under different rules. Malformed imports
use the controller's existing recovery-copy path.
PR #79 did not retain aggregate fight/economy counters; its resumed summary labels
those counters as starting at import, while the original journal remains intact.

Future content updates refresh known gear and enemy definitions while preserving
colors, levels, timers, charges, countdowns, and damage already dealt. Removed
item definitions remain usable. An active enemy keeps at least one health when
its reduced maximum would otherwise kill it during an update. A content refresh
also starts a new journal baseline with the original save retained for analysis.

Puzzle records update throughout play, including unfinished and fatal puzzles.
They retain seed codes, generation settings, palette mapping, active reveal and
mistake timing, hints, What if? entries, and every observed app/content version.
Starting a replacement run explicitly abandons the previous one before archive.

## Experiments

`pnpm campaign --seeds 10 --generated 40 --rounds 40` writes a report and raw JSON
to `reports/phase7/`. Use `--generated-only` for generated board geometry alone,
or positional CSV paths to choose recordings. Other options are `--seed`,
`--generated`, `--rounds`, and `--out`.

Trials use actual starters with ordinary or banked solver deductions and with
zero or one labeled synthetic mistake per puzzle. Their equipment policies
include coverage, weak-color and recovery preferences. A full inventory does
not stop progression: incoming loot and shop gear can replace existing items,
and comparisons include effect strength, levels, charge and cooldown. This is a
simple explicit policy, not an optimal player. Source geometry, accepted command
journals, final definitions, health/gear/supply trajectories and unresolved runs
remain in the output. The observed lowest tenth of offered color widths is a
descriptive proxy, not an independent measure of loot luck.

Earlier phase-7 simulation results describe different rules and player policies.
They must not be pooled with the hybrid's results. Human playtesting still needs
to establish clarity, meaningful equipment choices, difficulty and run length.
