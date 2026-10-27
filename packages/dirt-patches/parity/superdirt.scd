// sclang superdirt.scd <events.scd> <out.wav> <seconds>
var eventsPath, outPath, seconds;
var sampleRate = 48000;
var lead = 0.01;
var setup = List.new, timed = List.new, onset, dirt;
var record = { |time, msgs|
	if(onset.isNil) { setup.addAll(msgs) } { timed.add([onset + (time ? 0)] ++ msgs) }
};
var sink = (
	hasBundle: false, addr: 0, port: 0, hostname: "parity", socket: nil, isLocal: true,
	sendMsg: { |self ...msg| record.(nil, [msg]) },
	sendBundle: { |self, time ...msgs| record.(time, msgs) },
	sendClumpedBundles: { |self, time ...msgs| record.(time, msgs) },
	sendRaw: { Error("raw OSC is not captured").throw },
	sync: { |self, condition, bundles, latency| bundles !? { record.(latency, bundles) } }
);
var isHandshake = { |msg| ["status", "notify", "sync"].includes(msg[0].asString.replace("/", "")) };
var server = Server(\parity, NetAddr("127.0.0.1", 0));

var trimLead = { |path|
	var file = SoundFile.openRead(path);
	var data = FloatArray.newClear(file.numFrames * file.numChannels);
	var skip = (lead * sampleRate).round.asInteger * file.numChannels;
	file.readData(data);
	file.close;
	file = SoundFile(path).headerFormat_("WAV").sampleFormat_("float").numChannels_(file.numChannels).sampleRate_(sampleRate);
	file.openWrite;
	file.writeData(data.copyRange(skip, data.size - 1));
	file.close;
};

try {
	#eventsPath, outPath, seconds = thisProcess.argv;

	server.options
		.numInputBusChannels_(0).numOutputBusChannels_(2)
		.numBuffers_(1024 * 16).memSize_(8192 * 32).maxNodes_(1024 * 32).numWireBufs_(2048);
	server.instVarPut(\addr, sink);
	server.statusWatcher.instVarPut(\hasBooted, true).instVarPut(\notified, true).instVarPut(\sampleRate, sampleRate);
	Server.default = server;
	SynthDef.synthDefDir = outPath.dirname +/+ "synthdefs/";
	File.mkdir(SynthDef.synthDefDir);

	dirt = SuperDirt(2, server);
	dirt.makeOrbits([0]);
	(thisProcess.nowExecutingPath.dirname +/+ "../scd/index.scd").load.(dirt);
	dirt.orbits.do(_.amp_(1));

	eventsPath.load.do { |entry|
		var event = (latency: 0).putPairs(entry[1]);
		onset = entry[0];
		DirtEvent(dirt.orbits @@ (event[\orbit] ? 0), dirt.modules, event).play;
	};

	Score(
		setup.reject(isHandshake).collect { |msg, i| [i * 1e-6, msg] }
		++ timed.collect { |bundle| [bundle[0] + lead] ++ bundle.drop(1) }
		++ [[seconds.asFloat + lead, [\c_set, 0, 0]]]
	).recordNRT(
		outPath ++ ".osc", outPath,
		sampleRate: sampleRate, headerFormat: "WAV", sampleFormat: "float",
		options: server.options, duration: seconds.asFloat + lead,
		action: { trimLead.(outPath); 0.exit }
	);
} { |error|
	error.reportError;
	1.exit;
};
