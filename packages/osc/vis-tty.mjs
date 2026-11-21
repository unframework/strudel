#!/usr/bin/env node
import osc from 'osc';
import { DEFAULT_VIS_PORT } from './vis-protocol.mjs';
import { VisScene } from './vis-scene.mjs';

const PORT = Number(process.env.VIS_PORT ?? DEFAULT_VIS_PORT);
const FRAME_MS = 33;
const TRAFFIC_WINDOW_MS = 1000;
const TAB = '  ';

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

let lastFrame = '';

function draw() {
  const { columns, rows } = process.stdout;
  const current = scene.current;
  const { datagramsPerSecond, bytesPerSecond, peakBytesPerSecond } = traffic.read(Date.now());
  const rates = `${datagramsPerSecond} msg/s · ${kb(bytesPerSecond)} · peak ${kb(peakBytesPerSecond)}`;
  const status = current
    ? `vis-tty :${PORT} · eval ${current.evalId} · ${current.locations.length} locations · ${rates}`
    : `vis-tty :${PORT} · waiting for source · ${rates}`;
  const body = current
    ? renderSource(current.source, litMask(current.source.length, scene.activeRanges(Date.now())), columns, rows - 1)
    : [];
  const frame = [...body, ''].join('\n') + ansi.clearBelow;
  const statusLine = `\x1b[${rows};1H${ansi.dim}${status.slice(0, columns)}${ansi.reset}${ansi.clearLine}`;
  if (frame + statusLine === lastFrame) return;
  lastFrame = frame + statusLine;
  process.stdout.write(ansi.home + frame + statusLine);
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
