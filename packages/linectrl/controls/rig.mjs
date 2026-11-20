import { getIsStarted, getTime } from '@strudel/core';
import { Deck } from './deck.mjs';
import { ControllerSession } from './session.mjs';

const CHANNEL = 1;
const STORAGE_KEY = 'linectrl-controls';

const clock = { now: () => (getIsStarted() ? getTime() : null) };

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

async function openMidiInput(device) {
  const { enableWebMidi } = await import('@strudel/midi');
  const { MidiInput } = await import('@strudel/midi/input.mjs');
  await enableWebMidi();
  return new MidiInput(device);
}

export const deck = new Deck(createStorage(), clock, CHANNEL);

export const controller = new ControllerSession(deck, openMidiInput);
