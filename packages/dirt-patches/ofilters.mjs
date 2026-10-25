import { registerControl } from '@strudel/core';

/**
 * Orbit-wide resonant low-pass that runs after `grit` and ahead of delay and reverb, so unlike `lpf` it also reaches the drone voices (`dsaw` etc).
 * Each event glides the cutoff linearly to its value over the event's duration; the first event after a bypass snaps straight to it.
 * An event without `olpf` bypasses the filter, and the latest event's value applies to the whole orbit.
 * Sample a slow curve with `segment` for sweeps. SuperDirt only (drone-server).
 *
 * @name olpf
 * @tags dirt-patches, filter, orbit
 * @param {number | Pattern} frequency cutoff in Hz
 * @synonyms olp
 * @example
 * s("dsaw").freq(58.27).olpf(sine.slow(16).rangex(150, 1300)).olpq(4).segment(8)
 */
export const { olpf, olp } = registerControl('olpf', 'olp');

/**
 * Resonance of `olpf` in Strudel's 0–50 dB scale (default 1), glided like the cutoff.
 *
 * @name olpq
 * @tags dirt-patches, filter, orbit
 * @param {number | Pattern} q resonance, 0–50
 * @example
 * s("dsaw").freq(58.27).olpf(600).olpq(8)
 */
export const { olpq } = registerControl('olpq');

/**
 * Orbit-wide resonant high-pass, the counterpart of `olpf`: same placement, glide and bypass rules. SuperDirt only (drone-server).
 *
 * @name ohpf
 * @tags dirt-patches, filter, orbit
 * @param {number | Pattern} frequency cutoff in Hz
 * @synonyms ohp
 * @example
 * s("dsaw").freq(58.27).ohpf(sine.slow(8).rangex(40, 400)).segment(8)
 */
export const { ohpf, ohp } = registerControl('ohpf', 'ohp');

/**
 * Resonance of `ohpf` in Strudel's 0–50 dB scale (default 1).
 *
 * @name ohpq
 * @tags dirt-patches, filter, orbit
 * @param {number | Pattern} q resonance, 0–50
 * @example
 * s("dsaw").freq(58.27).ohpf(200).ohpq(6)
 */
export const { ohpq } = registerControl('ohpq');

/**
 * Orbit-wide band-pass, the counterpart of `olpf`: same placement, glide and bypass rules. SuperDirt only (drone-server).
 *
 * @name obpf
 * @tags dirt-patches, filter, orbit
 * @param {number | Pattern} frequency center frequency in Hz
 * @synonyms obp
 * @example
 * s("dpulse").freq(58.27).pw(0.9).obpf(sine.slow(12).rangex(1500, 4000)).obpq(1.5).segment(8)
 */
export const { obpf, obp } = registerControl('obpf', 'obp');

/**
 * Q of `obpf` as for `bpq`, higher is narrower (default 1).
 *
 * @name obpq
 * @tags dirt-patches, filter, orbit
 * @param {number | Pattern} q band-pass Q
 * @example
 * s("dsaw").freq(58.27).obpf(1200).obpq(4)
 */
export const { obpq } = registerControl('obpq');
