import { useStore } from '@nanostores/react';
import { emptySampleMeta, parseSampleMeta, sidecarPath } from '@strudel/sample-meta';
import { getAudioContext, getSampleUrl, loadBuffer, setSampleMeta, soundMap } from '@strudel/webaudio';
import cx from '@src/cx.mjs';
import { useEffect, useMemo, useState } from 'react';
import { SampleEditor, useAsync } from '../../annotate/SampleEditor.jsx';
import { attempt } from '../../annotate/timeline.mjs';
import { ActionButton } from '../button/action-button.jsx';
import { inputClass } from './SettingsTab.jsx';

async function fetchSidecar(url) {
  const res = await fetch(sidecarPath(url));
  if (res.status === 404) {
    return emptySampleMeta();
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  return parseSampleMeta(await res.json());
}

async function saveSidecar(url, meta) {
  const res = await fetch(sidecarPath(url), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  return parseSampleMeta(await res.json());
}

function useSampleAnnotation(url) {
  const loaded = useAsync(
    url &&
      (async () => {
        const [buffer, meta] = await Promise.all([loadBuffer(url, getAudioContext()), fetchSidecar(url)]);
        return { buffer, meta };
      }),
    [url],
  );
  const [saved, setSaved] = useState();
  const [meta, setMeta] = useState();
  const [saveError, setSaveError] = useState();

  useEffect(() => {
    setSaved(loaded.value?.meta);
    setMeta(loaded.value?.meta);
    setSaveError(undefined);
  }, [loaded.value]);

  const save = async () => {
    try {
      const stored = await saveSidecar(url, meta);
      setSampleMeta(url, stored);
      setSaved(stored);
      setMeta(stored);
      setSaveError(undefined);
    } catch (err) {
      setSaveError(err.message);
    }
  };

  return {
    status: loaded.status,
    error: loaded.error ?? saveError,
    buffer: loaded.value?.buffer,
    meta,
    saved,
    dirty: meta !== saved,
    setMeta,
    save,
    revert: () => setMeta(saved),
  };
}

function SamplePicker({ s, n, onChange }) {
  const sounds = useStore(soundMap);
  const names = useMemo(
    () =>
      Object.entries(sounds ?? {})
        .filter(([name, { data }]) => !name.startsWith('_') && data.type === 'sample' && !data.prebake)
        .map(([name]) => name)
        .sort(),
    [sounds],
  );
  const count = s ? (sounds[s]?.data.samples.length ?? 1) : 0;
  return (
    <div className="flex gap-2 items-center">
      <select className={cx('px-2', inputClass)} value={s ?? ''} onChange={(e) => onChange(e.target.value, 0)}>
        <option value="">{names.length ? 'pick a sample' : 'no user samples loaded, try samples("local:")'}</option>
        {names.map((name) => (
          <option key={name} value={name} className="bg-background">
            {name}
          </option>
        ))}
      </select>
      {count > 1 && (
        <input
          type="number"
          className={cx('px-2 w-16', inputClass)}
          min={0}
          max={count - 1}
          value={n}
          onChange={(e) => onChange(s, Number(e.target.value))}
        />
      )}
    </div>
  );
}

export function AnnotateTab() {
  const [{ s, n }, setSound] = useState({ s: undefined, n: 0 });
  const url = useMemo(() => (s ? attempt(() => getSampleUrl({ s, n })).value : undefined), [s, n]);
  const sample = useSampleAnnotation(url);

  return (
    <div id="annotate-tab" className="flex flex-col gap-2 p-2 text-foreground text-xs">
      <SamplePicker s={s} n={n} onChange={(s, n) => setSound({ s, n })} />
      {sample.status === 'loading' && <div>loading…</div>}
      {sample.error && <div className="text-red-500">{sample.error}</div>}
      {sample.buffer && sample.meta && (
        <>
          <SampleEditor url={url} buffer={sample.buffer} meta={sample.meta} onChange={sample.setMeta} shortcuts>
            <ActionButton label="save" disabled={!sample.dirty} onClick={sample.save} />
            <ActionButton label="revert" disabled={!sample.dirty} onClick={sample.revert} />
          </SampleEditor>
          <div className="opacity-50">
            double-click adds a marker, drag moves it · space plays · t taps a beat marker while playing · delete
            removes the selected marker
          </div>
        </>
      )}
    </div>
  );
}
