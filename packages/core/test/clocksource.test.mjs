/*
clocksource.test.mjs - Tests for external clock source helpers
Copyright (C) 2026 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/core/test/clocksource.test.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { describe, expect, it } from 'vitest';
import { anchorCycle, catchUpTime } from '../clocksource.mjs';

const hapAt = (cycle) => ({ whole: { begin: { valueOf: () => cycle } } });

describe('anchorCycle', () => {
  const source = (jumpCycle) => ({
    jumpCycle,
    catchup: 0.2,
    cycleAt: (t) => t, // 1 cycle per second for the test
    timeAt: (c) => c,
  });

  it('honors a recent jump', () => {
    expect(anchorCycle(source(0), 0.1)).toBe(0);
  });
  it('ignores a stale jump and returns the live position', () => {
    expect(anchorCycle(source(0), 5)).toBe(5);
  });
  it('returns the live position when there is no jump', () => {
    expect(anchorCycle(source(undefined), 3)).toBe(3);
  });
});

describe('catchUpTime', () => {
  const minLatency = 0.01;
  it('schedules at its own time when there is margin ahead', () => {
    expect(catchUpTime(hapAt(2), 10.5, 10, 0, minLatency)).toBe(10.5);
  });
  it('fires immediately when due within the latency margin', () => {
    expect(catchUpTime(hapAt(2), 10.005, 10, 0, minLatency)).toBe(10 + minLatency);
  });
  it('fires the downbeat immediately even if slightly late', () => {
    expect(catchUpTime(hapAt(0), 9.9, 10, 0, minLatency)).toBe(10 + minLatency);
  });
  it('drops a non-downbeat onset that is too late', () => {
    expect(catchUpTime(hapAt(2), 9.9, 10, 0, minLatency)).toBe(undefined);
  });
});
