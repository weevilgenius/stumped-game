import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { decodeSeedCode, generate } from '../src/engine';
import { STARTERS } from '../src/adventure/content/campaign';
import { type RunPolicy, type RunReport, simulateRun } from '../src/adventure/sim/runs';
import type { SimulationRound } from '../src/adventure/sim/simulation';
import { parseTraces, replayRound, syntheticRound } from '../src/adventure/sim/traces';

/* Complete-run report: every starter on the same seeded maps and loot, planned and ordinary play, with and without mistakes. */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { seeds: { type: 'string', default: '50' }, out: { type: 'string', default: 'reports/runs' } },
});
const seeds = Number(values.seeds);
const files = positionals.length ? positionals
  : readdirSync('tests').filter((name) => name.endsWith('.csv')).sort().map((name) => `tests/${name}`);
const exact: SimulationRound[] = [];
const mistakes: SimulationRound[] = [];
for (const file of files) {
  for (const trace of parseTraces(readFileSync(file, 'utf8'), basename(file, '.csv')).traces.filter((t) => t.size === 9)) {
    const decoded = decodeSeedCode(trace.code);
    const input = replayRound(trace);
    if (!decoded || !input) continue;
    const puzzle = generate(decoded.settings, decoded.seed, decoded.version);
    exact.push({ puzzle, input });
    mistakes.push({ puzzle, input: syntheticRound(trace, 1, exact.length) });
  }
}
const mean = (xs: readonly number[]): string => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '-');
const pct = (n: number, d: number): string => `${((100 * n) / Math.max(1, d)).toFixed(0)}%`;
const rows: string[] = [];
const all: RunReport[] = [];
for (const starter of STARTERS) {
  for (const policy of ['planned', 'ordinary'] as RunPolicy[]) {
    for (const [label, pool] of [['exact', exact], ['1 synthetic mistake', mistakes]] as const) {
      const reports = Array.from({ length: seeds }, (_, seed) => simulateRun(starter, seed + 1, pool, policy));
      all.push(...reports);
      // Unluckiest tenth of loot paths: fewest gear gained.
      const unlucky = [...reports].sort((a, b) => a.gearGained - b.gearGained).slice(0, Math.max(1, Math.round(seeds / 10)));
      const row = (rs: readonly RunReport[], name: string): string => `| ${starter.name} | ${policy} | ${label} | ${name} | ${rs.length} | ${pct(rs.filter((r) => r.outcome === 'victory').length, rs.length)} | ${pct(rs.filter((r) => r.outcome === 'unfinished').length, rs.length)} | ${mean(rs.map((r) => r.column))} | ${mean(rs.map((r) => r.puzzles))} | ${mean(rs.map((r) => r.fightsWon))} | ${mean(rs.map((r) => r.escaped))} | ${mean(rs.flatMap((r) => r.healthAfterFights))} | ${mean(rs.map((r) => r.gearGained))} | ${mean(rs.map((r) => r.levels))} | ${mean(rs.map((r) => r.suppliesEarned))} | ${mean(rs.map((r) => r.suppliesSpent))} |`;
      rows.push(row(reports, 'all'), row(unlucky, 'unluckiest tenth'));
    }
  }
}
const report = [
  '# Complete-run simulation', '',
  `${seeds} seeded maps per row, ${exact.length} recorded 9x9 puzzles from ${files.join(', ')}. Every starter plays the same seeds, so maps, enemies, and loot rolls match; puzzles come from the pool in recorded order starting at an offset from the seed.`, '',
  'Planned picks the next deduced cell with a one-turn tactical score and readies only the item that should receive it; ordinary replays the recorded order with everything readied. The simulated player prefers fights and elites when healthy and rests or shops when below half health, takes all loot that fits, buys what it can afford, and rests to heal below 70% health. Unfinished means the puzzle pool ran out.', '',
  '| Starter | Policy | Mistakes | Loot luck | Runs | Won | Unfinished | Column | Puzzles | Fights won | Escaped | Health after fights | Gear gained | Levels | Supplies earned | Supplies spent |',
  '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...rows, '',
];
mkdirSync(values.out, { recursive: true });
writeFileSync(join(values.out, 'report.md'), `${report.join('\n')}\n`);
writeFileSync(join(values.out, 'results.json'), `${JSON.stringify(all, null, 2)}\n`);
console.log(report.join('\n'));
