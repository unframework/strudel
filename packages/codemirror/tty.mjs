import { ViewPlugin } from '@codemirror/view';

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

    this.constrainTerminalViewport(view);
    this.render(view);
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

    console.log('[TTY] Terminal buffer content:');
    console.log(lines.join('\n'));
  }

  destroy() {
    console.log('[TTY] Plugin destroyed');
  }
}

export const ttyMirrorPlugin = ViewPlugin.fromClass(TTYMirrorView);
