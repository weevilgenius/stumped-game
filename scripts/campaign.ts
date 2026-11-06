import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { CONTENT_VERSION, STARTERS } from '../src/adventure/content/campaign';
import { simulateCampaign, type CampaignTrial, type GearPolicy } from '../src/adventure/sim/campaign';
import { deriveSeed } from '../src/adventure/engine';
import type { SimulationRound } from '../src/adventure/sim/simulation';
import { checkBoard, parseTraces, replayRound } from '../src/adventure/sim/traces';
import { decodeSeedCode, generate } from '../src/engine';
import { version } from '../package.json';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  seed: { type: 'string', default: '7' }, seeds: { type: 'string', default: '10' },
  generated: { type: 'string', default: '30' }, rounds: { type: 'string', default: '30' },
  'generated-only': { type: 'boolean', default: false },
  out: { type: 'string', default: 'reports/phase7' },
} });
const integer = (key: 'seed' | 'seeds' | 'generated' | 'rounds', min: number, max: number): number => {
  const n = Number(values[key]);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${key} must be ${min} to ${max}`);
  return n;
};
const config = { seed: integer('seed', 0, 0xFFFFFFFF), seeds: integer('seeds', 1, 1000),
  generatedOnly: values['generated-only'], generated: integer('generated', 0, 500), rounds: integer('rounds', 1, 100) };
const files = values['generated-only'] ? [] : positionals.length ? positionals : readdirSync('tests').filter((name) => name.endsWith('.csv')).sort().map((name) => `tests/${name}`);
const fingerprints: Record<string, string> = {};
const recorded: SimulationRound[] = [];
const excluded: string[] = [];
const codes = new Set<string>();
for (const file of files) {
  const csv = readFileSync(file, 'utf8');
  fingerprints[file] = createHash('sha256').update(csv).digest('hex');
  const imported = parseTraces(csv, basename(file, '.csv'));
  if (imported.problems.length) throw new Error(JSON.stringify(imported.problems));
  for (const trace of imported.traces.filter((trace) => trace.size === 9 && trace.tier === 'medium')) {
    if (checkBoard(trace)) throw new Error(`Invalid board: ${trace.code}`);
    const input = replayRound(trace);
    const decoded = decodeSeedCode(trace.code)!;
    if (!input || decoded.settings.freebies !== 0 || trace.silver) {
      excluded.push(`${trace.dataset}/${trace.id}: unknown mistakes, freebies enabled, or silver`);
      continue;
    }
    if (codes.has(trace.code)) continue;
    codes.add(trace.code);
    recorded.push({ puzzle: generate(decoded.settings, decoded.seed, decoded.version), input });
  }
}
const generated: SimulationRound[] = [];
for (let index = 0; index < config.generated; index++) {
  const puzzle = generate({ size: 9, tier: 'medium', freebies: 0, silver: false, shape: 2, sizeMix: 2 }, deriveSeed(config.seed, `campaign-board/${index}`));
  generated.push({ puzzle, input: { dataset: 'generated-9-medium', id: String(index), code: puzzle.code,
    size: 9, tier: 'medium', sequence: 'synthetic', turns: [] } });
}
const records: CampaignTrial[] = [];
const pools = [{ name: 'recorded', pool: recorded }, { name: 'generated', pool: generated }].filter(({ pool }) => pool.length);
if (!pools.length) throw new Error('No eligible boards; supply --generated or recordings without freebies');
for (const { name, pool } of pools) {
  for (let index = 0; index < config.seeds; index++) {
    const seed = (config.seed + index) >>> 0;
    const offset = deriveSeed(seed, 'opening-board') % pool.length;
    const rounds = [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, config.rounds);
    for (const starter of STARTERS) for (const gear of ['coverage', 'weak', 'recovery'] as GearPolicy[]) {
      for (const policy of ['ordinary', 'planned'] as const) for (const mistakes of [false, true]) {
        const result = simulateCampaign({ seed, starter, gear, policy, mistakes, rounds });
        result.sequence = `${name} board geometry; ${result.sequence}`;
        records.push(result);
      }
    }
    console.log(`${name}: seed ${seed}, ${records.length} complete-run trials`);
  }
}
const groups = new Map<string, CampaignTrial[]>();
for (const record of records) {
  const key = `${record.sources[0]?.dataset.startsWith('generated') ? 'generated' : 'recorded'} / ${record.starter} / ${record.gear} / ${record.policy} / ${record.sequence.includes('wrong') ? 'synthetic mistake' : 'no mistakes'}`;
  const group = groups.get(key) ?? [];
  group.push(record); groups.set(key, group);
}
const mean = (rows: CampaignTrial[], value: (row: CampaignTrial) => number): string => (rows.reduce((sum, row) => sum + value(row), 0) / rows.length).toFixed(1);
const report = [
  '# Phase 7 bounded campaign experiments', '',
  `Application ${version}, content ${CONTENT_VERSION}. Configuration: ${JSON.stringify(config)}.`, '',
  `${records.length} trials. ${recorded.length} eligible recorded boards; ${generated.length} generated boards.`, '',
  'All trials use actual starters. Herbalist is the victory unlock, reported separately. Concept-probe loadouts are excluded. Maps and each node’s encounter/loot streams are paired by seed; policies may take different paths. Weak and recovery paths are explicit equipment preferences, not claims about random loot luck.', '',
  'Both policies use solver deductions without hidden solution access. Ordinary reveals the first available deduction with reactive readiness. Planned banks all deductions and uses a three-turn, width-four beam search over reveal order and receiving slots; it is bounded lookahead, not an optimum. Neither policy models human time. The 18–27 puzzle / roughly one-hour target requires human review; no measured population timing is inferred.', '',
  'Recorded boards preserve dataset identifiers and exact original input in source files, but campaign reveal orders are modeled. Synthetic mistakes insert one wrong reveal per puzzle at a deterministic gap; these are never labeled exact replays. Runs stop at death, victory, solver stall, or input limit. Live unresolved runs remain visible and do not count as victories. Inputs are consumed without repeating a board within a trial.', '',
  'Raw JSON contains full engine states and replayable accepted commands, health/gear/coverage/supply trajectories after every puzzle, first useful gear and first encounter completion, original board codes and provenance, income/spending, upgrades, and outcomes. Loot quality is the observed mean number of colors per offered gear item, conditional on reached drops. The lowest tenth is descriptive of those observed paths, not an independent measure of all possible loot; deaths before loot remain at zero.', '',
  '| Boards / starter / gear / policy / mistakes | Trials | Victories | Alive | Deaths | Unresolved | Puzzles | Turns | Fights won | Useful gear puzzle* | First win puzzle* | Health | Earned | Spent | Upgrades |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
];
for (const [key, rows] of groups) {
  const acquired = rows.filter((row) => row.usefulGearRound !== null);
  const won = rows.filter((row) => row.openingWinRound !== null);
  report.push(`| ${key} | ${rows.length} | ${rows.filter((row) => row.outcome === 'victory').length} | ${rows.filter((row) => row.survived).length} | ${rows.filter((row) => row.outcome === 'death').length} | ${rows.filter((row) => ['limit', 'solver-stalled'].includes(row.outcome)).length} | ${mean(rows, (row) => row.history.length)} | ${mean(rows, (row) => row.turns)} | ${mean(rows, (row) => row.state.campaign!.wins)} | ${acquired.length}/${rows.length}: ${acquired.length ? mean(acquired, (row) => row.usefulGearRound!) : '—'} | ${won.length}/${rows.length}: ${won.length ? mean(won, (row) => row.openingWinRound!) : '—'} | ${mean(rows, (row) => Math.max(0, row.state.health))} | ${mean(rows, (row) => row.state.campaign!.earned)} | ${mean(rows, (row) => row.state.campaign!.spent)} | ${mean(rows, (row) => row.state.campaign!.upgrades)} |`);
}
report.push('', '*Acquisition and first-win averages are conditional; reached/total counts prevent survivor-only summaries.', '', '## Lowest tenth of observed loot paths', '', '| Group | Seed | Outcome | Loot quality | Fights won | Puzzles |', '|---|---:|---|---:|---:|---:|');
for (const [key, rows] of groups) {
  for (const row of [...rows].sort((a, b) => a.lootQuality - b.lootQuality || a.seed - b.seed).slice(0, Math.max(1, Math.ceil(rows.length / 10)))) {
    report.push(`| ${key} | ${row.seed} | ${row.outcome} | ${row.lootQuality.toFixed(2)} | ${row.state.campaign!.wins} | ${row.history.length} |`);
  }
}
report.push('', '## Excluded recorded boards', '', ...excluded.map((line) => `- ${line}`), '');
mkdirSync(values.out, { recursive: true });
writeFileSync(join(values.out, 'results.json'), JSON.stringify({ schema: 1, app: version, content: CONTENT_VERSION, config, fingerprints, starters: STARTERS, excluded, records }));
writeFileSync(join(values.out, 'report.md'), report.join('\n'));
console.log(`Wrote ${values.out}/report.md and results.json`);
