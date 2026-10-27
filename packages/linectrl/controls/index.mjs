import { getIsStarted, getTime, logger, signal } from '@strudel/core';
import { Deck } from './deck.mjs';

const DEVICE = 'X-TOUCH COMPACT';
const CHANNEL = 1;
const STORAGE_KEY = 'linectrl-controls';

const clock = { now: () => (getIsStarted() ? getTime() : null) };

let deck;

function getDeck() {
  if (!deck) {
    deck = new Deck(createStorage(), clock, CHANNEL);
    connect(deck);
  }
  return deck;
}

function createStorage() {
  if (typeof localStorage === 'undefined') {
    let values = {};
    return { load: () => values, save: (next) => (values = next) };
  }
  return {
    load: () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'),
    save: (values) => localStorage.setItem(STORAGE_KEY, JSON.stringify(values)),
  };
}

async function connect(deck) {
  try {
    const { enableWebMidi } = await import('@strudel/midi');
    const { MidiInput } = await import('@strudel/midi/input.mjs');
    await enableWebMidi();

    const input = new MidiInput(DEVICE);
    input.onMessage((type, _chan, num, value) => deck.receive(type, num, value));
    input.onConnectionChange((isConnected) => (isConnected ? deck.attach(input) : deck.detach()));
  } catch (err) {
    logger(`[linectrl] ${DEVICE} unavailable, controls play stored values: ${err.message}`, 'warning');
  }
}

function assertMidiNumber(num) {
  if (!Number.isInteger(num) || num < 0 || num > 127) {
    throw new Error(`[linectrl] expected a MIDI number 0-127, got ${num}`);
  }
}

function controlPattern(kind, addr, align) {
  addr.forEach(assertMidiNumber);
  if (!(align >= 0)) {
    throw new Error(`[linectrl] expected alignment in cycles >= 0, got ${align}`);
  }
  const read = getDeck().control(kind, addr, align);
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
export const IN = (cc, align = 0) => controlPattern('in', [cc], align);

/**
 * Controller toggle button, 0 or 1. Its light pulses on the beat while a change is pending.
 *
 * @name BTN
 * @tags external_io, midi
 * @param {number} note MIDI note number of the button
 * @param {number} align cycles to align changes to, e.g. 1 for the next bar; 0 for immediate
 * @returns Pattern
 */
export const BTN = (note, align = 0) => controlPattern('btn', [note], align);

/**
 * Controller momentary button: 1 while held, 0 when released.
 *
 * @name PUSH
 * @tags external_io, midi
 * @param {number} note MIDI note number of the button
 * @param {number} align cycles to align changes to; 0 for immediate
 * @returns Pattern
 */
export const PUSH = (note, align = 0) => controlPattern('push', [note], align);

/**
 * Controller button group where one button is selected at a time; the value is the selected
 * button's index. Pass an array of notes to add an alignment: `RADIO([12, 13, 14], 1)`.
 *
 * @name RADIO
 * @tags external_io, midi
 * @param {...number} notes MIDI note numbers of the buttons
 * @returns Pattern
 */
export function RADIO(...args) {
  const [notes, align] = Array.isArray(args[0]) ? [args[0], args[1] ?? 0] : [args, 0];
  return controlPattern('radio', notes, align);
}
