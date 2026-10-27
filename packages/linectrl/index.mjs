import { Pattern, gain, isPattern, register, stack } from '@strudel/core';

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
 * Probabilistic gate: each hap survives with probability `prob`. Inverse
 * spelling of `degradeBy` — `at(0.5)` keeps ~50%, `at(1)` keeps everything,
 * `at(0)` drops everything. Dropped haps are removed from the timeline
 * entirely (no silent event left behind).
 *
 * @name at
 * @memberof Pattern
 * @tags random
 * @param {number} prob probability of keeping each hap, 0..1
 * @returns Pattern
 * @example
 * s("hh*8").at(0.5)
 */
export const at = register('at', (prob, pat) => pat._degradeBy(1 - prob));

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
 * Adds a `t` tag to object haps for use with tr()/trl().
 */
export const t = register('t', (chars, pat) => {
  if (isPattern(chars)) {
    chars = chars.queryArc(0, 0)[0]?.value ?? '';
  }

  return pat.withValue((v) => ({ ...v, t: String(chars) }));
});

function trImpl(preserveOriginal, chars, fn, pat) {
  if (isPattern(chars)) {
    chars = chars.queryArc(0, 0)[0]?.value ?? '';
  }
  if (isPattern(fn)) {
    fn = fn.queryArc(0, 0)[0]?.value ?? ((x) => x);
  }

  const tagged = pat.withHap((hap) =>
    typeof hap.value === 'object' ? hap : hap.withValue(() => ({ t: String(hap.value) })),
  );

  const tags = Array.isArray(chars)
    ? chars
    : chars instanceof RegExp
      ? [chars]
      : String(chars)
          .replace(/\s/g, '')
          .split('')
          .map((c) => new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  if (tags.length === 0) {
    console.warn('tr: no tags found in chars argument:', chars);
    return tagged;
  }

  let fns;
  if (Array.isArray(fn)) {
    if (fn.length !== tags.length) {
      console.warn(`tr: ${fn.length} callbacks for ${tags.length} tags; using first for all.`);
      fns = tags.map(() => fn[0] ?? ((x) => x));
    } else {
      fns = fn;
    }
  } else {
    fns = tags.map(() => fn);
  }

  // Each hap is assigned to at most one tag (first match wins) — strict partition.
  const partitionIndex = (v) => {
    const s = v?.t ?? '';
    for (let i = 0; i < tags.length; i++) {
      if (tags[i].test(s)) return i;
    }
    return -1;
  };

  const branches = preserveOriginal ? [tagged] : [tagged.filterValues((v) => partitionIndex(v) === -1)];

  for (let i = 0; i < tags.length; i++) {
    const frac = tags.length === 1 ? 1 : i / (tags.length - 1);
    const post = fns[i](tagged, frac);
    const matched = preserveOriginal
      ? post.filterValues((v) => tags[i].test(v?.t ?? ''))
      : post.filterValues((v) => partitionIndex(v) === i);
    branches.push(matched);
  }

  return stack(...branches);
}

/**
 * Conditionally translates string-valued haps based on which character(s) appear
 * in their value. Tags every hap with `{ t: <originalString> }` so that layered
 * `tr` calls can keep matching against the original token after the value has
 * been turned into an object.
 *
 * Each hap is routed to **at most one** tag (first match wins). Matching haps
 * are replaced by the callback's output; non-matching haps pass through.
 *
 * `chars` accepts a string of single-char tags, a single RegExp, or an array of
 * RegExps. `fn` may be a single callback (applied to every tag, with the tag's
 * fraction as the 2nd arg) or an array of callbacks (one per tag).
 *
 * @name tr
 * @memberof Pattern
 * @tags structure
 * @returns Pattern
 * @example
 * "a b a b".tr("a", p => p.gain(0.2))
 * @example
 * "xy x y".tr(/y/, p => p.gain(0.2))
 * @example
 * "o 1 2 3 4".tr("o1234", (p, frac) => p.gain(frac))
 * @example
 * "Bx S B S".tr("BS", [p => p.s("bd"), p => p.s("sd")])
 */
Pattern.prototype.tr = function (chars, ...fns) {
  const fn = fns.length === 0 ? (x) => x : fns.length === 1 ? fns[0] : fns;
  return trImpl(false, chars, fn, this);
};

/**
 * Layered variant of `tr`. The original pattern is always preserved; each tag's
 * callback contributes additional, decorative haps stacked on top.
 *
 * Use this when callbacks shift haps in time (`late`/`early`) or otherwise add
 * notes alongside the originals (ghost notes, echoes), so that decorations from
 * multiple tags don't compound on each other.
 *
 * @name trl
 * @memberof Pattern
 * @tags structure
 * @returns Pattern
 * @example
 * "Bxy".tr("B", p => p.s("bd"))
 *      .trl("xy", [p => p.late(-1/16).gain(0.5), p => p.late(1/8).gain(0.5)])
 */
Pattern.prototype.trl = function (chars, ...fns) {
  const fn = fns.length === 0 ? (x) => x : fns.length === 1 ? fns[0] : fns;
  return trImpl(true, chars, fn, this);
};

export * from './controls/index.mjs';
