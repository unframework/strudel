import { z } from 'zod';
import { get as kvGet, set as kvSet } from 'idb-keyval';

import { getMetadata } from '../../website/src/metadata_parser';

console.log('filesync-ext: active');

const KV_KEY_DIR_HANDLE = 'strudel-filesync-ext-dir-handle';

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
  if (existingHandle) {
    await existingHandle.requestPermission({ mode: 'readwrite' });
  }

  const dirHandle = existingHandle || (await window.showDirectoryPicker());

  const testFileHandle = await dirHandle.getFileHandle('strudel filesync.txt', { create: true });
  const writable = await testFileHandle.createWritable();
  await writable.write('This folder contains Strudel files managed by the Strudel Filesystem Sync extension.');
  await writable.close();

  await kvSet(KV_KEY_DIR_HANDLE, dirHandle);

  return dirHandle;
}

/**
 * Clean up existing files with same ID but different filenames
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} id
 * @param {string} filename current filename to keep
 */
async function removeMismatchingPatternFiles(dirHandle, id, filename) {
  // Avoid weird scenarios where a super short ID matches many files and destroys a lot of data
  if (id.length !== 12) {
    console.warn(`filesync-ext: skipping cleanup for pattern ${id} with non-standard ID length`);
    return;
  }

  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind !== 'file') {
      continue;
    }

    if (name !== filename && name.includes(id) && name.endsWith('.strudel.js')) {
      console.log(`filesync-ext: removing old file for pattern ${id}: ${name}`);
      await dirHandle.removeEntry(name);
    }
  }
}

/**
 *
 * @param {string} id
 * @param {string} code
 */
async function syncPattern(id, code) {
  console.log(`filesync-ext: syncing pattern ${id} to local filesystem`);

  if (fileNameSanitize(id) !== id) {
    console.error(`filesync-ext: pattern ID ${id} contains unsafe filename characters`);
    return;
  }

  const meta = getMetadata(code);
  const title = meta.title || 'unnamed';
  const author = Array.isArray(meta.by) ? meta.by.join(',') : 'Anonymous';

  const prefix = `${fileNameSanitize(title).slice(0, 50)} - ${fileNameSanitize(author).slice(0, 30)}`;
  const filename = `${prefix} (${id}).strudel.js`;

  console.log(`filesync-ext: writing file: ${filename}`);

  try {
    const dirHandle = await ensureDirectoryAccess();

    const handle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(code);
    await writable.close();

    console.log(`filesync-ext: successfully wrote pattern ${id} to ${filename}`);

    await removeMismatchingPatternFiles(dirHandle, id, filename);
  } catch (e) {
    console.error(`filesync-ext: error writing pattern ${id} to file`, e);
  }
}

const eventSchema = z
  .object({
    namespace: z.literal('strudel-filesync-ext'),
  })
  .and(
    z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('load'), rpcCallId: z.string() }),
        z.object({ type: z.literal('userPatternUpdated'), data: userPatternSchema }),
        z.object({ type: z.literal('userPatternDeleted'), id: z.string() }),
      ])
      .catch(({ input }) => ({
        type: 'unknown',
        input,
      })),
  );

async function onEvent(event) {
  if (event.type === 'userPatternUpdated') {
    const patternData = event.data;
    await syncPattern(patternData.id, patternData.code);
  } else if (event.type === 'userPatternDeleted') {
    const dirHandle = await ensureDirectoryAccess();
    // TODO: preserve deleted files somehow? eg remove the ID from the name
    await removeMismatchingPatternFiles(dirHandle, event.id, '');
  } else if (event.type === 'load') {
    console.log('filesync-ext: load event');
    const dirHandle = await ensureDirectoryAccess();

    const codeUpdates = {};
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind !== 'file') {
        continue;
      }

      const patternIdMatch = name.match(/\(([^)]{12})\)\.strudel\.js$/);
      if (!patternIdMatch) {
        continue;
      }

      const id = patternIdMatch[1];
      const fileHandle = await dirHandle.getFileHandle(name);
      const file = await fileHandle.getFile();
      const code = await file.text();

      codeUpdates[id] = code;
      console.log(`filesync-ext: loaded pattern ${id} from file ${name}`);
    }

    console.log('filesync-ext: sending code updates to REPL', codeUpdates);
    window.postMessage(
      {
        namespace: 'strudel-main',
        type: 'rpcResponse',
        id: event.rpcCallId,
        response: codeUpdates,
      },
      window.origin,
    );
  } else if (event.type === 'unknown') {
    console.error('filesync-ext: unknown event received', event.input);
  }
}

// window.postMessage({namespace: 'strudel-filesync-ext', type: 'load'})
window.addEventListener('message', async (event) => {
  const parsed = eventSchema.safeParse(event.data);
  if (!parsed.success) {
    return;
  }

  onEvent(parsed.data);
});

// Indicate presence of the extension
document.body.classList.add('strudel-filesync-ext-active');
