import { createClient } from '@supabase/supabase-js';

let client = null;

function getClient() {
  if (client) return client;

  const url = import.meta.env.PUBLIC_SUPASYNC_URL;
  const key = import.meta.env.PUBLIC_SUPASYNC_KEY;
  if (!url || !key) {
    console.warn('[supasync] missing URL or key', import.meta.env);
    return null;
  }

  console.log('[supasync] client initialized');
  client = createClient(url, key);
  return client;
}

export async function loadSupasyncData() {
  const sb = getClient();
  if (!sb) return {};

  try {
    const { data, error } = await sb.from('patterns').select('id, code');
    if (error) {
      console.error('supasync: error loading patterns', error);
      return {};
    }
    const result = {};
    for (const row of data) {
      result[row.id] = row.code;
    }
    return result;
  } catch (err) {
    console.error('supasync: error loading patterns', err);
    return {};
  }
}

export async function saveSupasyncPattern(id, data) {
  const sb = getClient();
  if (!sb) return;

  try {
    if (data === null) {
      const { error } = await sb.from('patterns').delete().eq('id', id);
      if (error) console.error('supasync: error deleting pattern', error);
    } else {
      const code = typeof data === 'string' ? data : (data.code ?? '');
      const { error } = await sb.from('patterns').upsert({ id, code }, { onConflict: 'id' });
      if (error) console.error('supasync: error upserting pattern', error);
    }
  } catch (err) {
    console.error('supasync: error saving pattern', err);
  }
}
