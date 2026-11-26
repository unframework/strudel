import { keepRecordedPlots, plotValue } from '@strudel/draw';
import { plotSampleMessage } from './vis-protocol.mjs';

export const SAMPLES_PER_CYCLE = 16;
export const PLOT_TICK_MS = 50;
const PLOT_WIDGET_TYPES = ['_plot', '_plot1'];
const QUERY_WIDTH = 1 / (SAMPLES_PER_CYCLE * 1000);

export function inlinePlots(widgets) {
  const plotWidgets = widgets.filter(({ type }) => PLOT_WIDGET_TYPES.includes(type));
  const recorded = new Map(keepRecordedPlots(plotWidgets.map(({ id }) => id)).map((plot) => [plot.id, plot]));
  return plotWidgets
    .filter(({ id }) => recorded.has(id))
    .map(({ id, to }) => {
      const { pattern, key, min, max, lookback } = recorded.get(id);
      return { end: to, pattern, key, min, max, lookback };
    });
}

const sampleValues = ({ pattern, key }, cycle) =>
  pattern.queryArc(cycle, cycle + QUERY_WIDTH).map((hap) => plotValue(hap.value, key) ?? NaN);

export const plotSampleMessages = ({ evalId, plots }, cycle) =>
  plots.map((plot, index) => plotSampleMessage(evalId, index, cycle, sampleValues(plot, cycle)));

export class PlotClock {
  #scheduler;
  #nextStep = 0;

  constructor(scheduler) {
    this.#scheduler = scheduler;
  }

  dueSamples() {
    const scheduler = this.#scheduler;
    if (!scheduler.started) return [];
    const endStep = Math.ceil(scheduler.lastEnd * SAMPLES_PER_CYCLE);
    if (this.#nextStep > endStep) this.#nextStep = Math.ceil(scheduler.lastBegin * SAMPLES_PER_CYCLE);
    this.#nextStep = Math.max(this.#nextStep, endStep - SAMPLES_PER_CYCLE);

    const due = [];
    for (; this.#nextStep < endStep; this.#nextStep++) {
      const cycle = this.#nextStep / SAMPLES_PER_CYCLE;
      due.push({ cycle, targetTime: scheduler.timeAt(cycle) });
    }
    return due;
  }
}
