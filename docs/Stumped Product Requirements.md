# Stumped: Product Requirements

Oct 2, 2026 · @Barrett Stump

## Overview

This is a personal remake of the region-based cat placement puzzle Meowdoku, built for one family that likes the puzzle and dislikes the ads. It keeps the core puzzle and the fast marking gestures, drops the monetization and most of the decoration, and adds undo, a hypothesis mode, explainable hints, and best times.

The puzzle is mechanically the same as a one-star Star Battle (also known as Queens): an N by N grid, N colored regions, one piece per row, column, and region, with no two pieces touching.

**Goals**

- Fast, smooth, accurate marking by tap and drag on phone and tablet.
- Every puzzle has exactly one solution and is solvable by deduction alone.
- More variety than the original in board shapes, colors, and difficulty.
- Tools for hard puzzles: undo and a hypothesis layer.
- Best times per size and difficulty in place of a score.

**Non-goals**

- A faithful replica of the original's art, sound, or progression.
- Onboarding for new players. Everyone using this already knows the rules.
- Accounts, a server, or shared leaderboards in the first version. A backend can be added later.

**Technology.** Web technology, mobile first. Specific technology choices are outside the scope of this document.

**Theme.** The name is Stumped, with a woodland theme. The table below maps each element of the original to its Stumped equivalent, and the rest of this document uses the Stumped terms.

| Original | Stumped |
| --- | --- |
| Cat, the hidden piece | Tree stump |
| Color region | Patch of forest floor |
| Fish, a life | Acorn |
| Golden fish level, played with one life | Silver acorn mode |
| Reveal hint (cat icon) | Woodpecker |
| Explain hint (light bulb icon) | Owl |
| Eliminate hint (mouse icon) | Squirrel |
| No-touching rule | Stumps need their personal space |
| Losing the puzzle | "Stumped." |

## Game rules

A board is an N by N grid divided into N colored regions, with N hidden stumps, where N is 5 to 10. Each region is a single connected area.

**Placement rules**

1. Exactly one stump in each row.
2. Exactly one stump in each column.
3. Exactly one stump in each color region.
4. No two stumps touch, including diagonally.

**Starting state.** Most boards start with every stump hidden. A board may occasionally start with one stump already revealed, or contain a one-square region, as long as that does not collapse the puzzle (see Puzzle engine).

**Lives.** A puzzle starts with three acorns. Each wrong reveal costs one. In silver acorn mode the puzzle starts with a single acorn.

**Winning.** The puzzle is won when the last stump is revealed.

**Losing.** The puzzle is lost when the last acorn is gone. The app returns to the main screen, where the player can retry the same puzzle from a blank board or start a new one.

## Board interaction

Responsiveness is the top requirement: every gesture takes effect immediately and drag strokes never skip squares. A single tap must not wait for a possible double tap before showing its result.

| Gesture | Starting on | Result |
| --- | --- | --- |
| Tap | Unmarked square | Places an X |
| Tap | X | Removes the X |
| Drag | Unmarked square | Places an X on every unmarked square the stroke crosses |
| Drag | X | Erases every X the stroke crosses |
| Double tap | Any unrevealed square, with or without an X | Attempts to reveal a stump |

Drags never change revealed stumps or red X's. A long press as an alternative reveal gesture is a possible later option.

**Correct reveal.** The stump appears at once. A small reveal animation may play, and the player can start marking X's while it runs. The game does not mark any X's for the player.

**Wrong reveal.** The square gets a red X that stays for the rest of the puzzle, and one acorn is lost. If the guess broke a rule against a stump that is already revealed, the game first shows which stump it conflicts with, for example a line to the stump in the same column or color. The wrong-reveal animation blocks input until it finishes.

**Wrong X's.** The game gives no feedback when an X sits on a stump's square. Only the explain hint will point it out.

**Undo.** One undo button with an unlimited stack and no redo. Each tap or whole drag stroke is one step. Reveals, lost acorns, and hint results are permanent and are not undone.

## Hypothesis mode

Hypothesis mode is a single scratch layer for "if a stump is here, then what" reasoning, the equivalent of paper and pencil. A toggle button turns it on and off.

**While it is on**

- Double tap places a tentative stump. It is not checked against the solution and costs no acorn. Tentative stumps are drawn smaller than revealed ones.
- X's drawn are hypothesis X's: smaller, placed in the upper right of the square, and tinted. Size and position carry the distinction, not color alone.
- Tap and drag work the same way as in normal play, acting on hypothesis marks. Tapping a tentative stump removes it. Normal X's cannot be changed while the mode is on.
- A tentative stump that breaks one of the four rules against a revealed stump or another tentative stump is flagged. No other contradiction is detected.

**Leaving the mode**

- **Discard** removes every tentative stump and hypothesis X.
- **Keep** turns the hypothesis X's into normal X's and removes the tentative stumps. The player still double taps each stump in normal play, with the usual acorn risk.

**Undo.** Hypothesis mode has its own undo stack, separate from the one for normal play. Undo steps back through hypothesis marks only. It never enters or leaves the mode, so turning the mode on, Discard, and Keep cannot be undone.

**Limits.** There is one layer, with no nesting. Using the mode is not recorded and does not affect a clean result.

## Hints

Each puzzle allows one use of each of three hints. There is nothing to earn, buy, or run out of across puzzles. Using any hint marks the result as helped.

| Hint | Icon | What it does |
| --- | --- | --- |
| Reveal | Woodpecker | Reveals the stump in the color region with the fewest open squares |
| Explain | Owl | Shows the simplest available deduction and explains it |
| Eliminate | Squirrel | Places X's on three random unmarked squares that hold no stump |

**Explain details**

- If any of the player's X's sits on a stump's square, the hint points that out first and removes that X when closed.
- Otherwise it highlights the squares involved in the deduction and states the reasoning.
- Explanations with several steps can be stepped through backward and forward.
- When the explanation is closed, the game makes the resulting mark for the player. Depending on the deduction, that is a single X, several X's (as with N regions in N lines), or a revealed stump (for a region, row, or column with one unmarked square).

**Eliminate details.** The three squares are picked at random from the unmarked squares that hold no stump, with no analysis. If fewer than three remain, it marks those. The hint is weak early and still useful when the player is stuck late.

## Puzzle selection

There is no level sequence. By default each new puzzle has a random size and a random difficulty, and settings can fix either one.

- **Size:** 5 to 10, or random.
- **Difficulty:** easy, medium, hard, or random. Tiers are defined in Puzzle engine.
- **Silver acorn mode:** a setting that gives every puzzle a single acorn. When the setting is off and selection is random, about one puzzle in five is still a silver acorn puzzle.

**Seed codes.** Every puzzle has a short code that reproduces the identical board: size, difficulty, generator settings, layout, region colors, and whether it is a silver acorn puzzle. Entering a code, or opening a link that contains one, starts that puzzle. Screen orientation is a device preference and is not part of the code.

Seed codes are how two people play the same puzzle or share an interesting one. No server is involved.

## Results and best times

There is no score. Each completed puzzle records its time plus icons for anything that qualified the solve.

| Recorded | Shown as |
| --- | --- |
| Time to completion | The time |
| Hints used | An icon per hint used |
| Acorns lost | An icon with the count |
| Silver acorn mode | An icon |
| Repeat play of the same puzzle | An icon |
| Clean solve | A star |

**Clean solve.** No hints, no acorns lost, and the first play of that puzzle on this device.

**Repeat plays.** Every completed play is recorded, so a puzzle played several times has several times. The app remembers which puzzles have been played. Any later play of one, whether by retry or by entering its seed code, is marked as a repeat and cannot be clean.

**Best times.** Kept per size and difficulty. Every time is kept for now, and a cap may be added later. Starred times are listed above all others, then the rest by time.

**Timer.** It runs from the start of the puzzle and pauses while the app is in the background. A setting hides it during play, and the time is still recorded.

**Not recorded.** Use of hypothesis mode, the "Perfectly Marked" message, play streaks, and lost puzzles.

## Screen and feedback

The app has two screens: a main screen for everything outside of play, and a puzzle screen with only what is needed during play.

**Main screen**

- A colorful Stumped logo.
- A New puzzle button, always visible. If a puzzle is in progress, the app asks for confirmation first.
- A thumbnail of the current puzzle, when there is one. The current puzzle is the most recent one, in progress or finished. Tapping the thumbnail resumes a puzzle in progress.
- Share and Retry buttons, below or beside the thumbnail.
- The completion time, shown with the thumbnail once the puzzle has been completed.
- A way to enter a seed code and play that puzzle.
- View best times.
- Settings.

**End of a puzzle.** After a win or a loss, a short animation plays and the app returns to the main screen. From there the player can retry, share the puzzle, or start a new one.

**Puzzle screen**

- The board, as large as the screen allows.
- A stump count such as 2/9.
- The remaining acorns.
- The timer, when enabled.
- Three hint buttons, each showing whether it has been used.
- Undo.
- The hypothesis toggle, with Discard and Keep while the mode is on.
- A single back button that returns to the main screen. The puzzle is saved and the timer pauses, so it can be resumed from there.

**Animations**

1. When every other square in a revealed stump's row, column, or color region is marked, those squares pulse once.
2. When the last stump is revealed and no square is left unmarked, the game shows "Perfectly Marked".

Discreet animations are also fine for a correct reveal and for an X appearing or disappearing, as long as input stays live while they play. The wrong-reveal animation is the one exception: it blocks input until it finishes.

**Colors.** Ten solid colors, taken from Meowdoku. There is no symbol overlay mode. The list is in priority order. A puzzle of size N uses the first N and assigns those to regions at random. The first five are one hue each: gold, blue, rose, green, and teal. The rest are similar enough to be possibly confusing, organized so they stay off the smaller boards. Orange sits next to gold, brown next to rose, purple next to blue, and light blue next to teal.

| Name | Hex |
| --- | --- |
| Gold | `#E4BB49` |
| Blue | `#5B75B2` |
| Rose | `#D57374` |
| Green | `#AED994` |
| Teal | `#48B5B2` |
| Pink | `#FAB4D0` |
| Light blue | `#A7BFD7` |
| Purple | `#9778D6` |
| Brown | `#AD6F48` |
| Orange | `#FEAA6C` |

**Orientation.** Portrait and landscape are both supported on phone and tablet.

**Sound and haptics.** None.

## Platform

The app runs entirely on the device, with no server.

- **Saving.** The puzzle in progress saves after every changed mark, reveal, and hint, including marks, the hypothesis layer, acorns, hints used, and elapsed time. After a crash or a relaunch the app resumes it quickly, with nothing lost.
- **Offline.** The app installs to the home screen and works with no connection. Puzzles are generated on the device.
- **Data.** Settings and best times are stored locally per device. There are no accounts.
- **Performance.** Input stays smooth on a phone or tablet while anything else is happening. Puzzle generation must never stall the board.

**Settings**

- Timer shown or hidden.
- Size: fixed or random.
- Difficulty: fixed or random.
- Silver acorn mode.
- Region shape controls (see Puzzle engine).

## Puzzle engine

This section is written to be handed to the coding agent on its own. One rule-based solver does three jobs: it proves each puzzle is solvable without guessing, rates its difficulty, and drives the explain hint.

### Solver

The solver works the way a person does. It repeatedly applies the simplest technique that makes progress, and it records each step so the step can be shown as an explanation. It never guesses.

A puzzle is valid only if it has exactly one solution and the solver finishes it using the techniques below.

### Techniques and tiers

"Line" means a row or a column. "Open" means not yet ruled out.

| Technique | Description | Tier |
| --- | --- | --- |
| Stump elimination | A known stump rules out the rest of its row, column, and region, and its eight neighbors | Easy |
| Forced square | A row, column, or region with one open square holds a stump there | Easy |
| One region in one line | A region whose open squares all sit in one line rules out the rest of that line | Easy |
| Two in two, three in three | N regions whose open squares fit inside N lines rule out the rest of those lines, for N of 2 or 3 | Medium |
| Four in four, five in five | The same for N of 4 or 5 | Hard |
| Multi-step chain | A stump in this square would, after several steps, leave some row, column, or region with no open square, so the square is ruled out | Hard |
| One-step blocking | A stump in this square would at once leave some row, column, or region with no open square | Medium |

The confinement techniques also apply in reverse: N lines whose open squares all fall inside N regions rule out the rest of those regions.

**Rating.** A puzzle's tier is the hardest technique the solver needed.

**Tuning.** These tiers are a starting point and skew slightly hard on purpose. Several shape tricks are easy to learn and can make a puzzle collapse into easier forms, so expect to adjust the tiers after real play.

### Generator

The generator produces a board for a requested size and tier from a seed. The same seed, settings, and generator version always give the same board, which is what makes seed codes work. The code must therefore carry the generator version.

A suggested approach: place a legal set of stumps, grow a connected region around each one, then check the result with the solver and reject or adjust it until it has one solution and the requested tier.

**Freebies.** A pre-revealed stump or a one-square region may appear, more often at easy and medium and rarely at hard. The puzzle must still need its tier's techniques afterward.

**Variety controls**

- Region size mix, from one dominant region with small neighbors to regions of similar size.
- Region shape, from compact blobs to long thin runs.
- How often freebies appear.

In random mode these vary from puzzle to puzzle. Region colors are assigned at random.

**Speed.** Generation runs in the background, and the next puzzle should be prepared ahead of time so starting one is instant.

## Out of scope

These parts of the original are deliberately left out.

- Ads, and earning or buying hints.
- The score, level numbers, and the difficulty ramp.
- Timed leaderboard competitions.
- Daily play streaks and their rewards.
- The rule reminder cards and the per-color cat tracker.
- The symbol overlay for telling colors apart.
- Heavy decorative animation such as idle cat faces, particles, and sparkles, the level-complete screen, voice, sound, and haptics.

These were considered for the remake and declined.

- Automatic X's after a reveal.
- Redo.
- Nested hypotheses and per-square pencil marks.
- Feedback on wrong X's outside the explain hint.

## Open questions

Decisions still to make.

- [ ] Tier tuning after real play.
- [ ] Whether to cap the number of best times kept.
