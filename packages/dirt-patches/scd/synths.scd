var osc = (thisProcess.nowExecutingPath.dirname +/+ "oscillators.scd").load;
var phasor = osc[\phasor], sawWave = osc[\sawWave], pulseWave = osc[\pulseWave], fm = osc[\fm];
var oscillators = osc[\waves], fmWaves = osc[\fmWaves];
var aliases = (sin: \sine, saw: \sawtooth, sqr: \square, tri: \triangle);
var noises = (
	white: { WhiteNoise.ar },
	pink: { PinkNoise.ar },
	brown: { OnePole.ar(WhiteNoise.ar, 1 / 1.02) },
	crackle: { Dust2.ar(\density.kr(0.03) * 0.01 * SampleRate.ir) }
);
var synthNames = (oscillators.keys.asArray ++ aliases.keys.asArray ++ noises.keys.asArray ++ [\pulse, \supersaw]).asSet;
var filterModels = ['12db', 'ladder', '24db'];
var maxVoices = 16;

var adsr = { |attack, decay, sustain, release, defaults|
	if([attack, decay, sustain, release].every(_.isNil)) {
		defaults
	} {
		[
			(attack ? 0).max(0.001),
			(decay ? 0).max(0.001),
			(sustain ?? { if(decay.isNil) { 1 } { 0.001 } }).min(1),
			(release ? 0).max(0.01)
		]
	}
};

var gate = { |holdTime| EnvGen.kr(Env([1, 1, 0], [holdTime, 0])) };
var envelope = { |start, peak, sustain, times, curve| Env([start, peak, sustain, start], times, curve, 2) };

var pitched = { |freq|
	var held = gate.(\holdTime.kr(1));
	var pitchEnv = EnvGen.kr(envelope.(\pitchStart.kr(0), \pitchPeak.kr(0), \pitchSustain.kr(0),
		[\pitchAttack.kr(0.2), \pitchDecay.kr(0.001), \pitchRelease.kr(0.001)], \lin), held);
	var vibrato = SinOsc.kr(\vib.kr(0)) * \vibmod.kr(0.5);
	var fmTimes = [\fmAttack.kr(0.001), \fmDecay.kr(0.001), \fmRelease.kr(0.01)];
	var fmSustain = \fmSustain.kr(1);
	var fmLin = EnvGen.kr(envelope.(0, 1, fmSustain, fmTimes, \lin), held);
	var fmExp = EnvGen.kr(envelope.(0.001, 1, fmSustain.max(0.001), fmTimes, \exp), held);
	var fmEnv = 1 + ((fmLin + ((fmExp - fmLin) * \fmExp.kr(1)) - 1) * \fmEnvOn.kr(0));
	fm.(freq, \fmi.kr(0), \fmh.kr(1), \fmWave.kr(0), fmEnv) * (pitchEnv + vibrato).midiratio
};

var cutoff = {
	var freq = EnvGen.kr(envelope.(\fStart.kr(440), \fPeak.kr(440), \fSustain.kr(440),
		[\fAttack.kr(0.005), \fDecay.kr(0.14), \fRelease.kr(0.1)], \exp), gate.(\holdTime.kr(1)));
	freq.clip(10, SampleRate.ir * 0.45)
};

var addSynthDefs = { |numChannels|
	oscillators.keysValuesDo { |name, oscillator|
		var def = { |out, freq = 440, pan = 0, noise = 0|
			var sig = oscillator.(pitched.(freq));
			sig = (sig * (2 - (2 * noise)).min(1)) + (PinkNoise.ar * (2 * noise).min(1));
			Out.ar(out, DirtPan.ar(sig * 0.3, numChannels, pan))
		};
		SynthDef(name, def).add;
		aliases.keysValuesDo { |alias, target| if(target == name) { SynthDef(alias, def).add } };
	};

	noises.keysValuesDo { |name, noise|
		SynthDef(name, { |out, pan = 0|
			Out.ar(out, DirtPan.ar(noise.() * 0.3, numChannels, pan))
		}).add;
	};

	SynthDef(\pulse, { |out, freq = 440, pan = 0, pw = 0.5, pwrate = 1, pwsweep = 0|
		var width = pw + (LFTri.kr(pwrate) * pwsweep * 0.5);
		var sig = pulseWave.(pitched.(freq).max(0), (1 - width.clip(-0.99, 0.99)) / 2);
		Out.ar(out, DirtPan.ar(LeakDC.ar(sig) * 0.3, numChannels, pan))
	}).add;

	SynthDef(\supersaw, { |out, freq = 440, pan = 0, unison = 5, spread = 0.6, detune = 0.18|
		var voices = unison.round.clip(1, maxVoices);
		var spreading = voices > 1;
		var step = detune / (voices - 1).max(1);
		var center = detune * 0.5 * spreading;
		var width = spread.clip(0, 1) * spreading;
		var carrier = pitched.(freq).max(0);
		var saws = maxVoices.collect { |i|
			var voiceFreq = carrier * ((i * step) - center).midiratio;
			sawWave.((phasor.(voiceFreq) + Rand(0, 1)).frac, voiceFreq) * (i < voices)
		};
		var sig = Pan2.ar(saws[0, 2..].sum, width) + Pan2.ar(saws[1, 3..].sum, width.neg);
		Out.ar(out, DirtPan.ar(sig * (0.3 / voices.sqrt), numChannels, pan))
	}).add;

	SynthDef(\strudel_adsr, { |out, holdTime = 1, envAttack = 0.001, envDecay = 0.05, envSustain = 0.6, envRelease = 0.01|
		var env = EnvGen.ar(envelope.(0, 1, envSustain, [envAttack, envDecay, envRelease], \lin), gate.(holdTime));
		ReplaceOut.ar(out, In.ar(out, numChannels) * env)
	}).add;

	[
		[\lpf, { |sig, freq, rq| RLPF.ar(sig, freq, rq) }],
		[\hpf, { |sig, freq, rq| RHPF.ar(sig, freq, rq) }],
		[\bpf, { |sig, freq, rq| BPF.ar(sig, freq, rq) }]
	].do { |pair|
		var kind = pair[0], filter = pair[1];
		SynthDef("strudel_%_12db".format(kind), { |out, rq = 1|
			ReplaceOut.ar(out, filter.(In.ar(out, numChannels), cutoff.(), rq))
		}).add;
		SynthDef("strudel_%_24db".format(kind), { |out, rq = 1|
			var freq = cutoff.();
			ReplaceOut.ar(out, filter.(filter.(In.ar(out, numChannels), freq, rq), freq, rq))
		}).add;
	};

	SynthDef(\strudel_lpf_ladder, { |out, k = 0.13, drive = 0.69|
		var gain = drive.exp.clip(0.1, 2000);
		var sig = MoogFF.ar((In.ar(out, numChannels) * gain).tanh, cutoff.(), k.min(3.95));
		ReplaceOut.ar(out, sig / gain * (1 + k).min(1.75))
	}).add;
};

var filterArgs = { |kind, freq, q, attack, decay, sustain, release, env, noteDuration|
	var model = ~ftype ? 0;
	var enveloped = [attack, decay, sustain, release, env].any(_.notNil);
	var times = adsr.(attack, decay, sustain, release, [0.005, 0.14, 0, 0.1]);
	var depth = (env ? 1).abs;
	var anchor = ~fanchor ? 0;
	var start = freq, peak = freq;
	var args;

	if(model.isNumber) { model = filterModels.wrapAt(model.floor) };
	if(kind != \lpf and: { model == 'ladder' }) { model = '12db' };

	if(enveloped) {
		start = (2 ** (depth * anchor).neg * freq).clip(10, 20000);
		peak = (2 ** (depth - (depth * anchor)) * freq).clip(10, 20000);
		if((env ? 1) < 0) { #start, peak = [peak, start] };
	};

	args = [
		out: ~out, holdTime: noteDuration,
		fStart: start, fPeak: peak, fSustain: start + (times[2] * (peak - start)),
		fAttack: times[0], fDecay: times[1], fRelease: times[3]
	];
	args = args ++ switch(model,
		'ladder', { [k: ((q ? 1) * 0.13).min(8), drive: ~drive ? 0.69] },
		{ [rq: if(kind == \bpf) { 1 / (q ? 1).max(0.01) } { 10 ** ((q ? 1).neg / 20) }] }
	);
	["strudel_%_%".format(kind, model).asSymbol, args]
};

var prepare = {
	~strudelPrepared ?? {
		~strudelPrepared = true;
		~envSustain = ~sustain;
		~sustain = nil;
		~legato = ~legato ? ~clip;
		~olpf = ~olpf ? ~olp;
		~ohpf = ~ohpf ? ~ohp;
		if(~release.notNil and: { ~legato.isNil }) { ~legato = 1 };
		~gain = ~gain.max(0) ** 0.25;
		if((~delay ? 0) > 0) {
			~delaytime = ~delaytime ?? { (~delaysync ? (3/16)) / ~cps };
			~delayfeedback = (~delayfeedback ? 0.5).clip(0, 0.98);
		};
		if(synthNames.includes(~s) and: { ~note.isNil and: { ~midinote.isNumber.not and: { ~freq.isNumber.not } } }) {
			~midinote = 36
		};
	};
	nil
};

var finish = {
	var synth = synthNames.includes(~s);
	var hold = ~sustain;
	var noteDuration = ~delta.value * (~legato ? 1);
	var amp = adsr.(~attack, ~decay, ~envSustain, ~release, if(synth) { [0.001, 0.05, 0.6, 0.01] });
	var fmEnv = adsr.(~fmattack, ~fmdecay, ~fmsustain, ~fmrelease);

	amp !? {
		var tail = hold + amp[3] + 0.01;
		~strudelAmp = [
			out: ~out, holdTime: hold,
			envAttack: amp[0], envDecay: amp[1], envSustain: amp[2], envRelease: amp[3]
		];
		~sustain = if(~buffer.notNil) { tail.min(~unitDuration.value * ~length / ~speed.abs.max(0.001)) } { tail };
	};

	~strudelFilters = (
		lpf: ~cutoff !? { |freq| filterArgs.(\lpf, freq, ~resonance, ~lpattack, ~lpdecay, ~lpsustain, ~lprelease, ~lpenv, noteDuration) },
		hpf: ~hcutoff !? { |freq| filterArgs.(\hpf, freq, ~hresonance, ~hpattack, ~hpdecay, ~hpsustain, ~hprelease, ~hpenv, noteDuration) },
		bpf: ~bandf !? { |freq| filterArgs.(\bpf, freq, ~bandq, ~bpattack, ~bpdecay, ~bpsustain, ~bprelease, ~bpenv, noteDuration) }
	);

	if(synth) {
		~holdTime = hold;

		if([~pattack, ~pdecay, ~psustain, ~prelease, ~penv].any(_.notNil)) {
			var semitones = ~penv ? 1;
			var times = adsr.(~pattack, ~pdecay, ~psustain, ~prelease, [0.2, 0.001, 1, 0.001]);
			var anchor = ~panchor ? times[2];
			~pitchStart = semitones.neg * anchor;
			~pitchPeak = semitones - (semitones * anchor);
			~pitchSustain = ~pitchStart + (times[2] * (~pitchPeak - ~pitchStart));
			~pitchAttack = times[0];
			~pitchDecay = times[1];
			~pitchRelease = times[3];
		};

		~fmWave = fmWaves.indexOf(~fmwave ? \sine) ? 0;
		fmEnv !? {
			~fmEnvOn = 1;
			~fmExp = if((~fmenv ? \exp) == \exp) { 1 } { 0 };
			~fmAttack = fmEnv[0];
			~fmDecay = fmEnv[1];
			~fmSustain = fmEnv[2];
			~fmRelease = fmEnv[3];
		};

		if(~s == \pulse and: { ~pwsweep.isNil }) { ~pwsweep = if(~pwrate.notNil) { 0.3 } { 0 } };
		if(~s == \supersaw) { ~detune = ~detune ?? { if(~n.isNumber) { ~n } { 0.18 } } };
	};
	nil
};

{ |dirt|
	addSynthDefs.(dirt.numChannels);

	dirt.addModule('envelope', { |event| event.sendSynth(\strudel_adsr, ~strudelAmp) }, { ~strudelAmp.notNil });
	[\lpf, \hpf, \bpf].do { |kind|
		dirt.addModule(kind,
			{ |event| event.sendSynth(*~strudelFilters[kind]) },
			{ ~strudelFilters[kind].notNil }
		);
	};

	dirt.orbits.do { |orbit| orbit.set(\diversion, prepare, \play, finish) };
}
