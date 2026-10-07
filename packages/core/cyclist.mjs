/*
cyclist.mjs - event scheduler for a single strudel instance. for multi-instance scheduler, see - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/core/neocyclist.mjs>
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/core/cyclist.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import createClock from './zyklus.mjs';
import { errorLogger, logger } from './logger.mjs';
import { anchorCycle, catchUpTime } from './clocksource.mjs';

export class Cyclist {
  constructor({
    interval,
    onTrigger,
    onToggle,
    onError,
    getTime,
    latency = 0.1,
    setInterval,
    clearInterval,
    beforeStart,
  }) {
    this.started = false;
    this.beforeStart = beforeStart;
    this.cps = 0.5;
    this.num_ticks_since_cps_change = 0;
    this.lastTick = 0; // absolute time when last tick (clock callback) happened
    this.lastBegin = 0; // query begin of last tick
    this.lastEnd = 0; // query end of last tick
    this.getTime = getTime; // get absolute time
    this.num_cycles_at_cps_change = 0;
    this.seconds_at_cps_change; // clock phase when cps was changed
    this.onToggle = onToggle;
    this.onTrigger = onTrigger;
    this.onError = onError;
    this.latency = latency; // fixed trigger time offset
    this.clockSource = null;
    this.clockGeneration = undefined;
    this.clockInCharge = false;
    this.clockStarted = false;
    this.clockOffset = 0; // external cycle at (re)start, so the pattern counts from ~0
    this.warnedExternalCps = false;
    this.clock = createClock(
      getTime,
      // called slightly before each cycle
      (phase, duration, _, t) => {
        if (this.clockSource) {
          this.externalTick(phase, duration, t);
        } else {
          this.internalTick(phase, duration, t);
        }
      },
      interval, // duration of each cycle
      0.1,
      0.1,
      setInterval,
      clearInterval,
    );
  }
  internalTick(phase, duration, t) {
    if (this.num_ticks_since_cps_change === 0) {
      this.num_cycles_at_cps_change = this.lastEnd;
      this.seconds_at_cps_change = phase;
    }
    this.num_ticks_since_cps_change++;
    const seconds_since_cps_change = this.num_ticks_since_cps_change * duration;
    const num_cycles_since_cps_change = seconds_since_cps_change * this.cps;

    try {
      const begin = this.lastEnd;
      this.lastBegin = begin;
      const end = this.num_cycles_at_cps_change + num_cycles_since_cps_change;
      this.lastEnd = end;
      this.lastTick = phase;

      if (phase < t) {
        // avoid querying haps that are in the past anyway
        console.log(`skip query: too late`);
        return;
      }

      // query the pattern for events
      const haps = this.pattern.queryArc(begin, end, { _cps: this.cps, cyclist: 'cyclist' });

      haps.forEach((hap) => {
        if (hap.hasOnset()) {
          const targetTime =
            (hap.whole.begin - this.num_cycles_at_cps_change) / this.cps + this.seconds_at_cps_change + this.latency;
          const duration = hap.duration / this.cps;
          // the following line is dumb and only here for backwards compatibility
          // see https://codeberg.org/uzu/strudel/pulls/1004
          const deadline = targetTime - phase;
          // this onTrigger has another signature
          this.onTrigger?.(hap, deadline, duration, this.cps, targetTime);
          if (hap.value.cps !== undefined && this.cps != hap.value.cps) {
            this.cps = hap.value.cps;
            this.num_ticks_since_cps_change = 0;
          }
        }
      });
    } catch (e) {
      errorLogger(e);
      this.onError?.(e);
    }
  }
  externalTick(phase, duration, t) {
    const source = this.clockSource;
    const now = this.getTime();

    if (!source.isRunning(now)) {
      if (source.isStopped?.()) {
        this.clockInCharge = false; // held: don't query or advance
        return;
      }
      if (this.clockInCharge) {
        logger('[cyclist] external clock lost, back on internal clock', 'warning');
        this.clockInCharge = false;
        this.clockGeneration = undefined;
        this.num_ticks_since_cps_change = 0;
        this.num_cycles_at_cps_change = this.lastEnd;
      }
      if (!this.clockStarted) {
        return; // armed, waiting for the external transport to start — stay silent
      }
      this.internalTick(phase, duration, t);
      return;
    }

    try {
      this.clockInCharge = true;
      this.clockStarted = true;
      this.cps = source.cps;

      if (source.generation !== this.clockGeneration) {
        this.clockGeneration = source.generation;
        const anchor = anchorCycle(source, now);
        this.clockOffset = Math.floor(anchor);
        this.lastEnd = anchor - this.clockOffset;
      }

      const begin = this.lastEnd;
      const end = Math.max(begin, source.cycleAt(phase + duration) - this.clockOffset);
      this.lastBegin = begin;
      this.lastEnd = end;
      this.lastTick = phase;

      const haps = this.pattern.queryArc(begin, end, { _cps: source.cps, cyclist: 'cyclist' });

      haps.forEach((hap) => {
        if (!hap.hasOnset()) {
          return;
        }
        const targetTime = source.timeAt(hap.whole.begin + this.clockOffset) + this.latency;
        const when = catchUpTime(targetTime, this.getTime(), this.clock.minLatency);
        if (when === undefined) {
          return;
        }
        const hapDuration = hap.duration / source.cps;
        this.onTrigger?.(hap, when - phase, hapDuration, source.cps, when);
      });
    } catch (e) {
      errorLogger(e);
      this.onError?.(e);
    }
  }
  setClockSource(source) {
    source = source ?? null;
    if (source === this.clockSource) {
      return;
    }
    if (source) {
      this.clockSource = source;
      this.clockGeneration = undefined;
      this.clockInCharge = false;
      this.clockStarted = false;
      this.clockOffset = 0;
      this.warnedExternalCps = false;
      logger('[cyclist] following external clock');
      this.wake();
      return;
    }
    const lastCps = this.clockSource?.cps;
    this.clockSource = null;
    this.clockInCharge = false;
    if (Number.isFinite(lastCps) && lastCps > 0) {
      this.cps = lastCps;
    }
    this.num_ticks_since_cps_change = 0;
    this.num_cycles_at_cps_change = this.lastEnd;
    logger('[cyclist] back to internal clock');
  }
  wake() {
    if (!this.started || !this.clockSource) {
      return;
    }
    this.clock.tick?.();
  }
  now() {
    if (!this.started) {
      return 0;
    }
    if (this.clockInCharge && this.clockSource) {
      return this.clockSource.cycleAt(this.getTime()) - this.clockOffset;
    }
    const secondsSinceLastTick = this.getTime() - this.lastTick - this.clock.duration;
    return this.lastBegin + secondsSinceLastTick * this.cps; // + this.clock.minLatency;
  }
  setStarted(v) {
    this.started = v;
    this.onToggle?.(v);
  }
  async start() {
    await this.beforeStart?.();
    this.num_ticks_since_cps_change = 0;
    this.num_cycles_at_cps_change = 0;
    this.clockGeneration = undefined;
    this.clockInCharge = false;
    if (!this.pattern) {
      throw new Error('Scheduler: no pattern set! call .setPattern first.');
    }
    logger('[cyclist] start');
    this.clock.start();
    this.setStarted(true);
  }
  pause() {
    logger('[cyclist] pause');
    this.clock.pause();
    this.setStarted(false);
  }
  stop() {
    logger('[cyclist] stop');
    this.clock.stop();
    this.lastEnd = 0;
    this.clockInCharge = false;
    this.setStarted(false);
  }
  async setPattern(pat, autostart = false) {
    this.pattern = pat;
    if (autostart && !this.started) {
      await this.start();
    }
  }
  setCps(cps = 0.5) {
    if (this.clockInCharge) {
      if (!this.warnedExternalCps) {
        logger('[cyclist] setcps ignored while following external clock', 'warning');
        this.warnedExternalCps = true;
      }
      return;
    }
    if (this.cps === cps) {
      return;
    }
    this.cps = cps;
    this.num_ticks_since_cps_change = 0;
  }
  log(begin, end, haps) {
    const onsets = haps.filter((h) => h.hasOnset());
    console.log(`${begin.toFixed(4)} - ${end.toFixed(4)} ${Array(onsets.length).fill('I').join('')}`);
  }
}
