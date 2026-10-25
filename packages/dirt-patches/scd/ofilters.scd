var decibelRq = { |q| 10 ** (q.neg / 20) };
var filters = [
	[\olpf, \olpq, decibelRq, { |sig, freq, rq| RLPF.ar(sig, freq, rq) }],
	[\ohpf, \ohpq, decibelRq, { |sig, freq, rq| RHPF.ar(sig, freq, rq) }],
	[\obpf, \obpq, { |q| q.max(0.01).reciprocal }, { |sig, freq, rq| BPF.ar(sig, freq, rq) }]
];

var addSynthDef = { |numChannels, cutoffKey, resonanceKey, toRq, filter|
	SynthDef("strudel_%%".format(cutoffKey, numChannels), { |dryBus, effectBus, gate = 1, delta = 0|
		var cutoff = NamedControl.kr(cutoffKey, 0);
		var resonance = NamedControl.kr(resonanceKey, 1);
		var dry = In.ar(dryBus, numChannels);
		var on = cutoff > 0;
		var settled = on * (Sweep.kr(on) > 0.005);
		var glide = { |value| Lag.kr(VarLag.kr(value, delta * settled), 0.004 * settled) };
		var freq = glide.(Gate.kr(cutoff, on)).clip(20, 20000);
		var rq = glide.(toRq.(resonance));
		var fade = EnvGen.kr(Env.asr, gate, doneAction: 2);
		var sig = LinXFade2.ar(dry, filter.(dry, freq, rq), (Lag.kr(on, 0.004) * fade) * 2 - 1);

		DirtPause.ar(sig, graceTime: 4);
		ReplaceOut.ar(dryBus, sig);
	}, [\ir, \ir]).add;
};

{ |dirt|
	var effectName = { |cutoffKey| "strudel_%".format(cutoffKey).asSymbol };
	var names = filters.collect { |spec| effectName.(spec[0]) };

	forkIfNeeded {
		filters.do { |spec| addSynthDef.(dirt.numChannels, *spec) };
		dirt.server.sync;
		dirt.orbits.do { |orbit|
			var effects = orbit.globalEffects.reject { |effect| names.includes(effect.name) };
			var afterGrit = (effects.detectIndex { |effect| effect.name == \strudel_grit } ? -1) + 1;
			var added = filters.collect { |spec| GlobalDirtEffect(effectName.(spec[0]), [spec[0], spec[1], \delta]) };

			orbit.globalEffects = effects.keep(afterGrit) ++ added ++ effects.drop(afterGrit);
			filters.do { |spec| orbit.set(spec[1], 1) };
			orbit.initNodeTree;
		};
	};
}
