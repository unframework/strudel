const peakCache = new WeakMap(); // AudioBuffer -> Map<columns, peaks>

export function computePeaks(buffer, columns) {
  const byColumns = peakCache.get(buffer) ?? new Map();
  peakCache.set(buffer, byColumns);
  if (byColumns.has(columns)) {
    return byColumns.get(columns);
  }

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const perColumn = buffer.length / columns;
  for (let col = 0; col < columns; col++) {
    const from = Math.floor(col * perColumn);
    const to = Math.max(from + 1, Math.floor((col + 1) * perColumn));
    let lo = 0;
    let hi = 0;
    for (const data of channels) {
      for (let i = from; i < to; i++) {
        lo = Math.min(lo, data[i]);
        hi = Math.max(hi, data[i]);
      }
    }
    min[col] = lo;
    max[col] = hi;
  }
  const peaks = { min, max };
  byColumns.set(columns, peaks);
  return peaks;
}

export const MARKER_HIT_PX = 6;

export const timeToX = (t, duration, width) => (t / duration) * width;
const TIME_RESOLUTION = 10000;

export const xToTime = (x, duration, width) =>
  Math.round(Math.min(duration, Math.max(0, (x / width) * duration)) * TIME_RESOLUTION) / TIME_RESOLUTION;

// markers: [{ t, cue, selected, residual }], gridTimes: [{ t, accent }]
export function drawWaveform(ctx, { buffer, markers, gridTimes, playhead, colors }) {
  const { width, height } = ctx.canvas;
  const { duration } = buffer;
  const dpr = window.devicePixelRatio || 1;
  const mid = height / 2;
  ctx.clearRect(0, 0, width, height);

  for (const { t, accent } of gridTimes) {
    ctx.fillStyle = colors.grid;
    ctx.globalAlpha = accent ? 0.5 : 0.2;
    ctx.fillRect(Math.round(timeToX(t, duration, width)), 0, dpr, height);
  }
  ctx.globalAlpha = 1;

  const { min, max } = computePeaks(buffer, width);
  ctx.fillStyle = colors.wave;
  for (let x = 0; x < width; x++) {
    const top = mid - max[x] * mid;
    ctx.fillRect(x, top, 1, Math.max(1, (max[x] - min[x]) * mid));
  }

  for (const { t, cue, selected, residual } of markers) {
    const x = Math.round(timeToX(t, duration, width));
    const flag = (selected ? 8 : 6) * dpr;
    ctx.fillStyle = cue ? colors.cue : colors.marker;
    ctx.fillRect(x - (selected ? dpr : 0), 0, selected ? 3 * dpr : dpr, height);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + flag, 0);
    ctx.lineTo(x, flag);
    ctx.fill();
    if (residual !== undefined) {
      const gridX = timeToX(t - residual, duration, width);
      ctx.fillRect(Math.min(x, gridX), height - 4 * dpr, Math.max(dpr, Math.abs(x - gridX)), 4 * dpr);
    }
  }

  if (playhead !== undefined) {
    ctx.fillStyle = colors.playhead;
    ctx.fillRect(Math.round(timeToX(playhead, duration, width)), 0, dpr, height);
  }
}
