#!/usr/bin/env node

import cowsay from 'cowsay';
import { createReadStream, existsSync, writeFileSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import http from 'http';
import { join, resolve, sep } from 'path';
import readline from 'readline';
import os from 'os';
import { parseSampleMeta, SIDECAR_SUFFIX, sidecarPath } from '@strudel/sample-meta';
import { isAudioFile, getSampleMap } from './scan.mjs';
import { warpedSample } from './warp.mjs';

const PORT = process.env.PORT || 5432;

const args = process.argv.slice(2);

function getArgValue(flag) {
  const i = args.indexOf(flag);
  if (i !== -1) {
    const nextIsFlag = args[i + 1]?.startsWith('--') ?? true;
    if (nextIsFlag) return true;
    return args[i + 1];
  }
}

function getInput(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (response) => {
      rl.close();
      resolve(response);
    }),
  );
}

let directory = getArgValue('--dir') || process.cwd();
directory = resolve(directory);
if (args.includes('--json')) {
  const json = JSON.stringify(await getSampleMap(directory, getArgValue('--flat')));
  const outFile = resolve(directory, 'strudel.json');
  if (existsSync(outFile)) {
    const answer = await getInput(`Warning: File already exists at ${outFile}. Overwrite? (y/N): `);
    if (answer.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }
  writeFileSync(outFile, json, 'utf8');
  console.log(`Wrote json to ${outFile}`);
}

console.log(
  cowsay.say({
    text: 'welcome to @strudel/sampler',
    e: 'oO',
    T: 'U ',
  }),
);

const writable = args.includes('--writable');
const cacheDir = join(directory, '.warp-cache');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function resolveInDirectory(pathname) {
  const filePath = resolve(directory, '.' + decodeURIComponent(pathname).split('/').join(sep));
  if (!filePath.startsWith(directory + sep)) {
    throw new HttpError(403, 'Forbidden');
  }
  return filePath;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readSidecar(audioPath) {
  const sidecar = sidecarPath(audioPath);
  if (!existsSync(sidecar)) {
    throw new HttpError(404, 'Sample has no markers');
  }
  return parseSampleMeta(JSON.parse(await readFile(sidecar, 'utf8')));
}

async function putSidecar(req, res, filePath) {
  if (!writable) {
    throw new HttpError(405, 'Start the server with --writable to save markers');
  }
  const audioPath = filePath.slice(0, -SIDECAR_SUFFIX.length);
  if (!filePath.endsWith(SIDECAR_SUFFIX) || !isAudioFile(audioPath) || !existsSync(audioPath)) {
    throw new HttpError(400, 'Can only write sidecars of existing audio files');
  }
  let meta;
  try {
    meta = parseSampleMeta(JSON.parse(await readBody(req)));
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  await writeFile(filePath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(meta));
}

function streamFile(res, filePath) {
  if (!existsSync(filePath)) {
    throw new HttpError(404, 'File not found');
  }
  const readStream = createReadStream(filePath);
  readStream.on('error', (err) => {
    res.statusCode = 500;
    res.end('Internal server error');
    console.error(err);
  });
  readStream.pipe(res);
}

async function getFile(res, filePath, bpmParam) {
  if (bpmParam === null) {
    return streamFile(res, filePath);
  }
  const bpm = Number(bpmParam);
  if (!(bpm > 0)) {
    throw new HttpError(400, `Invalid bpm: ${bpmParam}`);
  }
  if (!isAudioFile(filePath) || !existsSync(filePath)) {
    throw new HttpError(404, 'File not found');
  }
  const warpPath = await warpedSample({ cacheDir, audioPath: filePath, meta: await readSidecar(filePath), bpm });
  res.setHeader('X-Warp-Path', warpPath);
  streamFile(res, warpPath);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (url.pathname === '/' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(await getSampleMap(directory, getArgValue('--flat'))));
  }
  const filePath = resolveInDirectory(url.pathname);
  if (req.method === 'PUT') {
    return putSidecar(req, res, filePath);
  }
  if (req.method === 'GET') {
    return getFile(res, filePath, url.searchParams.get('bpm'));
  }
  throw new HttpError(405, 'Method not allowed');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-Warp-Path');
  try {
    await handle(req, res);
  } catch (err) {
    res.statusCode = err.status ?? 500;
    res.end(err.status ? err.message : 'Internal server error');
    err.status || console.error(err);
  }
});

const IP_ADDRESS = '0.0.0.0';
let IP;
const networkInterfaces = os.networkInterfaces();

Object.keys(networkInterfaces).forEach((key) => {
  networkInterfaces[key].forEach((networkInterface) => {
    if (networkInterface.family === 'IPv4' && !networkInterface.internal) {
      IP = networkInterface.address;
    }
  });
});

server.listen(PORT, IP_ADDRESS, () => {
  console.log(`@strudel/sampler is now serving audio files from:
 ${directory}

To use them in the Strudel REPL, run:
 samples('http://localhost:${PORT}')

Or on a machine in the same network:
 ${IP ? `samples('http://${IP}:${PORT}')` : `Unable to determine server's IP address.`}
`);
});
