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
    this.termWidth = 80; // Terminal width in columns
    this.termHeight = 24; // Terminal height in rows

    console.log('[TTY] Plugin initialized');

    this.constrainTerminalViewport(view);
    this.render(view);
  }

  constrainTerminalViewport(view) {
    const { state } = view;
    const { from, to } = view.viewport;
    const viewportStart = state.doc.lineAt(from).number - 1;
    const viewportEnd = state.doc.lineAt(to).number; // exclusive

    if (this.termTop + this.termHeight > viewportEnd) {
      this.termTop = Math.max(0, viewportEnd - this.termHeight);
    }

    if (this.termTop < viewportStart) {
      this.termTop = viewportStart;
    }
  }

  update(update) {
    if (update.docChanged) {
      console.log('[TTY] Document changed');
      console.log('[TTY] New doc length:', update.state.doc.length);
      this.constrainTerminalViewport(update.view);
      this.render(update.view);
    }

    if (update.viewportChanged) {
      console.log('[TTY] Render viewport changed', update.view.viewport);
      this.constrainTerminalViewport(update.view);
      this.render(update.view);
    }

    if (update.selectionSet) {
      const cursor = update.state.selection.main.head;
      const cursorLine = update.state.doc.lineAt(cursor);
      console.log('[TTY] Cursor at char:', cursor, 'line:', cursorLine.number, 'col:', cursor - cursorLine.from);
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
