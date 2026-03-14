import { EditorView, Decoration } from '@codemirror/view';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import strudelTheme from '@strudel/codemirror/themes/strudel-theme.mjs';

// StateEffect to set highlight decorations
const setHighlights = StateEffect.define();

const highlightField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlights)) {
        return e.value;
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

let editor = null;

window.initEditor = function (code) {
  const parent = document.getElementById('editor');
  parent.innerHTML = '';

  const state = EditorState.create({
    doc: code,
    extensions: [
      javascript(),
      strudelTheme,
      highlightField,
      EditorView.editable.of(false),
      EditorView.lineWrapping,
    ],
  });

  editor = new EditorView({ state, parent });
};

window.applyHighlights = function (locations) {
  if (!editor) return;
  const docLength = editor.state.doc.length;

  const marks = locations
    .filter(({ start, end }) => start < docLength && end <= docLength && start < end)
    .map(({ start, end, color }) => {
      const style = `outline: solid 2px ${color || '#fff'}`;
      return Decoration.mark({ attributes: { style } }).range(start, end);
    });

  const decorations = Decoration.set(marks, true);
  editor.dispatch({ effects: setHighlights.of(decorations) });
};

window.clearHighlights = function () {
  if (!editor) return;
  editor.dispatch({ effects: setHighlights.of(Decoration.none) });
};

window.__keyframesReady = true;
