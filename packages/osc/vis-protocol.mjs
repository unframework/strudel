export const DEFAULT_VIS_PORT = 57140;

export const visAddress = {
  source: '/vis/src',
  locations: '/vis/locs',
  highlight: '/vis/hl',
};

const SOURCE_CHUNK_CHARS = 1024;
const LOCATIONS_PER_CHUNK = 128;

const slices = (items, size) =>
  Array.from({ length: Math.max(1, Math.ceil(items.length / size)) }, (_, i) => items.slice(i * size, (i + 1) * size));

// args: evalId, index, count, ...payload
const chunkMessages = (address, evalId, payloads) =>
  payloads.map((payload, index) => ({ address, args: [evalId, index, payloads.length, ...payload] }));

export const evalMessages = ({ evalId, source, locations }) => [
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
];

export const highlightMessage = (evalId, durationSeconds, locationIndices) => ({
  address: visAddress.highlight,
  args: [evalId, durationSeconds, ...locationIndices],
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
