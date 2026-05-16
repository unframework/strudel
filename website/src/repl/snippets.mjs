import { atom } from 'nanostores';
import { $settings } from '../../settings.mjs';
import { getMetadata } from '../../metadata_parser.js';
import { useStore } from '@nanostores/react';
import { useMemo } from 'react';

/**
 * Extract snippets from pattern code.
 * A snippet starts with `// @snippet <label>` and ends at the next blank line.
 */
function extractSnippets(code) {
  const snippets = [];
  const lines = code.split('\n');
  let current = null;

  for (const line of lines) {
    if (line.trim().startsWith('// @snippet ')) {
      if (current) snippets.push(current.trimEnd());
      current = line + '\n';
    } else if (current) {
      if (line.trim() === '') {
        snippets.push(current.trimEnd());
        current = null;
      } else {
        current += line + '\n';
      }
    }
  }
  if (current) snippets.push(current.trimEnd());
  return snippets;
}

/**
 * Process a single pattern and return snippet data if any found.
 */
function processPattern(id, pattern) {
  const snippets = extractSnippets(pattern.code || '');
  if (snippets.length === 0) return null;

  const meta = getMetadata(pattern.code);
  const metaTitle = meta.title?.trim() || null;
  let title = metaTitle;
  if (!title) {
    const date = new Date(pattern.created_at);
    if (!isNaN(date)) {
      title = date.toLocaleDateString();
    } else {
      title = id || 'unnamed';
    }
  }

  return {
    title,
    snippets,
    id,
    hasTitle: !!metaTitle,
    createdAt: pattern.created_at,
  };
}

/**
 * Sort patterns same way as PatternsTab: titled first (alphabetically), then untitled by date.
 */
function sortPatternSnippets(result) {
  return [...result].sort((a, b) => {
    if (a.hasTitle && b.hasTitle) {
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    }
    if (a.hasTitle) return -1;
    if (b.hasTitle) return 1;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
}

// Cache store: { [id]: { code, data } }
export const $snippetCache = atom({});

// Batch size for processing
const BATCH_SIZE = 10;

/**
 * Yield control back to the browser. Resolves on next idle callback.
 * Throws AbortError if signal is aborted.
 */
async function yieldThread(signal) {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  return new Promise((resolve, reject) => {
    const callback = () => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
      } else {
        resolve();
      }
    };

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(callback, { timeout: 100 });
    } else {
      setTimeout(callback, 0);
    }
  });
}

// Current abort controller for cancelling stale jobs
let currentController = null;

/**
 * Async snippet extraction with batched yielding.
 * Only processes patterns that have changed since last extraction.
 */
async function runExtraction(userPatterns, signal) {
  const currentIds = new Set(Object.keys(userPatterns));
  const cache = { ...$snippetCache.get() };

  // Find patterns that need processing (new or changed)
  const toProcess = [];
  for (const [id, pattern] of Object.entries(userPatterns)) {
    const cached = cache[id];
    if (!cached || cached.code !== pattern.code) {
      toProcess.push([id, pattern]);
    }
  }

  // Remove deleted patterns from cache
  for (const id of Object.keys(cache)) {
    if (!currentIds.has(id)) {
      delete cache[id];
    }
  }

  // Process patterns in batches, yielding between batches
  for (let i = 0; i < toProcess.length; i++) {
    if (i > 0 && i % BATCH_SIZE === 0) {
      await yieldThread(signal);
    }

    const [id, pattern] = toProcess[i];
    const data = processPattern(id, pattern);
    cache[id] = { code: pattern.code, data };
  }

  $snippetCache.set(cache);
}

/**
 * Schedule extraction, cancelling any in-progress job.
 */
function scheduleExtraction(userPatterns) {
  if (currentController) {
    currentController.abort();
  }
  currentController = new AbortController();

  runExtraction(userPatterns, currentController.signal).catch((e) => {
    if (e.name !== 'AbortError') {
      throw e;
    }
  });
}

// Subscribe to settings changes and trigger extraction
$settings.subscribe((settings) => {
  scheduleExtraction(settings.userPatterns);
});

/**
 * React hook to use snippets. Derives sorted array from cache via memo.
 */
export function useSnippets() {
  const cache = useStore($snippetCache);

  return useMemo(() => {
    const results = [];
    for (const { data } of Object.values(cache)) {
      if (data) results.push(data);
    }
    return sortPatternSnippets(results);
  }, [cache]);
}
