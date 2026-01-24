import { ViewPlugin } from '@codemirror/view';
import { Terminal } from '@xterm/xterm';
import { setMiniLocations, showMiniLocations } from './highlight.mjs';

import '@xterm/xterm/css/xterm.css';

const SERIAL_PORT = 'COM17';
const SERIAL_SPEED = '57600';

const LINE_PREFIX_WIDTH = 3; // Width of line number prefix

/**
 * TTY Mirror Plugin
 * Captures CodeMirror state for remote terminal display
 */
class TTYMirrorView {
  constructor(view) {
    this.view = view;

    this.dirtyBuffer = false; // Whether the buffer needs to be flushed
    this.flushPaused = false; // Whether flushing is paused (XOFF)

    // Virtual text mode buffer params
    this.termTop = 0; // Top line number (0-indexed)
    this.termLeft = 0; // Left column offset (0-indexed)
    this.termWidth = 80; // Terminal width in columns
    this.termHeight = 24; // Terminal height in rows

    this.lines = [];
    this.lineAttrs = [];
    this.lineRanges = [];
    this.visTop = null; // Visible cursor row in terminal viewport
    this.visLeft = null; // Visible cursor column in terminal viewport

    this.miniLocations = []; // Current mini locations from highlight plugin

    // Last rendered state (for diff-based rendering)
    this.lastTermTop = null;
    this.lastTermLeft = null;
    this.lastLines = []; // Array of strings, one per terminal row
    this.lastLineAttrs = []; // Array of attribute arrays, one per terminal row
    this.lastCursorRow = null; // Terminal row (0-indexed)
    this.lastCursorCol = null; // Terminal column (0-indexed)

    console.log('[TTY] Plugin initialized');

    // Connect to JSON Serial Server
    this.setupWebsocket();

    // Create xterm.js terminal for debug display
    this.setupXterm();

    this.constrainTerminalViewport(view);
    this.render(view);
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
    this.terminal = new Terminal({
      rows: this.termHeight,
      cols: this.termWidth,
      theme: {
        background: '#000000',
        foreground: '#ffffff',
      },
    });

    this.terminal.open(this.xtermContainer);

    // Clear screen and initialize
    this.clearScreen();
  }

  setupWebsocket() {
    this.wsBuffer = [];
    this.sendId = 1;

    const wsUrl = 'ws://localhost:8989/ws';
    console.log('[TTY] Connecting to JSON Serial Server:', wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[TTY] WebSocket connected');
      this.ws.send(`open ${SERIAL_PORT} ${SERIAL_SPEED}`);
    };

    this.ws.onclose = (event) => {
      console.log('[TTY] WebSocket closed:', event.code, event.reason);
    };

    this.ws.onerror = (error) => {
      console.error('[TTY] WebSocket error:', error);
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

    console.log('[TTY] Handling remote message:', message);
    // TODO: Handle messages from remote terminal
  }

  sendToRemote(data) {
    this.wsBuffer.push(data);
  }

  flushRemote() {
    const data = this.wsBuffer.join('');
    this.wsBuffer = [];

    // console.log('[TTY] Flushing', data.length, 'bytes');

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const payload = {
        P: SERIAL_PORT,
        Data: [{ D: data, Id: `send-${this.sendId++}` }],
      };
      this.ws.send('sendjson ' + JSON.stringify(payload));
    }
  }

  // ANSI escape code helpers
  write(str) {
    this.terminal.write(str);
    this.sendToRemote(str);
  }

  writeCursorPos(row, col) {
    // ANSI cursor positioning is 1-indexed
    this.write(`\x1b[${row + 1};${col + 1}H`);
  }

  clearScreen() {
    this.write('\x1b[2J');
    this.flushRemote();
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

  constrainTerminalViewport(view) {
    const { state } = view;

    const cursor = state.selection.main.head;
    const cursorLine = state.doc.lineAt(cursor);
    const cursorLineIdx = cursorLine.number - 1; // Convert to 0-indexed
    const cursorCol = cursor - cursorLine.from;

    if (this.termTop + this.termHeight <= cursorLineIdx) {
      this.termTop = cursorLineIdx - this.termHeight + 1;
    }

    if (this.termTop > cursorLineIdx) {
      this.termTop = cursorLineIdx;
    }

    if (this.termLeft + this.termWidth <= cursorCol) {
      this.termLeft = cursorCol - this.termWidth + 1;
    }

    if (this.termLeft > cursorCol) {
      this.termLeft = cursorCol;
    }
  }

  update(update) {
    // Check for highlight effects
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setMiniLocations)) {
          console.log('[TTY] setMiniLocations effect:', effect.value);
        }
        if (effect.is(showMiniLocations)) {
          this.updateMiniLocations(effect.value.haps);
          // this.miniLocations = effect.value.haps.flatMap((hap) => hap.context?.locations || []);
          // console.log('[TTY] showMiniLocations effect:', effect.value.atTime, this.miniLocations);
          this.flush();
        }
      }
    }

    if (update.docChanged) {
      console.log('[TTY] Document changed');
      console.log('[TTY] New doc length:', update.state.doc.length);

      this.constrainTerminalViewport(update.view);
      this.render(update.view);
      this.flush();
    }

    if (update.selectionSet) {
      const cursor = update.state.selection.main.head;
      const cursorLine = update.state.doc.lineAt(cursor);
      console.log('[TTY] Cursor at char:', cursor, 'line:', cursorLine.number, 'col:', cursor - cursorLine.from);

      this.constrainTerminalViewport(update.view);
      this.render(update.view);
      this.flush();
    }
  }

  render(view) {
    this.dirtyBuffer = true;

    const { state } = view;

    const terminalBottom = Math.min(this.termTop + this.termHeight, state.doc.lines);
    this.lines = [];
    this.lineAttrs = [];
    this.lineRanges = [];
    for (let lineIdx = this.termTop; lineIdx < terminalBottom; lineIdx++) {
      const fullLine = state.doc.line(lineIdx + 1);
      const prefix = String(lineIdx + 1).padStart(LINE_PREFIX_WIDTH, ' ');
      const clipped = (prefix + fullLine.text).slice(this.termLeft, this.termLeft + this.termWidth);
      const attrs = [7, 7, 7]; // Inverted for line number prefix
      this.lines.push(clipped);
      this.lineAttrs.push(attrs);
      this.lineRanges.push([fullLine.from, fullLine.to]);
    }

    // Show cursor at CodeMirror cursor position (if visible in viewport)
    const cursor = state.selection.main.head;
    const cursorLine = state.doc.lineAt(cursor);
    const cursorLineIdx = cursorLine.number - 1;
    const cursorCol = cursor - cursorLine.from;

    this.visTop = cursorLineIdx - this.termTop;
    this.visLeft = cursorCol - this.termLeft;
  }

  updateMiniLocations(haps) {
    this.dirtyBuffer = true;

    for (let i = 0; i < this.termHeight; i++) {
      if (!this.lineAttrs[i]) {
        this.lineAttrs[i] = [7, 7, 7];
        continue;
      }
      this.lineAttrs[i].length = LINE_PREFIX_WIDTH; // Clear content attrs
    }

    for (const hap of haps) {
      const locations = hap.context?.locations;
      if (!locations) {
        continue;
      }

      if (!Array.isArray(locations)) {
        console.warn('[TTY] mini location is not an array:', locations);
      }

      for (const { start, end } of locations) {
        for (let lineIdx = 0; lineIdx < this.termHeight; lineIdx++) {
          const [lineFrom, lineTo] = this.lineRanges[lineIdx] || [0, 0];
          if (start >= lineTo || end <= lineFrom) {
            continue; // No overlap
          }

          const attrs = this.lineAttrs[lineIdx];

          const attrStart = LINE_PREFIX_WIDTH + Math.max(0, start - lineFrom);
          const attrEnd = LINE_PREFIX_WIDTH + Math.min(lineTo - lineFrom, end - lineFrom);

          for (let col = attrStart; col < attrEnd; col++) {
            attrs[col] = 7; // Underline attribute
          }
        }
      }
    }
    // console.log('[TTY] Updated mini locations:', this.lineAttrs);
  }

  flush() {
    if (!this.dirtyBuffer) {
      return;
    }

    if (this.flushPaused) {
      return;
    }
    // console.log('[TTY] Flushing terminal display');

    // Update xterm display using ANSI escape codes
    this.hideCursor();

    // Vertical scroll optimization: if horizontal offset unchanged, use ANSI scroll
    if (this.lastTermLeft === this.termLeft && this.lastTermTop !== null) {
      const delta = this.termTop - this.lastTermTop;

      if (delta > 0 && delta < this.termHeight) {
        // Scrolled down in document - delete lines from top
        this.writeCursorHome();
        this.writeInsertLine(-delta);
        // Shift lastFullLines up, fill bottom with blanks
        this.lastLines.splice(0, delta);
        this.lastLineAttrs.splice(0, delta);
        for (let i = 0; i < delta; i++) {
          this.lastLines.push('');
          this.lastLineAttrs.push([]);
        }
      } else if (delta < 0 && -delta < this.termHeight) {
        // Scrolled up in document - insert lines at top
        this.writeCursorHome();
        this.writeInsertLine(-delta);
        // Shift lastFullLines down, fill top with blanks
        this.lastLines.splice(this.termHeight + delta);
        this.lastLineAttrs.splice(this.termHeight + delta);
        for (let i = 0; i < -delta; i++) {
          this.lastLines.unshift('');
          this.lastLineAttrs.unshift([]);
        }
      }
    }

    // Render each line at its position (skip unchanged lines)
    for (let i = 0; i < this.termHeight; i++) {
      const line = this.lines[i] || '';
      const attrs = this.lineAttrs[i] || [];
      const lastLine = this.lastLines[i] || '';
      const lastAttrs = this.lastLineAttrs[i] || [];

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
        console.log('line', i, 'col', start, 'to', end, 'attr', attr, 'text:', line.slice(start, j));
        this.writeCursorPos(i, start);

        // Set attributes (only handling inverted for now)
        if (attr === 7) {
          this.write('\x1b[7m'); // Inverted
        } else {
          this.write('\x1b[0m'); // Normal
        }

        this.write(line.slice(start, end));
      }

      // erase tail if new line is shorter than last line
      const eraseChars = lastLine.length - line.length;
      if (eraseChars > 0) {
        // console.log('line', i, 'erase', eraseChars);
        this.writeCursorPos(i, line.length);
        this.writeEraseChars(eraseChars);
      }

      this.lastLines[i] = line;
      this.lastLineAttrs[i] = attrs;
    }

    this.lastTermTop = this.termTop;
    this.lastTermLeft = this.termLeft;

    this.lastCursorRow = null;
    this.lastCursorCol = null;

    if (this.visTop >= 0 && this.visTop < this.termHeight && this.visLeft >= 0 && this.visLeft < this.termWidth) {
      this.writeCursorPos(this.visTop, this.visLeft + LINE_PREFIX_WIDTH);
      this.showCursor();

      this.lastCursorRow = this.visTop;
      this.lastCursorCol = this.visLeft;
    }

    this.dirtyBuffer = false;
    this.flushRemote();
  }

  destroy() {
    console.log('[TTY] Plugin destroyed');

    this.ws.close();

    this.terminal.dispose();
    this.xtermContainer.parentNode.removeChild(this.xtermContainer);
  }
}

export const ttyMirrorPlugin = ViewPlugin.fromClass(TTYMirrorView);
