import { ChunkAssembly, visAddress } from './vis-protocol.mjs';

const EVAL_ADDRESSES = {
  [visAddress.source]: 'source',
  [visAddress.locations]: 'locations',
  [visAddress.plots]: 'plots',
};

const groups = (flat, size) =>
  Array.from({ length: flat.length / size }, (_, i) => flat.slice(i * size, (i + 1) * size));
const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);

class PendingEval {
  source;
  locations;
  plots;

  add(address, index, count, payload) {
    const key = EVAL_ADDRESSES[address];
    this[key] ??= new ChunkAssembly(count);
    this[key].add(index, payload);
  }

  get isComplete() {
    return Boolean(this.source?.isComplete && this.locations?.isComplete && this.plots?.isComplete);
  }

  build(evalId) {
    return {
      evalId,
      source: this.source.payloads.map(([text]) => text).join(''),
      locations: groups(this.locations.payloads.flat(), 2),
      plots: groups(this.plots.payloads.flat(), 4).map(([end, min, max, lookback]) => ({
        end,
        min: finiteOrNull(min),
        max: finiteOrNull(max),
        lookback,
      })),
    };
  }
}

export class VisScene {
  current = null;
  #pending = new Map();
  #highlights = [];
  #plotSamples = [];

  receive(address, args, timeMs) {
    if (address in EVAL_ADDRESSES) {
      const [evalId, index, count, ...payload] = args;
      this.#receiveChunk(address, evalId, index, count, payload);
    } else if (address === visAddress.highlight) {
      const [evalId, durationSeconds, ...indices] = args;
      if (evalId !== this.current?.evalId) return;
      this.#highlights.push({ begin: timeMs, end: timeMs + durationSeconds * 1000, indices });
    } else if (address === visAddress.plot) {
      const [evalId, plotIndex, cycle, ...values] = args;
      if (evalId !== this.current?.evalId) return;
      this.#plotSamples[plotIndex]?.push({ timeMs, cycle, values: values.map(finiteOrNull) });
    }
  }

  #receiveChunk(address, evalId, index, count, payload) {
    if (evalId === this.current?.evalId) return;
    if (!this.#pending.has(evalId)) this.#pending.set(evalId, new PendingEval());
    const pending = this.#pending.get(evalId);
    pending.add(address, index, count, payload);
    if (!pending.isComplete) return;

    this.current = pending.build(evalId);
    this.#pending.clear();
    this.#highlights = [];
    this.#plotSamples = this.current.plots.map(() => []);
  }

  activeRanges(timeMs) {
    this.#highlights = this.#highlights.filter(({ end }) => end > timeMs);
    const active = new Set(this.#highlights.filter(({ begin }) => begin <= timeMs).flatMap(({ indices }) => indices));
    return [...active].map((index) => this.current.locations[index]).filter(Boolean);
  }

  plotHistory(plotIndex, timeMs) {
    const samples = this.#plotSamples[plotIndex];
    const played = samples.filter((sample) => sample.timeMs <= timeMs);
    if (!played.length) return [];
    const latest = played.at(-1).cycle;
    const oldest = latest - this.current.plots[plotIndex].lookback;
    const isInWindow = ({ cycle }) => cycle >= oldest && cycle <= latest;
    this.#plotSamples[plotIndex] = samples.filter((sample) => sample.timeMs > timeMs || isInWindow(sample));
    return played.filter(isInWindow);
  }
}
