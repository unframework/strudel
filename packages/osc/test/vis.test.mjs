import { describe, expect, it } from 'vitest';
import { Hap, TimeSpan } from '@strudel/core';
import { evalMessages, highlightMessage } from '../vis-protocol.mjs';
import { VisScene } from '../vis-scene.mjs';
import { createVisEval, hapLocationIndices, parseVisTarget } from '../vis.mjs';

const source = 'note("c e g").s("sine")\n'.repeat(100);
const locations = Array.from({ length: 300 }, (_, i) => [i, i + 2]);

const deliver = (scene, messages, timeMs = 0) =>
  messages.forEach(({ address, args }) => scene.receive(address, args, timeMs));

describe('vis feed', () => {
  it('reassembles chunked source and locations regardless of arrival order', () => {
    const visEval = createVisEval(source, locations);
    const messages = evalMessages(visEval);
    expect(messages.length).toBeGreaterThan(4);

    const scene = new VisScene();
    deliver(scene, messages.reverse());
    expect(scene.current).toEqual({ evalId: visEval.evalId, source, locations });
  });

  it('waits for every chunk before switching evals', () => {
    const scene = new VisScene();
    deliver(scene, evalMessages(createVisEval(source, locations)).slice(1));
    expect(scene.current).toBeNull();
  });

  it('lights ranges from the timetag for the event duration', () => {
    const visEval = createVisEval('s("bd sd")', [
      [3, 5],
      [6, 8],
    ]);
    const scene = new VisScene();
    deliver(scene, evalMessages(visEval));
    deliver(scene, [highlightMessage(visEval.evalId, 0.5, [1])], 1000);

    expect(scene.activeRanges(999)).toEqual([]);
    expect(scene.activeRanges(1200)).toEqual([[6, 8]]);
    expect(scene.activeRanges(1500)).toEqual([]);
  });

  it('ignores highlights from a stale eval', () => {
    const [stale, fresh] = [createVisEval('a', [[0, 1]]), createVisEval('b', [[0, 1]])];
    const scene = new VisScene();
    deliver(scene, evalMessages(stale));
    deliver(scene, [highlightMessage(stale.evalId, 1, [0])]);
    deliver(scene, evalMessages(fresh));
    deliver(scene, [highlightMessage(stale.evalId, 1, [0])]);

    expect(scene.current.evalId).toBe(fresh.evalId);
    expect(scene.activeRanges(500)).toEqual([]);
  });

  it('maps hap locations to deduped table indices, skipping unknown ones', () => {
    const visEval = createVisEval('', [
      [0, 2],
      [4, 6],
    ]);
    const context = {
      locations: [
        { start: 4, end: 6 },
        { start: 9, end: 12 },
        { start: 4, end: 6 },
      ],
    };
    const hap = new Hap(new TimeSpan(0, 1), new TimeSpan(0, 1), {}, context);
    expect(hapLocationIndices(visEval, hap)).toEqual([1]);
  });

  it('parses host:port targets', () => {
    expect(parseVisTarget('visbox:9000')).toEqual({ host: 'visbox', port: 9000 });
    expect(parseVisTarget('visbox')).toEqual({ host: 'visbox', port: 57140 });
    expect(() => parseVisTarget('visbox:abc')).toThrow();
  });
});
