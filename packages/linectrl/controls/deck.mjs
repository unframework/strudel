import { ControlLog } from './log.mjs';
import { lightFor } from './lights.mjs';

const LIT_VELOCITY = 127;
const REFRESH_MS = 20;
const READER_IDLE_CYCLES = 1;

/**
 * Mirror of the device shared by every sketch: each CC's latest value (`cc:12`) and a toggle per
 * button (`note:36`), persisted to storage, plus button lights rendered from those toggles.
 */
export class Deck {
  /**
   * @param {Object} storage `load()` and `save(values)` of the control key → value map
   * @param {Object} clock `now()` returns the current cycle, null while the transport is stopped
   * @param {number} channel MIDI channel for outgoing messages
   */
  constructor(storage, clock, channel) {
    this._storage = storage;
    this._clock = clock;
    this._channel = channel;

    this._controls = new Map();
    this._sentVelocities = new Map();
    this._output = null;
    this._refreshTimer = null;
    this._wasStarted = false;

    for (const [key, value] of Object.entries(storage.load())) {
      const [kind, num] = key.split(':');
      if (kind === 'cc' || kind === 'note') {
        this._ensureControl(kind, Number(num)).log.reset(value);
      }
    }
  }

  /**
   * @param {'cc' | 'note'} kind
   * @param {number} num CC or note number
   * @param {number} align cycles to align changes to, 0 for immediate
   * @returns {function(number): number} cycle → value
   */
  reader(kind, num, align) {
    const control = this._ensureControl(kind, num);
    return (cycle) => {
      this._syncTransport();
      control.readCycles.set(align, Math.max(control.readCycles.get(align) ?? cycle, cycle));
      return control.log.valueAt(cycle, align);
    };
  }

  /**
   * @param {'cc' | 'note'} kind
   * @param {number} num
   * @returns {number} latest value, 0 for an untouched control
   */
  value(kind, num) {
    return this._controls.get(controlKey(kind, num))?.log.value ?? 0;
  }

  /**
   * @param {'cc' | 'noteon' | 'noteoff'} type
   * @param {number} num CC or note number
   * @param {number} value raw 0-127
   */
  receive(type, num, value) {
    const now = this._syncTransport();

    // Hardware darkens the button on release
    if (type === 'noteoff') {
      this._sentVelocities.delete(num);
      return;
    }

    const { log } = this._ensureControl(type === 'cc' ? 'cc' : 'note', num);
    const next = type === 'cc' ? value / 127 : 1 - log.value;
    if (next === log.value) {
      return;
    }
    if (now === null) {
      log.reset(next);
    } else {
      log.record(now, next);
    }
    this._save();
  }

  /**
   * Start driving the device: restore fader and knob positions, then keep lights in sync.
   * @param {Object} output with `sendCC(cc, value, chan)` and `sendNote(note, velocity, chan)`
   */
  attach(output) {
    this.detach();
    this._output = output;

    for (const { kind, num, log } of this._controls.values()) {
      if (kind === 'cc') {
        output.sendCC(num, Math.round(log.value * 127), this._channel);
      }
    }

    this._refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  detach() {
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
    this._output = null;
    this._sentVelocities.clear();
  }

  refresh() {
    const now = this._syncTransport();

    for (const control of this._controls.values()) {
      const { kind, num, log, readCycles } = control;
      if (now !== null) {
        readCycles.forEach((cycle, align) => cycle < now - READER_IDLE_CYCLES && readCycles.delete(align));
        log.prune(now - Math.max(0, ...readCycles.keys()) - 1);
      }
      if (kind === 'note') {
        const isLit = log.value > 0;
        const isPending = now !== null && [...readCycles.keys()].some((align) => log.valueAt(now, align) !== log.value);
        this._sendLight(num, lightFor(isLit, isPending, now) ? LIT_VELOCITY : 0);
      }
    }
  }

  _sendLight(note, velocity) {
    if (this._sentVelocities.get(note) !== velocity) {
      this._output?.sendNote(note, velocity, this._channel);
      this._sentVelocities.set(note, velocity);
    }
  }

  _ensureControl(kind, num) {
    const key = controlKey(kind, num);
    if (!this._controls.has(key)) {
      this._controls.set(key, { kind, num, log: new ControlLog(0), readCycles: new Map() });
    }
    return this._controls.get(key);
  }

  // Cycle position restarts with the transport, so pending changes settle on every start/stop
  _syncTransport() {
    const now = this._clock.now();
    const isStarted = now !== null;
    if (isStarted !== this._wasStarted) {
      this._controls.forEach(({ log, readCycles }) => {
        log.collapse();
        readCycles.clear();
      });
      this._wasStarted = isStarted;
    }
    return now;
  }

  _save() {
    const values = {};
    for (const [key, { log }] of this._controls) {
      values[key] = log.value;
    }
    this._storage.save(values);
  }
}

function controlKey(kind, num) {
  return `${kind}:${num}`;
}
