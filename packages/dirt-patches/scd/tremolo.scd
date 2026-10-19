var shapes = (tri: 0, triangle: 0, sine: 1, ramp: 2, saw: 3, square: 4);

var shapeIndex = { |shape|
	if(shape.isNumber) { shape.floor.asInteger % 5 } {
		shapes[shape.asSymbol] ?? { Error("unknown tremoloshape %".format(shape)).throw }
	}
};

{ |dirt|
	var numChannels = dirt.numChannels;

	SynthDef("strudel_tremolo" ++ numChannels, { |out, freq = 1, depth = 1, skew = 1, shape = 0, phase = 0|
		var p = (Sweep.ar(0, freq) + phase).frac;
		var tri = Select.ar(p < skew, [(1 - p) / (1 - skew).max(1e-9), p / skew.max(1e-9)]);
		var wave = Select.ar(shape, [tri, (2pi * p).sin * 0.5 + 0.5, p, 1 - p, p < skew]);
		var gain = (1 - depth).max(0) + ((wave * depth).max(0) ** 1.5).min(1);
		ReplaceOut.ar(out, In.ar(out, numChannels) * gain)
	}, [\ir, \ir, \ir, \ir, \ir, \ir]).add;

	dirt.addModule(\tremolo, { |event|
		var freq = ~tremolosync !? { |cycles| ~cps * cycles } ?? { ~tremolo };
		event.sendSynth("strudel_tremolo" ++ numChannels, [
			out: ~out, freq: freq, depth: ~tremolodepth ? 1,
			skew: ~tremoloskew ?? { if(~tremoloshape.isNil) { 1 } { 0.5 } },
			shape: shapeIndex.(~tremoloshape ? 0),
			phase: ((~cycle / ~cps * freq) + (~tremolophase ? 0)).frac
		])
	}, { ~tremolo.notNil or: { ~tremolosync.notNil } });
}
