import { z } from 'zod';
import { get as kvGet, set as kvSet } from 'idb-keyval';

import { getMetadata } from '../../website/src/metadata_parser';

console.log('filesync-ext: active');

const STORAGE_KEY = 'strudel-settingsuserPatterns';
const KV_KEY_DIR_HANDLE = 'strudel-filesync-ext-directory-handle';

/**
 * @param {string} key
 * @param {(newValue: string, oldValue: string) => void} onChange
 */
function createStorageListener(key, onChange) {
  let initialValue = localStorage.getItem(key) || '';

  setInterval(() => {
    const currentValue = localStorage.getItem(key);
    if (currentValue !== initialValue) {
      try {
        onChange(currentValue, initialValue);
      } catch (e) {
        console.error('filesync-ext: error in storage listener', e);
      }

      initialValue = currentValue;
    }
  }, 500);
}

const userPatternSchema = z.object({
  id: z.string(),
  code: z.string(),
  created_at: z.number().optional(),
  collection: z.literal('user'),
});

/**
 *
 * @template T extends z.ZodTypeAny
 * @param {T} schema
 * @returns {z.ZodRecord<z.ZodString, T | undefined>}
 */
function safeMap(schema) {
  return z.record(schema.optional().catch(undefined));
}

function jsonParse(raw) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = JSON.parse(raw);
      resolve(parsed);
    } catch (e) {
      reject(e);
    }
  });
}

function fileNameSanitize(name) {
  return name.replace(/[^ a-z0-9_\-(),.]/gi, '-');
}

// TODO: run this in advance before saving somehow
async function ensureDirectoryAccess() {
  const existingHandle = await kvGet(KV_KEY_DIR_HANDLE);
  const dirHandle = existingHandle || (await window.showDirectoryPicker());

  const testFileHandle = await dirHandle.getFileHandle('strudel filesync.txt', { create: true });
  const writable = await testFileHandle.createWritable();
  await writable.write('This folder contains Strudel files managed by the Strudel Filesystem Sync extension.');
  await writable.close();

  await kvSet(KV_KEY_DIR_HANDLE, dirHandle);

  return dirHandle;
}

/**
 *
 * @param {string} id
 * @param {string} code
 */
async function syncPattern(id, code) {
  console.log(`filesync-ext: syncing pattern ${id} to local filesystem`);

  const meta = getMetadata(code);
  const title = meta.title || 'unnamed';
  const author = Array.isArray(meta.by) ? meta.by.join(',') : 'Anonymous';

  const prefix = `${fileNameSanitize(title).slice(0, 50)}_${fileNameSanitize(author).slice(0, 30)}`;
  const filename = `${prefix}_${fileNameSanitize(id)}.strudel.js`;

  console.log(`filesync-ext: writing file: ${filename}`);

  try {
    const dirHandle = await ensureDirectoryAccess();

    const handle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(code);
    await writable.close();

    console.log(`filesync-ext: successfully wrote pattern ${id} to ${filename}`);
  } catch (e) {
    console.error(`filesync-ext: error writing pattern ${id} to file`, e);
  }
}

createStorageListener(STORAGE_KEY, (newValue, oldValue) => {
  console.log('filesync-ext: detected change in userPatterns');

  (async () => {
    const newPatternsRaw = await jsonParse(newValue || '{}');
    const oldPatternsRaw = await jsonParse(oldValue).catch(() => ({}));

    const newPatterns = await safeMap(userPatternSchema).parseAsync(newPatternsRaw);
    const oldPatterns = await safeMap(userPatternSchema).parseAsync(oldPatternsRaw);

    // Determine added or updated patterns
    for (const newPattern of Object.values(newPatterns)) {
      const { id, code } = newPattern;

      const oldPattern = oldPatterns[id];
      if (oldPattern?.code !== code) {
        console.log(`filesync-ext: pattern updated: ${id}`);
        await syncPattern(id, code);
      }
    }
  })();
});
