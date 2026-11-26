import { Cyclist, logger } from '@strudel/core';
import { oscTimestamp, sendOscFrame } from './osc.mjs';
import { inlinePlots, PLOT_TICK_MS, PlotClock, plotSampleMessages } from './vis-plots.mjs';
import {
  createVisEval,
  DEFAULT_VIS_TARGET,
  evalMessages,
  hapLocationIndices,
  highlightMessage,
  parseVisTarget,
  RESEND_SECONDS,
} from './vis-protocol.mjs';

let target = parseVisTarget(DEFAULT_VIS_TARGET); // as seen from the bridge
let isSourceFeedEnabled = false;
let published = null;
let resendTimer;
let plotFeed = null; // { scheduler, clock, timer }

const toTarget = (message) => ({ ...message, ...target });

async function sendPublished() {
  if (!isSourceFeedEnabled || !published) return;
  for (const message of evalMessages(published)) {
    await sendOscFrame(toTarget(message));
  }
}

export function setVisTarget(next) {
  if (next.host === target.host && next.port === target.port) return;
  target = next;
  sendPublished();
}

export function setVisSourceFeed(isEnabled) {
  if (isEnabled === isSourceFeedEnabled) return;
  isSourceFeedEnabled = isEnabled;
  sendPublished();
}

export function publishVisEval(source, miniLocations, widgets, scheduler) {
  published = createVisEval(source, miniLocations, inlinePlots(widgets));
  resendTimer ??= setInterval(sendPublished, RESEND_SECONDS * 1000);
  sendPublished();
  published.plots.length && startPlotFeed(scheduler);
}

function startPlotFeed(scheduler) {
  if (plotFeed?.scheduler === scheduler) return;
  if (!(scheduler instanceof Cyclist)) {
    logger('[vis] plot samples need the default scheduler, turn off sync to send them', 'warning');
    return;
  }
  clearInterval(plotFeed?.timer);
  plotFeed = { scheduler, clock: new PlotClock(scheduler), timer: setInterval(sendPlotSamples, PLOT_TICK_MS) };
}

async function sendPlotSamples() {
  const { scheduler, clock } = plotFeed;
  const due = clock.dueSamples();
  if (!isSourceFeedEnabled || !published.plots.length) return;
  for (const { cycle, targetTime } of due) {
    const timestamp = oscTimestamp(scheduler.getTime(), targetTime);
    for (const message of plotSampleMessages(published, cycle)) {
      await sendOscFrame({ ...toTarget(message), timestamp });
    }
  }
}

export async function visTrigger(hap, currentTime, cps, targetTime) {
  if (!isSourceFeedEnabled || !published) return;
  const indices = hapLocationIndices(published, hap);
  if (!indices.length) return;
  const message = highlightMessage(published.evalId, hap.duration.valueOf() / cps, indices);
  await sendOscFrame({ ...toTarget(message), timestamp: oscTimestamp(currentTime, targetTime) });
}

export const withVisTrigger = (pattern) => pattern.onTrigger(visTrigger, false);
