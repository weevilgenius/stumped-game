/* ========================================================= *\
 *  Solve trace report                                       *
 *                                                           *
 *  Imports recorded solve logs, rebuilds every board from   *
 *  its seed code, prints collection statistics, and writes  *
 *  the exact replay rounds for the adventure simulator.     *
 *                                                           *
 *  Usage:                                                   *
 *    pnpm traces [files...]  (default every tests/*.csv)   *
 *    --out <file>  rounds JSON (default reports/rounds.json)
 *                                                           *
 *  Exits with status 1 if any recording is invalid.         *
\* ========================================================= */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import {
  checkBoard, median, parseTraces, replayRound, type SolveTrace, type TraceProblem, traceStats,
} from '../src/adventure/sim/traces';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string', default: 'reports/rounds.json' } },
});
const files = positionals.length > 0 ? positionals
  : readdirSync('tests').filter((name) => name.endsWith('.csv')).sort().map((name) => `tests/${name}`);

const traces: SolveTrace[] = [];
const problems: TraceProblem[] = [];
for (const file of files) {
  const dataset = basename(file, '.csv');
  const result = parseTraces(readFileSync(file, 'utf8'), dataset);
  problems.push(...result.problems);
  for (const trace of result.traces) {
    const message = checkBoard(trace);
    if (message) {
      problems.push({ dataset, id: trace.id, message });
    } else {
      traces.push(trace);
    }
  }
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;
const table = (title: string, groups: [string, SolveTrace[]][]): void => {
  console.log(`\n${title}`);
  console.log('group      games  pulses  first  last  first<=4  last>first  largest-late  max  median  first-3  last-3');
  for (const [name, group] of groups.filter(([, g]) => g.length > 0)) {
    const s = traceStats(group);
    console.log([
      name.padEnd(9), String(s.games).padStart(6), String(s.collections).padStart(7), String(s.medianFirst).padStart(6),
      String(s.medianLast).padStart(5), percent(s.smallFirst).padStart(9), percent(s.lastExceedsFirst).padStart(11),
      percent(s.largestLate).padStart(13), String(s.largest).padStart(4), String(s.medianPulse).padStart(7),
      percent(s.firstThreeEnergy).padStart(8), percent(s.lastThreeEnergy).padStart(7),
    ].join(' '));
  }
};

const tiers = (group: SolveTrace[]): [string, SolveTrace[]][] => (['easy', 'medium', 'hard'] as const)
  .map((tier) => [tier, group.filter((t) => t.tier === tier)]);
const sizes = [...new Set(traces.map((t) => t.size))].sort((a, b) => a - b);
const nine = traces.filter((t) => t.size === 9);

console.log(`Datasets: ${files.join(', ')}`);
table('All recordings', [['all', traces], ...tiers(traces)]);
table('By board size', sizes.map((size) => [`${size}x${size}`, traces.filter((t) => t.size === size)]));
table('9x9 (first sandbox)', [['9x9', nine], ...tiers(nine)]);

// Arrival order: median pulse at each collection number, for the sandbox size.
console.log('\n9x9 median pulse by collection number (givens excluded)');
for (const [name, group] of [['all', nine], ...tiers(nine)] as [string, SolveTrace[]][]) {
  const pulses = group.map((t) => t.events.filter((e) => !e.wrong && e.source !== 'given').map((e) => e.amount));
  const medians = Array.from({ length: 9 }, (_, i) => {
    const at = pulses.flatMap((p) => (i < p.length ? [p[i]] : []));
    return at.length === 0 ? '-' : String(median(at));
  });
  console.log(`${name.padEnd(9)} ${medians.map((m) => m.padStart(5)).join('')}`);
}
console.log('Every valid play has all N colors once each, with region sizes adding up to N×N.');

const rounds = traces.map(replayRound).filter((round) => round !== null);
console.log(`\nReplay rounds: ${rounds.length} of ${traces.length} (the rest lost acorns without recording where)`);
mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, `${JSON.stringify(rounds, null, 1)}\n`);
console.log(`Wrote ${values.out}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} invalid recordings:`);
  for (const p of problems) {
    console.error(`  ${p.dataset} ${p.id}: ${p.message}`);
  }
  process.exitCode = 1;
}
