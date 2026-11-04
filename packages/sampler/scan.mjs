import { readdir } from 'fs/promises';
import { join, sep } from 'path';

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

export async function getSampleMap(directory, flat = false) {
  const files = await getFilesInDirectory(directory);
  const root = directory.split(sep).join('/');
  const banks = {};
  files.forEach((path) => {
    path = path.split(sep).join('/');
    const subDir = path.replace(root, '');
    const subDirFlat = subDir.replaceAll('/', '_').slice(1); // remove initial underscore
    const subDirFlatStem = subDirFlat.replace(/\.[^.]+$/, ''); // remove extension
    const bank = flat ? subDirFlatStem : path.split('/').slice(-2)[0];
    banks[bank] = banks[bank] || [];
    banks[bank].push(subDir);
  });
  return banks;
}
