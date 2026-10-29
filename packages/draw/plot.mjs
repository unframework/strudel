/*
plot.mjs - line graph of a pattern's value over time
Copyright (C) 2026 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/draw/plot.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Pattern, Fraction, isPattern, getControlName, noteToMidi } from '@strudel/core';
import { getTheme, getDrawContext } from './draw.mjs';

export function signalSampler(pat, step) {
  const eps = step.div(1000);
  const stepSize = step.valueOf();
  const cache = new Map();
  const valuesAt = (k) => {
    const t = step.mul(k);
    return pat.queryArc(t, t.add(eps)).map((hap) => hap.value);
  };

  return (from, to) => {
    const first = Math.floor(from / stepSize);
    const last = Math.ceil(to / stepSize);
    for (const k of cache.keys()) {
      if (k < first || k > last) {
        cache.delete(k);
      }
    }

    const times = [];
    const series = [];
    for (let k = first; k <= last; k++) {
      if (!cache.has(k)) {
        cache.set(k, valuesAt(k));
      }
      const i = times.push(k * stepSize) - 1;
      cache.get(k).forEach((value, j) => {
        series[j] ??= [];
        series[j][i] = value;
      });
    }
    series.forEach((line) => {
      for (let i = 0; i < times.length; i++) {
        line[i] ??= null;
      }
    });
    return { times, series };
  };
}

function finite(v) {
  if (typeof v === 'boolean') {
    return Number(v);
  }
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function pitch(v) {
  if (typeof v !== 'string') {
    return finite(v);
  }
  try {
    return noteToMidi(v);
  } catch {
    return null;
  }
}

const fieldValue = (name, v) => (name === 'note' || name === 'n' ? pitch(v) : finite(v));

export function plotValue(value, key) {
  if (value === null || typeof value !== 'object') {
    return finite(value);
  }
  if (key !== undefined) {
    const name = getControlName(key);
    return fieldValue(name, value[name]);
  }
  for (const [name, v] of Object.entries(value)) {
    const plotted = fieldValue(name, v);
    if (plotted !== null) {
      return plotted;
    }
  }
  return null;
}

function valueRange(lines, min, max) {
  const values = lines.flat().filter((v) => v !== null);
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return [0, 1];
  }
  if (lo === hi) {
    return [lo - 0.5, hi + 0.5];
  }
  const pad = (hi - lo) * 0.05;
  return [min ?? lo - pad, max ?? hi + pad];
}

export function __plot({
  ctx,
  time,
  sample,
  cycles,
  playhead = 0.5,
  min,
  max,
  key,
  color,
  thickness = 2,
  background = 'transparent',
  playheadColor = getTheme().foreground,
}) {
  const { width: w, height: h } = ctx.canvas;
  const from = time - cycles * playhead;
  const to = time + cycles * (1 - playhead);

  const { times, series } = sample(from, to);
  const lines = series.map((raw) => raw.map((v) => plotValue(v, key)));
  const [lo, hi] = valueRange(lines, min, max);
  const x = (t) => ((t - from) / (to - from)) * w;
  const y = (v) => h - ((v - lo) / (hi - lo)) * h;

  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);

  const pixelRatio = w / (ctx.canvas.clientWidth || w);
  const fontSize = 10 * pixelRatio;
  const cycleWidth = x(1) - x(0);
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = playheadColor;
  ctx.fillStyle = playheadColor;
  ctx.lineWidth = 1;
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = 'top';
  ctx.beginPath();
  if (cycleWidth >= 4 * pixelRatio) {
    for (let cycle = Math.ceil(from); cycle <= to; cycle++) {
      ctx.moveTo(x(cycle), 0);
      ctx.lineTo(x(cycle), h);
      cycleWidth >= 3 * fontSize && ctx.fillText(cycle, x(cycle) + 2 * pixelRatio, 2 * pixelRatio);
    }
  }
  if (lo < 0 && hi > 0) {
    ctx.moveTo(0, y(0));
    ctx.lineTo(w, y(0));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.lineWidth = thickness;
  ctx.lineJoin = 'round';
  lines.forEach((line, k) => {
    ctx.strokeStyle = series[k].find((v) => v?.color)?.color ?? color ?? getTheme().foreground;
    ctx.beginPath();
    let penDown = false;
    line.forEach((v, i) => {
      if (v === null) {
        penDown = false;
        return;
      }
      penDown ? ctx.lineTo(x(times[i]), y(v)) : ctx.moveTo(x(times[i]), y(v));
      penDown = true;
    });
    ctx.stroke();
  });

  ctx.strokeStyle = playheadColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x(time), 0);
  ctx.lineTo(x(time), h);
  ctx.stroke();
}

/**
 * Plots the value of a pattern over time as a scrolling line graph, which is handy for seeing what continuous signals like `sine`, `saw` or `perlin` look like. To have the graph appear below the pattern instead of in the background, prefix with `_`, e.g. `sine._plot()`. Patterns stacked together are drawn as separate lines. For patterns with object values, e.g. `lpf(sine.range(200,2000))`, the first numeric field (or note name, as MIDI number) is plotted unless `key` is given. Booleans are plotted as 1 and 0. Faint vertical lines mark the start of each cycle, labelled with the cycle number.
 *
 * @name plot
 * @tags visualization
 * @param {Object} options Object containing all the optional following parameters as key value pairs:
 * @param {number} cycles number of cycles visible at the same time - defaults to 16
 * @param {number} playhead location of the current time on the time axis - 0 to 1, defaults to 0.5
 * @param {integer} samples number of points sampled across the visible window - defaults to 1024
 * @param {number} min lower bound of the value axis - defaults to the minimum of the visible values
 * @param {number} max upper bound of the value axis - defaults to the maximum of the visible values
 * @param {string} key name of the control to plot when values are objects
 * @param {string} color hexadecimal or CSS color of the line - defaults to the theme foreground
 * @param {number} thickness line thickness in pixels - defaults to 2
 * @param {string} background hexadecimal or CSS color of the background - defaults to transparent
 * @param {string} playheadColor hexadecimal or CSS color of the playhead line - defaults to the theme foreground
 * @example
 * n(sine.range(0,7).segment(16)).scale("C:minor")
 * ._plot()
 * @example
 * note("c2 eb2 g2 bb2").s("sawtooth")
 * .lpf(perlin.slow(2).range(200,2000))
 * ._plot({ cycles: 8, key: 'lpf' })
 */
Pattern.prototype.plot = function (options = {}) {
  const { ctx = getDrawContext(), id = 1, cycles = 16, samples = 1024 } = options;
  const sample = signalSampler(this, Fraction(cycles).div(samples));
  return this.draw((_, time) => __plot({ ...options, ctx, time, cycles, sample }), { id });
};

export function plot(arg) {
  if (isPattern(arg)) {
    return arg.plot();
  }
  return (pat) => pat.plot(arg);
}
