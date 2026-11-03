import { describe, expect, it } from 'vitest';
import {
  cueTime,
  formatMarkerTuples,
  gridBpm,
  gridTime,
  inferBeats,
  parseMarkerTuples,
  parseSampleMeta,
  parseWarpQuery,
  sourceGrid,
  warpPlan,
  warpTime,
  warpedGrid,
  warpQuery,
} from '../index.mjs';

const speech = parseSampleMeta({
  version: 1,
  markers: [
    { t: 1.31, beat: 2, name: 'accent' },
    { t: 0.4, beat: 0 },
    { t: 0.86, beat: 1 },
    { t: 2.0, name: 'breath' },
  ],
});

describe('parseSampleMeta', () => {
  it('sorts markers by time', () => {
    expect(speech.markers.map((m) => m.t)).toEqual([0.4, 0.86, 1.31, 2.0]);
  });

  it('rejects unknown versions and negative times', () => {
    expect(() => parseSampleMeta({ version: 2, markers: [] })).toThrow();
    expect(() => parseSampleMeta({ version: 1, markers: [{ t: -1 }] })).toThrow();
  });
});

describe('sourceGrid', () => {
  it('recovers tempo from jittered beat markers', () => {
    const jitter = [0.01, -0.012, 0.007, -0.004, 0.009, -0.01, 0.003, -0.006];
    const markers = jitter.map((j, beat) => ({ t: 0.25 + beat * 0.5 + j, beat }));
    const grid = sourceGrid(parseSampleMeta({ version: 1, markers }));
    expect(gridBpm(grid)).toBeCloseTo(120, 0);
    expect(grid.t0).toBeCloseTo(0.25, 1);
  });

  it('falls back to the declared bpm', () => {
    expect(sourceGrid({ version: 1, markers: [{ t: 1, beat: 0 }], bpm: 90 })).toEqual({ t0: 0, spb: 60 / 90 });
  });

  it('needs either a beat span or a bpm', () => {
    expect(() => sourceGrid({ version: 1, markers: [{ t: 1, beat: 0 }] })).toThrow();
  });
});

describe('warpPlan', () => {
  it('lands every beat marker exactly on the target grid', () => {
    const bpm = 140;
    const plan = warpPlan(speech, bpm);
    const grid = warpedGrid(speech, bpm);
    for (const m of speech.markers.filter((m) => m.beat !== undefined)) {
      expect(warpTime(plan, m.t)).toBeCloseTo(gridTime(grid, m.beat), 9);
    }
  });

  it('stretches head and tail like their neighbouring segments', () => {
    const plan = warpPlan(speech, 140);
    expect(plan[0]).toMatchObject({ from: 0, to: 0.4, ratio: plan[1].ratio });
    expect(plan.at(-1)).toMatchObject({ from: 1.31, to: Infinity, ratio: plan.at(-2).ratio });
  });

  it('stretches uniformly when only a bpm is known', () => {
    expect(warpPlan({ version: 1, markers: [], bpm: 100 }, 125)).toEqual([{ from: 0, to: Infinity, ratio: 0.8 }]);
  });

  it('rejects beats that run backwards in time', () => {
    const meta = parseSampleMeta({
      version: 1,
      markers: [
        { t: 0.2, beat: 1 },
        { t: 0.6, beat: 0 },
      ],
    });
    expect(() => warpPlan(meta, 120)).toThrow();
  });
});

describe('cueTime', () => {
  it('finds named markers and maps them into the warped render', () => {
    expect(cueTime(speech, 'accent')).toBe(1.31);
    expect(warpTime(warpPlan(speech, 120), cueTime(speech, 'accent'))).toBeCloseTo(0.4 * (0.5 / 0.46) + 1, 9);
    expect(() => cueTime(speech, 'missing')).toThrow();
  });
});

describe('inferBeats', () => {
  it('numbers taps by the median spacing', () => {
    const taps = [{ t: 0.1 }, { t: 0.6 }, { t: 1.62 }, { t: 2.1 }];
    expect(inferBeats(taps).map((m) => m.beat)).toEqual([0, 1, 3, 4]);
  });
});

describe('marker tuples', () => {
  it('round-trip through source text', () => {
    const tuples = [
      [1.31, 2, 'accent'],
      [0.4, 0],
      [2, "breath's"],
      [0.86, 1],
    ];
    const meta = parseMarkerTuples(tuples);
    expect(meta.markers).toEqual([...speech.markers.slice(0, 3), { t: 2, name: "breath's" }]);
    expect(formatMarkerTuples(meta)).toBe("[[0.4, 0], [0.86, 1], [1.31, 2, 'accent'], [2, 'breath\\'s']]");
  });

  it('rejects tuples without a time or with extra fields', () => {
    expect(() => parseMarkerTuples([['accent']])).toThrow();
    expect(() => parseMarkerTuples([[1, 2, 'a', 3]])).toThrow();
  });
});

describe('warpQuery', () => {
  it('carries only what the render depends on', () => {
    const query = warpQuery(speech, 120.004);
    expect(query).toBe('bpm=120&beats=0.4%3A0%2C0.86%3A1%2C1.31%3A2');
    const { bpm, meta } = parseWarpQuery(new URLSearchParams(query));
    expect(bpm).toBe(120);
    expect(warpPlan(meta, bpm)).toEqual(warpPlan(speech, bpm));
  });

  it('keeps the bpm fallback', () => {
    const { meta } = parseWarpQuery(new URLSearchParams(warpQuery({ version: 1, markers: [], bpm: 90 }, 120)));
    expect(meta).toEqual({ version: 1, markers: [], bpm: 90 });
  });

  it('rejects malformed queries', () => {
    expect(() => parseWarpQuery(new URLSearchParams('bpm=0'))).toThrow();
    expect(() => parseWarpQuery(new URLSearchParams('bpm=120&beats=x:1'))).toThrow();
  });
});
