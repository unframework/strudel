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
  silence,
  startScheduler,
  wakeScheduler,
} from '@strudel/core';
import { getAudioContext } from '@strudel/webaudio';
import { WebMidi, enableWebMidi } from './midi.mjs';
import { getDevice, getMidiDeviceNamesString } from './util.mjs';
import { MIDI_CONTINUE, MIDI_SONG_POSITION, MIDI_START, MIDI_STOP, MidiClockFollower } from './clockfollower.mjs';

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

/**
 * Follow an external MIDI clock as Strudel's transport, syncing tempo and start/stop.
 *
 * Pass a device name/index to start following, or `false` to disconnect and return to the
 * internal clock. Tempo is derived from the incoming 24-ppqn clock, external Start snaps the
 * playhead to the downbeat, and external Start/Stop drive the play button. The first playback
 * still needs one user gesture to unlock the browser's audio engine.
 *
 * Only works with the single-instance scheduler (turn off "Sync across Browser Tabs").
 *
 * @name midiclock
 * @tags external_io, midi
 * @param {string | number | false} input MIDI device name or index, or false to disconnect
 * @param {object} [options] beatsPerCycle (default 4), window, stallSeconds, nudge, catchup
 * @example
 * await midiclock('IAC Driver Bus 1')
 * $: s("bd*4,[~ cp]*2").bank("tr909")
 */
export async function midiclock(input, options = {}) {
  if (input === false) {
    Object.keys(connections).forEach(detach);
    setClockSource(null);
    return silence;
  }

  await enableWebMidi();
  detach(input);

  const follower = new MidiClockFollower(options);
  const collator = new ClockCollator({ getTargetClockTime: () => getAudioContext().currentTime });
  const conn = { listener: null, device: null, follower, connListener: null, disconnListener: null };
  connections[input] = conn;

  conn.listener = (e) => {
    const bytes = e.message.data;
    const time = collator.calculateTimestamp(getPerformanceTimeSeconds(), e.timestamp / 1000);
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
    }
  };

  const attach = (device) => {
    if (conn.device === device) {
      return;
    }
    conn.device = device;
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
  return silence;
}
