import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join, sep } from 'path';
import { parseSampleMeta, sidecarPath } from '@strudel/sample-meta';

const LOG = !!process.env.LOG;
const VALID_AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg'];

export const isAudioFile = (f) => {
  const ext = f.split('.').slice(-1)[0].toLowerCase();
  return VALID_AUDIO_EXTENSIONS.includes(ext);
};

async function getFilesInDirectory(directory) {
  let files = [];
  const dirents = await readdir(directory, { withFileTypes: true });
  for (const dirent of dirents) {
    const fullPath = join(directory, dirent.name);
    if (dirent.isDirectory()) {
      if (dirent.name.startsWith('.')) {
        LOG && console.warn(`ignore hidden folder: ${fullPath}`);
        continue;
      }
      try {
        const subFiles = (await getFilesInDirectory(fullPath)).filter(isAudioFile);
        files = files.concat(subFiles);
        LOG && console.log(`${dirent.name} (${subFiles.length})`);
      } catch (err) {
        LOG && console.warn(`skipped due to error: ${fullPath}`);
      }
    } else {
      isAudioFile(fullPath) && files.push(fullPath);
    }
  }
  return files;
}

async function readSidecars(directory, relativePaths) {
  const entries = [];
  for (const path of relativePaths) {
    const sidecar = join(directory, sidecarPath(path));
    if (!existsSync(sidecar)) {
      continue;
    }
    try {
      entries.push([path, parseSampleMeta(JSON.parse(await readFile(sidecar, 'utf8')))]);
    } catch (err) {
      console.error(`invalid sidecar ${sidecar}: ${err.message}`);
    }
  }
  return Object.fromEntries(entries);
}

export async function getSampleMap(directory, flat = false) {
  const files = await getFilesInDirectory(directory);
  const root = directory.split(sep).join('/');
  const banks = {};
  const relativePaths = files.map((path) => {
    path = path.split(sep).join('/');
    const subDir = path.replace(root, '');
    const subDirFlat = subDir.replaceAll('/', '_').slice(1); // remove initial underscore
    const subDirFlatStem = subDirFlat.replace(/\.[^.]+$/, ''); // remove extension
    const bank = flat ? subDirFlatStem : path.split('/').slice(-2)[0];
    banks[bank] = banks[bank] || [];
    banks[bank].push(subDir);
    return subDir;
  });
  const meta = await readSidecars(directory, relativePaths);
  return Object.keys(meta).length ? { ...banks, _meta: meta } : banks;
}
