import { registerControl } from '@strudel/core';

/**
 * Corpus resonator (after Ableton's Corpus): the note strikes a bank of eight tuned modes that rings on past the note's release, like a mallet on a marimba bar.
 * Overlapping notes ring independently, and the note's lifetime is extended by `crdecay` so the ring is not cut.
 * `cr` is the wet mix; notes without it play dry. Noise clicks and percussive strikes ring about as loud as they play dry; pitched notes excite their modes far harder and are capped near −12 dBFS, so trim those with `crgain`.
 * SuperDirt only (drone-server).
 *
 * @name cr
 * @tags dirt-patches, resonator
 * @param {number | Pattern} mix wet mix, 0–1
 * @example
 * note("c4 e4 g4 b4").s("white").decay(.01).sustain(0).cr(1).crmodel("beam").crdecay(1.5)
 */
export const { cr } = registerControl('cr');

/**
 * Corpus resonator body: `string` (default), `tube` (odd harmonics), `beam` (free bar), `membrane` (drum head), or their index 0–3.
 *
 * @name crmodel
 * @tags dirt-patches, resonator
 * @param {string | number | Pattern} model resonator body
 * @example
 * note("c3*4").s("white").decay(.01).sustain(0).cr(1).crmodel("<string tube beam membrane>")
 */
export const { crmodel } = registerControl('crmodel');

/**
 * Corpus resonator base pitch in Hz; by default the note's own.
 *
 * @name crfreq
 * @tags dirt-patches, resonator
 * @param {number | Pattern} frequency base pitch in Hz
 * @example
 * s("white*4").decay(.01).sustain(0).cr(1).crfreq("<110 165>")
 */
export const { crfreq } = registerControl('crfreq');

/**
 * Corpus resonator ring time in seconds (default 1).
 *
 * @name crdecay
 * @tags dirt-patches, resonator
 * @param {number | Pattern} seconds ring time
 * @example
 * note("c4 g4").s("white").decay(.01).sustain(0).cr(1).crdecay("<0.5 3>")
 */
export const { crdecay } = registerControl('crdecay');

/**
 * Corpus resonator damping: how much faster the upper modes die (default 0.5).
 *
 * @name crmaterial
 * @tags dirt-patches, resonator
 * @param {number | Pattern} amount upper-mode damping
 * @example
 * note("c4 g4").s("white").decay(.01).sustain(0).cr(1).crmaterial("<0.1 0.9>")
 */
export const { crmaterial } = registerControl('crmaterial');

/**
 * Corpus resonator brightness (default 0.5).
 *
 * @name crbright
 * @tags dirt-patches, resonator
 * @param {number | Pattern} amount brightness, 0–1
 * @example
 * note("c4 g4").s("white").decay(.01).sustain(0).cr(1).crbright("<0.2 0.9>")
 */
export const { crbright } = registerControl('crbright');

/**
 * Corpus resonator inharmonicity: stretches the partials (default 0).
 *
 * @name crinharm
 * @tags dirt-patches, resonator
 * @param {number | Pattern} amount partial stretch
 * @example
 * note("c4 g4").s("white").decay(.01).sustain(0).cr(1).crinharm("<0 0.3>")
 */
export const { crinharm } = registerControl('crinharm');

/**
 * Corpus resonator strike position along the body, 0–1 (default 0.17).
 *
 * @name crhit
 * @tags dirt-patches, resonator
 * @param {number | Pattern} position strike position, 0–1
 * @example
 * note("c4*4").s("white").decay(.01).sustain(0).cr(1).crhit("0.1 0.3 0.5 0.7")
 */
export const { crhit } = registerControl('crhit');

/**
 * Corpus resonator wet level trim (default 1). Pitched notes ring far harder than noise strikes, so turn those down here.
 *
 * @name crgain
 * @tags dirt-patches, resonator
 * @param {number | Pattern} gain wet level
 * @example
 * note("c3 e3").s("triangle").cr(0.5).crgain(0.3)
 */
export const { crgain } = registerControl('crgain');
