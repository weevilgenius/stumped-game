import mark from './assets/sounds/mark.wav';
import correct from './assets/sounds/correct.wav';
import wrong from './assets/sounds/wrong.wav';
import win from './assets/sounds/win.wav';
import lose from './assets/sounds/lose.wav';
import owl from './assets/sounds/owl.wav';
import squirrel from './assets/sounds/squirrel.wav';
import woodpecker from './assets/sounds/woodpecker.wav';

/** Original, softly enveloped effects bundled for offline play. Regenerate with scripts/generate-sounds.py. */
export const SOUND_URLS = { mark, correct, wrong, win, lose, owl, squirrel, woodpecker } as const;

/** An action or outcome with an audible cue. */
export type GameSound = keyof typeof SOUND_URLS;
