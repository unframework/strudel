import { describe, expect, it } from 'vitest';
import { Hap, sine, TimeSpan } from '@strudel/core';
import '@strudel/draw';
import {
  createVisEval,
  evalMessages,
  hapLocationIndices,
  highlightMessage,
  parseVisTarget,
  plotSampleMessage,
} from '../vis-protocol.mjs';
import { inlinePlots, PlotClock, plotSampleMessages, SAMPLES_PER_CYCLE } from '../vis-plots.mjs';
import { VisScene } from '../vis-scene.mjs';

const source = 'note("c e g").s("sine")\n'.repeat(100);
const locations = Array.from({ length: 300 }, (_, i) => [i, i + 2]);
const plots = Array.from({ length: 100 }, (_, i) => ({ end: i * 24, min: 0, max: i, lookback: 8 }));

const deliver = (scene, messages, timeMs = 0) =>
  messages.forEach(({ address, args }) => scene.receive(address, args, timeMs));

describe('vis feed', () => {
  it('reassembles chunked source and locations regardless of arrival order', () => {
    const visEval = createVisEval(source, locations, plots);
    const messages = evalMessages(visEval);
    expect(messages.length).toBeGreaterThan(6);

    const scene = new VisScene();
    deliver(scene, messages.reverse());
    expect(scene.current).toEqual({ evalId: visEval.evalId, source, locations, plots });
  });

  it('waits for every chunk before switching evals', () => {
    const scene = new VisScene();
    deliver(scene, evalMessages(createVisEval(source, locations, plots)).slice(0, -1));
    expect(scene.current).toBeNull();
  });

  it('lights ranges from the timetag for the event duration', () => {
    const visEval = createVisEval(
      's("bd sd")',
      [
        [3, 5],
        [6, 8],
      ],
      [],
    );
    const scene = new VisScene();
    deliver(scene, evalMessages(visEval));
    deliver(scene, [highlightMessage(visEval.evalId, 0.5, [1])], 1000);

    expect(scene.activeRanges(999)).toEqual([]);
    expect(scene.activeRanges(1200)).toEqual([[6, 8]]);
    expect(scene.activeRanges(1500)).toEqual([]);
  });

  it('ignores highlights from a stale eval', () => {
    const [stale, fresh] = [createVisEval('a', [[0, 1]], []), createVisEval('b', [[0, 1]], [])];
    const scene = new VisScene();
    deliver(scene, evalMessages(stale));
    deliver(scene, [highlightMessage(stale.evalId, 1, [0])]);
    deliver(scene, evalMessages(fresh));
    deliver(scene, [highlightMessage(stale.evalId, 1, [0])]);

    expect(scene.current.evalId).toBe(fresh.evalId);
    expect(scene.activeRanges(500)).toEqual([]);
  });

  it('maps hap locations to deduped table indices, skipping unknown ones', () => {
    const visEval = createVisEval(
      '',
      [
        [0, 2],
        [4, 6],
      ],
      [],
    );
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

  it('sends unset plot bounds as NaN and receives them as null', () => {
    const visEval = createVisEval('x', [], [{ end: 1, lookback: 8 }]);
    const scene = new VisScene();
    deliver(scene, evalMessages(visEval));
    expect(scene.current.plots).toEqual([{ end: 1, min: null, max: null, lookback: 8 }]);
  });

  it('keeps plot history for its lookback, once samples are due, and drops it on a new eval', () => {
    const visEval = createVisEval('x', [], [{ end: 1, min: 0, max: 1, lookback: 1 }]);
    const scene = new VisScene();
    deliver(scene, evalMessages(visEval));
    [0, 0.5, 1, 1.5, 2].forEach((cycle) =>
      deliver(scene, [plotSampleMessage(visEval.evalId, 0, cycle, [cycle, NaN])], cycle * 1000),
    );

    expect(scene.plotHistory(0, 1500).map(({ cycle }) => cycle)).toEqual([0.5, 1, 1.5]);
    expect(scene.plotHistory(0, 2000).at(-1)).toEqual({ timeMs: 2000, cycle: 2, values: [2, null] });

    deliver(scene, evalMessages(createVisEval('y', [], [{ end: 1, min: 0, max: 1, lookback: 1 }])));
    expect(scene.plotHistory(0, 2000)).toEqual([]);
  });

  it('forgets plot history from before the transport restarts', () => {
    const visEval = createVisEval('x', [], [{ end: 1, min: 0, max: 1, lookback: 4 }]);
    const scene = new VisScene();
    deliver(scene, evalMessages(visEval));
    deliver(scene, [plotSampleMessage(visEval.evalId, 0, 10, [1])], 0);
    deliver(scene, [plotSampleMessage(visEval.evalId, 0, 0, [0])], 100);

    expect(scene.plotHistory(0, 100).map(({ cycle }) => cycle)).toEqual([0]);
  });

  it('joins recorded plots with their widgets and samples each series', () => {
    sine.plot({ id: 'vis-test-plot', ctx: null, cycles: 4 });
    sine.plot({ id: 'vis-test-other', ctx: null });
    sine.plot1({ id: 'vis-test-plot1', ctx: null });
    const widgets = [
      { type: '_plot', id: 'vis-test-plot', to: 12 },
      { type: '_pianoroll', id: 'vis-test-other', to: 20 },
      { type: '_plot1', id: 'vis-test-plot1', to: 30 },
      { type: '_plot', id: 'vis-test-unrecorded', to: 40 },
    ];

    const visPlots = inlinePlots(widgets);
    expect(visPlots.map(({ end, min, max, lookback }) => ({ end, min, max, lookback }))).toEqual([
      { end: 12, min: undefined, max: undefined, lookback: 2 },
      { end: 30, min: 0, max: 1, lookback: 8 },
    ]);
    expect(inlinePlots([widgets[1]])).toEqual([]);

    const [message] = plotSampleMessages(createVisEval('', [], visPlots.slice(0, 1)), 0.25);
    expect(message.args.slice(1, 3)).toEqual([0, 0.25]);
    expect(message.args[3]).toBeCloseTo(1);
  });

  it('steps through the sample grid as the scheduler queries ahead, timed by the scheduler', () => {
    const scheduler = { started: true, lastBegin: 0, lastEnd: 0.2, timeAt: (cycle) => cycle * 2 };
    const clock = new PlotClock(scheduler);
    const cycles = () => clock.dueSamples().map(({ cycle }) => cycle * SAMPLES_PER_CYCLE);

    expect(clock.dueSamples().slice(0, 2)).toEqual([
      { cycle: 0, targetTime: 0 },
      { cycle: 1 / SAMPLES_PER_CYCLE, targetTime: 2 / SAMPLES_PER_CYCLE },
    ]);
    Object.assign(scheduler, { lastBegin: 0.2, lastEnd: 0.3 });
    expect(cycles()).toEqual([4]);
    Object.assign(scheduler, { lastBegin: 10, lastEnd: 10.1 });
    expect(cycles()).toEqual(Array.from({ length: SAMPLES_PER_CYCLE }, (_, i) => 146 + i));
    Object.assign(scheduler, { lastBegin: 0, lastEnd: 0.1 });
    expect(cycles()).toEqual([0, 1]);
    scheduler.started = false;
    expect(cycles()).toEqual([]);
  });
});
