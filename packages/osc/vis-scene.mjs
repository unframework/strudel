import { ChunkAssembly, visAddress } from './vis-protocol.mjs';

const pairs = (flat) => Array.from({ length: flat.length / 2 }, (_, i) => [flat[2 * i], flat[2 * i + 1]]);

class PendingEval {
  source;
  locations;

  add(address, index, count, payload) {
    const key = address === visAddress.source ? 'source' : 'locations';
    this[key] ??= new ChunkAssembly(count);
    this[key].add(index, payload);
  }

  get isComplete() {
    return Boolean(this.source?.isComplete && this.locations?.isComplete);
  }

  build(evalId) {
    return {
      evalId,
      source: this.source.payloads.map(([text]) => text).join(''),
      locations: pairs(this.locations.payloads.flat()),
    };
  }
}

export class VisScene {
  current = null;
  #pending = new Map();
  #highlights = [];

  receive(address, args, timeMs) {
    if (address === visAddress.source || address === visAddress.locations) {
      const [evalId, index, count, ...payload] = args;
      this.#receiveChunk(address, evalId, index, count, payload);
    } else if (address === visAddress.highlight) {
      const [evalId, durationSeconds, ...indices] = args;
      if (evalId !== this.current?.evalId) return;
      this.#highlights.push({ begin: timeMs, end: timeMs + durationSeconds * 1000, indices });
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
  }

  activeRanges(timeMs) {
    this.#highlights = this.#highlights.filter(({ end }) => end > timeMs);
    const active = new Set(this.#highlights.filter(({ begin }) => begin <= timeMs).flatMap(({ indices }) => indices));
    return [...active].map((index) => this.current.locations[index]).filter(Boolean);
  }
}
