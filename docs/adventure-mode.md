# Stumped Adventure Mode
*A proposed optional roguelike game driven by Stumped puzzles.*

## The concept

An adventurer travels through a world, encountering enemies, obstacles, treasures, characters, and difficult decisions. The goal is to complete a challenging adventure through a combination of strategy, luck, and puzzle-solving skill.

The adventure is **winnable but intentionally difficult**. Death ends a run, but players can immediately start again. The world may retain traces of previous adventures, and permanent unlocks could introduce new playable characters with different strengths and weaknesses—not simply make subsequent runs easier.

The adventure's setting and visual theme are still open.

## How Stumped powers the adventure

Each correct stump reveal produces a burst of energy:

- **Color:** Determined by the stump's region.
- **Strength:** Equal to the number of squares in that region.
- **Timing:** Energy becomes available immediately upon revealing the stump.

Each attempted reveal also advances the adventure by one tactical turn, even if the guess was incorrect. Ordinary X markings do not.

Small regions (2–3 energy) are typically solved early, while larger regions tend to be revealed later. Skilled players can deliberately change their reveal order to gain a tactical advantage, at the cost of extra mental effort.

## Equipment and abilities

A character has a small number of equipped items and abilities—perhaps four.

Each accepts particular colors and converts their energy into actions such as attacking, defending, healing, casting spells, or gathering resources.

For example:

- A dagger uses yellow energy to deal damage.
- A fire spell uses red energy, with damage scaling by energy strength.
- A shield accepts several colors but has a cooldown.
- An enchanted weapon requires charging with one color and activating with another.

**Energy is normally used immediately or lost, not accumulated.** Certain equipment may allow limited storage.

The player can toggle equipment between *ready* and *unready*. When a stump is revealed, its energy automatically activates the first eligible, readied item. The corresponding action animates immediately.

Readiness persists until changed, allowing players to solve puzzles with minimal extra interaction while still making tactical adjustments when necessary.

New equipment found during a run expands which colors the character can use and how effectively they're used. Finding good combinations is an important part of progression.

## Encounters and choices

The adventure includes combat and noncombat challenges: traveling, rescuing someone, overcoming barriers, negotiating, exploring, and more.

Encounters may involve:

- Enemies telegraphing attacks several reveals in advance.
- Collecting particular quantities or sequences of colors.
- Choosing between immediate benefits and longer-term rewards.
- Special options available only with certain equipment, abilities, or resources, similar to *FTL*.
- Risky decisions with consequences that carry through the adventure.

Encounters don't have to last exactly one puzzle. An easy enemy might be defeated after two reveals, leaving the rest of the puzzle for recovery, scavenging, or earning gold. A powerful enemy might survive across several puzzles.

**The Stumped puzzle always continues to completion**, regardless of the outcome of an encounter.

## Adventure progression

There are two scales of gameplay:

**During a puzzle:** Each stump attempt is a tactical turn. Resources are collected and immediately applied to combat or other activities. A small animated strip adjacent to the puzzle shows the adventure unfolding.

**Between puzzles:** The player sees the larger adventure, chooses routes, manages equipment, visits shops, uses consumables, and makes significant decisions. If an encounter is unfinished, it continues into the next puzzle.

Health, equipment, gold, inventory, and adventure progress persist throughout a run. Temporary color energy generally doesn't.

The player chooses an adventure difficulty that determines the size and logical difficulty of the Stumped puzzles, as well as the challenges encountered. This ensures that encounters and equipment requirements are appropriate for the available colors.

## The intended experience

The adventure should add a strategic dimension to Stumped without altering its core puzzle rules.

A casual player can mostly solve stumps normally, occasionally changing equipment or making adventure decisions. A more tactical player can carefully plan reveal order, prepare powerful combinations, exploit enemy weaknesses, and decide when to conserve particular colors.

Good equipment and clever decisions can produce exceptionally successful runs, while bad luck can doom even a skilled player.

The result should feel like **a real, replayable roguelike**, not simply an achievement or reward system attached to Sudoku.

## Still to be determined

The exact equipment slots and priorities, color affinities, resource conversion formulas, unused-energy behavior, character abilities, encounter balance, world structure, and visual theme remain open.

These will need experimentation and simulation using realistic Stumped solving patterns, particularly the tendency for small color regions to be revealed early.

The guiding goal is a game that is **easy to interact with, strategically rich, rewarding to replay, and challenging to win**.