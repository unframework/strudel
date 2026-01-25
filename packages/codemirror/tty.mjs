import { ViewPlugin } from '@codemirror/view';
import { setMiniLocations, showMiniLocations } from './highlight.mjs';
import { Terminal } from './terminal.mjs';

const LINE_PREFIX_WIDTH = 3; // Width of line number prefix

/**
 * TTY Mirror Plugin
 * Captures CodeMirror state for remote terminal display
 */
class TTYMirrorView {
  constructor(view) {
    this.view = view;

    // Create low-level terminal
    this.terminal = new Terminal();

    // Terminal viewport params (also in Terminal for scroll optimization)
    this.termTop = 0; // Top line number (0-indexed)
    this.termLeft = 0; // Left column offset (0-indexed)

    this.lineRanges = [];

    this.cursorTop = null; // Visible cursor row in raw terminal coords
    this.cursorLeft = null; // Visible cursor column in raw terminal coords
    this.cursorFlashInterval = null;
    this.cursorFlashActive = true;

    this.miniLocations = []; // Current mini locations from highlight plugin

    console.log('[TTY] Plugin initialized');

    this.updateCursor(view);
    this.render(view);
  }

  updateCursor(view) {
    const { state } = view;
    const visLineWidth = this.terminal.termWidth - LINE_PREFIX_WIDTH;

    const cursor = state.selection.main.head;
    const cursorLine = state.doc.lineAt(cursor);
    const cursorLineIdx = cursorLine.number - 1; // Convert to 0-indexed
    const cursorCol = cursor - cursorLine.from;

    if (this.termTop + this.terminal.termHeight <= cursorLineIdx) {
      this.termTop = cursorLineIdx - this.terminal.termHeight + 1;
    }

    if (this.termTop > cursorLineIdx) {
      this.termTop = cursorLineIdx;
    }

    if (this.termLeft + visLineWidth <= cursorCol) {
      this.termLeft = cursorCol - visLineWidth + 1;
    }

    if (this.termLeft > cursorCol) {
      this.termLeft = cursorCol;
    }

    const newCursorLeft = cursorCol - this.termLeft + LINE_PREFIX_WIDTH;
    const newCursorTop = cursorLineIdx - this.termTop;

    if (this.cursorLeft !== newCursorLeft || this.cursorTop !== newCursorTop) {
      this.cursorLeft = newCursorLeft;
      this.cursorTop = newCursorTop;
      this.resetCursorBlink();
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
          this.terminal.flush();
        }
      }
    }

    if (update.docChanged) {
      console.log('[TTY] Document changed');
      console.log('[TTY] New doc length:', update.state.doc.length);

      this.updateCursor(update.view);
      this.render(update.view);
      this.terminal.flush();
    }

    if (update.selectionSet) {
      const cursor = update.state.selection.main.head;
      const cursorLine = update.state.doc.lineAt(cursor);
      console.log('[TTY] Cursor at char:', cursor, 'line:', cursorLine.number, 'col:', cursor - cursorLine.from);

      this.updateCursor(update.view);
      this.render(update.view);
      this.terminal.flush();
    }
  }

  render(view) {
    // Sync viewport position to terminal
    this.terminal.setXY(this.termLeft, this.termTop);

    const { state } = view;

    this.lineRanges = [];

    const terminalBottom = Math.min(this.termTop + this.terminal.termHeight, state.doc.lines);
    for (let lineIdx = this.termTop; lineIdx < terminalBottom; lineIdx++) {
      const row = lineIdx - this.termTop;
      const fullLine = state.doc.line(lineIdx + 1);
      const prefix = String(lineIdx + 1).padStart(LINE_PREFIX_WIDTH, ' ');
      const lineText = fullLine.text.slice(this.termLeft).padEnd(this.terminal.termWidth - LINE_PREFIX_WIDTH, ' ');

      this.terminal.fillString(0, row, prefix, 7); // Inverted line number
      this.terminal.fillString(LINE_PREFIX_WIDTH, row, lineText, 0);
      this.lineRanges.push([fullLine.from, fullLine.to]);
    }

    this.renderCursor();
  }

  updateMiniLocations(haps) {
    // Clear content attrs (keep line number prefix attrs)
    for (let row = 0; row < this.terminal.termHeight; row++) {
      this.terminal.fillAttr(LINE_PREFIX_WIDTH, row, 0, this.terminal.termWidth - LINE_PREFIX_WIDTH);
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
        for (let row = 0; row < this.terminal.termHeight; row++) {
          const [lineFrom, lineTo] = this.lineRanges[row] || [0, 0];
          if (start >= lineTo || end <= lineFrom) {
            continue; // No overlap
          }

          const attrStart = LINE_PREFIX_WIDTH + Math.max(0, start - lineFrom);
          const attrEnd = LINE_PREFIX_WIDTH + Math.min(lineTo - lineFrom, end - lineFrom);

          this.terminal.fillAttr(attrStart, row, 7, attrEnd - attrStart);
        }
      }
    }

    this.renderCursor();
  }

  clearCursorBlink() {
    // Clear old interval
    if (this.cursorFlashInterval) {
      clearInterval(this.cursorFlashInterval);
      this.cursorFlashInterval = null;
    }
  }

  resetCursorBlink() {
    // Clear old interval
    this.clearCursorBlink();

    // Set new cursor interval
    if (this.cursorLeft != null && this.cursorTop != null) {
      this.cursorFlashActive = true;
      this.cursorFlashInterval = setInterval(() => {
        this.cursorFlashActive = !this.cursorFlashActive;
        this.renderCursor();
        this.terminal.flush();
      }, 600);
    }
  }

  renderCursor() {
    this.terminal.fillAttr(this.cursorLeft, this.cursorTop, this.cursorFlashActive ? 7 : 0, 1);
  }

  destroy() {
    console.log('[TTY] Plugin destroyed');

    this.clearCursorBlink();

    this.terminal.destroy();
  }
}

export const ttyMirrorPlugin = ViewPlugin.fromClass(TTYMirrorView);
