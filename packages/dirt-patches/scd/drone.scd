// RMS-matched to Saw
var waves = (
	dsine: { |freq| SinOsc.ar(freq) * 0.41 },
	dtri: { |freq| LFTri.ar(freq) * 0.5 },
	dsaw: { |freq| Saw.ar(freq) },
	dsquare: { |freq| Pulse.ar(freq) * 0.58 }
);

var addSynthDef = { |name, wave, numChannels|
	SynthDef("strudel_%".format(name), { |out, freq = 440, detune = 0, pan = 0, level = 1, glide = 1, timeout = 4, attack = 3, release = 6, gate = 1, t_seen = 1|
		var heard = Sweep.kr(t_seen) < timeout;
		var env = EnvGen.kr(Env.asr(attack, 1, release), gate * heard, doneAction: 2);
		var sig = wave.(VarLag.kr(freq * detune.midiratio, glide)) * VarLag.kr(level, glide);
		Out.ar(out, DirtPan.ar(sig * 0.3 * env, numChannels, VarLag.kr(pan, glide)))
	}).add;
};

var steer = { |name, voices|
	var defName = "strudel_%".format(name).asSymbol;

	{ |event|
		var orbit = event.orbit;
		var key = [orbit.orbitIndex, (~voice ? 0).asInteger];
		var args = [
			freq: ~freq, detune: ~detune ? 0, pan: ~pan,
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
