#!/usr/bin/env node
import { readFileSync, watchFile } from 'node:fs';
import osc from 'osc';
import * as core from '@strudel/core';
import { evalScope, Pattern, repl } from '@strudel/core';
import * as dirtPatches from '@strudel/dirt-patches';
import * as draw from '@strudel/draw';
import * as edo from '@strudel/edo';
import * as linectrl from '@strudel/linectrl';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import * as xen from '@strudel/xen';
import { registerWidgetType, transpiler } from '@strudel/transpiler';
import {
  createVisEval,
  DEFAULT_VIS_TARGET,
  evalMessages,
  hapLocationIndices,
  highlightMessage,
  parseVisTarget,
  RESEND_SECONDS,
} from './vis-protocol.mjs';
import { inlinePlots, PLOT_TICK_MS, PlotClock, plotSampleMessages } from './vis-plots.mjs';

const WATCH_MS = 500;
const OUTPUT_ONLY_METHODS = [
  'osc',
  'midi',
  'scope',
  'spectrum',
  'markcss',
  'pianoroll',
  'punchcard',
  'spiral',
  'pitchwheel',
];
const audioSetup = { samples: () => {}, aliasBank: () => {}, soundAlias: () => {} };

const [file, targetText = DEFAULT_VIS_TARGET] = process.argv.slice(2);
if (!file) {
  process.stderr.write('usage: vis-feed sketch.js [host:port]\n');
  process.exit(1);
}
const target = parseVisTarget(targetText);

OUTPUT_ONLY_METHODS.flatMap((name) => [name, `_${name}`])
  .filter((name) => !(name in Pattern.prototype))
  .forEach(
    (name) =>
      (Pattern.prototype[name] = function () {
        return this;
      }),
  );
Object.assign(Pattern.prototype, {
  _plot(id, options = {}) {
    return this.plot({ ...options, id, ctx: null });
  },
  _plot1(id, options = {}) {
    return this.plot1({ ...options, id, ctx: null });
  },
});
['_plot', '_plot1'].forEach(registerWidgetType);
await evalScope(core, draw, edo, tonal, mini, xen, linectrl, dirtPatches, audioSetup);

const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, metadata: false });
udp.on('error', (err) => process.stderr.write(`vis-feed: ${err.message}\n`));
await new Promise((resolve) => {
  udp.once('ready', resolve);
  udp.open();
});
const send = (packet) => udp.send(packet, target.host, target.port);
const timeTag = (seconds) => osc.timeTag(0, performance.timeOrigin + seconds * 1000);

let published = null;
const sendPublished = () => published && evalMessages(published).forEach(send);

function trigger(hap, _currentTime, cps, targetTime) {
  if (!published) return;
  const indices = hapLocationIndices(published, hap);
  if (!indices.length) return;
  send({
    timeTag: timeTag(targetTime),
    packets: [highlightMessage(published.evalId, hap.duration.valueOf() / cps, indices)],
  });
}

const { evaluate, scheduler } = repl({
  defaultOutput: () => {},
  getTime: () => performance.now() / 1000,
  transpiler,
  editPattern: (pattern) => pattern.onTrigger(trigger, false),
  afterEval: ({ code, meta }) => {
    published = createVisEval(code, meta?.miniLocations ?? [], inlinePlots(meta?.widgets ?? []));
    const { evalId, locations, plots } = published;
    process.stderr.write(`vis-feed: eval ${evalId}, ${locations.length} locations, ${plots.length} plots\n`);
    sendPublished();
  },
});

const plotClock = new PlotClock(scheduler);
function sendPlotSamples() {
  const due = plotClock.dueSamples();
  if (!published?.plots.length) return;
  due.forEach(({ cycle, targetTime }) =>
    send({ timeTag: timeTag(targetTime), packets: plotSampleMessages(published, cycle) }),
  );
}

const evaluateFile = () => evaluate(readFileSync(file, 'utf8'));

process.stderr.write(`vis-feed: ${file} → ${target.host}:${target.port}\n`);
await evaluateFile();
watchFile(file, { interval: WATCH_MS }, evaluateFile);
setInterval(sendPublished, RESEND_SECONDS * 1000);
setInterval(sendPlotSamples, PLOT_TICK_MS);
