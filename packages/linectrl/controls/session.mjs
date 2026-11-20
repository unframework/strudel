import { logger } from '@strudel/core';

const IDLE = { phase: 'idle' };

/**
 * Which controller drives the deck, and whether it is connected.
 *
 * Status is `{ phase: 'idle' } | { phase: 'waiting', device } | { phase: 'connected', device }
 * | { phase: 'unavailable', device, error }`.
 */
export class ControllerSession {
  /**
   * @param {Deck} deck
   * @param {function(string): Promise<Object>} openInput device name → single-use input handle with
   *   `onMessage`, `onConnectionChange`, `isConnected`, `close`, and the deck's output methods
   */
  constructor(deck, openInput) {
    this._deck = deck;
    this._openInput = openInput;

    this._status = IDLE;
    this._listeners = new Set();
    this._input = null;
    this._attempt = null;
  }

  getStatus() {
    return this._status;
  }

  /**
   * @param {function(): void} listener called after every status change
   * @returns {function(): void} unsubscribe
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Switch to another device, closing the current one.
   * @param {string} device MIDI input name, or '' for none
   */
  async setDevice(device) {
    const attempt = (this._attempt = {});
    this._closeInput();

    if (device === '') {
      this._setStatus(IDLE);
      return;
    }
    this._setStatus({ phase: 'waiting', device });

    let input;
    try {
      input = await this._openInput(device);
    } catch (err) {
      if (attempt === this._attempt) {
        logger(`[linectrl] ${device} unavailable, controls play stored values: ${err.message}`, 'warning');
        this._setStatus({ phase: 'unavailable', device, error: err.message });
      }
      return;
    }

    if (attempt !== this._attempt) {
      input.close();
      return;
    }

    const onConnectionChange = (isConnected) => {
      isConnected ? this._deck.attach(input) : this._deck.detach();
      this._setStatus({ phase: isConnected ? 'connected' : 'waiting', device });
    };

    this._input = input;
    input.onMessage((type, _chan, num, value) => this._deck.receive(type, num, value));
    input.onConnectionChange(onConnectionChange);
    if (input.isConnected) {
      onConnectionChange(true);
    }
  }

  /**
   * Push stored knob and fader positions to the device and repaint every light.
   */
  resync() {
    if (this._status.phase !== 'connected') {
      throw new Error(`[linectrl] cannot resync while ${this._status.phase}`);
    }
    this._deck.attach(this._input);
  }

  _closeInput() {
    if (this._input) {
      this._input.close();
      this._deck.detach();
      this._input = null;
    }
  }

  _setStatus(status) {
    this._status = status;
    this._listeners.forEach((listener) => listener());
  }
}
