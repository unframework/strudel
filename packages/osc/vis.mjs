import { oscTimestamp, sendOscFrame } from './osc.mjs';
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

export function publishVisEval(source, miniLocations) {
  published = createVisEval(source, miniLocations);
  resendTimer ??= setInterval(sendPublished, RESEND_SECONDS * 1000);
  sendPublished();
}

export async function visTrigger(hap, currentTime, cps, targetTime) {
  if (!isSourceFeedEnabled || !published) return;
  const indices = hapLocationIndices(published, hap);
  if (!indices.length) return;
  const message = highlightMessage(published.evalId, hap.duration.valueOf() / cps, indices);
  await sendOscFrame({ ...toTarget(message), timestamp: oscTimestamp(currentTime, targetTime) });
}

export const withVisTrigger = (pattern) => pattern.onTrigger(visTrigger, false);
