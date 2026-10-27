const FFT_SIZE = 8192;
const FLOOR_DB = -120;
const AUDIBLE_RANGE_DB = 40;
const ENVELOPE_WINDOWS = 12;
const PEAK_COUNT = 8;

export const toDb = (power) => Math.max(FLOOR_DB, 10 * Math.log10(power));

export function readWav(buffer) {
  let format;
  for (let offset = 12; offset < buffer.length; ) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        float: buffer.readUInt16LE(body) === 3,
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bytes: buffer.readUInt16LE(body + 14) / 8,
      };
    }
    if (id === 'data') {
      return decodeFrames(buffer.subarray(body, body + size), format);
    }
    offset = body + size + (size & 1);
  }
  throw new Error('WAV has no data chunk');
}

function decodeFrames(data, { float, channels, sampleRate, bytes }) {
  const read = float ? (at) => data.readFloatLE(at) : (at) => data.readIntLE(at, bytes) / 2 ** (8 * bytes - 1);
  const frames = data.length / bytes / channels;
  const mono = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      mono[frame] += read((frame * channels + channel) * bytes) / channels;
    }
  }
  return { sampleRate, samples: mono };
}

function fftMagnitudes(frame) {
  const n = frame.length;
  const re = Float64Array.from(frame);
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const step = (-2 * Math.PI) / len;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < len / 2; k++) {
        const [a, b] = [start + k, start + k + len / 2];
        const [cos, sin] = [Math.cos(step * k), Math.sin(step * k)];
        const [tr, ti] = [re[b] * cos - im[b] * sin, re[b] * sin + im[b] * cos];
        [re[b], im[b]] = [re[a] - tr, im[a] - ti];
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  return Float64Array.from({ length: n / 2 }, (_, k) => re[k] ** 2 + im[k] ** 2);
}

export function powerSpectrum({ sampleRate, samples }) {
  const window = Float64Array.from({ length: FFT_SIZE }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / FFT_SIZE));
  const windowPower = window.reduce((sum, w) => sum + w * w, 0);
  const power = new Float64Array(FFT_SIZE / 2);
  let frames = 0;
  for (let start = 0; start + FFT_SIZE <= samples.length; start += FFT_SIZE / 2, frames++) {
    const bins = fftMagnitudes(window.map((w, k) => w * samples[start + k]));
    bins.forEach((p, k) => (power[k] += p));
  }
  if (frames === 0) {
    throw new Error(`render shorter than one ${FFT_SIZE}-sample analysis frame`);
  }
  return { binHz: sampleRate / FFT_SIZE, power: power.map((p) => (2 * p) / frames / windowPower / FFT_SIZE) };
}

export function octaveBands({ binHz, power }) {
  const bands = [];
  for (let low = 31.25; low < (power.length * binHz) / 2; low *= 2) {
    let sum = 0;
    for (let k = Math.ceil(low / binHz); k < Math.min(power.length, (2 * low) / binHz); k++) sum += power[k];
    bands.push({ low, high: 2 * low, db: toDb(sum) });
  }
  return bands;
}

export function peaks({ binHz, power }, count) {
  const found = [];
  for (let k = 1; k < power.length - 1; k++) {
    if (power[k] > power[k - 1] && power[k] >= power[k + 1]) {
      const [a, b, c] = [power[k - 1], power[k], power[k + 1]].map(Math.log);
      const offset = (0.5 * (a - c)) / (a - 2 * b + c || 1);
      found.push({ hz: (k + offset) * binHz, db: toDb(power[k]) });
    }
  }
  return found.sort((x, y) => y.db - x.db).slice(0, count);
}

export function rmsEnvelope({ sampleRate, samples }, windowSeconds) {
  const size = Math.round(windowSeconds * sampleRate);
  return Array.from({ length: Math.floor(samples.length / size) }, (_, i) => {
    let sum = 0;
    for (let k = i * size; k < (i + 1) * size; k++) sum += samples[k] ** 2;
    return { seconds: i * windowSeconds, db: toDb(sum / size) };
  });
}

function flooredDiffs(strudelRows, superdirtRows) {
  const floor = Math.max(...[...strudelRows, ...superdirtRows].map((row) => row.db)) - AUDIBLE_RANGE_DB;
  return strudelRows.map(({ db, ...where }, i) => ({
    ...where,
    strudel: db,
    superdirt: superdirtRows[i].db,
    diff: Math.max(superdirtRows[i].db, floor) - Math.max(db, floor),
    audible: Math.max(db, superdirtRows[i].db) > floor,
  }));
}

const largestDiff = (rows) => rows.reduce((worst, row) => (Math.abs(row.diff) > Math.abs(worst.diff) ? row : worst));

export function compareRenders(strudel, superdirt) {
  if (strudel.sampleRate !== superdirt.sampleRate) {
    throw new Error(`sample rates differ: ${strudel.sampleRate} vs ${superdirt.sampleRate}`);
  }
  const seconds = Math.min(strudel.samples.length, superdirt.samples.length) / strudel.sampleRate;
  const [a, b] = [strudel, superdirt].map(({ sampleRate, samples }) => ({
    sampleRate,
    samples: samples.subarray(0, Math.round(seconds * sampleRate)),
  }));
  const [spectrumA, spectrumB] = [a, b].map(powerSpectrum);
  const bands = flooredDiffs(octaveBands(spectrumA), octaveBands(spectrumB));
  const envelope = flooredDiffs(...[a, b].map((render) => rmsEnvelope(render, seconds / ENVELOPE_WINDOWS)));
  const level = (render) => rmsEnvelope(render, seconds)[0].db;
  return {
    level: { strudel: level(a), superdirt: level(b), diff: level(b) - level(a) },
    bands,
    worstBand: largestDiff(bands),
    envelope,
    worstEnvelope: largestDiff(envelope),
    peaks: { strudel: peaks(spectrumA, PEAK_COUNT), superdirt: peaks(spectrumB, PEAK_COUNT) },
  };
}
