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
import { transpiler } from '@strudel/transpiler';
import {
  createVisEval,
  DEFAULT_VIS_TARGET,
  evalMessages,
  hapLocationIndices,
  highlightMessage,
  parseVisTarget,
  RESEND_SECONDS,
} from './vis-protocol.mjs';

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
await evalScope(core, draw, edo, tonal, mini, xen, linectrl, dirtPatches, audioSetup);

const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, metadata: false });
udp.on('error', (err) => process.stderr.write(`vis-feed: ${err.message}\n`));
await new Promise((resolve) => {
  udp.once('ready', resolve);
  udp.open();
});
const send = (packet) => udp.send(packet, target.host, target.port);

let published = null;
const sendPublished = () => published && evalMessages(published).forEach(send);

function trigger(hap, _currentTime, cps, targetTime) {
  if (!published) return;
  const indices = hapLocationIndices(published, hap);
  if (!indices.length) return;
  send({
    timeTag: osc.timeTag(0, performance.timeOrigin + targetTime * 1000),
    packets: [highlightMessage(published.evalId, hap.duration.valueOf() / cps, indices)],
  });
}

const { evaluate } = repl({
  defaultOutput: () => {},
  getTime: () => performance.now() / 1000,
  transpiler,
  editPattern: (pattern) => pattern.onTrigger(trigger, false),
  afterEval: ({ code, meta }) => {
    published = createVisEval(code, meta?.miniLocations ?? []);
    process.stderr.write(`vis-feed: eval ${published.evalId}, ${published.locations.length} locations\n`);
    sendPublished();
  },
});

const evaluateFile = () => evaluate(readFileSync(file, 'utf8'));

process.stderr.write(`vis-feed: ${file} → ${target.host}:${target.port}\n`);
await evaluateFile();
watchFile(file, { interval: WATCH_MS }, evaluateFile);
setInterval(sendPublished, RESEND_SECONDS * 1000);
