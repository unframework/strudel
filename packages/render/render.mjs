import {
  initStrudel,
  evaluate,
  renderPatternAudio,
  Pattern,
  samples,
  registerZZFXSounds,
  aliasBank,
} from '@strudel/web';
import { registerSoundfonts } from '@strudel/soundfonts';

// Register no-op stubs for UI-only methods that may appear in pattern code
Pattern.prototype._scope =
  Pattern.prototype._scope ||
  function () {
    return this;
  };

async function prebake() {
  const ds = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';
  const tc = 'https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main';
  const ts = 'https://raw.githubusercontent.com/todepond/samples/main';
  await Promise.all([
    registerZZFXSounds(),
    registerSoundfonts(),
    samples(`${ds}/tidal-drum-machines.json`),
    samples(`${ds}/piano.json`),
    samples(`${ds}/Dirt-Samples.json`),
    samples(`${ds}/vcsl.json`),
    samples(`${ds}/mridangam.json`),
    samples(`${tc}/strudel.json`),
  ]);
  aliasBank(`${ts}/tidal-drum-machines-alias.json`);
}

let initPromise;

async function init() {
  if (!initPromise) {
    initPromise = initStrudel({ prebake });
  }
  return initPromise;
}

window.renderOffline = async function (code, begin = 0, end = 4, sampleRate = 44100) {
  const repl = await init();

  // Evaluate the code to get the pattern (autoplay=false)
  const pattern = await evaluate(code, false);

  // Use CPS from scheduler (set by setcpm/setcps in the code, or default)
  const cps = repl.scheduler.cps;

  // Collect hap timeline
  const haps = pattern
    .queryArc(begin, end, { _cps: cps })
    .filter((hap) => hap.hasOnset())
    .sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());

  const timeline = [
    { _meta: true, _cps: cps, _begin: begin, _end: end },
    ...haps.map((hap) => ({
      begin: hap.whole.begin.valueOf(),
      end: hap.whole.end.valueOf(),
      duration: hap.duration.valueOf(),
      value: hap.value,
      locations: hap.context.locations || [],
    })),
  ];

  // Render audio — this triggers a download via the existing renderPatternAudio
  await renderPatternAudio(pattern, cps, begin, end, sampleRate);

  return timeline;
};

// Signal that the module is loaded
window.__strudelRenderReady = true;
