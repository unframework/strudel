var resonators = [
	string: (1..8),
	tube: [1, 3, 5, 7, 9, 11, 13, 15],
	beam: [1, 2.756, 5.404, 8.933, 13.345, 18.637, 24.812, 31.870],
	membrane: [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501]
];
var models = resonators[0, 2..];

{ |dirt|
	var numChannels = dirt.numChannels;
	var instrument = { |model|
		var name = if(model.isNumber) { models[model.asInteger] } { model.asSymbol };
		if(models.includes(name).not) { Error("unknown crmodel %".format(model)).throw };
		"corpus_%%".format(name, numChannels).asSymbol
	};

	resonators.pairsDo { |model, ratios|
		SynthDef("corpus_%%".format(model, numChannels), { |out|
			var freq = \freq.ir(220), decay = \decay.ir(1), hit = \hit.ir(0.17);
			var dry = In.ar(out, numChannels);
			var freqs = freq * (ratios ** (1 + \inharm.ir(0)));
			var amps = (ratios ** (\bright.ir(0.5) * 2 - 2)) * (hit * ratios * pi).sin.abs * (freqs < (SampleRate.ir * 0.45));
			var times = decay * (ratios ** \material.ir(0.5).neg);
			var strikeGain = (1000.log / (decay * SampleRate.ir)).sqrt;
			var wet = Limiter.ar(LeakDC.ar(Klank.ar(`[freqs, amps, times], dry * strikeGain * 8)) * \gain.ir(1), 0.25);
			ReplaceOut.ar(out, XFade2.ar(dry, wet, \mix.ir(1).clip(0, 1) * 2 - 1))
		}).add;
	};

	dirt.addModule(\corpus, { |event|
		var decay = (~crdecay ? 1).max(0.01);
		~sustain = ~sustain + decay;
		event.sendSynth(instrument.(~crmodel ? \string), [
			out: ~out, mix: ~cr, freq: ~crfreq ? ~freq, decay: decay,
			material: ~crmaterial ? 0.5, bright: ~crbright ? 0.5, inharm: ~crinharm ? 0, hit: ~crhit ? 0.17, gain: ~crgain ? 1
		])
	}, { ~cr.notNil });
	dirt.orderModules([\envelope, \corpus]);
}
