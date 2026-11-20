import { describe, expect, it } from 'vitest';
import { Deck } from '../controls/deck.mjs';
import { ControllerSession } from '../controls/session.mjs';

function createFakeInput(device) {
  const input = {
    device,
    isConnected: false,
    isClosed: false,
    sent: [],
    messageListeners: new Set(),
    connectionListeners: new Set(),
    onMessage: (listener) => input.messageListeners.add(listener),
    onConnectionChange: (listener) => input.connectionListeners.add(listener),
    sendCC: (cc, value) => input.sent.push(['cc', cc, value]),
    sendNote: (note, velocity) => input.sent.push(['note', note, velocity]),
    close: () => {
      input.isClosed = true;
      input.messageListeners.clear();
      input.connectionListeners.clear();
    },
    setConnected: (isConnected) => {
      input.isConnected = isConnected;
      input.connectionListeners.forEach((listener) => listener(isConnected));
    },
    press: (note) => input.messageListeners.forEach((listener) => listener('noteon', 1, note, 127)),
    turn: (cc, value) => input.messageListeners.forEach((listener) => listener('cc', 2, cc, value)),
  };
  return input;
}

function createSession(stored = {}) {
  const storage = { load: () => stored, save: () => {} };
  const deck = new Deck(storage, { now: () => null }, 1);
  const inputs = [];
  const session = new ControllerSession(deck, async (device) => {
    if (device === 'broken') {
      throw new Error('no WebMIDI');
    }
    const input = createFakeInput(device);
    inputs.push(input);
    return input;
  });
  const phases = [];
  session.subscribe(() => phases.push(session.getStatus().phase));
  return { session, deck, inputs, phases };
}

describe('ControllerSession', () => {
  it('waits for the device and attaches the deck on connect', async () => {
    const { session, deck, inputs, phases } = createSession({ 'in:12': 1 });
    deck.control('in', [12], 0);
    await session.setDevice('X-TOUCH');
    expect(session.getStatus()).toEqual({ phase: 'waiting', device: 'X-TOUCH' });

    inputs[0].setConnected(true);
    expect(session.getStatus()).toEqual({ phase: 'connected', device: 'X-TOUCH' });
    expect(inputs[0].sent).toEqual([['cc', 12, 127]]);

    inputs[0].setConnected(false);
    expect(phases).toEqual(['waiting', 'connected', 'waiting']);
    deck.detach();
  });

  it('feeds incoming messages to the deck', async () => {
    const { session, deck, inputs } = createSession();
    const read = deck.control('btn', [36], 0);
    await session.setDevice('X-TOUCH');
    inputs[0].press(36);
    expect(read(0)).toBe(1);
  });

  it('keeps the latest messages newest first, cleared on device switch', async () => {
    const { session, inputs } = createSession();
    await session.setDevice('X-TOUCH');
    inputs[0].press(36);
    for (let value = 0; value < 50; value++) {
      inputs[0].turn(12, value);
    }

    const recent = session.getRecentMessages();
    expect(recent).toHaveLength(50);
    expect(recent[0]).toEqual({ seq: 50, type: 'cc', channel: 2, num: 12, value: 49 });
    expect(recent.at(-1)).toMatchObject({ type: 'cc', value: 0 });

    await session.setDevice('B');
    expect(session.getRecentMessages()).toEqual([]);
  });

  it('learns the next message of a type and still feeds it to the deck', async () => {
    const { session, deck, inputs } = createSession();
    const read = deck.control('btn', [36], 0);
    await session.setDevice('X-TOUCH');
    const learned = [];
    const learner = session.learn('noteon', (num) => learned.push(num));

    inputs[0].turn(12, 64);
    expect(learner.isArmed).toBe(true);
    inputs[0].press(36);
    inputs[0].press(37);

    expect(learned).toEqual([36]);
    expect(learner.isArmed).toBe(false);
    expect(read(0)).toBe(1);
  });

  it('disarms the previous learner when arming another', () => {
    const { session } = createSession();
    const first = session.learn('cc', () => {});
    const second = session.learn('noteon', () => {});
    expect(first.isArmed).toBe(false);

    first.cancel();
    expect(second.isArmed).toBe(true);
    second.cancel();
    expect(second.isArmed).toBe(false);
  });

  it('stops whichever learner is armed', () => {
    const { session } = createSession();
    const learner = session.learn('cc', () => {});
    expect(session.isLearning()).toBe(true);

    session.stopLearning();
    expect(learner.isArmed).toBe(false);
    expect(session.isLearning()).toBe(false);
  });

  it('closes the old input when switching devices', async () => {
    const { session, deck, inputs } = createSession();
    const read = deck.control('btn', [36], 0);
    await session.setDevice('A');
    inputs[0].setConnected(true);
    await session.setDevice('B');

    expect(inputs[0].isClosed).toBe(true);
    inputs[0].press(36);
    expect(read(0)).toBe(0);
    expect(session.getStatus()).toEqual({ phase: 'waiting', device: 'B' });
    deck.detach();
  });

  it('closes an input that finished opening after a newer switch', async () => {
    const { session, inputs } = createSession();
    const first = session.setDevice('A');
    await session.setDevice('');
    await first;
    expect(inputs[0].isClosed).toBe(true);
    expect(session.getStatus()).toEqual({ phase: 'idle' });
  });

  it('reports an unavailable device', async () => {
    const { session } = createSession();
    await session.setDevice('broken');
    expect(session.getStatus()).toEqual({ phase: 'unavailable', device: 'broken', error: 'no WebMIDI' });
  });

  it('resyncs faders and repaints every light', async () => {
    const { session, deck, inputs } = createSession({ 'in:12': 0, 'btn:36': 1 });
    deck.control('in', [12], 0);
    deck.control('btn', [36], 0);
    await session.setDevice('X-TOUCH');
    inputs[0].setConnected(true);
    deck.refresh();
    deck.refresh();
    expect(inputs[0].sent).toEqual([
      ['cc', 12, 0],
      ['note', 36, 127],
    ]);

    inputs[0].sent.length = 0;
    session.resync();
    deck.refresh();
    expect(inputs[0].sent).toEqual([
      ['cc', 12, 0],
      ['note', 36, 127],
    ]);
    deck.detach();
  });

  it('refuses to resync while not connected', async () => {
    const { session } = createSession();
    await session.setDevice('X-TOUCH');
    expect(() => session.resync()).toThrow('waiting');
  });
});
