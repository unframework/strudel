import { describe, expect, it } from 'vitest';
import { s } from '@strudel/core';
import { parseSampleMeta } from '@strudel/sample-meta';
import { registerSampleSource, setSampleMeta } from 'superdough';
import { cue } from '../samplecues.mjs';

const url = 'http://localhost:5432/voice/hey.wav';
registerSampleSource('voice', [url], {});
setSampleMeta(
  url,
  parseSampleMeta({
    version: 1,
    markers: [
      { t: 0.4, beat: 0 },
      { t: 0.9, beat: 1, name: 'accent' },
    ],
  }),
);

const onsets = (pat, begin, end, cps) =>
  pat.queryArc(begin, end, { _cps: cps }).map((hap) => [hap.whole.begin.valueOf(), hap.part.begin.valueOf()]);

describe('cue', () => {
  it('moves onsets earlier by the cue position in cycles', () => {
    expect(onsets(cue('accent', s('voice')), 0, 1, 0.5)).toEqual([
      [-0.45, 0],
      [0.55, 0.55],
    ]);
  });

  it('accounts for speed', () => {
    expect(onsets(cue('accent', s('voice').speed(2)), 0, 1, 0.5)).toEqual([
      [-0.225, 0],
      [0.775, 0.775],
    ]);
  });

  it('pulls haps from beyond the queried span', () => {
    expect(onsets(cue('accent', s('voice')), 0.5, 0.6, 0.5)).toEqual([
      [-0.45, 0.5],
      [0.55, 0.55],
    ]);
    expect(onsets(cue('accent', s('voice')), 0.6, 0.7, 0.5)).toEqual([[0.55, 0.6]]);
  });

  it('warps the cue position with beatwarp', () => {
    expect(onsets(cue('accent', s('voice').beatwarp(60)), 0, 1, 0.5)).toEqual([
      [-0.9, 0],
      [0.1, 0.1],
    ]);
  });

  it('drops haps of unknown cues', () => {
    expect(onsets(cue('missing', s('voice')), 0, 1, 0.5)).toEqual([]);
  });
});
