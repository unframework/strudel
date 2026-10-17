var addSynthDef = { |numChannels|
	SynthDef("strudel_grit" ++ numChannels, { |dryBus, effectBus, gate = 1, grit = 0, gritfreq = 440, gritmix = 0.3|
		var dry = In.ar(dryBus, numChannels);
		var drive = grit.lag(0.1).max(0.001);
		var crossover = gritfreq.lag(0.1).clip(20, 20000);
		var sub = (LPF.ar(dry, crossover) * drive).tanh / drive.tanh;
		var body = HPF.ar((dry * drive * 4).tanh, crossover) * gritmix.lag(0.1);
		var sig = Select.ar(grit > 0, [dry, sub + body]);
		var fade = EnvGen.kr(Env.asr, gate, doneAction: 2);

		DirtPause.ar(sig, graceTime: 4);
		ReplaceOut.ar(dryBus, XFade2.ar(dry, sig, fade * 2 - 1));
	}, [\ir, \ir]).add;
};

{ |dirt|
	forkIfNeeded {
		addSynthDef.(dirt.numChannels);
		dirt.server.sync;
		dirt.orbits.do { |orbit|
			if(orbit.globalEffects.any { |effect| effect.name == \strudel_grit }.not) {
				orbit.globalEffects = [GlobalDirtEffect(\strudel_grit, [\grit, \gritfreq, \gritmix])] ++ orbit.globalEffects;
			};
			orbit.set(\gritfreq, 440, \gritmix, 0.3);
			orbit.initNodeTree;
		};
	};
}
