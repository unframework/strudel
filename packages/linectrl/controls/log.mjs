export function alignStamp(stamp, align) {
  return align > 0 ? Math.ceil(stamp / align) * align : stamp;
}

/**
 * Value history of one control, stamped in cycles. Alignment is applied at read time, so the
 * same input can be heard immediately by one reader and on the next half-bar by another.
 */
export class ControlLog {
  constructor(value) {
    this.base = value;
    this.events = [];
  }

  get value() {
    return this.events.at(-1)?.value ?? this.base;
  }

  record(stamp, value) {
    if (this.events.length && stamp < this.events.at(-1).stamp) {
      this.collapse();
    }
    this.events.push({ stamp, value });
  }

  reset(value) {
    this.base = value;
    this.events = [];
  }

  collapse() {
    this.reset(this.value);
  }

  valueAt(cycle, align) {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (alignStamp(event.stamp, align) <= cycle) {
        return event.value;
      }
    }
    return this.base;
  }

  prune(before) {
    const keepFrom = this.events.findIndex((event) => event.stamp > before);
    const settledCount = keepFrom === -1 ? this.events.length : keepFrom;
    if (settledCount > 0) {
      this.base = this.events[settledCount - 1].value;
      this.events = this.events.slice(settledCount);
    }
  }
}
