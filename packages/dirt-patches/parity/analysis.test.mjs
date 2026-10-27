import { describe, expect, it } from 'vitest';
import { compareRenders, octaveBands, peaks, powerSpectrum, readWav } from './analysis.mjs';

const SAMPLE_RATE = 48000;
const render = (signal, seconds = 1) => ({
  sampleRate: SAMPLE_RATE,
  samples: Float32Array.from({ length: seconds * SAMPLE_RATE }, (_, i) => signal(i / SAMPLE_RATE)),
});
const sine = (hz, amplitude = 1) => render((t) => amplitude * Math.sin(2 * Math.PI * hz * t));

function wav16(channels) {
  const frames = channels[0].length;
  const buffer = Buffer.alloc(44 + frames * channels.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels.length, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * channels.length * 2, 28);
  buffer.writeUInt16LE(channels.length * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * channels.length * 2, 40);
  channels.forEach((channel, c) =>
    channel.forEach((value, i) => buffer.writeInt16LE(Math.round(value * 32767), 44 + (i * channels.length + c) * 2)),
  );
  return buffer;
}

describe('readWav', () => {
  it('mixes PCM channels down to mono', () => {
    const { sampleRate, samples } = readWav(
      wav16([
        [0.5, -0.5],
        [0.25, 0.25],
      ]),
    );
    expect(sampleRate).toBe(SAMPLE_RATE);
    expect(Array.from(samples).map((s) => +s.toFixed(3))).toEqual([0.375, -0.125]);
  });
});

describe('spectrum', () => {
  it('locates a sine at its frequency', () => {
    expect(peaks(powerSpectrum(sine(440.5)), 1)[0].hz).toBeCloseTo(440.5, 0);
  });

  it('puts a full-scale sine at -3 dB in its octave band', () => {
    const band = octaveBands(powerSpectrum(sine(1400))).find(({ low, high }) => low <= 1400 && 1400 < high);
    expect(band.db).toBeCloseTo(-3, 0);
  });
});

describe('compareRenders', () => {
  it('reports identical renders as matching', () => {
    const report = compareRenders(sine(220), sine(220));
    expect(report.level.diff).toBe(0);
    expect(report.worstBand.diff).toBe(0);
    expect(report.worstEnvelope.diff).toBe(0);
  });

  it('reports a level offset in every audible band', () => {
    const report = compareRenders(sine(220), sine(220, 0.5));
    expect(report.level.diff).toBeCloseTo(-6, 0);
    expect(report.worstBand.diff).toBeCloseTo(-6, 0);
  });

  it('ignores differences far below the loudest part', () => {
    const quietHum = render((t) => Math.sin(2 * Math.PI * 220 * t) + 1e-3 * Math.sin(2 * Math.PI * 5000 * t));
    expect(Math.abs(compareRenders(sine(220), quietHum).worstBand.diff)).toBeLessThan(0.1);
  });

  it('flags an audible extra partial', () => {
    const buzz = render((t) => Math.sin(2 * Math.PI * 220 * t) + 0.3 * Math.sin(2 * Math.PI * 5000 * t));
    expect(compareRenders(sine(220), buzz).worstBand).toMatchObject({ low: 4000 });
  });
});
