import { getCps } from '@strudel/core';
import { inferBeats } from '@strudel/sample-meta';
import { beatwarpUrl, getAudioContext, loadBuffer } from '@strudel/webaudio';
import cx from '@src/cx.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionButton } from '../components/button/action-button.jsx';
import { Checkbox, inputClass } from '../components/panel/SettingsTab.jsx';
import { startPreview } from './preview.mjs';
import { attempt, fitSummary, gridTimes, previewBlips, viewTimeline } from './timeline.mjs';
import { drawWaveform, MARKER_HIT_PX, timeToX, xToTime } from './waveform.mjs';

const WAVEFORM_HEIGHT = 160;
const MARKER_COLOR = '#f59e0b';
const CUE_COLOR = '#ec4899';

export function useAsync(load, deps) {
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
  const [drag, setDrag] = useState();
  const dpr = window.devicePixelRatio || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = WAVEFORM_HEIGHT * dpr;
    const foreground = getComputedStyle(canvas).color;
    drawWaveform(canvas.getContext('2d'), {
      buffer,
      markers: timeline.markers.map(({ marker, t, residual }) => ({
        t: marker === drag?.marker ? drag.t : t,
        residual: marker === drag?.marker ? undefined : residual,
        cue: !!marker.name,
        selected: marker === selected,
      })),
      gridTimes: clicks,
      playhead,
      colors: { wave: foreground, grid: foreground, playhead: foreground, marker: MARKER_COLOR, cue: CUE_COLOR },
    });
  }, [buffer, timeline, clicks, playhead, selected, drag, cssWidth]);

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
    let dragged = { marker: hit.marker, t: hit.marker.t };
    const move = (e) => {
      dragged = { marker: hit.marker, t: timeAt(e) };
      setDrag(dragged);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(undefined);
      dragged.t !== hit.marker.t && onMove(hit.marker, dragged.t);
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

  return { playing, setPlaying, position, seek };
}

const replBpm = () => getCps() * 240;
const byTime = (markers) => [...markers].sort((a, b) => a.t - b.t);

export function SampleEditor({ url, buffer, meta, onChange }) {
  const [warped, setWarped] = useState(false);
  const [blipsOn, setBlipsOn] = useState(true);
  const [clickOn, setClickOn] = useState(false);
  const [customBpmOn, setCustomBpmOn] = useState(false);
  const [customBpm, setCustomBpm] = useState(120);
  const [picked, setPicked] = useState();
  const [seekCount, setSeekCount] = useState(0);
  const selected = meta.markers.includes(picked) ? picked : undefined;

  const targetBpm = customBpmOn ? customBpm : replBpm();
  const canWarp = !attempt(() => viewTimeline(meta, targetBpm)).error;
  const showWarped = warped && canWarp;
  const warpedBuffer = useWarpedBuffer(url, meta, showWarped ? targetBpm : undefined);
  const viewBuffer = showWarped ? warpedBuffer.value : buffer;

  const timeline = useMemo(
    () => (showWarped ? viewTimeline(meta, targetBpm) : viewTimeline(meta)),
    [meta, showWarped, targetBpm],
  );
  const clicks = useMemo(
    () => (timeline.grid && viewBuffer ? gridTimes(timeline.grid, viewBuffer.duration) : []),
    [timeline, viewBuffer],
  );
  const blips = previewBlips({ markers: blipsOn ? timeline.markers : [], clicks: clickOn ? clicks : [] });
  const preview = usePreview({ buffer: viewBuffer, blips, restartKey: `${blipsOn}${clickOn}${seekCount}` });
  const fit = fitSummary(meta);

  const replaceMarker = (old, next) => {
    onChange({ ...meta, markers: byTime(meta.markers.map((x) => (x === old ? next : x))) });
    setPicked(next);
  };
  const addMarker = (marker) => {
    onChange({ ...meta, markers: byTime([...meta.markers, marker]) });
    setPicked(marker);
  };
  const deleteMarker = (marker) => {
    onChange({ ...meta, markers: meta.markers.filter((x) => x !== marker) });
    setPicked(undefined);
  };

  return (
    <div className="flex flex-col gap-2 text-foreground text-xs">
      <div className="flex gap-4 items-center flex-wrap">
        <ActionButton label={preview.playing ? 'stop' : 'play'} onClick={() => preview.setPlaying(!preview.playing)} />
        <Checkbox label="marker blips" value={blipsOn} onChange={(e) => setBlipsOn(e.target.checked)} />
        <Checkbox label="grid click" value={clickOn} onChange={(e) => setClickOn(e.target.checked)} />
        <Checkbox label="warped" value={showWarped} disabled={!canWarp} onChange={(e) => setWarped(e.target.checked)} />
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

      {viewBuffer && (
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
          onSelect={setPicked}
          onMove={(marker, t) => replaceMarker(marker, { ...marker, t })}
          onAdd={(t) => addMarker({ t })}
        />
      )}

      <div className="flex gap-4 items-center flex-wrap">
        <span>
          {fit.error ?? `fitted ${fit.value.bpm.toFixed(2)} bpm, worst nudge ${fit.value.worstMs.toFixed(1)} ms`}
        </span>
        <ActionButton
          label="auto-number beats"
          disabled={showWarped}
          onClick={() => onChange({ ...meta, markers: inferBeats(meta.markers) })}
        />
      </div>

      {selected && !showWarped && (
        <MarkerFields
          marker={selected}
          onChange={(next) => replaceMarker(selected, next)}
          onDelete={() => deleteMarker(selected)}
        />
      )}
    </div>
  );
}
