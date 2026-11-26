#!/usr/bin/env node
import osc from 'osc';
import { DEFAULT_VIS_PORT } from './vis-protocol.mjs';
import { VisScene } from './vis-scene.mjs';

const PORT = Number(process.env.VIS_PORT ?? DEFAULT_VIS_PORT);
const FRAME_MS = 33;
const TRAFFIC_WINDOW_MS = 1000;
const TAB = '  ';
const SPARKS = '▁▂▃▄▅▆▇█';
const READOUT_WIDTH = 9;

const ansi = {
  enterScreen: '\x1b[?1049h\x1b[?25l',
  leaveScreen: '\x1b[?25h\x1b[?1049l',
  home: '\x1b[H',
  clearLine: '\x1b[K',
  clearBelow: '\x1b[J',
  highlight: '\x1b[1;30;43m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

class TrafficMeter {
  #datagrams = [];
  #peakBytesPerSecond = 0;

  add(bytes, timeMs) {
    this.#datagrams.push({ bytes, timeMs });
  }

  read(timeMs) {
    this.#datagrams = this.#datagrams.filter((datagram) => datagram.timeMs > timeMs - TRAFFIC_WINDOW_MS);
    const bytesPerSecond = this.#datagrams.reduce((sum, { bytes }) => sum + bytes, 0);
    this.#peakBytesPerSecond = Math.max(this.#peakBytesPerSecond, bytesPerSecond);
    return { datagramsPerSecond: this.#datagrams.length, bytesPerSecond, peakBytesPerSecond: this.#peakBytesPerSecond };
  }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB/s`;

const scene = new VisScene();
const traffic = new TrafficMeter();

const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: PORT, metadata: false });
udp.on('raw', (data) => traffic.add(data.length, Date.now()));
udp.on('message', (message, timeTag) => scene.receive(message.address, message.args, timeTag?.native ?? Date.now()));
udp.on('error', (err) => process.stderr.write(`vis-tty: ${err.message}\n`));
udp.open();

function litMask(length, ranges) {
  const mask = new Uint8Array(length);
  ranges.forEach(([start, end]) => mask.fill(1, start, end));
  return mask;
}

function renderSource(source, mask, columns, rows) {
  const lines = [];
  let line = '';
  let width = 0;
  let lit = false;
  const endLine = () => {
    lines.push(line + (lit ? ansi.reset : '') + ansi.clearLine);
    [line, width, lit] = ['', 0, false];
  };

  for (let i = 0; i < source.length && lines.length < rows; i++) {
    const char = source[i];
    if (char === '\n') {
      endLine();
      continue;
    }
    const glyph = char === '\t' ? TAB : char;
    if (width + glyph.length > columns) continue;
    if (Boolean(mask[i]) !== lit) {
      lit = !lit;
      line += lit ? ansi.highlight : ansi.reset;
    }
    line += glyph;
    width += glyph.length;
  }
  if (lines.length < rows) endLine();
  return lines;
}

const lineNumberAt = (source, offset) => source.slice(0, offset).split('\n').length;

function sparkline(values, min, max) {
  const finite = values.filter((value) => value !== null);
  const lo = min ?? Math.min(...finite);
  const hi = max ?? Math.max(...finite);
  const level = (value) =>
    hi > lo ? Math.round(((value - lo) / (hi - lo)) * (SPARKS.length - 1)) : Math.floor(SPARKS.length / 2);
  return values
    .map((value) => (value === null ? ' ' : SPARKS[Math.min(SPARKS.length - 1, Math.max(0, level(value)))]))
    .join('');
}

function renderPlot(source, plot, history, columns) {
  const label = `L${lineNumberAt(source, plot.end)} `;
  const width = Math.max(0, columns - label.length - READOUT_WIDTH);
  const values = history.slice(-width).map(({ values: [first = null] }) => first);
  const latest = values.at(-1);
  const readout = (latest == null ? '' : String(Number(latest.toPrecision(3)))).padStart(READOUT_WIDTH);
  return `${ansi.dim}${label}${ansi.reset}${sparkline(values, plot.min, plot.max).padStart(width)}${readout}${ansi.clearLine}`;
}

let lastFrame = '';

function draw() {
  const { columns, rows } = process.stdout;
  const current = scene.current;
  const nowMs = Date.now();
  const { datagramsPerSecond, bytesPerSecond, peakBytesPerSecond } = traffic.read(nowMs);
  const rates = `${datagramsPerSecond} msg/s · ${kb(bytesPerSecond)} · peak ${kb(peakBytesPerSecond)}`;
  const status = current
    ? `vis-tty :${PORT} · eval ${current.evalId} · ${current.locations.length} locations · ${current.plots.length} plots · ${rates}`
    : `vis-tty :${PORT} · waiting for source · ${rates}`;
  const plotLines = current
    ? current.plots.map((plot, index) => renderPlot(current.source, plot, scene.plotHistory(index, nowMs), columns))
    : [];
  const sourceRows = Math.max(0, rows - 1 - plotLines.length);
  const body = current
    ? renderSource(current.source, litMask(current.source.length, scene.activeRanges(nowMs)), columns, sourceRows)
    : [];
  const frame = [...body, ''].join('\n') + ansi.clearBelow;
  const plotRows = plotLines.map((line, i) => `\x1b[${sourceRows + 1 + i};1H${line}`).join('');
  const statusLine = `\x1b[${rows};1H${ansi.dim}${status.slice(0, columns)}${ansi.reset}${ansi.clearLine}`;
  if (frame + plotRows + statusLine === lastFrame) return;
  lastFrame = frame + plotRows + statusLine;
  process.stdout.write(ansi.home + frame + plotRows + statusLine);
}

function quit() {
  process.stdout.write(ansi.leaveScreen);
  process.exit(0);
}

process.stdout.write(ansi.enterScreen);
process.stdout.on('resize', () => (lastFrame = ''));
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
setInterval(draw, FRAME_MS);
