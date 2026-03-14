#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const { values: args } = parseArgs({
  options: {
    jsonl: { type: 'string' },
    code: { type: 'string' },
    begin: { type: 'string' },
    end: { type: 'string' },
    fps: { type: 'string', default: '25' },
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '720' },
    output: { type: 'string', short: 'o', default: 'frames' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (args.help) {
  console.log(`Usage: render-video [options]

Options:
  --jsonl <path>         Path to JSONL timeline (from cli.mjs)
  --code <path>          Path to source code file
  --begin <cycle>        Start cycle for video (default: from JSONL _meta)
  --end <cycle>          End cycle for video (default: from JSONL _meta)
  --fps <n>              Frame rate for quantization (default: 25)
  --width <n>            Viewport width (default: 1280)
  --height <n>           Viewport height (default: 720)
  -o, --output <dir>     Output directory for frames (default: frames)
  -h, --help             Show this help
`);
  process.exit(0);
}

if (!args.jsonl || !args.code) {
  console.error('Error: provide --jsonl and --code');
  process.exit(1);
}

// Parse JSONL
const lines = readFileSync(args.jsonl, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
const meta = lines.find((l) => l._meta);
if (!meta) {
  console.error('Error: JSONL missing _meta line with _cps');
  process.exit(1);
}
const haps = lines.filter((l) => !l._meta);
const cps = meta._cps;
const begin = args.begin != null ? parseFloat(args.begin) : meta._begin;
const end = args.end != null ? parseFloat(args.end) : meta._end;
const fps = parseInt(args.fps);
const width = parseInt(args.width);
const height = parseInt(args.height);
const outputDir = args.output;
const code = readFileSync(args.code, 'utf-8');

const duration = (end - begin) / cps; // seconds

// Collect sparse transition times (in seconds from video start)
const transitions = new Set([0]);
for (const hap of haps) {
  const hapStartSec = (hap.begin - begin) / cps;
  const hapEndSec = (hap.begin + hap.duration - begin) / cps;
  // Quantize to frame grid
  transitions.add(Math.round(hapStartSec * fps) / fps);
  transitions.add(Math.round(hapEndSec * fps) / fps);
}
const times = [...transitions].filter((t) => t >= 0 && t < duration).sort((a, b) => a - b);

console.log(`CPS: ${cps}, cycles ${begin}..${end}, duration: ${duration.toFixed(1)}s`);
console.log(`${times.length} keyframes (vs ${Math.ceil(duration * fps)} at ${fps}fps)`);

async function renderKeyframes() {
  mkdirSync(outputDir, { recursive: true });

  console.log('Starting vite dev server...');
  const server = await createServer({
    root: __dirname,
    server: { port: 0 },
    logLevel: 'error',
  });
  await server.listen();
  const port = server.httpServer.address().port;
  const url = `http://localhost:${port}/keyframes.html`;

  console.log('Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    page.on('pageerror', (err) => console.error('Page error:', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('Console error:', msg.text());
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__keyframesReady === true', { timeout: 10000 }).catch(async () => {
      const html = await page.content();
      console.error('Page did not load. HTML:', html.slice(0, 500));
      throw new Error('keyframes page failed to load');
    });

    // Initialize editor with code
    await page.evaluate((code) => window.initEditor(code), code);

    // Render each keyframe
    const concatLines = ['ffconcat version 1.0'];

    for (let i = 0; i < times.length; i++) {
      const time = times[i];
      const cycleTime = begin + time * cps;

      // Find active haps at this cycle time
      const activeLocations = [];
      for (const hap of haps) {
        if (hap.begin <= cycleTime && cycleTime < hap.begin + hap.duration) {
          for (const loc of hap.locations) {
            activeLocations.push({
              start: loc.start,
              end: loc.end,
              color: hap.value?.color,
            });
          }
        }
      }

      // Apply highlights
      if (activeLocations.length > 0) {
        await page.evaluate((locs) => window.applyHighlights(locs), activeLocations);
      } else {
        await page.evaluate(() => window.clearHighlights());
      }

      // Screenshot
      const frameName = `frame_${String(i + 1).padStart(5, '0')}.png`;
      await page.screenshot({ path: join(outputDir, frameName) });

      // Duration until next keyframe (or end of video)
      const nextTime = i + 1 < times.length ? times[i + 1] : duration;
      const frameDuration = nextTime - time;

      concatLines.push(`file ${frameName}`);
      concatLines.push(`duration ${frameDuration.toFixed(6)}`);

      if ((i + 1) % 50 === 0 || i === times.length - 1) {
        console.log(`  ${i + 1}/${times.length} keyframes`);
      }
    }

    // ffmpeg concat demuxer requires the last file repeated without duration
    const lastFrame = `frame_${String(times.length).padStart(5, '0')}.png`;
    concatLines.push(`file ${lastFrame}`);

    const concatPath = join(outputDir, 'concat.txt');
    writeFileSync(concatPath, concatLines.join('\n') + '\n');
    console.log(`Concat file saved to: ${concatPath}`);
    console.log(
      `\nTo create video:\n  ffmpeg -f concat -safe 0 -i ${concatPath} -i <audio.wav> -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest output.mp4`,
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

renderKeyframes().catch((err) => {
  console.error('Render failed:', err);
  process.exit(1);
});
