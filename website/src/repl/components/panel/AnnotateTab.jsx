import { useStore } from '@nanostores/react';
import { getCps } from '@strudel/core';
import { emptySampleMeta, inferBeats, parseSampleMeta, sidecarPath } from '@strudel/sample-meta';
import { beatwarpUrl, getAudioContext, getSampleUrl, loadBuffer, setSampleMeta, soundMap } from '@strudel/webaudio';
import cx from '@src/cx.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { startPreview } from '../../annotate/preview.mjs';
import { attempt, fitSummary, gridTimes, nextTapBeat, previewBlips, viewTimeline } from '../../annotate/timeline.mjs';
import { drawWaveform, MARKER_HIT_PX, timeToX, xToTime } from '../../annotate/waveform.mjs';
import { ActionButton } from '../button/action-button.jsx';
import { Checkbox, inputClass } from './SettingsTab.jsx';

const WAVEFORM_HEIGHT = 160;
const MARKER_COLOR = '#f59e0b';
const CUE_COLOR = '#ec4899';

function useAsync(load, deps) {
  const [state, setState] = useState({ status: 'idle' });
  useEffect(() => {
    if (!load) {
      setState({ status: 'idle' });
      return;
    }
    let current = true;
    setState({ status: 'loading' });
    (async () => {
      try {
        const value = await load();
        current && setState({ status: 'ready', value });
      } catch (err) {
        current && setState({ status: 'error', error: err.message });
      }
    })();
    return () => {
      current = false;
    };
  }, deps);
  return state;
}

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

function MarkerFields({ marker, onChange, onDelete }) {
  const optional = (value) => (value === '' ? undefined : value);
  return (
    <div className="flex gap-2 items-center text-xs flex-wrap">
      <label>
        t{' '}
        <input
          type="number"
          step={0.001}
          min={0}
          className={cx('px-2 w-24', inputClass)}
          value={marker.t}
          onChange={(e) => onChange({ ...marker, t: Number(e.target.value) })}
        />
      </label>
      <label>
        beat{' '}
        <input
          type="number"
          step={0.5}
          className={cx('px-2 w-20', inputClass)}
          value={marker.beat ?? ''}
          onChange={(e) => onChange({ ...marker, beat: optional(e.target.value) && Number(e.target.value) })}
        />
      </label>
      <label>
        cue{' '}
        <input
          className={cx('px-2 w-28', inputClass)}
          value={marker.name ?? ''}
          placeholder="name"
          onChange={(e) => onChange({ ...marker, name: optional(e.target.value) })}
        />
      </label>
      <ActionButton label="delete" onClick={onDelete} />
    </div>
  );
}

function useCanvasWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return width;
}

function Waveform({ buffer, timeline, clicks, playhead, selected, editable, onSeek, onSelect, onMove, onAdd }) {
  const canvasRef = useRef();
  const cssWidth = useCanvasWidth(canvasRef);
  const dpr = window.devicePixelRatio || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = WAVEFORM_HEIGHT * dpr;
    const foreground = getComputedStyle(canvas).color;
    drawWaveform(canvas.getContext('2d'), {
      buffer,
      markers: timeline.markers.map(({ marker, t, residual }) => ({
        t,
        residual,
        cue: !!marker.name,
        selected: marker === selected,
      })),
      gridTimes: clicks,
      playhead,
      colors: { wave: foreground, grid: foreground, playhead: foreground, marker: MARKER_COLOR, cue: CUE_COLOR },
    });
  }, [buffer, timeline, clicks, playhead, selected, cssWidth]);

  const timeAt = (e) => xToTime(e.clientX - canvasRef.current.getBoundingClientRect().left, buffer.duration, cssWidth);

  const onMouseDown = (e) => {
    const t = timeAt(e);
    const hit = timeline.markers.find(
      ({ t: markerT }) => Math.abs(timeToX(markerT - t, buffer.duration, cssWidth)) <= MARKER_HIT_PX,
    );
    if (!hit) {
      onSelect(undefined);
      onSeek(t);
      return;
    }
    onSelect(hit.marker);
    if (!editable) {
      return;
    }
    let dragged = hit.marker;
    const move = (e) => {
      dragged = onMove(dragged, timeAt(e));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full cursor-crosshair border border-muted"
      style={{ height: WAVEFORM_HEIGHT }}
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => editable && onAdd(timeAt(e))}
    />
  );
}

function useWarpedBuffer(url, meta, bpm) {
  const warpedUrl = url && bpm !== undefined ? beatwarpUrl(url, meta, bpm) : undefined;
  return useAsync(warpedUrl && (() => loadBuffer(warpedUrl, getAudioContext())), [warpedUrl]);
}

function usePreview({ buffer, blips, restartKey }) {
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const positionRef = useRef(0);
  const blipsRef = useRef(blips);
  blipsRef.current = blips;

  const seek = (t) => {
    positionRef.current = t;
    setPosition(t);
  };

  useEffect(() => seek(0), [buffer]);

  useEffect(() => {
    if (!playing || !buffer) {
      return;
    }
    const handle = startPreview({
      buffer,
      from: positionRef.current,
      blips: blipsRef.current,
      onEnded: () => {
        seek(0);
        setPlaying(false);
      },
    });
    let frame;
    const tick = () => {
      positionRef.current = handle.position();
      setPosition(positionRef.current);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      handle.stop();
    };
  }, [playing, buffer, restartKey]);

  return { playing, setPlaying, position, positionRef, seek };
}

const replBpm = () => getCps() * 240;

export function AnnotateTab() {
  const [{ s, n }, setSound] = useState({ s: undefined, n: 0 });
  const url = useMemo(() => (s ? attempt(() => getSampleUrl({ s, n })).value : undefined), [s, n]);
  const sample = useSampleAnnotation(url);
  const { meta, saved, buffer } = sample;

  const [warped, setWarped] = useState(false);
  const [blipsOn, setBlipsOn] = useState(true);
  const [clickOn, setClickOn] = useState(false);
  const [customBpmOn, setCustomBpmOn] = useState(false);
  const [customBpm, setCustomBpm] = useState(120);
  const [offbeats, setOffbeats] = useState(false);
  const [selected, setSelected] = useState();
  const [seekCount, setSeekCount] = useState(0);

  const targetBpm = customBpmOn ? customBpm : replBpm();
  const canWarp = saved && !attempt(() => viewTimeline(saved, targetBpm)).error;
  const showWarped = warped && canWarp;
  const warpedBuffer = useWarpedBuffer(url, saved, showWarped ? targetBpm : undefined);
  const viewBuffer = showWarped ? warpedBuffer.value : buffer;

  const timeline = useMemo(
    () => meta && (showWarped ? viewTimeline(saved, targetBpm) : viewTimeline(meta)),
    [meta, saved, showWarped, targetBpm],
  );
  const clicks = useMemo(
    () => (timeline?.grid && viewBuffer ? gridTimes(timeline.grid, viewBuffer.duration) : []),
    [timeline, viewBuffer],
  );
  const blips = previewBlips({ markers: blipsOn ? (timeline?.markers ?? []) : [], clicks: clickOn ? clicks : [] });
  const preview = usePreview({ buffer: viewBuffer, blips, restartKey: `${blipsOn}${clickOn}${seekCount}` });
  const fit = meta && fitSummary(meta);

  const replaceMarker = (old, next) => {
    sample.setMeta((m) => ({ ...m, markers: m.markers.map((x) => (x === old ? next : x)).sort((a, b) => a.t - b.t) }));
    setSelected(next);
    return next;
  };
  const addMarker = (marker) => {
    sample.setMeta((m) => ({ ...m, markers: [...m.markers, marker].sort((a, b) => a.t - b.t) }));
    setSelected(marker);
  };
  const deleteMarker = (marker) => {
    sample.setMeta((m) => ({ ...m, markers: m.markers.filter((x) => x !== marker) }));
    setSelected(undefined);
  };

  const onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || !meta) {
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      preview.setPlaying(!preview.playing);
    } else if (e.key === 't' && preview.playing && !showWarped) {
      const t = preview.positionRef.current;
      addMarker({ t, beat: nextTapBeat(meta, t, offbeats ? 0.5 : 1) });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !showWarped) {
      deleteMarker(selected);
    }
  };

  return (
    <div
      id="annotate-tab"
      className="flex flex-col gap-2 p-2 text-foreground text-xs outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <SamplePicker s={s} n={n} onChange={(s, n) => setSound({ s, n })} />
      {sample.status === 'loading' && <div>loading…</div>}
      {sample.error && <div className="text-red-500">{sample.error}</div>}
      {buffer && meta && (
        <>
          <div className="flex gap-4 items-center flex-wrap">
            <ActionButton
              label={preview.playing ? 'stop' : 'play'}
              onClick={() => preview.setPlaying(!preview.playing)}
            />
            <Checkbox label="marker blips" value={blipsOn} onChange={(e) => setBlipsOn(e.target.checked)} />
            <Checkbox label="grid click" value={clickOn} onChange={(e) => setClickOn(e.target.checked)} />
            <Checkbox
              label="warped"
              value={showWarped}
              disabled={!canWarp}
              onChange={(e) => setWarped(e.target.checked)}
            />
            <Checkbox label="custom bpm" value={customBpmOn} onChange={(e) => setCustomBpmOn(e.target.checked)} />
            <input
              type="number"
              min={20}
              max={400}
              step={0.01}
              className={cx('px-2 w-20', inputClass)}
              disabled={!customBpmOn}
              value={customBpmOn ? customBpm : Math.round(targetBpm * 100) / 100}
              onChange={(e) => Number(e.target.value) > 0 && setCustomBpm(Number(e.target.value))}
            />
            {showWarped && warpedBuffer.status === 'loading' && <span>rendering…</span>}
            {showWarped && warpedBuffer.error && <span className="text-red-500">{warpedBuffer.error}</span>}
          </div>

          {viewBuffer && timeline && (
            <Waveform
              buffer={viewBuffer}
              timeline={timeline}
              clicks={clicks}
              playhead={preview.position}
              selected={selected}
              editable={!showWarped}
              onSeek={(t) => {
                preview.seek(t);
                setSeekCount((c) => c + 1);
              }}
              onSelect={setSelected}
              onMove={(marker, t) => replaceMarker(marker, { ...marker, t })}
              onAdd={(t) => addMarker({ t })}
            />
          )}

          <div className="flex gap-4 items-center flex-wrap">
            <span>
              {fit.error ?? `fitted ${fit.value.bpm.toFixed(2)} bpm, worst nudge ${fit.value.worstMs.toFixed(1)} ms`}
            </span>
            <Checkbox label="tap offbeats" value={offbeats} onChange={(e) => setOffbeats(e.target.checked)} />
            <ActionButton
              label="auto-number beats"
              disabled={showWarped}
              onClick={() => sample.setMeta((m) => ({ ...m, markers: inferBeats(m.markers) }))}
            />
            <ActionButton label="save" disabled={!sample.dirty} onClick={sample.save} />
            <ActionButton label="revert" disabled={!sample.dirty} onClick={sample.revert} />
            {sample.dirty && showWarped && <span>warped view shows saved markers</span>}
          </div>

          {selected && !showWarped && (
            <MarkerFields
              marker={selected}
              onChange={(next) => replaceMarker(selected, next)}
              onDelete={() => deleteMarker(selected)}
            />
          )}

          <div className="opacity-50">
            double-click adds a marker, drag moves it · space plays · t taps a beat marker while playing · delete
            removes the selected marker
          </div>
        </>
      )}
    </div>
  );
}
