DaVerb : MultiOutUGen {
	*ar { |in, decay = 0.5, damping = 0.005, bandwidth = 0.9999, preDelay = 0, excursionRate = 0.5, excursionDepth = 0.7, inputDiffusion1 = 0.75, inputDiffusion2 = 0.625, decayDiffusion1 = 0.7, decayDiffusion2 = 0.5|
		^this.multiNew('audio', in, decay, damping, bandwidth, preDelay, excursionRate, excursionDepth, inputDiffusion1, inputDiffusion2, decayDiffusion1, decayDiffusion2)
	}

	init { |... theInputs|
		inputs = theInputs;
		^this.initOutputs(2, rate)
	}

	checkInputs { ^this.checkValidInputs }
}
