var phasor = { |freq| Phasor.ar(DC.ar(0), freq * SampleDur.ir) }; // audio-rate trig makes rate audio-rate
var stepSize = { |freq| (freq.abs * SampleDur.ir).clip(1e-6, 0.5) };
var blep = { |phase, dt|
	var head = (phase / dt).min(1);
	var tail = ((phase - 1) / dt).max(-1);
	((2 * head) - head.squared - 1) + (tail.squared + (2 * tail) + 1)
};
var sawWave = { |phase, freq| (2 * phase) - 1 - blep.(phase, stepSize.(freq)) };
var pulseWave = { |freq, duty|
	var phase = phasor.(freq);
	var dt = stepSize.(freq);
	((phase < duty) * 2 - 1) + blep.(phase, dt) - blep.((phase + 1 - duty).frac, dt)
};
var saw = { |freq| sawWave.((phasor.(freq) + 0.5).frac, freq) };
var webAudioPeakNormal = 0.847;
var waves = (
	sine: { |freq| SinOsc.ar(freq) },
	sawtooth: { |freq| saw.(freq) * webAudioPeakNormal },
	square: { |freq| pulseWave.(freq, 0.5) * webAudioPeakNormal },
	triangle: { |freq| 1 - (4 * ((phasor.(freq) + 0.25).frac - 0.5).abs) }
);
var fmWaves = [\sine, \triangle, \square, \sawtooth];
var fm = { |freq, index, harmonicity, waveIndex, env = 1|
	var modFreq = freq * harmonicity;
	var modulator = Select.ar(waveIndex, fmWaves.collect { |wave| waves[wave].(modFreq) });
	freq + (modulator * env * index * modFreq)
};

(phasor: phasor, sawWave: sawWave, saw: saw, pulseWave: pulseWave, waves: waves, fmWaves: fmWaves, fm: fm)
