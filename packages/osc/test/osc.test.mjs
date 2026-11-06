import { describe, expect, it } from 'vitest';
import { Hap, TimeSpan } from '@strudel/core';
import { decayToDirtSize, parseControlsFromHap } from '../osc.mjs';

const controlsOf = (value) => parseControlsFromHap(new Hap(new TimeSpan(0, 1), new TimeSpan(0, 1), value), 1);

describe('decayToDirtSize', () => {
  it('keeps short decays at the minimum size', () => {
    expect(decayToDirtSize(0)).toBe(0);
    expect(decayToDirtSize(0.5)).toBe(0);
  });

  it('grows monotonically with decay time', () => {
    const sizes = [1, 2, 4, 8].map(decayToDirtSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(decayToDirtSize(2)).toBeCloseTo(0.8, 1);
  });

  it('stays below the self-oscillating feedback range', () => {
    expect(decayToDirtSize(10)).toBeLessThanOrEqual(0.95);
    expect(decayToDirtSize(1000)).toBe(0.95);
  });
});

describe('parseControlsFromHap reverb size', () => {
  it('converts roomsize seconds', () => {
    expect(controlsOf({ s: 'bd', room: 0.5, roomsize: 4 }).size).toBe(decayToDirtSize(4));
  });

  it('converts the size carried by room mininotation', () => {
    expect(controlsOf({ s: 'bd', room: 0.5, size: 4 }).size).toBe(decayToDirtSize(4));
  });

  it('leaves size unset when no decay is given', () => {
    expect(controlsOf({ s: 'bd', room: 0.5 })).not.toHaveProperty('size');
  });
});

describe('parseControlsFromHap duck lists', () => {
  it('joins per-orbit lists with colons', () => {
    const controls = controlsOf({ s: 'bd', duckorbit: [2, 3], duckattack: [0.4, 0.1], duckdepth: 1 });
    expect(controls).toMatchObject({ duckorbit: '2:3', duckattack: '0.4:0.1', duckdepth: 1 });
  });
});
