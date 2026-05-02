import { gain, isPattern, register } from '@strudel/core';

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

/**
 * Conditionally translates string-valued haps based on which character(s) appear
 * in their value. Tags every hap with `{ tr: <originalString> }` so that layered
 * `tr` calls can keep matching against the original token after the value has
 * been turned into an object.
 *
 * - **Boolean match (single char):** `tr('#', x => x.trans(1))` applies the
 *   callback to any hap whose string contains `#`.
 * - **Range match (multi char):** `tr(' .oO', (x, v) => x.gain(v))` assigns
 *   each non-space character an evenly spaced fraction in `[0, 1]` and passes
 *   that fraction as the second arg. Spaces are treated as no-match placeholders.
 *
 * @name tr
 * @memberof Pattern
 * @tags structure
 * @returns Pattern
 * @example
 * "a b a b".tr("a", x => x.gain(0.2))
 * @example
 * "o 1 2 3 4".tr("o1234", (x, frac) => x.gain(frac))
 */
export const tr = register(
  'tr',
  (chars, fn, pat) => {
    if (isPattern(chars)) {
      chars = chars.queryArc(0, 0)[0]?.value ?? '';
    }
    if (isPattern(fn)) {
      fn = fn.queryArc(0, 0)[0]?.value ?? ((x) => x);
    }

    const tagged = pat.withHap((hap) =>
      typeof hap.value === 'object' ? hap : hap.withValue(() => ({ tr: String(hap.value) })),
    );

    const tags = typeof chars === 'object' ? [] : String(chars).replace(/\s/g, '').split('');
    if (tags.length === 0) {
      console.warn('tr: no tags found in chars argument:', chars);
    }

    return tags.reduce((acc, c, i) => {
      const condition = tagged.fmap((v) => ((v?.tr ?? '').includes(c) ? 1 : 0));

      const frac = tags.length === 1 ? 1 : i / (tags.length - 1);
      const fracFn = (x) => fn(x, frac);

      return acc.when(condition, fracFn);
    }, tagged);
  },
  false, // Prevent auto-lifting which causes this to re-run frequently
);
