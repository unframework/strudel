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
    this.visTop = null; // Visible cursor row in terminal viewport
    this.visLeft = null; // Visible cursor column in terminal viewport

    this.miniLocations = []; // Current mini locations from highlight plugin

    console.log('[TTY] Plugin initialized');

    this.constrainTerminalViewport(view);
    this.render(view);

    this.cursorFlash = true;
    this.cursorFlashInterval = setInterval(() => {
      this.cursorFlash = !this.cursorFlash;
      this.renderCursor();
      this.terminal.flush();
    }, 600);
  }

  constrainTerminalViewport(view) {
    const { state } = view;

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

    if (this.termLeft + this.terminal.termWidth <= cursorCol) {
      this.termLeft = cursorCol - this.terminal.termWidth + 1;
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
          this.terminal.flush();
        }
      }
    }

    if (update.docChanged) {
      console.log('[TTY] Document changed');
      console.log('[TTY] New doc length:', update.state.doc.length);

      this.constrainTerminalViewport(update.view);
      this.render(update.view);
      this.terminal.flush();
    }

    if (update.selectionSet) {
      const cursor = update.state.selection.main.head;
      const cursorLine = update.state.doc.lineAt(cursor);
      console.log('[TTY] Cursor at char:', cursor, 'line:', cursorLine.number, 'col:', cursor - cursorLine.from);

      this.constrainTerminalViewport(update.view);
      this.render(update.view);
      this.terminal.flush();
    }
  }

  render(view) {
    this.terminal.dirtyBuffer = true;

    // Sync viewport position to terminal
    this.terminal.termTop = this.termTop;
    this.terminal.termLeft = this.termLeft;

    const { state } = view;

    const terminalBottom = Math.min(this.termTop + this.terminal.termHeight, state.doc.lines);
    this.terminal.lines = [];
    this.terminal.lineAttrs = [];
    this.lineRanges = [];
    for (let lineIdx = this.termTop; lineIdx < terminalBottom; lineIdx++) {
      const fullLine = state.doc.line(lineIdx + 1);
      const prefix = String(lineIdx + 1).padStart(LINE_PREFIX_WIDTH, ' ');
      const clipped = (prefix + fullLine.text).slice(this.termLeft, this.termLeft + this.terminal.termWidth);
      const attrs = [7, 7, 7]; // Inverted for line number prefix
      this.terminal.lines.push(clipped);
      this.terminal.lineAttrs.push(attrs);
      this.lineRanges.push([fullLine.from, fullLine.to]);
    }

    // Show cursor at CodeMirror cursor position (if visible in viewport)
    const cursor = state.selection.main.head;
    const cursorLine = state.doc.lineAt(cursor);
    const cursorLineIdx = cursorLine.number - 1;
    const cursorCol = cursor - cursorLine.from;

    this.visTop = cursorLineIdx - this.termTop;
    this.visLeft = cursorCol - this.termLeft;

    this.renderCursor();
  }

  updateMiniLocations(haps) {
    this.terminal.dirtyBuffer = true;

    for (let i = 0; i < this.terminal.termHeight; i++) {
      if (!this.terminal.lineAttrs[i]) {
        this.terminal.lineAttrs[i] = [7, 7, 7];
        continue;
      }
      this.terminal.lineAttrs[i].length = LINE_PREFIX_WIDTH; // Clear content attrs
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
        for (let lineIdx = 0; lineIdx < this.terminal.termHeight; lineIdx++) {
          const [lineFrom, lineTo] = this.lineRanges[lineIdx] || [0, 0];
          if (start >= lineTo || end <= lineFrom) {
            continue; // No overlap
          }

          const attrs = this.terminal.lineAttrs[lineIdx];

          const attrStart = LINE_PREFIX_WIDTH + Math.max(0, start - lineFrom);
          const attrEnd = LINE_PREFIX_WIDTH + Math.min(lineTo - lineFrom, end - lineFrom);

          for (let col = attrStart; col < attrEnd; col++) {
            attrs[col] = 7; // Underline attribute
          }
        }
      }
    }

    this.renderCursor();
  }

  renderCursor() {
    this.terminal.dirtyBuffer = true;
    if (
      this.visTop >= 0 &&
      this.visTop < this.terminal.termHeight &&
      this.visLeft >= 0 &&
      this.visLeft < this.terminal.termWidth
    ) {
      this.terminal.lines[this.visTop] = this.terminal.lines[this.visTop].padEnd(
        this.visLeft + LINE_PREFIX_WIDTH + 1,
        ' ',
      ); // Ensure there is a space at the end
      this.terminal.lineAttrs[this.visTop][this.visLeft + LINE_PREFIX_WIDTH] = this.cursorFlash ? 7 : 0; // Mark cursor position
    }
  }

  destroy() {
    console.log('[TTY] Plugin destroyed');

    clearInterval(this.cursorFlashInterval);

    this.terminal.destroy();
  }
}

export const ttyMirrorPlugin = ViewPlugin.fromClass(TTYMirrorView);
