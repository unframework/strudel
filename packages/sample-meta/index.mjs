import { z } from 'zod';

export const SIDECAR_SUFFIX = '.json';

const markerSchema = z.object({
  t: z.number().nonnegative(),
  beat: z.number().optional(),
  name: z.string().min(1).optional(),
});

const sampleMetaSchema = z.object({
  version: z.literal(1),
  markers: z.array(markerSchema),
  bpm: z.number().positive().optional(),
});

export const emptySampleMeta = () => ({ version: 1, markers: [] });

export function parseSampleMeta(json) {
  const meta = sampleMetaSchema.parse(json);
  return { ...meta, markers: [...meta.markers].sort((a, b) => a.t - b.t) };
}

export const sidecarPath = (audioPath) => audioPath + SIDECAR_SUFFIX;

export const beatMarkers = (meta) => meta.markers.filter((m) => m.beat !== undefined);

export function cueTime(meta, name) {
  const cue = meta.markers.find((m) => m.name === name);
  if (!cue) {
    throw new Error(`no cue "${name}" in sample markers`);
  }
  return cue.t;
}

export const gridTime = (grid, beat) => grid.t0 + beat * grid.spb;
export const gridBpm = (grid) => 60 / grid.spb;

// least squares fit of t = t0 + beat * spb
function fitGrid(markers) {
  const n = markers.length;
  const meanBeat = markers.reduce((sum, m) => sum + m.beat, 0) / n;
  const meanT = markers.reduce((sum, m) => sum + m.t, 0) / n;
  let cov = 0;
  let variance = 0;
  for (const m of markers) {
    cov += (m.beat - meanBeat) * (m.t - meanT);
    variance += (m.beat - meanBeat) ** 2;
  }
  const spb = cov / variance;
  if (!(spb > 0)) {
    throw new Error('beat markers must advance in time');
  }
  return { t0: meanT - meanBeat * spb, spb };
}

const hasBeatSpan = (markers) => new Set(markers.map((m) => m.beat)).size >= 2;

export function sourceGrid(meta) {
  const beats = beatMarkers(meta);
  if (hasBeatSpan(beats)) {
    return fitGrid(beats);
  }
  if (meta.bpm) {
    return { t0: 0, spb: 60 / meta.bpm };
  }
  throw new Error('sample needs two beat markers or a bpm');
}

export function inferBeats(markers) {
  if (markers.length < 2) {
    return markers.map((m) => ({ ...m, beat: 0 }));
  }
  const gaps = markers
    .slice(1)
    .map((m, i) => m.t - markers[i].t)
    .sort((a, b) => a - b);
  const spacing = gaps[Math.floor(gaps.length / 2)];
  return markers.map((m) => ({ ...m, beat: Math.round((m.t - markers[0].t) / spacing) }));
}

// segment ratio is output duration / input duration; last segment runs to the end of the file
export function warpPlan(meta, bpm) {
  const spb = 60 / bpm;
  const beats = beatMarkers(meta);
  if (!hasBeatSpan(beats)) {
    return [{ from: 0, to: Infinity, ratio: gridBpm(sourceGrid(meta)) / bpm }];
  }

  const inner = beats.slice(1).map((m, i) => {
    const prev = beats[i];
    if (!(m.beat > prev.beat && m.t > prev.t)) {
      throw new Error(`beat markers out of order at ${m.t}s`);
    }
    return { from: prev.t, to: m.t, ratio: ((m.beat - prev.beat) * spb) / (m.t - prev.t) };
  });
  const head = { from: 0, to: beats[0].t, ratio: inner[0].ratio };
  const tail = { from: beats.at(-1).t, to: Infinity, ratio: inner.at(-1).ratio };
  return [head, ...inner, tail].filter((s) => s.to > s.from);
}

export function warpTime(plan, t) {
  let out = 0;
  for (const s of plan) {
    if (t <= s.to) {
      return out + (t - s.from) * s.ratio;
    }
    out += (s.to - s.from) * s.ratio;
  }
  throw new Error(`time ${t}s outside warp plan`);
}

export function warpedGrid(meta, bpm) {
  const spb = 60 / bpm;
  const plan = warpPlan(meta, bpm);
  const beats = beatMarkers(meta);
  if (!hasBeatSpan(beats)) {
    const source = sourceGrid(meta);
    return { t0: warpTime(plan, source.t0), spb };
  }
  return { t0: warpTime(plan, beats[0].t) - beats[0].beat * spb, spb };
}

// FNV-1a, distinguishes marker edits in cache keys
export function metaRevision(meta) {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(meta)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
