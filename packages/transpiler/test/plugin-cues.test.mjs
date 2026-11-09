import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cueRun } from '@strudel/core';
import { transpiler } from '../index.mjs';

const options = { wrapAsync: false, addReturn: false, simpleLocs: true };

const applyMints = (code, mints) =>
  [...mints].reverse().reduce((text, { at, insert }) => text.slice(0, at) + insert + text.slice(at), code);

describe('cue plugin', () => {
  beforeEach(() => (cueRun.isMinting = true));
  afterEach(() => (cueRun.isMinting = false));

  it('mints an id and fills in default alignment and easing', () => {
    const code = 'x.c(2)';
    const { output, cueMints } = transpiler(code, options);
    const [{ insert }] = cueMints;

    expect(insert).toMatch(/^, 1, 0, '#[0-9a-z]{4}'$/);
    expect(applyMints(code, cueMints)).toBe(`x.c(2${insert})`);
    expect(output).toBe(`x.c(2${insert});`);
  });

  it('keeps the arguments that are already written', () => {
    const { cueMints } = transpiler('x.c(2, 4)\ny.c(3, 2, 8)', options);
    expect(cueMints.map((mint) => mint.insert.split(', ').length)).toEqual([3, 2]);
  });

  it('leaves calls that already have an id alone', () => {
    const code = "x.c(2, 1, 0, '#abcd')";
    const { output, cueMints } = transpiler(code, options);
    expect(cueMints).toBeUndefined();
    expect(output).toBe(`${code};`);
  });

  it('offsets insertion points for block-based evaluation', () => {
    const { cueMints } = transpiler('x.c(2)', { ...options, blockBased: true, range: [100, 106] });
    expect(cueMints[0].at).toBe(105);
  });

  it('does not mint without an editor to write the id', () => {
    cueRun.isMinting = false;
    const { output, cueMints } = transpiler('x.c(2)', options);
    expect(cueMints).toBeUndefined();
    expect(output).toBe('x.c(2);');
  });

  it('rejects a call with nothing to change to', () => {
    expect(() => transpiler('x.c()', options)).toThrow(/needs the pattern/);
  });
});
