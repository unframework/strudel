import { signal } from '@strudel/core';
import { deck } from './rig.mjs';

function controlPattern(kind, num, align) {
  if (!Number.isInteger(num) || num < 0 || num > 127) {
    throw new Error(`[linectrl] expected a MIDI number 0-127, got ${num}`);
  }
  if (!(align >= 0)) {
    throw new Error(`[linectrl] expected alignment in cycles >= 0, got ${align}`);
  }
  const read = deck.reader(kind, num, align);
  return signal((t) => read(Number(t)));
}

/**
 * Controller knob or fader value, 0 to 1. Persists across reloads and works without the device.
 *
 * @name IN
 * @tags external_io, midi
 * @param {number} cc MIDI CC number
 * @param {number} align cycles to align changes to, e.g. 0.5 for the next half-bar; 0 for immediate
 * @returns Pattern
 */
export const IN = (cc, align = 0) => controlPattern('cc', cc, align);

/**
 * Controller toggle button, 0 or 1. Its light pulses on the beat while a change is pending.
 *
 * @name BTN
 * @tags external_io, midi
 * @param {number} note MIDI note number of the button
 * @param {number} align cycles to align changes to, e.g. 1 for the next bar; 0 for immediate
 * @returns Pattern
 */
export const BTN = (note, align = 0) => controlPattern('note', note, align);
