/* ========================================================= *\
 *  Adventure simulation report (plan phase 4)               *
 *                                                           *
 *  Replays every exactly known 9x9 recording through the    *
 *  sandbox encounters under each loadout, readiness policy, *
 *  and reveal order, and checks the phase 4 targets.        *
 *                                                           *
 *  Usage:                                                   *
 *    pnpm simulate [files...]  (default every tests/*.csv) *
\* ========================================================= */

import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';
import { HUNTER, ROCKFALL, WANDERER, WOLF } from '../src/adventure/content/sandbox';
import type { CharacterDef, EncounterDef } from '../src/adventure/engine';
import {
  type EncounterResult, type Ordering, ORDERINGS, type Policy, POLICIES, type SimRound, simulateEncounter,
} from '../src/adventure/sim/simulate';
import { checkBoard, parseTraces, replayRound } from '../src/adventure/sim/traces';
import { decodeSeedCode, generate } from '../src/engine';

const files = process.argv.length > 2 ? process.argv.slice(2)
  : readdirSync('tests').filter((name) => name.endsWith('.csv')).sort().map((name) => `tests/${name}`);

const rounds: SimRound[] = [];
for (const file of files) {
  for (const trace of parseTraces(readFileSync(file, 'utf8'), basename(file, '.csv')).traces) {
    const replay = trace.size === 9 ? replayRound(trace) : null;
    const decoded = decodeSeedCode(trace.code);
    if (!replay || !decoded || checkBoard(trace)) continue;
    rounds.push({ puzzle: generate(decoded.settings, decoded.seed, decoded.version), turns: replay.turns });
  }
}

/** Shuffled orders per recording. */
const SHUFFLES = 10;
/** Rounds an encounter may last. */
const MAX_ROUNDS = 3;

const LOADOUTS: readonly CharacterDef[] = [WANDERER, HUNTER];
const ENCOUNTERS: readonly EncounterDef[] = [WOLF, ROCKFALL];

/** Each recording starts one encounter, continuing into the following recordings. */
const runAll = (character: CharacterDef, encounter: EncounterDef, policy: Policy, ordering: Ordering): EncounterResult[] => (
  rounds.flatMap((_, i) => {
    const sequence = Array.from({ length: MAX_ROUNDS }, (_, k) => rounds[(i + k) % rounds.length]);
    const seeds = ordering === 'shuffled' ? Array.from({ length: SHUFFLES }, (_, s) => (i + 1) * 1000 + s) : [1];
    return seeds.map((seed) => simulateEncounter(character, encounter, sequence, policy, ordering, seed));
  }));

const share = (results: readonly EncounterResult[], test: (r: EncounterResult) => boolean): number => (
  results.filter(test).length / results.length);
const pct = (value: number): string => `${Math.round(value * 100)}%`.padStart(6);
const mean = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

console.log(`Recordings: ${rounds.length} exactly known 9x9 games from ${files.join(', ')}`);
console.log(`Each starts an encounter that may run up to ${MAX_ROUNDS} rounds; shuffled uses ${SHUFFLES} orders each.`);

const wins = new Map<string, number>();
for (const encounter of ENCOUNTERS) {
  for (const character of LOADOUTS) {
    const covered = new Set(character.loadout.flatMap((item) => item.colors)).size;
    console.log(`\n${encounter.id} vs ${character.id} (${covered} of 9 colors covered)`);
    console.log('policy    order        won  died  failed  unfin  1-round  hurt  wasted  useful-first');
    for (const policy of POLICIES) {
      for (const ordering of ORDERINGS) {
        const results = runAll(character, encounter, policy, ordering);
        const won = share(results, (r) => r.outcome === 'won');
        wins.set(`${encounter.id}/${character.id}/${policy}/${ordering}`, won);
        const combat = results.reduce((a, r) => a + r.combatPulses, 0);
        console.log([
          policy.padEnd(9), ordering.padEnd(9), pct(won), pct(share(results, (r) => r.outcome === 'died')),
          pct(share(results, (r) => r.outcome === 'failed')).padStart(7),
          pct(share(results, (r) => r.outcome === 'unfinished')),
          pct(share(results, (r) => r.outcome === 'won' && r.rounds === 1)).padStart(8),
          mean(results.map((r) => r.healthLost)).toFixed(1).padStart(5),
          pct(results.reduce((a, r) => a + r.wasted, 0) / combat).padStart(7),
          encounter.type === 'enemy' ? pct(share(results, (r) => r.usefulBeforeFirstHit)).padStart(13) : '            -',
        ].join(' '));
      }
    }
  }
}

// Phase 4 targets and red flags (docs/adventure-mode-plan.md, phase 4 decisions).
const points = (a: string, b: string): number => Math.round(((wins.get(a) ?? 0) - (wins.get(b) ?? 0)) * 100);
console.log('\nTargets (wolf)');
for (const character of LOADOUTS) {
  const id = `wolf/${character.id}`;
  console.log(`  ${character.id}: readiness (reactive - passive, observed) ${points(`${id}/reactive/observed`, `${id}/passive/observed`)} points`);
  console.log(`  ${character.id}: reveal order (tactical - observed, reactive) ${points(`${id}/reactive/tactical`, `${id}/reactive/observed`)} points (target 5 to 10)`);
  console.log(`  ${character.id}: order matters (observed - shuffled, reactive) ${points(`${id}/reactive/observed`, `${id}/reactive/shuffled`)} points`);
}
const opening = runAll(WANDERER, WOLF, 'reactive', 'observed');
console.log(`  starting loadout deaths in its first encounter: ${pct(share(opening, (r) => r.outcome === 'died')).trim()} (target under 5%)`);
