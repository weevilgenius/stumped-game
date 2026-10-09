# Stumped

Stumped is a mobile-first, offline puzzle game for the Stump family. It is a
personal remake of Meowdoku that keeps the region-based placement puzzle and
quick marking gestures while removing ads.

Each puzzle has an N × N grid divided into N connected, colored regions. Place
one stump in every row, column, and region, with no two stumps touching—even
diagonally. Boards range from 5 × 5 to 10 × 10.

The game is designed for phones and tablets, runs entirely on the device, and
needs no account or internet connection. Its woodland theme turns the original
cats into stumps, color regions into patches of forest floor, and hints into
woodpeckers, owls, and squirrels.

See [Stumped Product Requirements](docs/Stumped%20Product%20Requirements.md)
for the full design and game rules.

## Agent bake-off

Four agents independently built the game from clean copies of the same commit,
with dependencies installed and the project assets, tests, screenshot utility,
and Phaser 4 guidance available. Each received the prompt:

> Read [@docs/Stumped Product Requirements.md](docs/Stumped%20Product%20Requirements.md)
> and implement the game using Phaser 4. The core engine has already been
> implemented (see [@src/engine/README.md](src/engine/README.md)). Verify your
> work using tests and the screenshot utility, which you should enhance as
> needed.

Each agent was run at high or extra high effort level.

| Agent | Branch | Play | Tokens | Cost |
| --- | --- | --- | ---: | ---: |
| Gemini 3.8 Flash | [gemini](https://github.com/weevilgenius/stumped-game/tree/gemini) | [Play](https://weevilgenius.github.io/stumped-game/gemini/) | 27.8 million | $3.24 |
| Grok 4.7 | [grok](https://github.com/weevilgenius/stumped-game/tree/grok) | [Play](https://weevilgenius.github.io/stumped-game/grok/) | 16.2 million | $6.00 |
| Fable 5.1 | [fable](https://github.com/weevilgenius/stumped-game/tree/fable) | [Play](https://weevilgenius.github.io/stumped-game/fable/) | 21.4 million | $26.40 |
| GPT 6 Astra | [astra](https://github.com/weevilgenius/stumped-game/tree/astra) | [Play](https://weevilgenius.github.io/stumped-game/astra/) | 8.3 million | $14.99 |

### Notes

All of the agents had to create their own "X" sprites with mediochre results. I used
screenshots from the original game while crafting the PRD and to extract useful region
colors, but I did not give the agents any screenshots to work with. Giving each agent
a screenshot utility to inspect its work was critical to getting good results without
extensive prompting.

My personal summary:

Gemini's game worked but was less polished and more error prone than the others. I
was worried about its ability to complete the game in one shot, which is why I ended
up building the core engine separately and providing it to the agents. Grok's result
was servicable but not stand out. Fable's implementation had the best animations and
game play interaction. Astra leaned hard into the theme and built a very elaborate
(and amusing) home screen.

### Running the agent versions

Clone the repository. Then run:

```
git switch <agent_branch>
pnpm install
pnpm run dev
```