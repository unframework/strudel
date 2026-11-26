export const DEFAULT_VIS_PORT = 57140;
export const DEFAULT_VIS_TARGET = `127.0.0.1:${DEFAULT_VIS_PORT}`;
export const RESEND_SECONDS = 30;

export const visAddress = {
  source: '/vis/src',
  locations: '/vis/locs',
  highlight: '/vis/hl',
  plots: '/vis/plots',
  plot: '/vis/plot',
};

export function parseVisTarget(text) {
  const [host, port = String(DEFAULT_VIS_PORT)] = text.split(':');
  if (!host || !/^\d+$/.test(port)) throw new Error(`[vis] expected host:port, got "${text}"`);
  return { host, port: Number(port) };
}

export function createVisEval(source, miniLocations, plots) {
  const locations = miniLocations.map(([start, end]) => [start, end]);
  return {
    evalId: Math.random().toString(36).slice(2, 10),
    source,
    locations,
    plots,
    indexOf: new Map(locations.map(([start, end], index) => [`${start}:${end}`, index])),
  };
}

export const hapLocationIndices = (visEval, hap) => [
  ...new Set(
    (hap.context.locations ?? [])
      .map(({ start, end }) => visEval.indexOf.get(`${start}:${end}`))
      .filter((index) => index !== undefined),
  ),
];

const SOURCE_CHUNK_CHARS = 1024;
const LOCATIONS_PER_CHUNK = 128;
const PLOTS_PER_CHUNK = 64;

const slices = (items, size) =>
  Array.from({ length: Math.max(1, Math.ceil(items.length / size)) }, (_, i) => items.slice(i * size, (i + 1) * size));

// args: evalId, index, count, ...payload
const chunkMessages = (address, evalId, payloads) =>
  payloads.map((payload, index) => ({ address, args: [evalId, index, payloads.length, ...payload] }));

export const evalMessages = ({ evalId, source, locations, plots }) => [
  ...chunkMessages(
    visAddress.source,
    evalId,
    slices(source, SOURCE_CHUNK_CHARS).map((text) => [text]),
  ),
  ...chunkMessages(
    visAddress.locations,
    evalId,
    slices(locations, LOCATIONS_PER_CHUNK).map((chunk) => chunk.flat()),
  ),
  ...chunkMessages(
    visAddress.plots,
    evalId,
    slices(plots, PLOTS_PER_CHUNK).map((chunk) =>
      chunk.flatMap(({ end, min, max, lookback }) => [end, min ?? NaN, max ?? NaN, lookback]),
    ),
  ),
];

export const highlightMessage = (evalId, durationSeconds, locationIndices) => ({
  address: visAddress.highlight,
  args: [evalId, durationSeconds, ...locationIndices],
});

export const plotSampleMessage = (evalId, plotIndex, cycle, values) => ({
  address: visAddress.plot,
  args: [evalId, plotIndex, cycle, ...values],
});

export class ChunkAssembly {
  #chunks;

  constructor(count) {
    this.#chunks = new Array(count);
  }

  add(index, payload) {
    this.#chunks[index] = payload;
  }

  get isComplete() {
    return !this.#chunks.includes(undefined);
  }

  get payloads() {
    return this.#chunks;
  }
}
