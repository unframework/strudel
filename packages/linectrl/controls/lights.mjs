const BEATS_PER_CYCLE = 4;

const isOnBeat = (cycle) => (cycle * BEATS_PER_CYCLE) % 1 < 0.5;

/**
 * Button light scheme: steady when settled, pulsing on the beat while a change is pending.
 * @param {boolean} isLit latest toggle state
 * @param {boolean} isPending whether a reader has yet to hear it, only while the transport runs
 * @param {number | null} cycle current cycle, null while the transport is stopped
 * @returns {boolean} whether the LED is lit
 */
export function lightFor(isLit, isPending, cycle) {
  return isPending ? isOnBeat(cycle) : isLit;
}
