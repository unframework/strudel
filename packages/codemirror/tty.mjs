import { ViewPlugin } from '@codemirror/view';
import { Terminal } from '@xterm/xterm';

import '@xterm/xterm/css/xterm.css';

/**
 * TTY Mirror Plugin
 * Captures CodeMirror state for remote terminal display
 */
class TTYMirrorView {
  constructor(view) {
    this.view = view;

    // Virtual text mode buffer params
    this.termTop = 0; // Top line number (0-indexed)
    this.termLeft = 0; // Left column offset (0-indexed)
    this.termWidth = 80; // Terminal width in columns
    this.termHeight = 24; // Terminal height in rows

    // Last rendered state (for diff-based rendering)
    this.lastTermTop = null;
    this.lastTermLeft = null;
    this.lastLines = []; // Array of strings, one per terminal row
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
      this.ws.send('open COM16 57600');
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
    if (message.Cmd === 'Write' || message.Cmd === 'CompleteFake') {
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

    console.log('[TTY] Flushing', data.length, 'bytes');

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const payload = {
        P: 'COM16',
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
    this.write('\x1b[H'); // Move cursor to home
  }

  clearLine() {
    this.write('\x1b[2K');
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
    if (update.docChanged) {
      console.log('[TTY] Document changed');
      console.log('[TTY] New doc length:', update.state.doc.length);

      this.constrainTerminalViewport(update.view);
      this.render(update.view);
    }

    if (update.selectionSet) {
      const cursor = update.state.selection.main.head;
      const cursorLine = update.state.doc.lineAt(cursor);
      console.log('[TTY] Cursor at char:', cursor, 'line:', cursorLine.number, 'col:', cursor - cursorLine.from);

      this.constrainTerminalViewport(update.view);
      this.render(update.view);
    }
  }

  render(view) {
    const { state } = view;

    const terminalBottom = Math.min(this.termTop + this.termHeight, state.doc.lines);
    const lines = [];
    for (let lineIdx = this.termTop; lineIdx < terminalBottom; lineIdx++) {
      const fullLine = state.doc.line(lineIdx + 1);
      const clipped = fullLine.text.slice(this.termLeft, this.termLeft + this.termWidth);
      lines.push(clipped);
    }

    // Update xterm display using ANSI escape codes
    this.hideCursor();

    // Vertical scroll optimization: if horizontal offset unchanged, use ANSI scroll
    if (this.lastTermLeft === this.termLeft && this.lastTermTop !== null) {
      const delta = this.termTop - this.lastTermTop;

      if (delta > 0 && delta < this.termHeight) {
        // Scrolled down in document - content moves up
        this.writeScroll(delta);
        // Shift lastFullLines up, fill bottom with blanks
        this.lastLines.splice(0, delta);
        for (let i = 0; i < delta; i++) {
          this.lastLines.push('');
        }
      } else if (delta < 0 && -delta < this.termHeight) {
        // Scrolled up in document - content moves down
        this.writeScroll(delta);
        // Shift lastFullLines down, fill top with blanks
        this.lastLines.splice(this.termHeight + delta);
        for (let i = 0; i < -delta; i++) {
          this.lastLines.unshift('');
        }
      }
    }

    // Render each line at its position (skip unchanged lines)
    for (let i = 0; i < this.termHeight; i++) {
      const line = lines[i] || '';
      const lastLine = this.lastLines[i] || '';

      if (line !== lastLine) {
        this.writeCursorPos(i, 0);
        // Pad only enough to erase old content if new line is shorter
        const padLength = Math.max(line.length, lastLine.length);
        this.write(line.padEnd(padLength, ' '));
      }

      this.lastLines[i] = line;
    }

    this.lastTermTop = this.termTop;
    this.lastTermLeft = this.termLeft;
    // Show cursor at CodeMirror cursor position (if visible in viewport)
    const cursor = state.selection.main.head;
    const cursorLine = state.doc.lineAt(cursor);
    const cursorLineIdx = cursorLine.number - 1;
    const cursorCol = cursor - cursorLine.from;

    const visTop = cursorLineIdx - this.termTop;
    const visLeft = cursorCol - this.termLeft;

    this.lastCursorRow = null;
    this.lastCursorCol = null;

    if (visTop >= 0 && visTop < this.termHeight && visLeft >= 0 && visLeft < this.termWidth) {
      this.writeCursorPos(visTop, visLeft);
      this.showCursor();

      this.lastCursorRow = visTop;
      this.lastCursorCol = visLeft;
    }

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
