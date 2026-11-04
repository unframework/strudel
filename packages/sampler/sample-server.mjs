#!/usr/bin/env node

import cowsay from 'cowsay';
import { createReadStream, existsSync, writeFileSync } from 'fs';
import http from 'http';
import { join, resolve, sep } from 'path';
import readline from 'readline';
import os from 'os';
import { parseWarpQuery } from '@strudel/sample-meta';
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

async function getFile(res, filePath, params) {
  if (!params.has('bpm')) {
    return streamFile(res, filePath);
  }
  let warp;
  try {
    warp = parseWarpQuery(params);
  } catch (err) {
    throw new HttpError(400, `Invalid warp query: ${err.message}`);
  }
  if (!isAudioFile(filePath) || !existsSync(filePath)) {
    throw new HttpError(404, 'File not found');
  }
  const warpPath = await warpedSample({ cacheDir, audioPath: filePath, ...warp });
  res.setHeader('X-Warp-Path', warpPath);
  streamFile(res, warpPath);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(await getSampleMap(directory, getArgValue('--flat'))));
  }
  const filePath = resolveInDirectory(url.pathname);
  if (req.method === 'GET') {
    return getFile(res, filePath, url.searchParams);
  }
  throw new HttpError(405, 'Method not allowed');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
