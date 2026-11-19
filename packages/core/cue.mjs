import { Pattern, isPattern, reify } from './pattern.mjs';
import { getCps, getIsStarted, getTime } from './schedulerState.mjs';

const LOOKAHEAD_SECONDS = 0.1;
const ID_LENGTH = 4;

export const CUE_ID_SOURCE = `#[0-9a-z]{${ID_LENGTH}}`;
const idRegex = new RegExp(`^${CUE_ID_SOURCE}$`);

export const SETTLED = Object.freeze({ armedAt: -Infinity, at: -Infinity, ease: 0 });

export function isCueId(value) {
  return typeof value === 'string' && idRegex.test(value);
}

/** With align 0 the change is due as soon as the scheduler can play it. */
export function nextBoundary(cycle, align) {
  return align > 0 ? Math.ceil(cycle / align) * align : cycle;
}

/** Share of NEW heard at a cycle: 0 before the boundary, ramping to 1 over `ease` cycles. */
export function cueMix(cue, cycle) {
  if (cycle < cue.at) {
    return 0;
  }
  return cue.ease > 0 ? Math.min(1, (cycle - cue.at) / cue.ease) : 1;
}

/**
 * @returns {{ kind: 'waiting' | 'easing', progress: number } | { kind: 'settled' }}
 */
export function cuePhase(cue, cycle) {
  if (cycle < cue.at) {
    return { kind: 'waiting', progress: Math.max(0, (cycle - cue.armedAt) / (cue.at - cue.armedAt)) };
  }
  if (cycle < cue.at + cue.ease) {
    return { kind: 'easing', progress: cueMix(cue, cycle) };
  }
  return { kind: 'settled' };
}

/**
 * Timing of pending `.c()` changes for the current uninterrupted transport run, keyed by the ids
 * the editor writes into the code. Ids minted in this page session are never minted again.
 */
export class CueRun {
  /**
   * @param {Object} clock `now()` gives the cycle a change can safely start at, null while stopped
   * @param {function(): number} random
   */
  constructor(clock, random) {
    this.isMinting = false;
    this._clock = clock;
    this._random = random;
    this._minted = new Set();
    this._fresh = new Set();
    this._cues = new Map();
    this._wasStarted = false;
  }

  /** @param {Set<string>} taken ids already present in the code */
  mint(taken) {
    let id;
    do {
      id = `#${Math.floor(this._random() * 36 ** ID_LENGTH)
        .toString(36)
        .padStart(ID_LENGTH, '0')}`;
    } while (this._minted.has(id) || taken.has(id));
    this._minted.add(id);
    this._fresh.add(id);
    return id;
  }

  isClaimed(id) {
    return this._minted.has(id) && !this._fresh.has(id);
  }

  arm(id, ease, align) {
    if (!this._fresh.delete(id)) {
      return;
    }
    const now = this._syncTransport();
    if (now !== null) {
      this._cues.set(id, { armedAt: now, at: nextBoundary(now, align), ease });
    }
  }

  get(id) {
    this._syncTransport();
    return this._cues.get(id) ?? SETTLED;
  }

  // Cycle numbers restart with the transport, so pending changes settle on every start/stop
  _syncTransport() {
    const now = this._clock.now();
    const isStarted = now !== null;
    if (isStarted !== this._wasStarted) {
      this._cues.clear();
      this._wasStarted = isStarted;
    }
    return now;
  }
}

const schedulerClock = {
  now: () => (getIsStarted() ? getTime() + LOOKAHEAD_SECONDS * getCps() : null),
};

export const cueRun = new CueRun(schedulerClock, Math.random);

function lerp(from, to, mix) {
  return from + (to - from) * mix;
}

function blend(from, to, mix) {
  if (typeof from === 'number' && typeof to === 'number') {
    return lerp(from, to, mix);
  }
  if (from?.constructor !== Object || to?.constructor !== Object) {
    return to;
  }
  const blended = { ...to };
  for (const [key, value] of Object.entries(to)) {
    if (typeof value === 'number' && typeof from[key] === 'number') {
      blended[key] = lerp(from[key], value, mix);
    }
  }
  return blended;
}

const onsetOf = (hap) => Number(hap.wholeOrPart().begin);

export function cuePattern(run, id, older, newer) {
  return new Pattern((state) => {
    const cue = run.get(id);
    const before = older.query(state).filter((hap) => cueMix(cue, onsetOf(hap)) === 0);
    const after = newer.query(state).flatMap((hap) => {
      const mix = cueMix(cue, onsetOf(hap));
      if (mix === 0) {
        return [];
      }
      if (mix === 1) {
        return [hap];
      }
      const from = older.query(state.setSpan(hap.wholeOrPart()))[0];
      return [from ? hap.withValue((to) => blend(from.value, to, mix)) : hap];
    });
    return before.concat(after);
  });
}

function assertCycles(name, value, isValid) {
  if (typeof value !== 'number' || !isValid(value)) {
    throw new Error(`.c() expects ${name} as a number of cycles, got ${value}`);
  }
}

/**
 * Cues a change from this pattern to `next`, easing numeric values over `ease` cycles. The change
 * starts right away, or on the next multiple of `align` cycles after evaluation. The editor writes
 * an id into the call on first evaluation to remember the change across evaluations; without one,
 * `next` plays.
 *
 * @name c
 * @memberof Pattern
 * @tags temporal
 * @param {Pattern} next pattern to switch to
 * @param {number} ease cycles to ramp numeric values over, 0 for a hard switch
 * @param {number} align cycles to align the start to, e.g. 4 for the next 4-cycle boundary, 0 to start right away
 * @param {string} id written by the editor, after whichever of `ease` and `align` are given
 * @returns Pattern
 * @example
 * note("c2 eb2").s("sawtooth").lpf("800".c("2000", 2))
 */
Pattern.prototype.c = function (next, ...rest) {
  if (next === undefined) {
    throw new Error('.c() needs the pattern to change to, like "800".c("2000")');
  }
  const id = typeof rest.at(-1) === 'string' ? rest.pop() : undefined;
  const [ease = 1, align = 0] = rest;
  assertCycles('ease', ease, (v) => v >= 0);
  assertCycles('align', align, (v) => v >= 0);
  if (id === undefined) {
    return reify(next);
  }
  if (!isCueId(id)) {
    throw new Error(`.c() id must look like '#k3x9', got ${id}`);
  }
  cueRun.arm(id, ease, align);
  return cuePattern(cueRun, id, this, reify(next));
};

export function cueWithId(target, id, ...args) {
  if (!isPattern(target)) {
    return target.c(...args);
  }
  return target.c(...args, id);
}
