#!/usr/bin/env node
import osc from 'osc';
import { DEFAULT_VIS_PORT } from './vis-protocol.mjs';
import { VisScene } from './vis-scene.mjs';

const PORT = Number(process.env.VIS_PORT ?? DEFAULT_VIS_PORT);
const FRAME_MS = 33;
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

const scene = new VisScene();

const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: PORT, metadata: false });
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
  const status = current
    ? `vis-tty :${PORT} · eval ${current.evalId} · ${current.locations.length} locations`
    : `vis-tty :${PORT} · waiting for source`;
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
