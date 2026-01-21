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
    this.termWidth = 40; // Terminal width in columns
    this.termHeight = 10; // Terminal height in rows

    console.log('[TTY] Plugin initialized');

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
    this.terminal.writeln('TTY Mirror initialized');
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

    // Update xterm display
    this.terminal.clear();
    lines.forEach((line) => {
      this.terminal.writeln(line);
    });
  }

  destroy() {
    console.log('[TTY] Plugin destroyed');

    this.terminal.dispose();
    this.xtermContainer.parentNode.removeChild(this.xtermContainer);
  }
}

export const ttyMirrorPlugin = ViewPlugin.fromClass(TTYMirrorView);
