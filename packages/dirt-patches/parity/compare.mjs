#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { Hap, TimeSpan } from '@strudel/core';
import { parseControlsFromHap } from '@strudel/osc';
import { compareRenders, readWav } from './analysis.mjs';
import { cases } from './cases.mjs';

const CYCLES = 1;
const SAMPLE_RATE = 48000;
const RENDER_TIMEOUT_MS = 180_000;

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const strudelRenderCli = fileURLToPath(import.meta.resolve('@strudel/render/cli.mjs'));

const { values: args, positionals: filters } = parseArgs({
  allowPositionals: true,
  options: {
    code: { type: 'string' },
    detail: { type: 'boolean', default: false },
    tolerance: { type: 'string', default: '1' },
  },
});
const tolerance = Number(args.tolerance);

async function runTool(command, commandArgs, env) {
  try {
    await run(command, commandArgs, {
      timeout: RENDER_TIMEOUT_MS,
      env: { ...process.env, ...env },
      maxBuffer: 64 << 20,
    });
  } catch (error) {
    const log = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().split('\n').slice(-30).join('\n');
    throw new Error(`${command} failed (${error.code ?? error.signal}):\n${log}`);
  }
}

const scLiteral = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? `${value}.0` : `${value}`;
  }
  if (typeof value === 'string') {
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  }
  throw new Error(`no OSC encoding for ${JSON.stringify(value)}`);
};

function superdirtEvents(timeline) {
  const [{ _cps: cps, _begin: begin }, ...haps] = timeline;
  const entries = haps.map((hap) => {
    const span = new TimeSpan(hap.begin, hap.end);
    const controls = parseControlsFromHap(new Hap(span, span, { ...hap.value }), cps);
    const pairs = Object.entries(controls).flatMap(([key, value]) => [scLiteral(key), scLiteral(value)]);
    return `\t[${(hap.begin - begin) / cps}, [${pairs.join(', ')}]]`;
  });
  return { seconds: CYCLES / cps, source: `[\n${entries.join(',\n')}\n]\n` };
}

async function renderCase({ name, code }) {
  const dir = join(here, 'out', name);
  const file = (leaf) => join(dir, leaf);
  await mkdir(dir, { recursive: true });
  await writeFile(file('pattern.strudel'), code);

  await runTool(process.execPath, [
    strudelRenderCli,
    ...['-i', file('pattern.strudel'), '-o', file('strudel.wav')],
    ...['--cycles', `${CYCLES}`, '--sample-rate', `${SAMPLE_RATE}`],
  ]);
  const timeline = (await readFile(file('strudel.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const { seconds, source } = superdirtEvents(timeline);
  await writeFile(file('events.scd'), source);
  await runTool('sclang', [join(here, 'superdirt.scd'), file('events.scd'), file('superdirt.wav'), `${seconds}`], {
    QT_QPA_PLATFORM: 'offscreen',
  });

  const [strudel, superdirt] = await Promise.all(
    ['strudel.wav', 'superdirt.wav'].map(async (leaf) => readWav(await readFile(file(leaf)))),
  );
  const report = compareRenders(strudel, superdirt);
  await writeFile(file('report.json'), JSON.stringify(report, null, 2));
  return { dir, report };
}

const db = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
const hz = (value) => (value >= 1000 ? `${value / 1000}k` : `${value}`);
const passes = ({ level, worstBand, worstEnvelope }) =>
  [level, worstBand, worstEnvelope].every(({ diff }) => Math.abs(diff) <= tolerance);

function printSummary(name, report) {
  const { level, worstBand, worstEnvelope } = report;
  console.log(
    [
      `${passes(report) ? 'PASS' : 'FAIL'}  ${name.padEnd(22)}`,
      `level ${db(level.diff).padStart(6)} dB`,
      `worst band ${`${hz(worstBand.low)}-${hz(worstBand.high)}`.padStart(9)} Hz ${db(worstBand.diff).padStart(6)} dB`,
      `worst envelope @${worstEnvelope.seconds.toFixed(2)}s ${db(worstEnvelope.diff).padStart(6)} dB`,
    ].join('   '),
  );
}

function printDetail({ dir, report }) {
  const row = (label, a, b, diff) =>
    console.log(`  ${label.padEnd(14)}${a.padStart(9)}${b.padStart(11)}${diff.padStart(8)}`);
  row('', 'strudel', 'superdirt', 'diff');
  row('level dB', db(report.level.strudel), db(report.level.superdirt), db(report.level.diff));
  console.log('  octave bands (dB)');
  report.bands.forEach((band) =>
    row(
      `${hz(band.low)}-${hz(band.high)}${band.audible ? '' : ' ~'}`,
      db(band.strudel),
      db(band.superdirt),
      db(band.diff),
    ),
  );
  console.log('  RMS envelope (dB)');
  report.envelope.forEach((point) =>
    row(`@${point.seconds.toFixed(2)}s`, db(point.strudel), db(point.superdirt), db(point.diff)),
  );
  console.log('  spectral peaks (Hz @ dB)');
  report.peaks.strudel.forEach((peak, i) => {
    const other = report.peaks.superdirt[i];
    row('', `${peak.hz.toFixed(0)}@${peak.db.toFixed(0)}`, `${other.hz.toFixed(0)}@${other.db.toFixed(0)}`, '');
  });
  console.log(`  renders: ${dir}\n`);
}

const selected = args.code
  ? [{ name: 'adhoc', code: args.code }]
  : cases.filter(({ name }) => filters.length === 0 || filters.some((filter) => name.includes(filter)));
if (selected.length === 0) {
  throw new Error(`no case matches ${filters.join(', ')}`);
}

let failures = 0;
for (const { name, code } of selected) {
  const result = await renderCase({ name, code });
  printSummary(name, result.report);
  if (args.detail || args.code) {
    printDetail(result);
  }
  failures += passes(result.report) ? 0 : 1;
}
console.log(`\n${selected.length - failures}/${selected.length} within ±${tolerance} dB`);
process.exitCode = failures > 0 ? 1 : 0;
