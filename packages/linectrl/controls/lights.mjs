const BEATS_PER_CYCLE = 4;

const isOnBeat = (cycle) => (cycle * BEATS_PER_CYCLE) % 1 < 0.5;

/**
 * Button light scheme: steady when settled, pulsing on the beat while a change is pending.
 * @param {boolean} raw latest pressed state
 * @param {boolean} settled state currently heard (after alignment)
 * @param {number | null} cycle current cycle, null while the transport is stopped
 * @returns {boolean} whether the LED is lit
 */
export function lightFor(raw, settled, cycle) {
  if (raw === settled || cycle === null) {
    return raw;
  }
  return isOnBeat(cycle);
}
