import { readFileSync } from 'node:fs';
import { checkBoard, parseTraces, replayRound, syntheticRound, traceStats } from './traces';

const SAMPLE = readFileSync('tests/sample-games.csv', 'utf8');
const { traces, problems } = parseTraces(SAMPLE, 'sample-games');

describe('trace import', () => {
  it('reads every sample game', () => {
    expect(problems).toEqual([]);
    expect(traces).toHaveLength(141);
    expect(traces.every((trace) => trace.dataset === 'sample-games')).toBe(true);
  });

  it('reproduces the documented statistics', () => {
    const stats = traceStats(traces);
    expect(stats).toMatchObject({
      games: 141, collections: 1137, medianFirst: 3, medianLast: 9, largest: 65, medianPulse: 6,
    });
    expect(Math.round(stats.smallFirst * 100)).toBe(68);
    expect(Math.round(stats.lastExceedsFirst * 100)).toBe(74);
    expect(Math.round(stats.largestLate * 100)).toBe(66);
    const byTier = (tier: string): ReturnType<typeof traceStats> => traceStats(traces.filter((t) => t.tier === tier));
    expect(byTier('easy')).toMatchObject({ games: 30, medianFirst: 2, medianLast: 10 });
    expect(byTier('medium')).toMatchObject({ games: 70, medianFirst: 3, medianLast: 11 });
    expect(byTier('hard')).toMatchObject({ games: 41, medianFirst: 4, medianLast: 7 });
    const nine = traceStats(traces.filter((t) => t.size === 9));
    expect(nine.games).toBe(66);
    expect(Math.round(nine.firstThreeEnergy * 100)).toBe(19);
    expect(Math.round(nine.lastThreeEnergy * 100)).toBe(51);
  });

  it('replays only plays whose every turn is known', () => {
    const rounds = traces.map(replayRound);
    expect(rounds.filter((round) => round !== null)).toHaveLength(139);
    const round = rounds.find((r) => r !== null)!;
    expect(round.sequence).toBe('replay');
    expect(round.turns.every((turn) => turn.type === 'collect' && turn.source !== 'given')).toBe(true);
  });

  // Rebuilding runs the generator, so only a few here; `pnpm traces` checks every board.
  it('rebuilds matching boards from seed codes', () => {
    for (const trace of traces.filter((t) => t.size <= 6).slice(0, 4)) {
      expect(checkBoard(trace)).toBeNull();
    }
    const trace = traces.find((t) => t.size === 5)!;
    const moved = { ...trace, events: trace.events.map((e, i) => (i === 1 ? { ...e, cell: (e.cell + 1) % trace.size ** 2 } : e)) };
    expect(checkBoard(moved)).toMatch(/order 2/);
  });

  it('places synthetic wrong turns repeatably, never last', () => {
    const [trace] = traces;
    const round = syntheticRound(trace, 2, 7);
    expect(round).toEqual(syntheticRound(trace, 2, 7));
    expect(round.sequence).toBe('synthetic');
    expect(round.turns.filter((turn) => turn.type === 'wrong')).toHaveLength(2);
    expect(round.turns.at(-1)?.type).toBe('collect');
    expect(round.turns.filter((turn) => turn.type === 'collect')).toEqual(replayRound(trace)?.turns);
  });

  it('reads wrong reveals from newer recordings', () => {
    const [header, ...lines] = SAMPLE.split('\n');
    const rows = lines.filter((line) => line.startsWith(traces[0].id))
      .map((line) => line.replace(',0,47.1,', ',1,47.1,'));
    const order = (line: string, n: number): string => line.replace(/,2HBCM8FDMYT,\d+,/, `,2HBCM8FDMYT,${n},`);
    const miss = order(rows[1], 2).replace(/,7,7,3,2,/, ',1,1,9,15,').replace(/,false$/, ',true');
    const csv = [header, rows[0], miss, ...rows.slice(1).map((line, i) => order(line, i + 3))].join('\n');
    const { traces: [parsed], problems: found } = parseTraces(csv, 'new');
    expect(found).toEqual([]);
    expect(parsed.turnsKnown).toBe(true);
    expect(replayRound(parsed)?.turns[0]).toEqual({ type: 'wrong' });
  });

  it('reports malformed recordings instead of repairing them', () => {
    const lines = SAMPLE.split('\n');
    const [id] = lines[1].split(',');
    const dropped = lines.filter((line, i) => i !== 2).join('\n');
    const [problem, ...rest] = parseTraces(dropped, 'x').problems;
    expect(rest).toEqual([]);
    expect(problem.id).toBe(id);
    expect(problem.message).toMatch(/order/);
    expect(parseTraces('a,b\n1,2', 'x').problems[0].message).toMatch(/missing columns/);
    const short = [lines[0], lines[1].slice(0, -7)].join('\n');
    expect(parseTraces(short, 'x').problems[0].message).toMatch(/values/);
  });
});
