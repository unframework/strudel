/*
input.mjs - MIDI input wrapper
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/midi/midi.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { WebMidi } from 'webmidi';
import { logger, ref } from '@strudel/core';
import { getDevice } from './util.mjs';

/**
 * MIDI input device wrapper that manages connection and reconnection, tracks
 * persisted CC states, and exposes raw message I/O. These instances are long-lived
 * and are maintained as singletons (keyed globally by input string/number).
 */
export class MidiInput {
  /**
   * @param {string | number} input MIDI device name or index defaulting to 0
   */
  constructor(input) {
    this.input = input;
    this.stateKey = typeof input === 'string' ? input : undefined; // Saved state is not tracked for numeric index inputs
    this.isConnected = false;
    this._currentDevice = null;

    this._refs = {};
    this._refsByChan = {};
    this._messageListeners = new Set();
    this._connectionListeners = new Set();

    this._loadAllStates();

    this.initialDevice = this._startDeviceListener();
  }

  /**
   * Implementation for the cc() factory function tied to this specific input.
   * @param {number} cc MIDI CC number
   * @param {number | undefined} chan MIDI channel (1-16) or undefined for all channels
   */
  createCC(cc, chan) {
    const lookupMap = chan === undefined ? this._refs : (this._refsByChan[chan] ??= {});
    lookupMap[cc] ??= 0;
    return ref(() => lookupMap[cc]);
  }

  /**
   * Subscribe to raw incoming messages. A note-on with zero velocity is reported as 'noteoff'.
   * @param {function('cc' | 'noteon' | 'noteoff', number, number, number): void} listener
   *   called with (type, channel, cc or note number, raw 0-127 value)
   * @returns {function(): void} unsubscribe
   */
  onMessage(listener) {
    this._messageListeners.add(listener);
    return () => this._messageListeners.delete(listener);
  }

  /**
   * Subscribe to connection changes. Fires once the device is ready to receive output
   * (after the stored CC values were re-sent) and again on disconnect.
   * @param {function(boolean): void} listener called with the new `isConnected` value
   * @returns {function(): void} unsubscribe
   */
  onConnectionChange(listener) {
    this._connectionListeners.add(listener);
    return () => this._connectionListeners.delete(listener);
  }

  /**
   * Send a CC message to the output port matching the connected input. No-op while disconnected.
   * @param {number} ccNum
   * @param {number} value raw 0-127
   * @param {number} chan 1-16
   */
  sendCC(ccNum, value, chan) {
    this._output()?.sendControlChange(ccNum, value, chan);
  }

  /**
   * Send a note message to the output port matching the connected input; zero velocity sends
   * note-off. No-op while disconnected.
   * @param {number} noteNum
   * @param {number} velocity raw 0-127
   * @param {number} chan 1-16
   */
  sendNote(noteNum, velocity, chan) {
    const output = this._output();
    if (velocity > 0) {
      output?.sendNoteOn(noteNum, { channels: chan, rawAttack: velocity });
    } else {
      output?.sendNoteOff(noteNum, { channels: chan, rawRelease: 0 });
    }
  }

  _output() {
    const device = this._currentDevice;
    return device ? WebMidi.outputs.find((o) => o.name === device.name) : undefined;
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

        // Wait a bit for device to be ready to receive last state
        await new Promise((resolve) => setTimeout(resolve, 2000));

        this._currentDevice = device;
        try {
          // Still continue if sending did not work
          this._sendAllStates();
        } catch (err) {
          console.error('midiin: failed to send last state on connect:', device.name, err);
        }

        device.addListener('midimessage', midiListener);
        this._setConnected(true);

        await this._waitForDeviceDisconnect(device);

        this._currentDevice = null;
        device.removeListener('midimessage', midiListener);
        device = null; // Clear var to trigger wait for connection

        this._setConnected(false);
      }
    })();

    return initialDevice;
  }

  _setConnected(isConnected) {
    this.isConnected = isConnected;
    for (const listener of this._connectionListeners) {
      try {
        listener(isConnected);
      } catch (err) {
        console.error('[midi] error in connection listener:', err);
      }
    }
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
    const { type, channel } = e.message;
    const [num, value] = e.dataBytes;

    switch (type) {
      case 'controlchange':
        this._onControlChange(channel, num, value);
        this._emit('cc', channel, num, value);
        break;

      case 'noteon':
        this._emit(value > 0 ? 'noteon' : 'noteoff', channel, num, value);
        break;

      case 'noteoff':
        this._emit('noteoff', channel, num, value);
        break;
    }
  }

  _emit(type, chan, num, value) {
    for (const listener of this._messageListeners) {
      try {
        listener(type, chan, num, value);
      } catch (err) {
        console.error('[midi] error in message listener:', err);
      }
    }
  }

  _onControlChange(chan, ccNum, value) {
    const scaled = value / 127;

    this._refs[ccNum] = scaled;
    this._refsByChan[chan] ??= {};
    this._refsByChan[chan][ccNum] = scaled;

    this._saveState(undefined, ccNum, scaled);
    this._saveState(chan, ccNum, scaled);
  }

  _loadAllStates() {
    Object.assign(this._refs, this._loadState(undefined));

    for (let chan = 1; chan <= 16; chan++) {
      this._refsByChan[chan] = this._loadState(chan);
    }
  }

  _stateStorageKey(chan) {
    return `strudel-midin-${this.stateKey}-chan${chan !== undefined ? chan : 'all'}`;
  }

  _loadState(chan) {
    if (!this.stateKey) {
      return {};
    }

    const initialDataRaw = localStorage.getItem(this._stateStorageKey(chan));
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

  _saveState(chan, cc, value) {
    if (!this.stateKey) {
      return;
    }

    const state = this._loadState(chan);
    state[cc] = value;
    localStorage.setItem(this._stateStorageKey(chan), JSON.stringify(state));
  }

  // Restore encoders and motorized sliders after a fresh connection.
  _sendAllStates() {
    for (const [chan, refs] of Object.entries(this._refsByChan)) {
      for (const [cc, value] of Object.entries(refs)) {
        this.sendCC(Number(cc), Math.round(value * 127), Number(chan));
      }
    }
  }
}
