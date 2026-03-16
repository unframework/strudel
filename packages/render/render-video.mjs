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
    width: { type: 'string', default: '720' },
    height: { type: 'string', default: '1280' },
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
  --fps <n>              Frame rate (default: 25)
  --width <n>            Viewport width (default: 720)
  --height <n>           Max viewport height (default: 1280)
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
const lines = readFileSync(args.jsonl, 'utf-8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
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
const code = readFileSync(args.code, 'utf-8').replace(/\r\n/g, '\n');

const duration = (end - begin) / cps;
const totalFrames = Math.ceil(duration * fps);

console.log(
  `CPS: ${cps}, cycles ${begin}..${end}, duration: ${duration.toFixed(1)}s, ${totalFrames} frames at ${fps}fps`,
);

async function renderFrames() {
  mkdirSync(outputDir, { recursive: true });

  console.log('Starting vite dev server...');
  const server = await createServer({
    root: __dirname,
    server: { port: 0 },
    logLevel: 'silent',
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

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__keyframesReady === true', { timeout: 10000 }).catch(async () => {
      const html = await page.content();
      console.error('Page did not load. HTML:', html.slice(0, 500));
      throw new Error('keyframes page failed to load');
    });

    await page.evaluate((code) => window.initEditor(code), code);

    // Auto-size viewport height to fit code content, capped at 9:16 ratio
    // Temporarily expand viewport tall so content isn't clipped during measurement
    const maxHeight = Math.ceil(width * 16 / 9);
    await page.setViewport({ width, height: 4000, deviceScaleFactor: 1 });
    const contentHeight = await page.evaluate(() => window.getContentHeight());
    // Round up to even number (required by libx264)
    const finalHeight = (Math.min(Math.max(contentHeight, 100), maxHeight) + 1) & ~1;
    console.log(`Viewport: ${width}x${finalHeight} (content: ${contentHeight}px, max: ${maxHeight}px)`);
    await page.setViewport({ width, height: finalHeight, deviceScaleFactor: 1 });

    const t0 = performance.now();
    const timings = { evaluate: 0, screenshot: 0 };
    const TAIL_SECONDS = 0.1; // fade-out tail after hap ends
    let idCounter = 0;
    let prevLocMap = new Map(); // persists across frames to track id continuity

    for (let i = 0; i < totalFrames; i++) {
      const time = i / fps;
      const cycleTime = begin + time * cps;

      // Collect active highlights, deduplicated by location + hap begin time
      // (end times may vary for the same event, so collate those into one)
      const eventMap = new Map(); // "loc:hapBegin" -> entry
      for (const hap of haps) {
        const hapEnd = hap.begin + hap.duration;
        const tailEnd = hapEnd + TAIL_SECONDS * cps;
        const age = (cycleTime - hap.begin) / cps; // seconds since hap start
        let intensity;
        if (hap.begin <= cycleTime && cycleTime < hapEnd) {
          intensity = 1;
        } else if (cycleTime >= hapEnd && cycleTime < tailEnd) {
          intensity = 1 - (cycleTime - hapEnd) / (TAIL_SECONDS * cps);
        } else {
          continue;
        }
        for (const loc of hap.locations) {
          const dedupeKey = `${loc.start}:${loc.end}:${hap.begin}`;
          const existing = eventMap.get(dedupeKey);
          if (!existing || intensity > existing.intensity) {
            eventMap.set(dedupeKey, { start: loc.start, end: loc.end, intensity, age, hapBegin: hap.begin });
          }
        }
      }

      // Per location, pick the entry with the latest hap begin time
      const locMap = new Map();
      for (const entry of eventMap.values()) {
        const locKey = `${entry.start}:${entry.end}`;
        const existing = locMap.get(locKey);
        if (!existing || entry.hapBegin > existing.hapBegin) {
          locMap.set(locKey, entry);
        }
      }

      // Assign ids: new id when hap begin time changes at a location (new event),
      // otherwise carry the previous frame's id forward (respects breaks between events)
      for (const [key, entry] of locMap) {
        const prev = prevLocMap.get(key);
        if (prev && prev.hapBegin === entry.hapBegin) {
          entry.id = prev.id;
        } else {
          entry.id = idCounter++;
        }
      }
      prevLocMap = locMap;
      const activeLocations = [...locMap.values()];

      let t = performance.now();
      if (activeLocations.length > 0) {
        await page.evaluate((locs) => window.applyHighlights(locs), activeLocations);
      } else {
        await page.evaluate(() => window.clearHighlights());
      }
      timings.evaluate += performance.now() - t;

      t = performance.now();
      const frameName = `frame_${String(i + 1).padStart(5, '0')}.png`;
      await page.screenshot({ path: join(outputDir, frameName) });
      timings.screenshot += performance.now() - t;

      if ((i + 1) % 50 === 0 || i === totalFrames - 1) {
        const elapsed = (performance.now() - t0) / 1000;
        const rate = (i + 1) / elapsed;
        const eta = ((totalFrames - i - 1) / rate).toFixed(0);
        const n = i + 1;
        console.log(
          `  ${n}/${totalFrames} frames (${rate.toFixed(1)} fps, ETA ${eta}s) | evaluate: ${(timings.evaluate / n).toFixed(0)}ms  screenshot: ${(timings.screenshot / n).toFixed(0)}ms  avg/frame: ${((elapsed * 1000) / n).toFixed(0)}ms`,
        );
      }
    }

    console.log(`Frames saved to: ${outputDir}/`);
    console.log(
      `\nTo create video:\n  ffmpeg -framerate ${fps} -i ${outputDir}/frame_%05d.png -i <audio.wav> -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest output.mp4`,
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

renderFrames().catch((err) => {
  console.error('Render failed:', err);
  process.exit(1);
});
