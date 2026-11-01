import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { decodeSeedCode, generate, type Puzzle } from '../src/engine';
import mulberry32 from '../src/utils/mulberry';
import { ENCOUNTERS, LOADOUTS, runExperiments, summarize, type TrialRecord } from '../src/adventure/sim/experiments';
import { streamSeed } from '../src/adventure/sim/ordering';
import type { SimulationRound } from '../src/adventure/sim/simulation';
import { checkBoard, parseTraces, replayRound, type RoundTurn, syntheticRound } from '../src/adventure/sim/traces';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seed: { type: 'string', default: '4' }, shuffles: { type: 'string', default: '8' },
    generated: { type: 'string', default: '12' }, rounds: { type: 'string', default: '3' },
    wrong: { type: 'string', default: '0' }, out: { type: 'string', default: 'reports/phase4' },
  },
});
const integer = (name: 'seed' | 'shuffles' | 'generated' | 'rounds' | 'wrong', min: number, max: number): number => {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  return value;
};
const config = {
  seed: integer('seed', 0, 0xFFFFFFFF), shuffles: integer('shuffles', 1, 1000),
  generated: integer('generated', 0, 1000), maxRounds: integer('rounds', 1, 100), wrong: integer('wrong', 0, 2),
};
const files = positionals.length ? positionals
  : readdirSync('tests').filter((name) => name.endsWith('.csv')).sort().map((name) => `tests/${name}`);
const pools = new Map<string, SimulationRound[]>();
const puzzles = new Map<string, Puzzle>();
const exclusions: string[] = [];
const datasetCounts: Record<string, number> = {};
const fingerprints: Record<string, string> = {};
for (const file of files) {
  const dataset = basename(file, '.csv');
  if (datasetCounts[dataset] !== undefined) throw new Error(`Duplicate dataset name: ${dataset}`);
  const csv = readFileSync(file, 'utf8');
  fingerprints[file] = createHash('sha256').update(csv).digest('hex');
  const result = parseTraces(csv, dataset);
  if (result.problems.length) throw new Error(JSON.stringify(result.problems));
  datasetCounts[dataset] = 0;
  for (const trace of result.traces.filter((t) => t.size === 9)) {
    const input = config.wrong > 0 ? syntheticRound(trace, config.wrong, streamSeed(config.seed, `${dataset}/${trace.id}/wrong`)) : replayRound(trace);
    if (!input) {
      exclusions.push(`${dataset}/${trace.id}: unrecorded wrong turns`);
      continue;
    }
    const problem = checkBoard(trace);
    if (problem) throw new Error(`${dataset}/${trace.id}: ${problem}`);
    let puzzle = puzzles.get(trace.code);
    if (!puzzle) {
      const decoded = decodeSeedCode(trace.code)!;
      puzzle = generate(decoded.settings, decoded.seed, decoded.version);
      puzzles.set(trace.code, puzzle);
    }
    const key = `${dataset}/${trace.tier}`;
    const pool = pools.get(key) ?? [];
    pool.push({ puzzle, input });
    pools.set(key, pool);
    datasetCounts[dataset]++;
  }
}
const generated: SimulationRound[] = [];
for (let index = 0; index < config.generated; index++) {
  const puzzle = generate({ size: 9, tier: 'medium', freebies: 0, silver: false, shape: 2, sizeMix: 2 }, streamSeed(config.seed, `board/${index}`));
  const turns: RoundTurn[] = puzzle.solution.map((cell) => ({
    type: 'collect', color: puzzle.colors[puzzle.regions[cell]],
    amount: puzzle.regions.filter((r) => r === puzzle.regions[cell]).length, source: 'player',
  }));
  const wrongRng = mulberry32(streamSeed(config.seed, `generated/${index}/wrong`));
  for (let i = 0; i < config.wrong; i++) turns.splice(Math.floor(wrongRng() * turns.length), 0, { type: 'wrong' });
  generated.push({ puzzle, input: {
    dataset: 'generated-9-medium', id: String(index), code: puzzle.code, size: 9, tier: puzzle.tier, sequence: 'synthetic',
    turns,
  } });
}
const records: TrialRecord[] = [];
for (const [key, pool] of pools) {
  console.log(`Simulating ${key}: ${pool.length} recorded puzzles`);
  records.push(...runExperiments(pool, 'recorded', config));
}
if (generated.length) {
  console.log(`Simulating ${generated.length} generated 9x9 medium puzzles (no freebies)`);
  records.push(...runExperiments(generated, 'generated', config));
}
if (!records.length) throw new Error('No 9x9 experiments selected');

const groups = new Map<string, TrialRecord[]>();
for (const record of records) {
  const key = [record.sources[0].dataset, record.tier, record.loadout, record.encounter, record.order, record.readiness].join(' / ');
  const group = groups.get(key) ?? [];
  group.push(record);
  groups.set(key, group);
}
const summaries = [...groups].map(([group, rows]) => ({ group, ...summarize(rows) }));
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const comparisons: string[] = [];
const bases = [...new Set(records.map((r) => [r.sources[0].dataset, r.tier, r.loadout, r.encounter].join(' / ')))];
for (const base of bases) {
  const pairs = [
    ['readiness (observed)', 'observed / passive', 'observed / reactive'],
    ['readiness (shuffled)', 'shuffled / passive', 'shuffled / reactive'],
    ['order (observed vs shuffled)', 'observed / reactive', 'shuffled / reactive'],
    ['order (solver vs tactical)', 'solver / reactive', 'tactical / reactive'],
    ['privileged oracle', 'tactical / reactive', 'oracle / reactive'],
  ];
  for (const [label, from, to] of pairs) {
    const a = summaries.find((s) => s.group === `${base} / ${from}`);
    const b = summaries.find((s) => s.group === `${base} / ${to}`);
    if (!a || !b) continue;
    comparisons.push(`| ${base} / ${label} | ${(a.damage - b.damage).toFixed(2)} | ${(b.health - a.health).toFixed(2)} | ${((b.success - a.success) * 100).toFixed(1)} | ${((a.waste - b.waste) * 100).toFixed(1)} |`);
  }
}
const report = [
  '# Phase 4 strategic simulation', '',
  `Configuration: \`${JSON.stringify(config)}\`. Datasets: \`${JSON.stringify(datasetCounts)}\`.`, '',
  `Excluded: ${exclusions.length} recordings with unknown turn order. ${records.length} deterministic trials.`, '',
  'These are bounded first-encounter experiments, not campaign win rates. Each trial carries an encounter over distinct puzzles in dataset order, within the same dataset/tier, up to the round limit. Trials overlap and shuffle replicates are not independent players.', '',
  'Observed = exact recording unless --wrong is supplied (then labeled synthetic in JSON). Shuffled preserves color/size pairs and wrong-turn positions; it is a counterfactual. Solver takes the first simultaneous forced cell after solver eliminations; tactical scores only those same cells. Oracle uses all hidden solution cells with the same greedy heuristic; it is a privileged benchmark, not an exhaustive optimum.', '',
  'Reactive readiness previews one turn for each possible receiving slot, using current health, block, telegraphs, visible region sizes and charge recipes. It knows no future order. It may skip a pulse. Tactical uses this same heuristic to choose a reachable cell. All generated boards are 9x9 medium with freebies off; recordings retain their original givens.', '',
  'Survived is survival through a resolved encounter. Live encounters at the limit and solver stalls remain separate; the survival interval is [survived, survived + limit + stalled]. Success requires defeating the enemy or completing the objective. Objective failure with a living character counts toward survival, not success. Death after resolution in the final puzzle overrides survival. The opening target is roughly 95%, evaluated on the starting loadout and ordinary wolf, with reactive readiness. A small, single-player sample cannot establish a population rate.', '',
  'Waste counts discarded squares; unfinished charges are reported separately as a fraction of all collected squares. Routing is not necessarily useful: full-health healing and incomplete charges can consume pulses. JSON includes effective healing, per-item activations, coverage/cooldown/context discards, supplies, opening actions, early damage and resolution turns.', '',
  '## Matched comparisons', '',
  'Differences are second policy minus first, except damage and waste where positive means a reduction. Each comparison uses identical board pools; shuffle replicates preserve equal weight per opening board. These are descriptive paired experiments, with no statistical independence claimed. An imperfect greedy policy can perform worse.', '',
  '| Dataset / tier / loadout / encounter / comparison | Damage saved | Health gained | Success gained (pp) | Waste reduced (pp) |',
  '|---|---:|---:|---:|---:|', ...comparisons, '',
  '## Detailed groups', '',
  '| Dataset / tier / loadout / encounter / order / readiness | Trials | Survived | Success | Death | Limit | Stall | Damage | Health | Resolution turn | Combat | Waste | Lost charges | Supplies |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...summaries.map((s) => `| ${s.group} | ${s.n} | ${pct(s.survived)} | ${pct(s.success)} | ${pct(s.death)} | ${pct(s.unresolved)} | ${pct(s.stalled)} | ${s.damage.toFixed(2)} | ${s.health.toFixed(2)} | ${s.resolutionTurn?.toFixed(2) ?? '—'} | ${pct(s.combat)} | ${pct(s.waste)} | ${pct(s.abandonedCharges)} | ${s.supplies.toFixed(2)} |`),
  '', '## Exclusions', '', ...exclusions.map((line) => `- ${line}`), '',
];
mkdirSync(values.out, { recursive: true });
writeFileSync(join(values.out, 'results.json'), `${JSON.stringify({
  schema: 1, config, files, fingerprints, datasetCounts, exclusions, loadouts: LOADOUTS, encounters: ENCOUNTERS, summaries, records,
}, null, 2)}\n`);
writeFileSync(join(values.out, 'report.md'), `${report.join('\n')}\n`);
console.log(`Wrote ${values.out}/report.md and results.json`);
