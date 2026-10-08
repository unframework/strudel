/*
midiclock.mjs - follow an external MIDI clock as Strudel's transport
Copyright (C) 2026 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/midi/midiclock.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import {
  ClockCollator,
  getPerformanceTimeSeconds,
  logger,
  pauseScheduler,
  setClockSource,
  startScheduler,
  wakeScheduler,
} from '@strudel/core';
import { getAudioContext } from '@strudel/webaudio';
import { WebMidi, enableWebMidi } from './midi.mjs';
import { getDevice, getMidiDeviceNamesString } from './util.mjs';
import {
  MIDI_CLOCK,
  MIDI_CONTINUE,
  MIDI_SONG_POSITION,
  MIDI_START,
  MIDI_STOP,
  MidiClockFollower,
} from './clockfollower.mjs';

const connections = {};

function detach(input) {
  const conn = connections[input];
  if (!conn) {
    return;
  }
  conn.device?.removeListener('midimessage', conn.listener);
  conn.connListener && WebMidi.removeListener('connected', conn.connListener);
  conn.disconnListener && WebMidi.removeListener('disconnected', conn.disconnListener);
  delete connections[input];
}

export function stopMidiClock() {
  Object.keys(connections).forEach(detach);
  setClockSource(null);
}

// Only works with the single-instance scheduler (turn off "Sync across Browser Tabs").
export async function followMidiClock(input, options = {}) {
  await enableWebMidi();

  const existing = connections[input];
  const follower = existing?.follower ?? new MidiClockFollower(options);
  const collator = existing?.collator ?? new ClockCollator({ getTargetClockTime: () => getAudioContext().currentTime });
  if (existing) {
    follower.configure(options);
  }
  detach(input);

  const conn = { listener: null, device: null, follower, collator, connListener: null, disconnListener: null };
  connections[input] = conn;

  conn.listener = (e) => {
    const bytes = e.message.data;
    const time = collator.calculateTimestamp(getPerformanceTimeSeconds(), e.timestamp / 1000);
    const wasRunning = follower.running;
    follower.feed(bytes, time);
    switch (bytes[0]) {
      case MIDI_START:
      case MIDI_CONTINUE:
        startScheduler();
        wakeScheduler();
        break;
      case MIDI_SONG_POSITION:
        wakeScheduler();
        break;
      case MIDI_STOP:
        pauseScheduler();
        break;
      case MIDI_CLOCK:
        if (!wasRunning && follower.running) {
          startScheduler();
          wakeScheduler();
        }
        break;
    }
  };

  const attach = (device) => {
    if (conn.device === device) {
      return;
    }
    conn.device = device;
    follower.deviceName = device.name;
    device.addListener('midimessage', conn.listener);
    logger(`[midi] following clock from "${device.name}"`);
  };

  conn.connListener = () => {
    const device = getDevice(input, WebMidi.inputs);
    device && attach(device);
  };
  conn.disconnListener = (e) => {
    if (conn.device && e.port.name === conn.device.name) {
      conn.device.removeListener('midimessage', conn.listener);
      conn.device = null;
      follower.deviceName = null;
      logger(`[midi] clock device disconnected: ${e.port.name}`);
    }
  };
  WebMidi.addListener('connected', conn.connListener);
  WebMidi.addListener('disconnected', conn.disconnListener);

  const device = getDevice(input, WebMidi.inputs);
  if (device) {
    attach(device);
  } else {
    logger(`[midi] waiting for clock device "${input}"... connected: ${getMidiDeviceNamesString(WebMidi.inputs)}`);
  }

  setClockSource(follower);
}
