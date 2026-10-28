var osc = (thisProcess.nowExecutingPath.dirname +/+ "oscillators.scd").load;
var pulseWave = osc[\pulseWave], fm = osc[\fm], fmWaves = osc[\fmWaves];

// RMS-matched to a ±1 saw
var waves = (
	dsine: { |freq| SinOsc.ar(freq) * 0.41 },
	dtri: { |freq| osc[\waves][\triangle].(freq) * 0.5 },
	dsaw: { |freq| osc[\saw].(freq) },
	dsquare: { |freq| pulseWave.(freq, 0.5) * 0.58 },
	dpulse: { |freq, pw|
		var width = (1 - pw.clip(-0.98, 0.98)) / 2;
		pulseWave.(freq.max(0), width) * (0.29 / sqrt(width * (1 - width)))
	}
);

var addSynthDef = { |name, wave, numChannels|
	SynthDef("strudel_%".format(name), { |out, freq = 440, detune = 0, pw = 0.5, pan = 0, fmi = 0, fmh = 1, fmWave = 0, level = 1, glide = 1, timeout = 4, attack = 3, release = 6, gate = 1, t_seen = 1|
		var heard = Sweep.kr(t_seen) < timeout;
		var env = EnvGen.kr(Env.asr(attack, 1, release), gate * heard, doneAction: 2);
		var carrier = fm.(VarLag.kr(freq * detune.midiratio, glide), VarLag.kr(fmi, glide), VarLag.kr(fmh, glide), fmWave);
		var sig = wave.(carrier, VarLag.kr(pw, glide)) * VarLag.kr(level, glide);
		Out.ar(out, DirtPan.ar(sig * 0.3 * env, numChannels, VarLag.kr(pan, glide)))
	}).add;
};

var steer = { |name, voices|
	var defName = "strudel_%".format(name).asSymbol;

	{ |event|
		var orbit = event.orbit;
		var key = [orbit.orbitIndex, (~voice ? 0).asInteger];
		var args = [
			freq: ~freq, detune: ~detune ? 0, pw: ~pw ? 0.5, pan: ~pan,
			fmi: ~fmi ? 0, fmh: ~fmh ? 1, fmWave: fmWaves.indexOf(~fmwave ? \sine) ? 0,
			level: ~amp * ((~gain.min(2) + ~overgain) ** 4), // dirt_gate's law, linear after strudel-synths
			glide: ~delta, timeout: ~delta * 4, release: ~release ? 6
		];

		event.bind {
			orbit.globalEffects.do { |x| x.set(currentEnvironment) };
			if(voices[key].notNil) {
				voices[key].set(\t_seen, 1, *args)
			} {
				voices[key] = Synth(defName, args ++ [out: orbit.dryBus, attack: ~attack ? 3], orbit.group)
					.onFree { voices.removeAt(key) };
			};
		};
		true
	}
};

{ |dirt|
	waves.keysValuesDo { |name, wave|
		var voices = Dictionary.new;

		addSynthDef.(name, wave, dirt.numChannels);
		dirt.soundLibrary.synthEvents[name].do { |previous| previous[\voices].do(_.release) };
		dirt.soundLibrary.addSynth(name, (play: steer.(name, voices), voices: voices));
	};
}
