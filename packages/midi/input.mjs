/*
input.mjs - MIDI input wrapper
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/midi/midi.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { WebMidi } from 'webmidi';
import { Fraction, Hap, Pattern, TimeSpan, getCps, getTime, logger, ref, reify } from '@strudel/core';
import { getAudioContext } from '@strudel/webaudio';
import { scheduleAtTime } from '../superdough/helpers.mjs';
import { getDevice } from './util.mjs';

/**
 * MIDI input device wrapper that manages connection and reconnection, tracks
 * persisted CC states, etc. These instances are long-lived and are maintained as singletons
 * (keyed globally by input string/number).
 */
export class MidiInput {
  /**
   *
   * @param {string | number} input MIDI device name or index defaulting to 0
   */
  constructor(input) {
    this.input = input;
    this.stateKey = typeof input === 'string' ? input : undefined; // Saved state is not tracked for numeric index inputs
    this._currentDevice = null;

    this._refs = {};
    this._refsByChan = {};
    this._toggles = {};
    this._togglesByChan = {};
    this._widgetListeners = [];
    this._pendingMutations = {};

    this._loadAllStates();

    this.initialDevice = this._startDeviceListener();
    this.isConnected = !!this.initialDevice;
  }

  /**
   * Implementation for the cc() factory function tied to this specific input.
   * The returned pattern carries a `.cue(pat)` method for pattern-driven overrides
   * (see `_makeCuePattern`).
   * @param {number} cc MIDI CC number
   * @param {number | undefined} chan MIDI channel (1-16) or undefined for all channels
   */
  createCC(cc, chan) {
    const lookupMap = chan === undefined ? this._refs : (this._refsByChan[chan] ??= {});
    if (!(cc in lookupMap)) {
      const initialState = this._loadState(chan, ''); // TODO is this needed?
      lookupMap[cc] = initialState[cc] || 0;
    }

    const ccPat = ref(() => lookupMap[cc]);
    ccPat.cue = (overridePat) => this._makeCuePattern(cc, chan, overridePat);
    return ccPat;
  }

  createNoteToggle(noteNum, chan) {
    const lookupMap = chan === undefined ? this._toggles : this._togglesByChan[chan];
    if (!(noteNum in lookupMap)) {
      lookupMap[noteNum] = 0;
    }

    return ref(() => lookupMap[noteNum]); // TODO align to cycles?
  }

  /**
   * Build a Pattern that overlays `overridePat` on top of the live CC value for
   * the given (cc, chan). Two-stage drop:
   *   1. Query-time anticipation: for any pat hap whose onset cycle is audibly
   *      upcoming (P > getTime()), the returned pattern reports the pat hap value
   *      over its part. This is what gives the audio scheduler the "soon-to-be"
   *      value ahead of time so the drop lands crisply.
   *   2. Audio-time fire: at the audio time of each upcoming pat hap onset,
   *      mutate `_refs`/`_refsByChan` to the pat value, persist via `_saveState`,
   *      and echo the CC to the device (motorized fader follows).
   * Gaps in `overridePat` (and pat haps whose onset is already audibly past) read
   * the live `lookupMap` so live MIDI input continues to take effect everywhere
   * the override doesn't.
   */
  _makeCuePattern(cc, chan, overridePat) {
    const lookupMap = chan === undefined ? this._refs : (this._refsByChan[chan] ??= {});
    const pat = reify(overridePat).discreteOnly();

    return new Pattern((state) => {
      const overrideHaps = pat.query(state);
      const cyclePosNow = Fraction(getTime() ?? 0);

      const haps = [];
      const overrideParts = [];
      for (const oh of overrideHaps) {
        if (!oh.whole) continue;
        const P = oh.whole.begin;
        const audiblyUpcoming = P.gte(cyclePosNow);
        if (audiblyUpcoming && oh.hasOnset()) {
          this._registerCueMutation(cc, chan, P, oh.value);
        }
        const value = audiblyUpcoming ? oh.value : lookupMap[cc];
        haps.push(new Hap(oh.whole, oh.part, value, oh.context));
        overrideParts.push(oh.part);
      }

      // Fill state.span gaps (subspans not covered by any override part) with the
      // live lookupMap value, structured one-hap-per-cycle like pure() would.
      const gaps = subtractSpans(state.span, overrideParts);
      for (const gap of gaps) {
        for (const sub of gap.spanCycles) {
          haps.push(new Hap(sub.begin.wholeCycle(), sub, lookupMap[cc], {}));
        }
      }
      return haps;
    });
  }

  // Schedule the audio-time mutation for an override at cycle `cycleFraction`. Deduped
  // by boundary key so repeated query-time discoveries collapse to one scheduleAtTime.
  _registerCueMutation(ccNum, chan, cycleFraction, value) {
    const cps = getCps();
    if (!cps) {
      return;
    }
    const chanCcKey = `${chan ?? 'all'}:${ccNum}`;
    const boundaryKey = cycleFraction.show();
    const queue = (this._pendingMutations[chanCcKey] ??= {});
    const existing = queue[boundaryKey];
    if (existing && existing.value === value) {
      return; // already scheduled with the same value
    }
    // Otherwise: re-eval with a different value at the same boundary supersedes — last write wins.

    const cyclePos = getTime();
    const cyclesUntil = Number(cycleFraction) - cyclePos;
    if (cyclesUntil < 0) {
      return; // already past
    }
    const audioCtx = getAudioContext();
    const targetAudioTime = audioCtx.currentTime + cyclesUntil / cps;
    queue[boundaryKey] = { cycle: cycleFraction, value };

    scheduleAtTime(
      () => {
        const q = this._pendingMutations[chanCcKey];
        const pending = q?.[boundaryKey];
        if (!pending || pending.value !== value) {
          return; // superseded by a re-eval with a different value, or already fired
        }
        delete q[boundaryKey];
        if (Object.keys(q).length === 0) {
          delete this._pendingMutations[chanCcKey];
        }

        const raw = Math.round(value * 127);
        if (chan === undefined) {
          this._refs[ccNum] = value;
          this._saveState(undefined, '', ccNum, value);
          for (const chanKey of Object.keys(this._refsByChan)) {
            if (ccNum in this._refsByChan[chanKey]) {
              const c = Number(chanKey);
              this._refsByChan[chanKey][ccNum] = value;
              this._saveState(c, '', ccNum, value);
            }
          }
          for (let c = 1; c <= 16; c++) {
            this._sendCC(ccNum, raw, c);
          }
        } else {
          this._refs[ccNum] = value;
          this._refsByChan[chan] ??= {};
          this._refsByChan[chan][ccNum] = value;
          this._saveState(undefined, '', ccNum, value);
          this._saveState(chan, '', ccNum, value);
          this._sendCC(ccNum, raw, chan);
        }
      },
      targetAudioTime,
      audioCtx,
    );
  }

  _startDeviceListener() {
    const initialDevice = getDevice(this.input, WebMidi.inputs);

    // Background connection loop
    (async () => {
      const midiListener = this._onMidiMessage.bind(this);
      let device = initialDevice;

      while (true) {
        if (!device) {
          device = await this._waitForDevice();
        }

        this.isConnected = true;
        try {
          this._widgetListeners.forEach((cb) => cb());
        } catch (err) {
          console.error('[midi] error in widget listener callback:', err);
        }

        // Wait a bit for device to be ready to receive last state
        await new Promise((resolve) => setTimeout(resolve, 2000));

        this._currentDevice = device;
        try {
          // Still continue if sending did not work
          this._sendAllStates(device);
        } catch (err) {
          console.error('midiin: failed to send last state on connect:', device.name, err);
        }

        // Listen for incoming MIDI messages and for disconnection
        device.addListener('midimessage', midiListener);

        await this._waitForDeviceDisconnect(device);

        this._currentDevice = null;
        device.removeListener('midimessage', midiListener);
        device = null; // Clear var to trigger wait for connection

        this.isConnected = false;
        try {
          this._widgetListeners.forEach((cb) => cb());
        } catch (err) {
          console.error('[midi] error in widget listener callback:', err);
        }
      }
    })();

    return initialDevice;
  }

  // Returns a promise that resolves when the specified device is connected
  _waitForDevice() {
    return new Promise((resolve) => {
      const connListener = () => {
        const device = getDevice(this.input, WebMidi.inputs);
        if (device) {
          logger(`[midi] device reconnected: ${device.name}`);

          WebMidi.removeListener('connected', connListener);
          resolve(device);
        }
      };

      WebMidi.addListener('connected', connListener);
    });
  }

  // Returns a promise that resolves when the specified device is disconnected
  _waitForDeviceDisconnect(device) {
    return new Promise((resolve) => {
      const disconnListener = (e) => {
        if (e.port.name === device.name) {
          logger(`[midi] device disconnected: ${device.name}`);

          WebMidi.removeListener('disconnected', disconnListener);
          resolve();
        }
      };

      WebMidi.addListener('disconnected', disconnListener);
    });
  }

  _onMidiMessage(e) {
    switch (e.message.type) {
      case 'controlchange':
        this._onControlChange(e);
        break;

      case 'noteon':
      case 'noteoff':
        this._onNote(e);
        break;
    }
  }

  _onNote(e) {
    const noteNum = e.dataBytes[0];
    const velocity = e.dataBytes[1];
    const chan = e.message.channel;

    this._togglesByChan[chan] ??= {};
    const isNoteOn = e.message.type === 'noteon' && velocity > 0;

    if (isNoteOn) {
      const newState = !this._togglesByChan[chan][noteNum];
      const newVal = newState ? 1 : 0;

      this._toggles[noteNum] = newVal;
      this._togglesByChan[chan][noteNum] = newVal;

      this._saveState(undefined, '-tog', noteNum, newVal);
      this._saveState(chan, '-tog', noteNum, newVal);

      this._sendToggleState(e.port, chan, noteNum, newState);
    } else {
      // Note off - resend current state to keep the hardware button lit up
      const curValue = this._togglesByChan[chan][noteNum];
      this._sendToggleState(e.port, chan, noteNum, curValue ? true : false);
    }
  }

  _onControlChange(e) {
    const ccNum = e.dataBytes[0];
    const v = e.dataBytes[1];
    const chan = e.message.channel;
    const scaled = v / 127;

    this._refs[ccNum] = scaled;
    this._refsByChan[chan] ??= {};
    this._refsByChan[chan][ccNum] = scaled;

    this._saveState(undefined, '', ccNum, scaled);
    this._saveState(chan, '', ccNum, scaled);
  }

  _loadAllStates() {
    Object.assign(this._refs, this._loadState(undefined, ''));
    Object.assign(this._toggles, this._loadState(undefined, '-tog'));

    for (let chan = 1; chan <= 16; chan++) {
      this._refsByChan[chan] ??= {};
      this._togglesByChan[chan] ??= {};
      Object.assign(this._refsByChan[chan], this._loadState(chan, ''));
      Object.assign(this._togglesByChan[chan], this._loadState(chan, '-tog'));
    }
  }

  _loadState(chan, suffix) {
    if (!this.stateKey) {
      return {};
    }

    const initialDataRaw = localStorage.getItem(
      `strudel-midin-${this.stateKey}-chan${chan !== undefined ? chan : 'all'}${suffix}`,
    );
    if (!initialDataRaw) {
      return {};
    }

    try {
      return JSON.parse(initialDataRaw);
    } catch (err) {
      console.warn(
        `Failed to parse MIDI state from localStorage for input "${this.stateKey}" and channel "${chan}"`,
        initialDataRaw,
        err,
      );
      return {};
    }
  }

  _saveState(chan, suffix, cc, value) {
    if (!this.stateKey) {
      return;
    }

    const state = this._loadState(chan, suffix);
    state[cc] = value;
    localStorage.setItem(
      `strudel-midin-${this.stateKey}-chan${chan !== undefined ? chan : 'all'}${suffix}`,
      JSON.stringify(state),
    );
  }

  // Send a CC message to the matching output of the currently-connected input
  _sendCC(ccNum, value, chan) {
    const device = this._currentDevice;
    if (!device) {
      return;
    }
    const output = WebMidi.outputs.find((o) => o.name === device.name);
    if (!output) {
      return;
    }
    output.sendControlChange(ccNum, value, chan);
  }

  // Send CC values back to device to restore encoders and motorized sliders
  _sendAllStates(device) {
    const output = WebMidi.outputs.find((o) => o.name === device.name);
    if (!output) {
      return;
    }

    for (const [chan, refs] of Object.entries(this._refsByChan)) {
      const channel = Number(chan);
      for (const [cc, value] of Object.entries(refs)) {
        const ccn = Number(cc);
        const scaled = Math.round(value * 127);
        this._sendCC(ccn, scaled, channel);
      }
    }

    for (const [chan, toggles] of Object.entries(this._togglesByChan)) {
      const channel = Number(chan);
      for (const [noteNumStr, isOn] of Object.entries(toggles)) {
        const noteNum = Number(noteNumStr);
        if (isOn) {
          output.sendNoteOn(noteNum, { channels: channel, rawAttack: 127 });
        } else {
          output.sendNoteOff(noteNum, { channels: channel, rawAttack: 0 });
        }
      }
    }
  }

  _sendToggleState(device, chan, noteNum, isOn) {
    const output = WebMidi.outputs.find((o) => o.name === device.name);
    if (!output) {
      return;
    }

    if (isOn) {
      output.sendNoteOn(noteNum, { channels: chan, rawAttack: 127 });
    } else {
      output.sendNoteOff(noteNum, { channels: chan, rawAttack: 0 });
    }
  }

  registerWidgetListener(callback) {
    // TODO clean up (elsewhere?)
    this._widgetListeners.push(callback);

    callback();
  }
}

// Returns `span` minus the union of `subtractParts`, as a list of TimeSpans.
function subtractSpans(span, subtractParts) {
  const sorted = [...subtractParts].sort((a, b) => a.begin.compare(b.begin));
  const result = [];
  let cursor = span.begin;

  for (const part of sorted) {
    if (part.end.lte(cursor)) continue;
    if (part.begin.gte(span.end)) break;
    const partBegin = part.begin.gt(cursor) ? part.begin : cursor;
    if (partBegin.gt(cursor)) {
      result.push(new TimeSpan(cursor, partBegin));
    }
    if (part.end.gt(cursor)) {
      cursor = part.end;
    }
    if (cursor.gte(span.end)) break;
  }

  if (cursor.lt(span.end)) {
    result.push(new TimeSpan(cursor, span.end));
  }

  return result;
}
