/*
clockfollower.mjs - estimates tempo and transport position from an incoming MIDI clock
Copyright (C) 2026 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/midi/clockfollower.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

export const MIDI_CLOCK = 0xf8;
export const MIDI_START = 0xfa;
export const MIDI_CONTINUE = 0xfb;
export const MIDI_STOP = 0xfc;
export const MIDI_SONG_POSITION = 0xf2;

const PPQN = 24; // MIDI clock pulses per quarter note
const CLOCKS_PER_BEAT = 6; // song position pointer counts 16th notes

// least squares through (t, i) samples: i(t) = slope*t + intercept. slope = clock ticks per second.
export function fitLine(samples) {
  const n = samples.length;
  if (n < 2) {
    return null;
  }
  let sumT = 0;
  let sumI = 0;
  for (const { t, i } of samples) {
    sumT += t;
    sumI += i;
  }
  const meanT = sumT / n;
  const meanI = sumI / n;
  let num = 0;
  let den = 0;
  for (const { t, i } of samples) {
    const dt = t - meanT;
    num += dt * (i - meanI);
    den += dt * dt;
  }
  if (den === 0) {
    return null;
  }
  const slope = num / den;
  return { slope, intercept: meanI - slope * meanT };
}

export class MidiClockFollower {
  constructor({ beatsPerCycle = 4, window = 24, stallSeconds = 0.5, nudge = 0, catchup = 0.2 } = {}) {
    this.ticksPerCycle = PPQN * beatsPerCycle;
    this.window = window;
    this.stallSeconds = stallSeconds;
    this.nudge = nudge;
    this.catchup = catchup;

    this.samples = [];
    this.tickCount = 0;
    this.fit = null;
    this.cps = 0;
    this.running = false;
    this.stopped = false;
    this.generation = 0;
    this.jumpCycle = 0;
    this.anchorTick = 0;
    this.anchorTime = 0;
    this.lastClockTime = -Infinity;
  }

  feed(bytes, time) {
    switch (bytes[0]) {
      case MIDI_CLOCK:
        if (!this.running && !this.stopped) {
          this._jump(this.tickCount, time); // join a stream already in progress; phase snaps on next Start
        }
        this._clock(time);
        break;
      case MIDI_START:
        this._jump(0, time);
        break;
      case MIDI_CONTINUE:
        this._jump(this.tickCount, time);
        break;
      case MIDI_STOP:
        this.running = false;
        this.stopped = true;
        break;
      case MIDI_SONG_POSITION:
        this._jump((bytes[1] | (bytes[2] << 7)) * CLOCKS_PER_BEAT, time);
        break;
    }
  }

  _clock(time) {
    this.samples.push({ t: time, i: this.tickCount });
    if (this.samples.length > this.window) {
      this.samples.shift();
    }
    this.tickCount++;
    const fit = fitLine(this.samples);
    if (fit) {
      this.fit = fit;
      this.cps = fit.slope / this.ticksPerCycle;
    }
    this.lastClockTime = time;
  }

  _jump(tick, time) {
    this.tickCount = tick;
    this.anchorTick = tick;
    this.anchorTime = time;
    this.jumpCycle = tick / this.ticksPerCycle;
    this.samples = [];
    this.fit = null;
    this.running = true;
    this.stopped = false;
    this.generation++;
  }

  cycleAt(time) {
    if (!this.fit) {
      return this.anchorTick / this.ticksPerCycle + this.nudge * this.cps;
    }
    const ticks = this.fit.slope * time + this.fit.intercept;
    return ticks / this.ticksPerCycle + this.nudge * this.cps;
  }

  timeAt(cycle) {
    if (!this.fit || this.fit.slope === 0) {
      return this.anchorTime;
    }
    const ticks = (cycle - this.nudge * this.cps) * this.ticksPerCycle;
    return (ticks - this.fit.intercept) / this.fit.slope;
  }

  isRunning(now) {
    return this.running && !this.stopped && now - this.lastClockTime < this.stallSeconds;
  }

  isStopped() {
    return this.stopped;
  }
}
