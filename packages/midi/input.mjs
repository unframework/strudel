/*
input.mjs - MIDI input wrapper
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/midi/midi.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { WebMidi } from 'webmidi';
import { Fraction, Hap, Pattern, TimeSpan, getCps, getTime, logger, pure, ref, reify } from '@strudel/core';
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

    // Unified cycle-boundary scheduler. key → { boundary: Fraction, payload }.
    // Used by cue mutations, toggle pending entries, and blink-stop scheduling.
    this._pending = {};

    // Hardware-LED silo. Keyed by `${chan}:${noteNum}`.
    this._ledState = {}; // current logical state: 0 | 1 | 'blink' | undefined
    this._ledIntervals = {}; // active blink interval handle, if any

    // Per-toggle boundary patterns. Keyed by `${chan ?? 'all'}:${noteNum}`. When a press
    // arrives, _onNote consults this map (chan-specific first, then 'all') to find the
    // next hap onset that should serve as the cycle-alignment boundary.
    this._toggleBoundaryPats = {};

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

  /**
   * @param {number} noteNum MIDI note number for the toggle button
   * @param {number | undefined} chan MIDI channel (1-16) or undefined for all channels
   * @param {Pattern | string | undefined} boundaryPat Optional pattern whose hap onsets
   *   define the cycle-alignment boundaries. When a press arrives, the next pat hap onset
   *   after `getTime()` becomes the transition boundary (and the LED blinks until then).
   *   If omitted, defaults to the next integer cycle (`floor(getTime()) + 1`). Re-evaluating
   *   without `boundaryPat` clears any prior boundary pat for this (chan, noteNum).
   */
  createNoteToggle(noteNum, chan, boundaryPat) {
    const lookupMap = chan === undefined ? this._toggles : this._togglesByChan[chan];
    if (!(noteNum in lookupMap)) {
      lookupMap[noteNum] = 0;
    }

    const boundaryKey = `${chan ?? 'all'}:${noteNum}`;
    if (boundaryPat !== undefined) {
      this._toggleBoundaryPats[boundaryKey] = reify(boundaryPat).discreteOnly();
    } else {
      delete this._toggleBoundaryPats[boundaryKey];
    }

    const pendingKey = `toggle:${chan ?? 'all'}:${noteNum}`;

    // Cycle-aligned: a toggle pressed mid-cycle continues to report the previous value
    // (stored as the pending entry's payload) until the next cycle boundary.
    return pure(1)
      .withHap((hap) => {
        const begin = hap.whole.begin;
        const entry = this._getPending(pendingKey);
        const value = entry && begin.lt(entry.boundary) ? entry.payload : lookupMap[noteNum];
        return hap.withValue(() => reify(value));
      })
      .innerJoin();
  }

  // ─── Unified cycle-boundary scheduler ──────────────────────────────────────
  // One `this._pending` map keyed by string. Both cue mutations and toggle pending
  // entries live here. Last-write-wins (`_schedule`) and first-write-wins
  // (`_scheduleIfAbsent`) coalesce semantics share the same audio-time fire path.

  // Last-write-wins: same (boundary, payload) → no-op; differing entry replaces
  // (the prior fire-time callback bails on identity check). Returns the registered
  // entry, or null if not scheduled (transport stopped or boundary in past).
  _schedule(key, boundary, payload, callback) {
    const cps = getCps();
    if (!cps) {
      return null;
    }
    const boundaryFr = Fraction(boundary);
    const existing = this._pending[key];
    if (existing && existing.boundary.eq(boundaryFr) && existing.payload === payload) {
      return existing;
    }
    const entry = { boundary: boundaryFr, payload };

    const cyclePos = getTime();
    const cyclesUntil = Number(boundaryFr) - cyclePos;
    if (cyclesUntil < 0) {
      return null;
    }
    const audioCtx = getAudioContext();
    const target = audioCtx.currentTime + cyclesUntil / cps;
    this._pending[key] = entry;
    scheduleAtTime(
      () => {
        if (this._pending[key] !== entry) {
          return; // superseded or cleared
        }
        delete this._pending[key];
        try {
          callback?.(payload);
        } catch (err) {
          console.error('[midi] scheduler callback error:', err);
        }
      },
      target,
      audioCtx,
    );
    return entry;
  }

  // First-write-wins: if any entry exists for this key, no-op (return existing).
  // Callback is optional — the toggle-transition cleanup is purely the entry-
  // deletion side-effect that _schedule's fire path performs.
  _scheduleIfAbsent(key, boundary, payload, callback) {
    if (this._pending[key]) {
      return this._pending[key];
    }
    return this._schedule(key, boundary, payload, callback);
  }

  _getPending(key) {
    return this._pending[key];
  }

  _cancelPending(key) {
    delete this._pending[key];
  }

  // Resolve the cycle-alignment boundary for a press on (chan, noteNum):
  //   - boundary pat registered (chan-specific first, then all-chan), and a hap is active
  //     at `now`: end of that hap.
  //   - boundary pat registered, but `now` falls in a gap: act immediately (return `now`),
  //     since the user explicitly opted out of alignment for this region.
  //   - no boundary pat: fall back to the next integer cycle (default alignment).
  // A 1-cycle query window is enough — any hap whose whole contains `now` must extend
  // into [now, now + 1).
  _resolveToggleBoundary(chan, noteNum) {
    const now = getTime();
    const nowFr = Fraction(now);
    const pat = this._toggleBoundaryPats[`${chan}:${noteNum}`] ?? this._toggleBoundaryPats[`all:${noteNum}`];
    if (pat) {
      const haps = pat.queryArc(now, now + 1);
      const containing = haps.find((h) => h.whole && h.whole.begin.lte(nowFr) && h.whole.end.gt(nowFr));
      return containing ? containing.whole.end : nowFr;
    }
    return Fraction(Math.floor(now) + 1);
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

  // Schedule the audio-time mutation for an override at cycle `cycleFraction`. Same-value
  // re-discoveries at the same boundary are deduped by the scheduler; differing values
  // supersede (last write wins). If the live lookupMap is already at `value`, skip
  // entirely — useful when the override pat carries a stable value across many haps
  // (e.g. cueing from a noteToggle, which emits one hap per cycle with the same value).
  _registerCueMutation(ccNum, chan, cycleFraction, value) {
    const lookupMap = chan === undefined ? this._refs : (this._refsByChan[chan] ??= {});
    if (lookupMap[ccNum] === value) {
      return; // already at the desired value — no mutation, no device echo
    }
    const key = `cue:${chan ?? 'all'}:${ccNum}:${cycleFraction.show()}`;
    this._schedule(key, cycleFraction, value, (val) => {
      const raw = Math.round(val * 127);
      if (chan === undefined) {
        this._refs[ccNum] = val;
        this._saveState(undefined, '', ccNum, val);
        for (const chanKey of Object.keys(this._refsByChan)) {
          if (ccNum in this._refsByChan[chanKey]) {
            const c = Number(chanKey);
            this._refsByChan[chanKey][ccNum] = val;
            this._saveState(c, '', ccNum, val);
          }
        }
        for (let c = 1; c <= 16; c++) {
          this._sendCC(ccNum, raw, c);
        }
      } else {
        this._refs[ccNum] = val;
        this._refsByChan[chan] ??= {};
        this._refsByChan[chan][ccNum] = val;
        this._saveState(undefined, '', ccNum, val);
        this._saveState(chan, '', ccNum, val);
        this._sendCC(ccNum, raw, chan);
      }
    });
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
          this._sendAllStates();
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
      // If a transition for this (chan, noteNum) is already pending, treat this press as
      // a cancellation: revert state to before the first press, drop the pending entries,
      // stop the blink. Net effect: the two presses cancel out, no transition at boundary.
      const pendingChanKey = `toggle:${chan}:${noteNum}`;
      const pendingChan = this._getPending(pendingChanKey);
      if (pendingChan) {
        const restoredVal = pendingChan.payload;
        this._toggles[noteNum] = restoredVal;
        this._togglesByChan[chan][noteNum] = restoredVal;
        this._saveState(undefined, '-tog', noteNum, restoredVal);
        this._saveState(chan, '-tog', noteNum, restoredVal);

        this._cancelPending(`toggle:all:${noteNum}`);
        this._cancelPending(pendingChanKey);

        this._renderNoteLED(chan, noteNum, restoredVal ? 1 : 0);
        return;
      }

      const prevGlobal = this._toggles[noteNum] ?? 0;
      const prevPerChan = this._togglesByChan[chan][noteNum] ?? 0;
      const newState = !prevPerChan;
      const newVal = newState ? 1 : 0;

      this._toggles[noteNum] = newVal;
      this._togglesByChan[chan][noteNum] = newVal;

      this._saveState(undefined, '-tog', noteNum, newVal);
      this._saveState(chan, '-tog', noteNum, newVal);

      // Cycle-align the pattern reads: keep reporting the previous value until the next
      // cycle boundary. The per-chan entry also drives the LED out of blink at the
      // boundary's audio time. Transport stopped → null entry → render immediate state.
      const boundary = this._resolveToggleBoundary(chan, noteNum);
      this._scheduleIfAbsent(`toggle:all:${noteNum}`, boundary, prevGlobal);
      const perChanEntry = this._scheduleIfAbsent(`toggle:${chan}:${noteNum}`, boundary, prevPerChan, () => {
        const finalVal = this._togglesByChan[chan]?.[noteNum];
        this._renderNoteLED(chan, noteNum, finalVal ? 1 : 0);
      });
      this._renderNoteLED(chan, noteNum, perChanEntry ? 'blink' : newState ? 1 : 0);
    } else {
      // Note off — resend current state to keep the LED lit. Skip if a blink is active
      // (the blink owns the LED until the boundary).
      if (this._ledState[`${chan}:${noteNum}`] !== 'blink') {
        const curValue = this._togglesByChan[chan][noteNum];
        this._renderNoteLED(chan, noteNum, curValue ? 1 : 0);
      }
    }
  }

  // ─── Hardware-LED silo ─────────────────────────────────────────────────────
  // Self-contained LED driver. value is 0 | 1 | true | false | 'blink'. Owns its
  // interval lifecycle in _ledIntervals; idempotent against same-state calls.

  _renderNoteLED(chan, noteNum, value) {
    const key = `${chan}:${noteNum}`;
    if (this._ledState[key] === value) {
      return; // idempotent
    }
    if (this._ledIntervals[key]) {
      clearInterval(this._ledIntervals[key]);
      delete this._ledIntervals[key];
    }
    this._ledState[key] = value;

    if (value === 'blink') {
      let on = true;
      this._sendNoteOnOff(chan, noteNum, on);
      this._ledIntervals[key] = setInterval(() => {
        on = !on;
        this._sendNoteOnOff(chan, noteNum, on);
      }, 80);
    } else {
      this._sendNoteOnOff(chan, noteNum, !!value);
    }
  }

  // Send a note on/off message to the matching output of the currently-connected input.
  // Mirrors _sendCC.
  _sendNoteOnOff(chan, noteNum, isOn) {
    const device = this._currentDevice;
    if (!device) {
      return;
    }
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

  // Send CC values and toggle LED states back to device to restore encoders, motorized
  // sliders, and button LEDs after a fresh connection. Only fires for already-connected
  // devices (`_currentDevice` is set before this is called from `_startDeviceListener`).
  _sendAllStates() {
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
        // Force-render: clear cached LED state so _renderNoteLED treats this as a new
        // value (the just-reconnected device has no notion of prior state).
        delete this._ledState[`${channel}:${noteNum}`];
        this._renderNoteLED(channel, noteNum, isOn ? 1 : 0);
      }
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
