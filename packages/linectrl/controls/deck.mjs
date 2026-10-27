import { ControlLog } from './log.mjs';
import { lightFor } from './lights.mjs';

const LIT_VELOCITY = 127;
const REFRESH_MS = 20;

// Next value of a control for an incoming message, or undefined when the message is not for it.
const reducers = {
  in: ([cc], log, type, num, value) => (type === 'cc' && num === cc ? value / 127 : undefined),
  btn: ([note], log, type, num) => (type === 'noteon' && num === note ? 1 - log.value : undefined),
  push: ([note], log, type, num) => (num === note ? { noteon: 1, noteoff: 0 }[type] : undefined),
  radio: (notes, log, type, num) => (type === 'noteon' && notes.includes(num) ? notes.indexOf(num) : undefined),
};

/**
 * Controller state shared by every sketch: one log per control (`in:12`, `btn:1`, `radio:12,13,14`),
 * persisted to storage, plus button lights rendered from those logs.
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
    this._lights = new Map(); // note → { control, member, align }, last registration wins
    this._sentVelocities = new Map();
    this._output = null;
    this._refreshTimer = null;
    this._wasStarted = false;

    for (const [key, value] of Object.entries(storage.load())) {
      const [kind, addrText] = key.split(':');
      if (kind in reducers) {
        this._controls.set(key, createControl(kind, addrText.split(',').map(Number), value));
      }
    }
  }

  /**
   * Register a control for reading and return its reader.
   * @param {'in' | 'btn' | 'push' | 'radio'} kind
   * @param {number[]} addr CC number, or note numbers
   * @param {number} align cycles to align changes to, 0 for immediate
   * @returns {function(number): number} cycle → value
   */
  control(kind, addr, align) {
    const key = `${kind}:${addr.join(',')}`;
    if (!this._controls.has(key)) {
      this._controls.set(key, createControl(kind, addr, 0));
    }
    const control = this._controls.get(key);
    control.maxAlign = Math.max(control.maxAlign, align);

    if (kind !== 'in') {
      addr.forEach((note, index) => {
        this._lights.set(note, { control, member: kind === 'radio' ? index : null, align });
      });
    }

    return (cycle) => {
      this._syncTransport();
      return control.log.valueAt(cycle, align);
    };
  }

  /**
   * @param {'cc' | 'noteon' | 'noteoff'} type
   * @param {number} num CC or note number
   * @param {number} value raw 0-127
   */
  receive(type, num, value) {
    const now = this._syncTransport();

    let isChanged = false;
    for (const control of this._controls.values()) {
      const next = reducers[control.kind](control.addr, control.log, type, num, value);
      if (next === undefined || next === control.log.value) {
        continue;
      }
      if (now === null) {
        control.log.reset(next);
      } else {
        control.log.record(now, next);
      }
      isChanged = true;
    }

    // Hardware darkens the button on release
    if (type === 'noteoff') {
      this._sentVelocities.delete(num);
    }

    if (isChanged) {
      this._save();
    }
  }

  /**
   * Start driving the device: restore fader and knob positions, then keep lights in sync.
   * @param {Object} output with `sendCC(cc, value, chan)` and `sendNote(note, velocity, chan)`
   */
  attach(output) {
    this.detach();
    this._output = output;

    for (const control of this._controls.values()) {
      if (control.kind === 'in') {
        output.sendCC(control.addr[0], Math.round(control.log.value * 127), this._channel);
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

    if (now !== null) {
      for (const control of this._controls.values()) {
        control.log.prune(now - control.maxAlign - 1);
      }
    }

    for (const [note, { control, member, align }] of this._lights) {
      const isLit = (value) => (member === null ? value > 0 : value === member);
      const raw = isLit(control.log.value);
      const settled = now === null ? raw : isLit(control.log.valueAt(now, align));
      const velocity = lightFor(raw, settled, now) ? LIT_VELOCITY : 0;

      if (this._sentVelocities.get(note) !== velocity) {
        this._output?.sendNote(note, velocity, this._channel);
        this._sentVelocities.set(note, velocity);
      }
    }
  }

  // Cycle position restarts with the transport, so pending changes settle on every start/stop
  _syncTransport() {
    const now = this._clock.now();
    const isStarted = now !== null;
    if (isStarted !== this._wasStarted) {
      this._controls.forEach((control) => control.log.collapse());
      this._wasStarted = isStarted;
    }
    return now;
  }

  _save() {
    const values = {};
    for (const [key, control] of this._controls) {
      values[key] = control.log.value;
    }
    this._storage.save(values);
  }
}

function createControl(kind, addr, value) {
  return { kind, addr, log: new ControlLog(value), maxAlign: 0 };
}
