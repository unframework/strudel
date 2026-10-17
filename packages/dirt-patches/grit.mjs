import { registerControl } from '@strudel/core';

/**
 * Two-band saturator that every orbit runs ahead of its delay and reverb, with `grit` as the drive (4 is a solid crunch).
 * Below `gritfreq` the signal gets a soft `tanh` that keeps the low end round; above it, it is driven four times harder and mixed in at `gritmix` for fizz on top.
 * Quiet input passes at its own level and only louder input is squashed, so turning `grit` up adds density rather than volume.
 *
 * Orbit-wide like `room`: the latest event's values apply to everything on that orbit, and an event without `grit` bypasses it.
 * SuperDirt only (drone-server).
 *
 * @name grit
 * @tags dirt-patches, distortion, orbit
 * @param {number | Pattern} drive saturation drive, 0 bypasses
 * @example
 * note("c2 eb2").s("sawtooth").grit(4)
 */
export const { grit } = registerControl('grit');

/**
 * Crossover frequency of `grit` in Hz (default 440). Set it from the pattern to keep it following the pitch, e.g. eight times the root.
 *
 * @name gritfreq
 * @tags dirt-patches, distortion, orbit
 * @param {number | Pattern} frequency crossover in Hz
 * @example
 * note("a#1").s("dsaw").grit(4).gritfreq(58.27 * 8)
 */
export const { gritfreq } = registerControl('gritfreq');

/**
 * Level of the hard-driven upper band of `grit` (default 0.3).
 *
 * @name gritmix
 * @tags dirt-patches, distortion, orbit
 * @param {number | Pattern} amount upper band level, 0–1
 * @example
 * note("c2").s("sawtooth").grit(4).gritmix(0.6)
 */
export const { gritmix } = registerControl('gritmix');
