import { logger } from '@strudel/core';
import { oscTimestamp, sendOscFrame } from './osc.mjs';
import { DEFAULT_VIS_PORT, evalMessages, highlightMessage } from './vis-protocol.mjs';

const RESEND_SECONDS = 30;

export const DEFAULT_VIS_TARGET = `127.0.0.1:${DEFAULT_VIS_PORT}`;

let target = null; // { host, port } of the visualizer, as seen from the bridge
let published = null;
let resendTimer;

export function parseVisTarget(text) {
  const [host, port = String(DEFAULT_VIS_PORT)] = text.split(':');
  if (!host || !/^\d+$/.test(port)) throw new Error(`[vis] expected host:port, got "${text}"`);
  return { host, port: Number(port) };
}

export function createVisEval(source, miniLocations) {
  const locations = miniLocations.map(([start, end]) => [start, end]);
  return {
    evalId: Math.random().toString(36).slice(2, 10),
    source,
    locations,
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

const toTarget = (message) => ({ ...message, ...target });

async function sendPublished() {
  if (!target || !published) return;
  try {
    for (const message of evalMessages(published)) {
      await sendOscFrame(toTarget(message));
    }
  } catch (err) {
    logger(`[vis] could not send source: ${err.message}`, 'warning');
  }
}

export function setVisTarget(next) {
  if (next?.host === target?.host && next?.port === target?.port) return;
  target = next;
  sendPublished();
}

export function publishVisEval(source, miniLocations) {
  published = createVisEval(source, miniLocations);
  resendTimer ??= setInterval(sendPublished, RESEND_SECONDS * 1000);
  sendPublished();
}

export async function visTrigger(hap, currentTime, cps, targetTime) {
  if (!target || !published) return;
  const indices = hapLocationIndices(published, hap);
  if (!indices.length) return;
  const message = highlightMessage(published.evalId, hap.duration.valueOf() / cps, indices);
  await sendOscFrame({ ...toTarget(message), timestamp: oscTimestamp(currentTime, targetTime) });
}

export const withVisTrigger = (pattern) => pattern.onTrigger(visTrigger, false);
