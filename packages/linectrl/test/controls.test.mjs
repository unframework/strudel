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
    expect(lightFor(true, false, 1.1)).toBe(true);
    expect(lightFor(false, false, 1.1)).toBe(false);
    expect(lightFor(true, true, 1.05)).toBe(true);
    expect(lightFor(true, true, 1.2)).toBe(false);
    expect(lightFor(true, false, null)).toBe(true);
  });
});

describe('Deck', () => {
  it('maps CC to 0-1 values', () => {
    const { deck, clock } = createDeck();
    const read = deck.reader('cc', 12, 0);
    clock.cycle = 1.2;
    deck.receive('cc', 12, 127);
    expect(read(1.25)).toBe(1);
    deck.receive('cc', 13, 0);
    expect(read(1.25)).toBe(1);
  });

  it('toggles a button on the next bar, and a second press before it cancels', () => {
    const { deck, clock } = createDeck();
    const read = deck.reader('note', 1, 1);
    clock.cycle = 2.3;
    deck.receive('noteon', 1, 127);
    deck.receive('noteoff', 1, 0);
    expect(read(2.9)).toBe(0);
    expect(read(3)).toBe(1);

    deck.receive('noteon', 1, 127);
    expect(read(3)).toBe(0);
  });

  it('lets readers with different alignments hear the same press', () => {
    const { deck, clock } = createDeck();
    const now = deck.reader('note', 1, 0);
    const nextBar = deck.reader('note', 1, 1);
    clock.cycle = 2.3;
    deck.receive('noteon', 1, 127);
    expect(now(2.4)).toBe(1);
    expect(nextBar(2.4)).toBe(0);
    expect(nextBar(3)).toBe(1);
  });

  it('follows every control without a reader', () => {
    const { deck } = createDeck();
    deck.receive('noteon', 36, 127);
    deck.receive('cc', 12, 127);
    expect(deck.value('note', 36)).toBe(1);
    expect(deck.value('cc', 12)).toBe(1);
    expect(deck.value('cc', 13)).toBe(0);
  });

  it('applies input immediately while the transport is stopped', () => {
    const { deck, clock } = createDeck();
    const read = deck.reader('note', 1, 1);
    clock.cycle = null;
    deck.receive('noteon', 1, 127);
    clock.cycle = 0.1;
    expect(read(0.1)).toBe(1);
  });

  it('settles pending changes when the transport restarts', () => {
    const { deck, clock } = createDeck();
    const read = deck.reader('note', 1, 1);
    clock.cycle = 7.5;
    deck.receive('noteon', 1, 127);
    clock.cycle = null;
    expect(read(0)).toBe(1);
    clock.cycle = 0;
    expect(read(0.5)).toBe(1);
  });

  it('restores and persists values, dropping unknown keys', () => {
    const { deck, clock, storage } = createDeck({ 'cc:12': 0.5, 'note:3': 1, 'radio:3,4': 1 });
    expect(deck.reader('cc', 12, 0)(0)).toBe(0.5);
    expect(deck.value('note', 3)).toBe(1);
    clock.cycle = 1;
    deck.receive('noteon', 3, 127);
    expect(storage.values).toEqual({ 'cc:12': 0.5, 'note:3': 0 });
  });

  it('restores faders on attach and lights every toggle', () => {
    const { deck, sent, output } = createDeck({ 'cc:12': 1, 'note:3': 1, 'note:4': 0 });
    deck.attach(output);
    deck.refresh();
    expect(sent).toEqual([
      ['cc', 12, 127],
      ['note', 3, 127],
      ['note', 4, 0],
    ]);
    deck.detach();
  });

  it('pulses a light until its longest-aligned reader hears the change', () => {
    const { deck, clock, sent, output } = createDeck();
    const read = deck.reader('note', 4, 1);
    clock.cycle = 1.05;
    read(1.05);
    deck.attach(output);
    deck.receive('noteon', 4, 127);
    deck.refresh();
    expect(sent).toEqual([['note', 4, 127]]);

    sent.length = 0;
    clock.cycle = 1.2;
    deck.refresh();
    expect(sent).toEqual([['note', 4, 0]]);

    sent.length = 0;
    clock.cycle = 2.2;
    deck.refresh();
    expect(sent).toEqual([['note', 4, 127]]);
    deck.detach();
  });

  it('stops pulsing for a reader the sketch no longer queries', () => {
    const { deck, clock, sent, output } = createDeck();
    const read = deck.reader('note', 4, 4);
    clock.cycle = 1.05;
    read(1.05);
    deck.attach(output);
    deck.receive('noteon', 4, 127);
    clock.cycle = 1.2;
    deck.refresh();
    expect(sent).toEqual([['note', 4, 0]]);

    sent.length = 0;
    clock.cycle = 2.3;
    deck.refresh();
    expect(sent).toEqual([['note', 4, 127]]);
    deck.detach();
  });
});
