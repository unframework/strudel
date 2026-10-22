import { beatMarkers, gridTime, sourceGrid, warpedGrid, warpPlan, warpTime } from '@strudel/sample-meta';

const BEATS_PER_BAR = 4;

export function attempt(fn) {
  try {
    return { value: fn() };
  } catch (err) {
    return { error: err.message };
  }
}

export function gridTimes(grid, duration) {
  const first = Math.ceil(-grid.t0 / grid.spb);
  const last = Math.floor((duration - grid.t0) / grid.spb);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => {
    const beat = first + i;
    return { t: gridTime(grid, beat), accent: beat % BEATS_PER_BAR === 0 };
  });
}

// marker and grid positions in the timeline of the buffer being shown
export function viewTimeline(meta, warpBpm) {
  if (warpBpm === undefined) {
    const fit = attempt(() => sourceGrid(meta));
    return {
      markers: meta.markers.map((m) => ({
        marker: m,
        t: m.t,
        residual: fit.value && m.beat !== undefined ? m.t - gridTime(fit.value, m.beat) : undefined,
      })),
      grid: fit.value,
    };
  }
  const plan = warpPlan(meta, warpBpm);
  return {
    markers: meta.markers.map((m) => ({ marker: m, t: warpTime(plan, m.t), residual: undefined })),
    grid: warpedGrid(meta, warpBpm),
  };
}

export function previewBlips({ markers, clicks }) {
  return [
    ...markers.map(({ t, marker }) => ({ t, freq: marker.name ? 2640 : 1760, gain: 0.25 })),
    ...clicks.map(({ t, accent }) => ({ t, freq: accent ? 880 : 440, gain: 0.3 })),
  ];
}

export function nextTapBeat(meta, t, step) {
  const before = beatMarkers(meta).filter((m) => m.t < t);
  return before.length ? before.at(-1).beat + step : 0;
}

export function fitSummary(meta) {
  const fit = attempt(() => sourceGrid(meta));
  if (fit.error) {
    return fit;
  }
  const residuals = beatMarkers(meta).map((m) => Math.abs(m.t - gridTime(fit.value, m.beat)));
  return { value: { bpm: 60 / fit.value.spb, worstMs: Math.max(0, ...residuals) * 1000 } };
}
