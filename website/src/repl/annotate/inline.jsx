import { logger } from '@strudel/core';
import { remeasureOnResize, replaceWidgetCallArgument, setWidget } from '@strudel/codemirror';
import { formatMarkerTuples, parseMarkerTuples } from '@strudel/sample-meta';
import { getAudioContext, getSampleUrl, loadBuffer, setSampleMeta } from '@strudel/webaudio';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActionButton } from '../components/button/action-button.jsx';
import { SampleEditor, useAsync } from './SampleEditor.jsx';
import { fitSummary } from './timeline.mjs';

const widgets = new Map(); // widget id -> { el, root }

function mountWidget(id) {
  if (!widgets.has(id)) {
    const el = document.createElement('div');
    el.className = 'block';
    widgets.set(id, { el, root: createRoot(el) });
  }
  const widget = widgets.get(id);
  setWidget(id, widget.el);
  return widget;
}

function soundOf(key) {
  const [s, n = '0'] = key.split(':');
  return { s, n: Number(n) };
}

function summary(meta) {
  const fit = fitSummary(meta);
  const tempo = fit.error ? 'no tempo' : `${fit.value.bpm.toFixed(2)} bpm`;
  const cues = meta.markers.filter((m) => m.name).map((m) => m.name);
  return [`${meta.markers.length} markers`, tempo, ...cues].join(' · ');
}

function InlineMarkers({ el, sound, url, meta: evaluated }) {
  const [meta, setMeta] = useState(evaluated);
  const [open, setOpen] = useState(false);
  const buffer = useAsync(open && (() => loadBuffer(url, getAudioContext())), [open, url]);

  useEffect(() => setMeta(evaluated), [evaluated]);
  useEffect(() => remeasureOnResize(el), [el]);

  const edit = (next) => {
    setMeta(next);
    setSampleMeta(url, next);
    try {
      replaceWidgetCallArgument(el, formatMarkerTuples(next));
    } catch (err) {
      logger(`[markers] could not write markers to the code: ${err.message}`, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-2 text-foreground text-xs font-sans">
      <div className="flex gap-2 items-center opacity-70">
        <ActionButton label={open ? '▾' : '▸'} onClick={() => setOpen(!open)} />
        <span>
          {sound} · {summary(meta)}
        </span>
      </div>
      {open && (
        <div className="w-[640px] max-w-full border border-muted p-2">
          {buffer.status === 'loading' && <div>loading…</div>}
          {buffer.error && <div className="text-red-500">{buffer.error}</div>}
          {buffer.value && (
            <SampleEditor url={url} buffer={buffer.value} meta={meta} onChange={edit} shortcuts={false} />
          )}
        </div>
      )}
    </div>
  );
}

export function markersWithID(id, sound, tuples) {
  const url = getSampleUrl(soundOf(sound));
  const meta = parseMarkerTuples(tuples);
  setSampleMeta(url, meta);
  const { el, root } = mountWidget(id);
  root.render(<InlineMarkers el={el} sound={sound} url={url} meta={meta} />);
}
