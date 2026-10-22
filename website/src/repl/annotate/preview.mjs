import { connectToDestination, getAudioContext } from '@strudel/webaudio';

const BLIP_SECONDS = 0.02;
const START_DELAY = 0.05;

function scheduleBlip(ac, output, when, { freq, gain }) {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.frequency.value = freq;
  env.gain.setValueAtTime(gain, when);
  env.gain.exponentialRampToValueAtTime(0.001, when + BLIP_SECONDS);
  osc.connect(env).connect(output);
  osc.start(when);
  osc.stop(when + BLIP_SECONDS);
  return osc;
}

// blips: [{ t, freq, gain }] in buffer time
export function startPreview({ buffer, from, blips, onEnded }) {
  const ac = getAudioContext();
  const output = ac.createGain();
  connectToDestination(output);

  const startAt = ac.currentTime + START_DELAY;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.connect(output);
  source.start(startAt, from);

  const oscillators = blips
    .filter(({ t }) => t >= from && t <= buffer.duration)
    .map((blip) => scheduleBlip(ac, output, startAt + blip.t - from, blip));

  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    source.onended = null;
    source.stop();
    oscillators.forEach((osc) => osc.stop());
    output.disconnect();
  };
  source.onended = () => {
    stop();
    onEnded();
  };

  return {
    stop,
    position: () => Math.min(buffer.duration, from + Math.max(0, ac.currentTime - startAt)),
  };
}
