import { Terminal as XTerm } from '@xterm/xterm';

import '@xterm/xterm/css/xterm.css';

const SERIAL_PORT = 'COM17';
const SERIAL_SPEED = '57600';

/**
 * Attr values are bitfields:
 *  bit 0: inverted
 *  bit 1: bold
 *  bit 2: underline
 */
export const ATTR_INVERTED = 1 << 0;
export const ATTR_BOLD = 1 << 1;
export const ATTR_UNDERLINE = 1 << 2;

/**
 * Low-level terminal rendering layer
 * Handles connections, ANSI escape codes, and diff-based rendering
 */
export class Terminal {
  constructor() {
    this.dirtyBuffer = false; // Whether the buffer needs to be flushed
    this.flushPaused = false; // Whether flushing is paused (XOFF)

    // Terminal viewport params
    this.termTop = 0; // Top line number (0-indexed)
    this.termLeft = 0; // Left column offset (0-indexed)
    this.termWidth = 80; // Terminal width in columns
    this.termHeight = 24; // Terminal height in rows

    // Virtual text buffer (fixed-size 2D matrix)
    this.lines = [];
    this.lineAttrs = [];
    for (let i = 0; i < this.termHeight; i++) {
      this.lines.push(' '.repeat(this.termWidth));
      this.lineAttrs.push(new Array(this.termWidth).fill(0));
    }

    // Last rendered state (for diff-based rendering)
    this.lastTermTop = null;
    this.lastTermLeft = null;
    this.lastLines = []; // Array of strings, one per terminal row
    this.lastLineAttrs = []; // Array of attribute arrays, one per terminal row

    for (let i = 0; i < this.termHeight; i++) {
      this.lastLines.push('');
      this.lastLineAttrs.push(new Array(this.termWidth).fill(0));
    }

    this.lastCursorRow = null; // Terminal row (0-indexed)
    this.lastCursorCol = null; // Terminal column (0-indexed)

    console.log('[Terminal] Initialized');

    // Connect to JSON Serial Server
    this.setupWebsocket();

    // Create xterm.js terminal for debug display
    this.setupXterm();

    this.clearScreen();
  }

  setupXterm() {
    // Create container div
    this.xtermContainer = document.createElement('div');
    this.xtermContainer.style.position = 'fixed';
    this.xtermContainer.style.bottom = '10px';
    this.xtermContainer.style.right = '10px';
    this.xtermContainer.style.zIndex = '10000';
    this.xtermContainer.style.border = '2px solid #555';
    this.xtermContainer.style.borderRadius = '4px';
    this.xtermContainer.style.backgroundColor = '#000';
    document.body.appendChild(this.xtermContainer);

    // Create terminal instance
    this.xterm = new XTerm({
      rows: this.termHeight,
      cols: this.termWidth,
      theme: {
        background: '#000000',
        foreground: '#ffffff',
      },
    });

    this.xterm.open(this.xtermContainer);
  }

  setupWebsocket() {
    this.wsBuffer = [];
    this.sendId = 1;

    const wsUrl = 'ws://localhost:8989/ws';
    console.log('[Terminal] Connecting to JSON Serial Server:', wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[Terminal] WebSocket connected');
      this.ws.send(`open ${SERIAL_PORT} ${SERIAL_SPEED}`);
    };

    this.ws.onclose = (event) => {
      console.log('[Terminal] WebSocket closed:', event.code, event.reason);
    };

    this.ws.onerror = (error) => {
      console.error('[Terminal] WebSocket error:', error);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleRemoteMessage(message);
      } catch (_err) {
        // Ignore non-JSON messages (echoed from client usually)
      }
    };
  }

  handleRemoteMessage(message) {
    if (message.P !== SERIAL_PORT) {
      return;
    }

    if (message.Cmd === 'Write' || message.Cmd === 'Queued' || message.Cmd === 'CompleteFake') {
      return;
    }

    if (message.Cmd === undefined) {
      if (message.D === '\x11') {
        // XON
        this.flushPaused = false;
        this.flush();
      } else if (message.D === '\x13') {
        // XOFF
        this.flushPaused = true;
      }
      return;
    }

    console.log('[Terminal] Handling remote message:', message);
    // TODO: Handle messages from remote terminal
  }

  sendToRemote(data) {
    this.wsBuffer.push(data);
  }

  flushRemote() {
    if (this.ws.readyState === WebSocket.OPEN) {
      const data = this.wsBuffer.join('');
      this.wsBuffer.length = 0;

      const payload = {
        P: SERIAL_PORT,
        Data: [{ D: data, Id: `send-${this.sendId++}` }],
      };
      this.ws.send('sendjson ' + JSON.stringify(payload));
    } else if (this.ws.readyState === WebSocket.CLOSED) {
      this.wsBuffer.length = 0;
    }
  }

  // ANSI escape code helpers
  write(str) {
    this.xterm.write(str);
    this.sendToRemote(str);
  }

  writeCursorPos(row, col) {
    // ANSI cursor positioning is 1-indexed
    this.write(`\x1b[${row + 1};${col + 1}H`);
  }

  clearScreen() {
    this.hideCursor();
    this.write('\x1b[2J');
    this.writeCursorHome();
    this.writeScrollRegion(0, this.termHeight - 1);
    this.flushRemote();
  }

  writeEraseChars(n) {
    this.write(`\x1b[${n}X`);
  }

  hideCursor() {
    this.write('\x1b[?25l');
  }

  showCursor() {
    this.write('\x1b[?25h');
  }

  saveCursor() {
    this.write('\x1b[s');
  }

  writeCursorHome() {
    this.write('\x1b[H');
  }

  writeScrollRegion(top, bottom) {
    this.write(`\x1b[${top + 1};${bottom + 1}r`);
  }

  writeInsertLine(delta) {
    if (delta > 0) {
      this.write(`\x1b[${delta}L`); // Insert lines
    } else if (delta < 0) {
      this.write(`\x1b[${-delta}M`); // Delete lines
    }
  }

  writeScroll(delta) {
    if (delta > 0) {
      this.write(`\x1b[${delta}S`); // Scroll up
    } else if (delta < 0) {
      this.write(`\x1b[${-delta}T`); // Scroll down
    }
  }

  restoreCursor() {
    this.write('\x1b[u');
  }

  writeAttrs(attr) {
    // Set attributes (only handling inverted for now)
    this.write('\x1b[0');
    if (attr & ATTR_INVERTED) {
      this.write(';7');
    }
    if (attr & ATTR_BOLD) {
      this.write(';1');
    }
    if (attr & ATTR_UNDERLINE) {
      this.write(';4');
    }
    this.write('m');
  }

  // === Buffer Mutation API ===

  /**
   * Set viewport position (for scroll optimization)
   */
  setXY(x, y) {
    this.termLeft = x;
    this.termTop = y;
  }

  /**
   * Write a string at position with a uniform attribute
   */
  fillString(x, y, str, attr) {
    if (y < 0 || y >= this.termHeight) return;
    if (x < 0) {
      str = str.slice(-x);
      x = 0;
    }
    if (x >= this.termWidth) return;

    str = str.slice(0, this.termWidth - x);

    // Splice string into line
    const line = this.lines[y];
    this.lines[y] = line.slice(0, x) + str + line.slice(x + str.length);

    // Fill attrs
    const attrs = this.lineAttrs[y];
    for (let i = 0; i < str.length; i++) {
      attrs[x + i] = attr;
    }

    this.dirtyBuffer = true;
  }

  /**
   * Update attribute value bits over a range. Sets or clears based on attrBits mask.
   */
  fillAttrBits(x, y, attrBits, isOn, len) {
    if (y < 0 || y >= this.termHeight) return;
    if (x < 0) {
      len += x;
      x = 0;
    }
    if (x >= this.termWidth) return;
    if (len <= 0) return;

    const attrs = this.lineAttrs[y];
    const end = Math.min(x + len, this.termWidth);
    if (isOn) {
      for (let i = x; i < end; i++) {
        attrs[i] |= attrBits;
      }
    } else {
      const mask = ~attrBits;
      for (let i = x; i < end; i++) {
        attrs[i] &= mask;
      }
    }

    this.dirtyBuffer = true;
  }

  flush() {
    if (!this.dirtyBuffer) {
      return;
    }

    if (this.flushPaused) {
      return;
    }

    // Vertical scroll optimization: if horizontal offset unchanged, use ANSI scroll
    if (this.lastTermLeft === this.termLeft && this.lastTermTop !== null) {
      const delta = this.termTop - this.lastTermTop;

      if (delta > 0 && delta < this.termHeight) {
        // Scrolled down in document - delete lines from top
        this.writeCursorHome();
        this.writeInsertLine(-delta);
        // Shift lastFullLines up, fill bottom with blanks
        for (let i = 0; i < delta; i++) {
          this.lastLines.push(' '.repeat(this.termWidth));
          this.lastLineAttrs.push(new Array(this.termWidth).fill(0));
        }
      } else if (delta < 0 && -delta < this.termHeight) {
        // Scrolled up in document - insert lines at top
        this.writeCursorHome();
        this.writeInsertLine(-delta);
        // Shift lastFullLines down, fill top with blanks
        this.lastLines.splice(this.termHeight + delta);
        this.lastLineAttrs.splice(this.termHeight + delta);
        for (let i = 0; i < -delta; i++) {
          this.lastLines.unshift(' '.repeat(this.termWidth));
          this.lastLineAttrs.unshift(new Array(this.termWidth).fill(0));
        }
      }
    }

    // Render each line at its position (skip unchanged lines)
    for (let i = 0; i < this.termHeight; i++) {
      const line = this.lines[i];
      const attrs = this.lineAttrs[i];
      const lastLine = this.lastLines[i];
      const lastAttrs = this.lastLineAttrs[i];

      const scanLength = line.length;

      // scan through for deltas
      for (let j = 0; j < scanLength; ) {
        const attr = attrs[j] || 0;

        if (line[j] === lastLine[j] && attr === (lastAttrs[j] || 0)) {
          j++;
          continue;
        }

        // collect a span that extends while new attr is same, but until chars+attrs match again
        // (and lookahead to avoid breaking on eg single spaces)
        const start = j;
        let sameCount = 0;
        do {
          j++;
          if (j >= scanLength) {
            break;
          }

          if ((attrs[j] || 0) !== attr) {
            break;
          }
          if (line[j] === lastLine[j] && attr === (lastAttrs[j] || 0)) {
            if (sameCount > 2) {
              // enough matches to break on
              break;
            }
            sameCount++;
          } else {
            sameCount = 0;
          }
        } while (true);

        const end = j - sameCount;

        // write the span
        this.writeCursorPos(i, start);
        this.writeAttrs(attr);
        this.write(line.slice(start, end));
        for (let k = start; k < end; k++) {
          lastAttrs[k] = attr;
        }
      }

      // erase tail if new line is shorter than last line
      const eraseChars = lastLine.length - line.length;
      if (eraseChars > 0) {
        this.writeCursorPos(i, line.length);
        this.writeEraseChars(eraseChars);
        lastAttrs.length = line.length;
      }

      this.lastLines[i] = line;
    }

    this.lastTermTop = this.termTop;
    this.lastTermLeft = this.termLeft;

    this.lastCursorRow = null;
    this.lastCursorCol = null;

    this.dirtyBuffer = false;
    this.flushRemote();
  }

  destroy() {
    console.log('[Terminal] Destroyed');

    this.ws.close();

    this.xterm.dispose();
    this.xtermContainer.parentNode.removeChild(this.xtermContainer);
  }
}
