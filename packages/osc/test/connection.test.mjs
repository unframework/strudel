import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendOscFrame } from '../osc.mjs';

const sockets = [];

class FakeSocket extends EventTarget {
  sent = [];

  constructor() {
    super();
    sockets.push(this);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {}
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const frame = { address: '/test', args: [] };

describe('sendOscFrame during a bridge outage', () => {
  let log;

  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.useFakeTimers({ toFake: ['performance'] });
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    log.mockRestore();
  });

  it('logs once, drops frames without reconnecting until the retry delay, then resumes', async () => {
    const sends = [sendOscFrame(frame), sendOscFrame(frame), sendOscFrame(frame)];
    sockets[0].dispatchEvent(new Event('close'));
    await Promise.all(sends);
    await sendOscFrame(frame);

    const errors = () => log.mock.calls.filter(([message]) => message.includes('Could not connect'));
    expect(sockets).toHaveLength(1);
    expect(errors()).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    const retry = sendOscFrame(frame);
    await settle();
    sockets[1].dispatchEvent(new Event('close'));
    await retry;
    expect(errors()).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    const resumed = sendOscFrame(frame);
    await settle();
    sockets[2].dispatchEvent(new Event('open'));
    await resumed;
    expect(sockets[2].sent).toEqual([frame]);
  });
});
