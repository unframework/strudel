import { describe, expect, it } from 'vitest';
import { ControlLog, alignStamp } from '../controls/log.mjs';
import { lightFor } from '../controls/lights.mjs';
import { Deck } from '../controls/deck.mjs';

function createDeck(stored = {}) {
  const clock = { cycle: 0, now: () => clock.cycle };
  const storage = { values: stored, load: () => storage.values, save: (values) => (storage.values = values) };
  const sent = [];
  const output = {
    sendCC: (cc, value) => sent.push(['cc', cc, value]),
    sendNote: (note, velocity) => sent.push(['note', note, velocity]),
  };
  return { deck: new Deck(storage, clock, 1), clock, storage, sent, output };
}

describe('ControlLog', () => {
  it('aligns stamps up to the next boundary', () => {
    expect(alignStamp(3.2, 0)).toBe(3.2);
    expect(alignStamp(3.2, 0.5)).toBe(3.5);
    expect(alignStamp(3.2, 1)).toBe(4);
    expect(alignStamp(4, 1)).toBe(4);
  });

  it('reads the same history immediately or aligned', () => {
    const log = new ControlLog(0);
    log.record(3.2, 0.7);
    expect(log.valueAt(3.3, 0)).toBe(0.7);
    expect(log.valueAt(3.3, 0.5)).toBe(0);
    expect(log.valueAt(3.5, 0.5)).toBe(0.7);
    expect(log.valueAt(3.9, 1)).toBe(0);
    expect(log.valueAt(4, 1)).toBe(0.7);
  });

  it('collapses when stamps go backwards', () => {
    const log = new ControlLog(0);
    log.record(10.2, 1);
    log.record(0.1, 0.5);
    expect(log.valueAt(0, 1)).toBe(1);
    expect(log.valueAt(1, 1)).toBe(0.5);
  });

  it('prunes settled events into the base value', () => {
    const log = new ControlLog(0);
    log.record(1, 0.2);
    log.record(2, 0.4);
    log.record(3, 0.6);
    log.prune(2);
    expect(log.base).toBe(0.4);
    expect(log.events).toEqual([{ stamp: 3, value: 0.6 }]);
  });
});

describe('lightFor', () => {
  it('is steady when settled and pulses on the beat while pending', () => {
    expect(lightFor(true, true, 1.1)).toBe(true);
    expect(lightFor(false, false, 1.1)).toBe(false);
    expect(lightFor(true, false, 1.05)).toBe(true);
    expect(lightFor(true, false, 1.2)).toBe(false);
    expect(lightFor(true, false, null)).toBe(true);
  });
});

describe('Deck', () => {
  it('maps CC to 0-1 values', () => {
    const { deck, clock } = createDeck();
    const read = deck.control('in', [12], 0);
    clock.cycle = 1.2;
    deck.receive('cc', 12, 127);
    expect(read(1.25)).toBe(1);
    deck.receive('cc', 13, 0);
    expect(read(1.25)).toBe(1);
  });

  it('toggles a button on the next bar, and a second press before it cancels', () => {
    const { deck, clock } = createDeck();
    const read = deck.control('btn', [1], 1);
    clock.cycle = 2.3;
    deck.receive('noteon', 1, 127);
    deck.receive('noteoff', 1, 0);
    expect(read(2.9)).toBe(0);
    expect(read(3)).toBe(1);

    deck.receive('noteon', 1, 127);
    expect(read(3)).toBe(0);
  });

  it('holds a push button only while pressed', () => {
    const { deck, clock } = createDeck();
    const read = deck.control('push', [2], 0);
    clock.cycle = 1;
    deck.receive('noteon', 2, 127);
    expect(read(1.1)).toBe(1);
    clock.cycle = 1.5;
    deck.receive('noteoff', 2, 0);
    expect(read(1.6)).toBe(0);
  });

  it('selects the radio index of the last pressed button', () => {
    const { deck, clock } = createDeck();
    const read = deck.control('radio', [12, 13, 14], 0);
    clock.cycle = 1;
    deck.receive('noteon', 14, 127);
    expect(read(1.1)).toBe(2);
    deck.receive('noteon', 12, 127);
    expect(read(1.1)).toBe(0);
  });

  it('applies input immediately while the transport is stopped', () => {
    const { deck, clock } = createDeck();
    const read = deck.control('btn', [1], 1);
    clock.cycle = null;
    deck.receive('noteon', 1, 127);
    clock.cycle = 0.1;
    expect(read(0.1)).toBe(1);
  });

  it('settles pending changes when the transport restarts', () => {
    const { deck, clock } = createDeck();
    const read = deck.control('btn', [1], 1);
    clock.cycle = 7.5;
    deck.receive('noteon', 1, 127);
    clock.cycle = null;
    expect(read(0)).toBe(1);
    clock.cycle = 0;
    expect(read(0.5)).toBe(1);
  });

  it('restores and persists values', () => {
    const { deck, clock, storage } = createDeck({ 'in:12': 0.5, 'radio:3,4': 1 });
    expect(deck.control('in', [12], 0)(0)).toBe(0.5);
    expect(deck.control('radio', [3, 4], 0)(0)).toBe(1);
    clock.cycle = 1;
    deck.receive('noteon', 3, 127);
    expect(storage.values).toEqual({ 'in:12': 0.5, 'radio:3,4': 0 });
  });

  it('restores faders on attach and renders lights', () => {
    const { deck, clock, sent, output } = createDeck({ 'in:12': 1 });
    deck.control('in', [12], 0);
    deck.control('radio', [3, 4], 1);
    clock.cycle = 1.05;
    deck.attach(output);
    deck.refresh();
    expect(sent).toEqual([
      ['cc', 12, 127],
      ['note', 3, 127],
      ['note', 4, 0],
    ]);

    sent.length = 0;
    deck.receive('noteon', 4, 127);
    deck.refresh();
    expect(sent).toEqual([['note', 4, 127]]);

    sent.length = 0;
    clock.cycle = 2;
    deck.refresh();
    expect(sent).toEqual([['note', 3, 0]]);
    deck.detach();
  });
});
