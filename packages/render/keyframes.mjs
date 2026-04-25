import { EditorView, Decoration } from '@codemirror/view';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import theme from '@strudel/codemirror/themes/solarizedLight.mjs';

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
    extensions: [javascript(), theme, highlightField, EditorView.editable.of(false)],
  });

  editor = new EditorView({ state, parent });
};

// Simple PRNG seeded by position — deterministic per location
function seededRandom(seed) {
  let x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const POP_SECONDS = 0.2; // initial pop multiplies intensity

function highlightStyle(intensity, seed, age) {
  const pop = 1 + 1 * Math.max(0, 1 - age / POP_SECONDS);
  const alpha = intensity * pop;
  const rnd = seededRandom(seed);

  const outlineWidth = 1 + (1 + rnd) * alpha;
  const scale = 1 + (0.1 + 0.1 * rnd) * alpha;
  const rotation = (rnd - 0.5) * 5 * alpha;
  const hue = Math.floor(rnd * 40 - 20); // slight color shift
  const offsetX = (rnd - 0.5) * 1.5 * alpha;

  return [
    `outline: solid ${outlineWidth.toFixed(1)}px rgba(${255 + hue},${255 + hue},${255},${Math.min(1, alpha).toFixed(2)})`,
    `outline-offset: ${(1 + alpha).toFixed(1)}px`,
    `display: inline-block`,
    `transform: scale(${scale.toFixed(3)}) rotate(${rotation.toFixed(2)}deg) translateX(${offsetX.toFixed(1)}px)`,
    `transform-origin: center`,
    `border-radius: 2px`,
  ].join('; ');
}

// locations: array of { start, end, intensity, age, id }
window.applyHighlights = function (locations) {
  if (!editor) return;
  const docLength = editor.state.doc.length;

  const marks = locations
    .filter(({ start, end }) => start < docLength && end <= docLength && start < end)
    .map(({ start, end, intensity, age, id }) => {
      const style = highlightStyle(intensity ?? 1, id, age ?? 0);
      return Decoration.mark({ attributes: { style } }).range(start, end);
    });

  const decorations = Decoration.set(marks, true);
  editor.dispatch({ effects: setHighlights.of(decorations) });
};

window.clearHighlights = function () {
  if (!editor) return;
  editor.dispatch({ effects: setHighlights.of(Decoration.none) });
};

window.getContentHeight = function () {
  if (!editor) return 0;
  // Measure the actual text content height, not the 100vh container
  const contentDOM = editor.contentDOM;
  const lastLine = contentDOM.lastElementChild;
  if (!lastLine) return 100;
  const rect = lastLine.getBoundingClientRect();
  const editorRect = document.getElementById('editor').getBoundingClientRect();
  // Distance from top of editor to bottom of last line + padding
  return Math.ceil(rect.bottom - editorRect.top + 24);
};

window.__keyframesReady = true;
