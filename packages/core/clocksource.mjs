/*
clocksource.mjs - helpers for following an external clock (e.g. MIDI clock) in the Cyclist scheduler
Copyright (C) 2026 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/core/clocksource.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { logger } from './logger.mjs';

// a clock source exposes: cycleAt(time), timeAt(cycle), isRunning(now), optional isStopped(),
// and fields cps, generation (bumped on every jump), jumpCycle, catchup (seconds)

export function anchorCycle(source, now) {
  const here = source.cycleAt(now);
  const jump = source.jumpCycle;
  if (jump === undefined) {
    return here;
  }
  const jumpAge = now - source.timeAt(jump);
  if (jumpAge > (source.catchup ?? 0)) {
    return here;
  }
  if (jump < here) {
    logger(`[cyclist] external clock jumped back to cycle ${jump.toFixed(2)}`);
  }
  return jump;
}

export function catchUpTime(hap, targetTime, now, jumpCycle, minLatency) {
  if (targetTime - now > minLatency) {
    return targetTime;
  }
  if (targetTime >= now || hap.whole.begin.valueOf() === jumpCycle) {
    return now + minLatency;
  }
  return undefined;
}
