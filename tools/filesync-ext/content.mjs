import { z } from 'zod';

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
      }
    }
  })();
});
