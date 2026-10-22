import { Pattern, register, TimeSpan } from '@strudel/core';
import { cueTime, gridBpm, sourceGrid, warpPlan, warpTime } from '@strudel/sample-meta';
import { getSampleMeta } from 'superdough';

const DEFAULT_CPS = 0.5;
const BEATS_PER_CYCLE = 4;
const MAX_PREROLL_CYCLES = 1;

const cpsOf = (state) => state.controls._cps ?? DEFAULT_CPS;

/**
 * Time-stretches marked-up samples to the current tempo, see `beatwarp`.
 *
 * @name beatsync
 * @tags samples
 * @example
 * samples('local:')
 * s("voice").beatsync().cue("accent")
 */
export const beatsync = register('beatsync', (pat) =>
  pat.withHaps((haps, state) => {
    const beatwarp = cpsOf(state) * 60 * BEATS_PER_CYCLE;
    return haps.map((hap) => hap.withValue((v) => ({ ...v, beatwarp })));
  }),
);

function cueSeconds(value, name) {
  if (value.begin) {
    throw new Error('cue does not combine with begin');
  }
  const meta = getSampleMeta(value);
  const t = value.beatwarp ? warpTime(warpPlan(meta, value.beatwarp), cueTime(meta, name)) : cueTime(meta, name);
  return t / Math.abs(value.speed ?? 1);
}

/**
 * Starts each sample early, so that its named cue marker falls on the event onset.
 * Apply after `beatwarp`/`beatsync` and `speed`, the pre-roll is computed from them.
 *
 * @name cue
 * @tags samples
 * @param {string | Pattern} name cue marker name
 * @example
 * samples('local:')
 * s("voice").beatsync().cue("accent")
 */
export const cue = register(
  'cue',
  (name, pat) =>
    new Pattern((state) => {
      const { span } = state;
      const lookahead = state.setSpan(new TimeSpan(span.begin, span.end.add(MAX_PREROLL_CYCLES)));
      return pat.query(lookahead).flatMap((hap) => {
        const preroll = cueSeconds(hap.value, name) * cpsOf(state);
        if (preroll > MAX_PREROLL_CYCLES) {
          throw new Error(`cue "${name}" is more than ${MAX_PREROLL_CYCLES} cycle into the sample`);
        }
        const shifted = hap.withSpan((s) => s.withTime((t) => t.sub(preroll)));
        const part = shifted.part.intersection(span);
        if (!part) {
          return [];
        }
        shifted.part = part;
        return [shifted];
      });
    }, pat._steps),
  true,
  true,
);

/**
 * Resamples marked-up samples to the current tempo, changing their pitch along with their speed.
 *
 * @name fitbpm
 * @tags samples, pitch
 * @example
 * samples('local:')
 * s("drumloop").fitbpm()
 */
export const fitbpm = register('fitbpm', (pat) =>
  pat.withHaps((haps, state) => {
    const bpm = cpsOf(state) * 60 * BEATS_PER_CYCLE;
    return haps.map((hap) =>
      hap.withValue((v) => ({ ...v, speed: (v.speed ?? 1) * (bpm / gridBpm(sourceGrid(getSampleMeta(v)))) })),
    );
  }),
);
