import { ViewPlugin } from '@codemirror/view';

/**
 * TTY Mirror Plugin
 * Captures CodeMirror state for remote terminal display
 */
class TTYMirrorView {
  constructor(view) {
    this.view = view;
    console.log('[TTY] Plugin initialized');
    console.log('[TTY] Initial doc length:', view.state.doc.length);
    console.log('[TTY] Initial viewport:', view.viewport);
  }

  update(update) {
    if (update.docChanged) {
      console.log('[TTY] Document changed');
      console.log('[TTY] New doc length:', update.state.doc.length);
      console.log('[TTY] Changes:', update.changes.toJSON());
    }

    if (update.viewportChanged) {
      console.log('[TTY] Viewport changed:', update.view.viewport);
    }

    if (update.selectionSet) {
      const cursor = update.state.selection.main.head;
      console.log('[TTY] Selection changed, cursor at:', cursor);
    }
  }

  destroy() {
    console.log('[TTY] Plugin destroyed');
  }
}

export const ttyMirrorPlugin = ViewPlugin.fromClass(TTYMirrorView);
