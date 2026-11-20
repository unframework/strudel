import { logger } from '@strudel/core';

const IDLE = { phase: 'idle' };
const RECENT_MESSAGE_COUNT = 50;

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

    this._recentMessages = [];
    this._messageListeners = new Set();
    this._messageSeq = 0;
    this._learner = null;
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
   * @returns {Array<{ seq: number, type: 'cc' | 'noteon' | 'noteoff', channel: number, num: number, value: number }>}
   *   the latest messages from the current device, newest first
   */
  getRecentMessages() {
    return this._recentMessages;
  }

  /**
   * @param {function(): void} listener called after every incoming message
   * @returns {function(): void} unsubscribe
   */
  subscribeMessages(listener) {
    this._messageListeners.add(listener);
    return () => this._messageListeners.delete(listener);
  }

  /**
   * Hand the number of the next incoming message of a type to `onLearned`. Arming a new learner
   * disarms the previous one. The message still reaches the deck.
   * @param {'cc' | 'noteon'} type
   * @param {function(number): void} onLearned called with the CC or note number
   * @returns {{ isArmed: boolean, cancel: function(): void }}
   */
  learn(type, onLearned) {
    this._disarm();
    const learner = {
      type,
      onLearned,
      isArmed: true,
      cancel: () => this._learner === learner && this._disarm(),
    };
    this._learner = learner;
    return learner;
  }

  isLearning() {
    return this._learner !== null;
  }

  stopLearning() {
    this._disarm();
  }

  /**
   * Switch to another device, closing the current one.
   * @param {string} device MIDI input name, or '' for none
   */
  async setDevice(device) {
    const attempt = (this._attempt = {});
    this._closeInput();
    this._setRecentMessages([]);

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
    input.onMessage((type, channel, num, value) => {
      this._deck.receive(type, num, value);
      this._recordMessage({ type, channel, num, value });
      if (this._learner?.type === type) {
        const { onLearned } = this._learner;
        this._disarm();
        onLearned(num);
      }
    });
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

  _disarm() {
    if (this._learner) {
      this._learner.isArmed = false;
      this._learner = null;
    }
  }

  _recordMessage(message) {
    const recent = [{ seq: this._messageSeq++, ...message }, ...this._recentMessages];
    this._setRecentMessages(recent.slice(0, RECENT_MESSAGE_COUNT));
  }

  _setRecentMessages(messages) {
    this._recentMessages = messages;
    this._messageListeners.forEach((listener) => listener());
  }

  _setStatus(status) {
    this._status = status;
    this._listeners.forEach((listener) => listener());
  }
}
