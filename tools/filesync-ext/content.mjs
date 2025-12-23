import { z } from 'zod';

import { getMetadata } from '../../website/src/metadata_parser';

console.log('filesync-ext: active');

const STORAGE_KEY = 'strudel-settingsuserPatterns';

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
    const handle = await window.showDirectoryPicker().then((dir) => dir.getFileHandle(filename, { create: true }));
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
