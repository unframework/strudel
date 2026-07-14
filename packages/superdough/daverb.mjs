// DaVerb - Dattorro plate reverb for orbit-level send effect
// Based on https://github.com/khoin/DattorroReverbNode (public domain)

if (typeof AudioContext !== 'undefined') {
  BaseAudioContext.prototype.createDaVerb = function () {
    const node = new AudioWorkletNode(this, 'dattorro-reverb', {
      outputChannelCount: [2],
    });
    // wet-only output: the send gain controls the mix amount
    node.parameters.get('wet').value = 1;
    node.parameters.get('dry').value = 0;
    return node;
  };
}
