import { initStrudel, evaluate, renderPatternAudio } from '@strudel/web';

let initPromise;

async function init() {
  if (!initPromise) {
    initPromise = initStrudel();
  }
  return initPromise;
}

window.renderOffline = async function (code, cycles, cps = 0.5, sampleRate = 44100) {
  await init();

  // Evaluate the code to get the pattern (autoplay=false)
  const pattern = await evaluate(code, false);

  // Collect hap timeline
  const haps = pattern
    .queryArc(0, cycles, { _cps: cps })
    .filter((hap) => hap.hasOnset())
    .sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());

  const timeline = haps.map((hap) => ({
    begin: hap.whole.begin.valueOf(),
    end: hap.whole.end.valueOf(),
    duration: hap.duration.valueOf(),
    value: hap.value,
    locations: hap.context.locations || [],
  }));

  // Render audio — this triggers a download via the existing renderPatternAudio
  await renderPatternAudio(pattern, cps, 0, cycles, sampleRate);

  return timeline;
};

// Signal that the module is loaded
window.__strudelRenderReady = true;
