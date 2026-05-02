import { gain, register } from '@strudel/core';

/**
 * Sets the global tempo in beats per minute, assuming 4 beats per cycle.
 * Equivalent to `setcpm(bpm/4)`.
 *
 * @name setBpm
 * @tags temporal
 * @param {number} bpm beats per minute
 * @example
 * setBpm(120)
 * $: s("bd*4")
 */
export function setBpm(bpm) {
  return globalThis.setCpm(bpm / 4);
}

/**
 * Outputs 1 when the pattern value is greater than or equal to `num`, else 0.
 * Useful for gating continuous signals into binary triggers.
 *
 * @name above
 * @memberof Pattern
 * @tags math
 * @returns Pattern
 * @example
 * s("hh*8").gain(sine.above(0))
 */
export const above = register('above', (num, pat) => pat.asNumber().fmap((v) => (v < num ? 0 : 1)));

/**
 * Outputs 1 when the pattern value is less than `num`, else 0.
 * Inverse of `above`.
 *
 * @name below
 * @memberof Pattern
 * @tags math
 * @returns Pattern
 * @example
 * s("hh*8").gain(sine.below(0))
 */
export const below = register('below', (num, pat) => pat.asNumber().fmap((v) => (v >= num ? 0 : 1)));

/**
 * Linearly maps the pattern value from the range `[from, to]` to `[0, 1]`,
 * clamped to that interval. Like a one-sided ramp / smoothstep without the curve.
 *
 * @name lstep
 * @memberof Pattern
 * @tags math
 * @returns Pattern
 * @example
 * s("hh*8").gain(sine.lstep(-0.5, 0.5))
 */
export const lstep = register('lstep', (from, to, pat) =>
  pat.asNumber().fmap((v) => Math.min(1, Math.max(0, (v - from) / (to - from)))),
);

/**
 * mgain is a shorthand for multiplying the pattern by a gain factor.
 * Equivalent to `mul(gain(x))`.
 *
 * @name mgain
 * @memberof Pattern
 * @tags math
 * @returns Pattern
 * @example
 * s("hh*8").mgain(sine)
 */
export const mgain = register('mgain', (gv, pat) => pat.mul(gain(gv)));
