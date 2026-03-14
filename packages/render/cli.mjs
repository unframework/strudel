#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { readFileSync, mkdtempSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const { values: args } = parseArgs({
  options: {
    input: { type: 'string', short: 'i' },
    cycles: { type: 'string', default: '4' },
    cps: { type: 'string', default: '0.5' },
    'sample-rate': { type: 'string', default: '44100' },
    output: { type: 'string', short: 'o', default: 'output.wav' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (args.help) {
  console.log(`Usage: strudel-render [file] [options]

Options:
  -i, --input <path>        Path to file containing Strudel code
  --cycles <n>              Number of cycles to render (default: 4)
  --cps <n>                 Cycles per second / tempo (default: 0.5)
  --sample-rate <n>         Sample rate in Hz (default: 44100)
  -o, --output <path>       Output WAV file path (default: output.wav)
  -h, --help                Show this help
`);
  process.exit(0);
}

if (!args.input) {
  console.error('Error: provide --input <file>');
  process.exit(1);
}
const code = readFileSync(args.input, 'utf-8');

const cycles = parseFloat(args.cycles);
const cps = parseFloat(args.cps);
const sampleRate = parseInt(args['sample-rate']);
const outputPath = args.output;

async function render() {
  // Create temp directory for the WAV download
  const downloadDir = mkdtempSync(join(tmpdir(), 'strudel-render-'));

  console.log('Starting vite dev server...');
  const server = await createServer({
    root: __dirname,
    server: { port: 0 },
    logLevel: 'silent',
  });
  await server.listen();
  const port = server.httpServer.address().port;
  const url = `http://localhost:${port}`;

  console.log('Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  try {
    const page = await browser.newPage();

    // Set up CDP download interception
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
    });

    // Listen for console messages from the page
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[webaudio]') || text.includes('[strudel]')) {
        console.log(text);
      }
    });

    page.on('pageerror', (err) => {
      console.error('Page error:', err.message);
    });

    console.log('Loading Strudel...');
    await page.goto(url, { waitUntil: 'networkidle0' });

    // Wait for the render module to be ready
    await page.waitForFunction('window.__strudelRenderReady === true', { timeout: 30000 });

    console.log(`Rendering ${cycles} cycles at ${cps} cps (${sampleRate}Hz)...`);

    const renderTimeout = 60000;
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Render timed out after ${renderTimeout / 1000}s`)), renderTimeout);
    });

    // Trigger the render (which triggers a download and returns the hap timeline)
    const renderPromise = page.evaluate(
      async (code, cycles, cps, sampleRate) => {
        return window.renderOffline(code, cycles, cps, sampleRate);
      },
      code,
      cycles,
      cps,
      sampleRate,
    );

    const timeline = await Promise.race([renderPromise, timeoutPromise]);
    clearTimeout(timeoutId);

    // Wait for the download to complete
    console.log('Waiting for WAV download...');
    await waitForDownload(downloadDir);

    // Find and move the downloaded WAV file
    const files = readdirSync(downloadDir);
    const wavFile = files.find((f) => f.endsWith('.wav'));
    if (!wavFile) {
      throw new Error('No WAV file was downloaded');
    }
    renameSync(join(downloadDir, wavFile), outputPath);
    console.log(`Audio saved to: ${outputPath}`);

    const timelinePath = outputPath.replace(/(\.[^.]{0,5})?$/, '.jsonl');
    writeFileSync(timelinePath, timeline.map((h) => JSON.stringify(h)).join('\n') + '\n');
    console.log(`Timeline saved to: ${timelinePath}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

async function waitForDownload(dir, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const files = readdirSync(dir);
    // Chrome creates .crdownload files while downloading
    const hasPartial = files.some((f) => f.endsWith('.crdownload'));
    const hasWav = files.some((f) => f.endsWith('.wav'));
    if (hasWav && !hasPartial) {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Download timed out');
}

render().catch((err) => {
  console.error('Render failed:', err);
  process.exit(1);
});
