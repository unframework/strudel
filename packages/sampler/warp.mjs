import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, rename, stat } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { warpPlan } from '@strudel/sample-meta';

const run = promisify(execFile);

const contentHashes = new Map(); // path -> { mtimeMs, hash }
const inFlight = new Map(); // cache path -> Promise<cache path>

async function contentHash(path) {
  const { mtimeMs } = await stat(path);
  const known = contentHashes.get(path);
  if (known?.mtimeMs === mtimeMs) {
    return known.hash;
  }
  const hash = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
  contentHashes.set(path, { mtimeMs, hash });
  return hash;
}

export const roundBpm = (bpm) => Math.round(bpm * 100) / 100;

function warpFilter(plan) {
  const segments = plan.map(({ from, to, ratio }, i) => {
    const end = to === Infinity ? '' : `:end=${to}`;
    return `[0:a]atrim=start=${from}${end},asetpts=PTS-STARTPTS,rubberband=tempo=${1 / ratio}[s${i}]`;
  });
  const inputs = plan.map((_, i) => `[s${i}]`).join('');
  return [...segments, `${inputs}concat=n=${plan.length}:v=0:a=1[out]`].join(';');
}

async function render(audioPath, plan, outPath) {
  const tmpPath = `${outPath}.tmp.wav`;
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    audioPath,
    '-filter_complex',
    warpFilter(plan),
    '-map',
    '[out]',
    '-c:a',
    'pcm_s16le',
    tmpPath,
  ]);
  await rename(tmpPath, outPath);
}

export async function warpedSample({ cacheDir, audioPath, meta, bpm }) {
  bpm = roundBpm(bpm);
  const key = createHash('sha256')
    .update([await contentHash(audioPath), JSON.stringify(meta), bpm].join('\n'))
    .digest('hex');
  const outPath = join(cacheDir, `${key}.wav`);
  if (existsSync(outPath)) {
    return outPath;
  }
  if (!inFlight.has(outPath)) {
    const job = (async () => {
      await mkdir(cacheDir, { recursive: true });
      await render(audioPath, warpPlan(meta, bpm), outPath);
      return outPath;
    })();
    inFlight.set(outPath, job);
    job.finally(() => inFlight.delete(outPath)).catch(() => {});
  }
  return inFlight.get(outPath);
}
