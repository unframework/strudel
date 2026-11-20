/*
clockfollower.test.mjs - Tests for the MIDI clock follower
Copyright (C) 2026 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/midi/test/clockfollower.test.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { describe, expect, it } from 'vitest';
import {
  MIDI_CLOCK,
  MIDI_SONG_POSITION,
  MIDI_START,
  MIDI_STOP,
  MidiClockFollower,
  fitLine,
} from '../clockfollower.mjs';

// 48 ticks/sec = 120 BPM; last pulse lands at 23/48 ≈ 0.479s
const feed120 = (follower) => {
  for (let i = 0; i < 24; i++) {
    follower.feed([MIDI_CLOCK], i / 48);
  }
};

describe('fitLine', () => {
  it('returns null for fewer than two samples', () => {
    expect(fitLine([])).toBe(null);
    expect(fitLine([{ t: 0, i: 0 }])).toBe(null);
  });
  it('recovers the slope of evenly spaced ticks', () => {
    const samples = Array.from({ length: 24 }, (_, i) => ({ t: i / 48, i }));
    expect(fitLine(samples).slope).toBeCloseTo(48, 5);
  });
  it('returns null when all timestamps coincide', () => {
    expect(
      fitLine([
        { t: 1, i: 0 },
        { t: 1, i: 5 },
      ]),
    ).toBe(null);
  });
});

describe('MidiClockFollower', () => {
  it('derives cps from clock pulses at 120 BPM', () => {
    const follower = new MidiClockFollower(); // beatsPerCycle 4 => 96 ticks/cycle
    feed120(follower);
    expect(follower.cps).toBeCloseTo(0.5, 5);
  });

  it('reports bpm, independent of beatsPerCycle', () => {
    const follower = new MidiClockFollower();
    expect(follower.bpm).toBe(0);
    feed120(follower);
    expect(follower.bpm).toBeCloseTo(120, 3);

    const wide = new MidiClockFollower({ beatsPerCycle: 8 });
    feed120(wide);
    expect(wide.bpm).toBeCloseTo(120, 3);
  });

  it('snaps to the downbeat on Start', () => {
    const follower = new MidiClockFollower();
    feed120(follower);
    const gen = follower.generation;
    follower.feed([MIDI_START], 0.5);
    expect(follower.generation).toBe(gen + 1);
    expect(follower.jumpCycle).toBe(0);
    expect(follower.cycleAt(0.5)).toBeCloseTo(0, 5);
    expect(follower.cps).toBeCloseTo(0.5, 5);
    expect(follower.isRunning(0.5)).toBe(true);
  });

  it('holds on Stop', () => {
    const follower = new MidiClockFollower();
    feed120(follower);
    follower.feed([MIDI_START], 0.5);
    follower.feed([MIDI_STOP], 0.52);
    expect(follower.isStopped()).toBe(true);
    expect(follower.isRunning(0.52)).toBe(false);
  });

  it('maps song position pointer to a cycle', () => {
    const follower = new MidiClockFollower(); // 96 ticks/cycle, 6 clocks/beat => 16 beats/cycle
    follower.feed([MIDI_SONG_POSITION, 16, 0], 1); // beat 16 = one cycle in
    expect(follower.jumpCycle).toBeCloseTo(1, 5);
  });

  it('reports not running after a stall', () => {
    const follower = new MidiClockFollower({ stallSeconds: 0.5 });
    feed120(follower);
    follower.feed([MIDI_START], 0.5);
    expect(follower.isRunning(0.6)).toBe(true);
    expect(follower.isRunning(1.1)).toBe(false);
  });

  it('follows a clock stream that is already running, without a Start', () => {
    const follower = new MidiClockFollower();
    follower.feed([MIDI_CLOCK], 0);
    follower.feed([MIDI_CLOCK], 1 / 48);
    expect(follower.isRunning(1 / 48)).toBe(true);
  });

  it('stays held after Stop even if clock keeps streaming', () => {
    const follower = new MidiClockFollower();
    feed120(follower);
    follower.feed([MIDI_START], 0.5);
    follower.feed([MIDI_STOP], 0.52);
    follower.feed([MIDI_CLOCK], 0.54);
    expect(follower.isRunning(0.54)).toBe(false);
  });

  it('adapts cps to a tempo change', () => {
    const follower = new MidiClockFollower({ window: 24 });
    follower.feed([MIDI_START], 0);
    let t = 0;
    for (let i = 1; i <= 48; i++) {
      t = i / 48;
      follower.feed([MIDI_CLOCK], t);
    }
    for (let i = 1; i <= 48; i++) {
      t += 1 / 56;
      follower.feed([MIDI_CLOCK], t);
    }
    expect(follower.cps).toBeCloseTo(56 / 96, 2);
  });

  it('bounds position error under timestamp jitter however long it has run', () => {
    const follower = new MidiClockFollower({ window: 24 });
    follower.feed([MIDI_START], 0);
    const jitter = [0.002, -0.0015, 0.001, -0.002, 0.0005];
    let maxErr = 0;
    for (let i = 1; i <= 2000; i++) {
      const t = i / 48 + jitter[i % jitter.length];
      follower.feed([MIDI_CLOCK], t);
      if (i > 24) {
        maxErr = Math.max(maxErr, Math.abs(follower.cycleAt(t) - (i - 1) / 96));
      }
    }
    expect(maxErr).toBeLessThan(0.02);
  });

  it('applies reconfigured options while keeping tracking state', () => {
    const follower = new MidiClockFollower();
    feed120(follower);
    follower.feed([MIDI_START], 0.5);
    const ticks = follower.tickCount;
    follower.configure({ nudge: 0.1, window: 48 });
    expect(follower.nudge).toBe(0.1);
    expect(follower.window).toBe(48);
    expect(follower.running).toBe(true);
    expect(follower.tickCount).toBe(ticks);
  });

  it('re-cues the downbeat to the current moment while keeping tempo', () => {
    const follower = new MidiClockFollower();
    feed120(follower);
    follower.feed([MIDI_START], 0.5);
    for (let i = 1; i <= 12; i++) {
      follower.feed([MIDI_CLOCK], 0.5 + i / 48);
    }
    const now = 0.5 + 12 / 48;
    const before = follower.cycleAt(now);
    expect(before - Math.round(before)).not.toBeCloseTo(0, 2); // mid-cycle, off the downbeat

    const bpm = follower.bpm;
    const gen = follower.generation;
    follower.recue(now);

    expect(follower.generation).toBe(gen + 1);
    expect(follower.bpm).toBeCloseTo(bpm, 6);
    const after = follower.cycleAt(now);
    expect(after - Math.round(after)).toBeCloseTo(0, 9); // now sits exactly on a downbeat
    expect(follower.jumpCycle).toBe(Math.round(after));
  });

  it('clears the fit when beatsPerCycle changes', () => {
    const follower = new MidiClockFollower();
    feed120(follower);
    expect(follower.fit).not.toBe(null);
    follower.configure({ beatsPerCycle: 8 });
    expect(follower.fit).toBe(null);
    expect(follower.ticksPerCycle).toBe(24 * 8);
  });
});
