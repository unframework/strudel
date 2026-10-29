import { describe, it, expect } from 'vitest';
import { saw, sine, stack, silence, sequence, pure, signal, Fraction } from '@strudel/core';
import { signalSampler, plotValue } from '../plot.mjs';

const sampleSignal = (pat, from, to, samples) => signalSampler(pat, Fraction(to - from).div(samples))(from, to);

describe('sampleSignal', () => {
  it('samples saw rising twice over two cycles', () => {
    const { times, series } = sampleSignal(saw, 0, 2, 8);
    expect(times.slice(0, 9)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(series[0].slice(0, 9)).toEqual([0, 0.25, 0.5, 0.75, 0, 0.25, 0.5, 0.75, 0]);
  });

  it('samples sine at the sample times', () => {
    const { times, series } = sampleSignal(sine, 0, 1, 16);
    times.forEach((t, i) => expect(series[0][i]).toBeCloseTo((Math.sin(2 * Math.PI * t) + 1) / 2));
  });

  it('draws stacked patterns as separate series', () => {
    const { series } = sampleSignal(stack(sine, saw), 0, 1, 4);
    expect(series).toHaveLength(2);
  });

  it('samples discrete sequences as steps', () => {
    const { series } = sampleSignal(sequence(0, 1, 2, 3), 0, 1, 8);
    expect(series[0].slice(0, 8)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('leaves gaps as null', () => {
    expect(sampleSignal(silence, 0, 1, 4).series).toEqual([]);
    const { series } = sampleSignal(sequence(pure(1), silence), 0, 1, 4);
    expect(series[0].slice(0, 4)).toEqual([1, 1, null, null]);
  });

  it('aligns sample times to the step grid', () => {
    const sample = signalSampler(saw, Fraction(0.25));
    expect(sample(0, 1).times).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(sample(0.1, 1.1).times).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25]);
  });

  it('only queries samples that scrolled into view', () => {
    let queries = 0;
    const counted = signal((t) => {
      queries++;
      return t;
    });
    const sample = signalSampler(counted, Fraction(0.25));
    sample(0, 1);
    expect(queries).toBe(5);
    sample(0.5, 1.5);
    expect(queries).toBe(7);
  });
});

describe('plotValue', () => {
  it('passes numbers through', () => {
    expect(plotValue(0.5)).toBe(0.5);
    expect(plotValue(NaN)).toBe(null);
  });

  it('picks the first numeric field of objects', () => {
    expect(plotValue({ s: 'saw', lpf: 800, gain: 0.5 })).toBe(800);
  });

  it('picks the given key of objects', () => {
    expect(plotValue({ lpf: 800, gain: 0.5 }, 'gain')).toBe(0.5);
    expect(plotValue({ lpf: 800 }, 'gain')).toBe(null);
  });

  it('resolves control aliases for the given key', () => {
    expect(plotValue({ note: 'c', cutoff: 800 }, 'lpf')).toBe(800);
  });

  it('plots note names as midi numbers', () => {
    expect(plotValue({ note: 'C4', gain: 0 })).toBe(60);
    expect(plotValue({ s: 'cp', gain: 0.5 })).toBe(0.5);
  });

  it('plots booleans as 1 and 0', () => {
    expect(plotValue(true)).toBe(1);
    expect(plotValue(false)).toBe(0);
    expect(plotValue({ s: 'bd', mute: true })).toBe(1);
  });

  it('ignores non-numeric values', () => {
    expect(plotValue('c3')).toBe(null);
    expect(plotValue(undefined)).toBe(null);
  });
});
