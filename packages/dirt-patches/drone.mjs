/**
 * Drone voice sounds `dsaw`, `dsine`, `dtri` and `dsquare`: sustained, RMS-matched oscillators whose events steer a long-lived voice instead of starting notes.
 * Each waveform keeps one voice per `(orbit, voice)` pair. The first event fades it in (`attack`, default 3 s); later events glide `freq`/`note`, `detune` (semitones), `pan` and linear `gain` to their new values over the event's duration, so a continuous signal sampled with `segment` becomes a smooth control curve.
 * When events stop for four event durations the voice fades out (`release`, default 6 s) and frees itself.
 * Per-event modules (`lpf`, `shape`, envelopes) don't apply; orbit-wide effects (`room`, `delay`, `grit`, `olpf`, `ohpf`) do.
 * SuperDirt only (drone-server).
 *
 * @name dsaw
 * @tags dirt-patches, synth
 * @synonyms dsine, dtri, dsquare
 * @noAutocomplete
 * @example
 * const swell = perlin.slow(14).range(0.5, 1);
 * stack(
 *   s("dsaw").voice(0).freq(58.27).gain(swell),
 *   s("dsaw").voice(1).freq(58.85).gain(swell.mul(0.55)).pan(perlin.slow(25).range(0.4, 0.6)),
 * ).segment(4).room(0.4)
 */
