var isDuck = { |effect| effect.name == \strudel_duck };
var splitList = { |value| value.asString.split($:).collect(_.asFloat) };

var addSynthDef = { |numChannels|
	SynthDef("strudel_duck" ++ numChannels, { |dryBus, effectBus, gate = 1, t_duck = 0, onset = 0, attack = 0.1, depth = 1|
		var held = LocalIn.ar(1, 1);
		var floor = (1 - depth.clip(0, 1).sqrt).clip(0.01, held);
		var duck = EnvGen.ar(Env([1, floor, 1], [onset, attack.max(0.002)], \exp), t_duck);
		var fade = EnvGen.kr(Env.asr, gate, doneAction: 2);
		var gain = 1 - ((1 - duck) * fade);

		LocalOut.ar(duck);
		DirtPause.ar(1 - duck, graceTime: 1);
		[dryBus, effectBus].do { |bus| ReplaceOut.ar(bus, In.ar(bus, numChannels) * gain) };
	}, [\ir, \ir]).add;
};

{ |dirt|
	forkIfNeeded {
		addSynthDef.(dirt.numChannels);
		dirt.server.sync;
		dirt.orbits.do { |orbit|
			var effects = orbit.globalEffects.reject(isDuck);
			var beforeMeters = effects.detectIndex { |effect| effect.name == \dirt_rms } ? effects.size;

			orbit.globalEffects.select(isDuck).do(_.release);
			orbit.globalEffects = effects.insert(beforeMeters, GlobalDirtEffect(\strudel_duck, []));
			orbit.initNodeTree;
		};
	};

	dirt.addModule(\duck, { |event|
		var lists = [~duckorbit, ~duckonset ? 0, ~duckattack ? 0.1, ~duckdepth ? 1].collect(splitList);

		lists[0].do { |target, i|
			var onset, attack, depth, effect;
			#onset, attack, depth = lists.drop(1).collect { |list| list[i] ? list[0] };
			effect = (dirt.orbits @@ target.asInteger).globalEffects.detect(isDuck);
			effect.resume;
			effect.synth.set(\t_duck, 1, \onset, onset, \attack, attack, \depth, depth);
		};
	}, { ~duckorbit.notNil });
}
