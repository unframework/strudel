var daVerb = \DaVerb.asClass;
var params = [\daverb, \dvdecay, \dvdamp, \dvlp, \dvp, \dvxr, \dvxd];
var defaults = [0, 0.5, 0.005, 0.9999, 0, 0.5, 0.7];

var addSynthDef = { |numChannels|
	SynthDef("strudel_daverb" ++ numChannels, { |dryBus, effectBus, gate = 1, daverb = 0, dvdecay = 0.5, dvdamp = 0.005, dvlp = 0.9999, dvp = 0, dvxr = 0.5, dvxd = 0.7|
		var in = In.ar(dryBus, numChannels).sum * 0.5 * daverb.lag(0.1);
		var wet = daVerb.ar(in, dvdecay, dvdamp, dvlp, dvp, dvxr, dvxd);
		var fade = EnvGen.kr(Env.asr, gate, doneAction: 2);

		DirtPause.ar(wet, graceTime: 8);
		Out.ar(effectBus, (wet * fade).wrapExtend(numChannels));
	}, [\ir, \ir]).add;
};

{ |dirt|
	if(daVerb.isNil) {
		Error("daverb: DaVerb UGen not installed, see dirt-patches README \"Building the DaVerb UGen\"").throw;
	};

	forkIfNeeded {
		addSynthDef.(dirt.numChannels);
		dirt.server.sync;
		dirt.orbits.do { |orbit|
			var isDaverb = { |effect| effect.name == \strudel_daverb };
			var effects = orbit.globalEffects.reject(isDaverb);
			var afterReverb = (effects.detectIndex { |effect| effect.name == \dirt_reverb } ? -1) + 1;

			orbit.globalEffects.select(isDaverb).do(_.release);
			orbit.globalEffects = effects.insert(afterReverb, GlobalDirtEffect(\strudel_daverb, params));
			orbit.set(*[params, defaults].flop.flat);
			orbit.initNodeTree;
		};
	};
}
