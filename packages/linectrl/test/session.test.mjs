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
