import { syntaxTree } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType } from '@codemirror/view';
import { controlCallEndingAt, findControlCalls, LEARN_TYPES } from './calls.mjs';
import { controller, deck } from './rig.mjs';

const BLINK_MS = 250;

const formats = {
  cc: (value) => value.toFixed(2),
  note: (value) => (value ? 'on' : 'off'),
};

const valueBoxes = {
  cc: { width: '4ch', top: '1px' },
  note: { width: '3ch', top: '-1px' },
};

function writeLearned(view, dom, num) {
  const call = controlCallEndingAt(view.state, view.posAtDOM(dom));
  call && view.dispatch({ changes: call.edit(num) });
}

class ControlWidget extends WidgetType {
  constructor(kind, num) {
    super();
    this.kind = kind;
    this.num = num;
  }

  eq(other) {
    return other.kind === this.kind && other.num === this.num;
  }

  toDOM(view) {
    const wrap = document.createElement('span');
    wrap.className = 'cm-linectrl';
    const value = wrap.appendChild(document.createElement('span'));
    value.className = 'cm-linectrl-value';
    Object.assign(value.style, valueBoxes[this.kind]);
    const button = wrap.appendChild(document.createElement('button'));
    button.className = 'cm-linectrl-learn';
    button.textContent = '●';
    button.title = this.kind === 'cc' ? 'Learn the next CC' : 'Learn the next note';

    let learner = { isArmed: false, cancel: () => {} };
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => {
      view.focus();
      if (learner.isArmed) {
        learner.cancel();
      } else {
        learner = controller.learn(LEARN_TYPES[this.kind], (num) => writeLearned(view, wrap, num));
      }
    });

    const isSwitch = this.kind === 'note';
    const render = () => {
      const current = this.num === null ? null : deck.value(this.kind, this.num);
      const text = current === null ? '–' : formats[this.kind](current);
      if (value.textContent !== text) {
        value.textContent = text;
      }
      value.classList.toggle('cm-linectrl-on', isSwitch && current > 0);
      value.classList.toggle('cm-linectrl-off', isSwitch && !current);
      button.classList.toggle('cm-linectrl-armed', learner.isArmed);
      button.style.opacity = learner.isArmed && (Date.now() / BLINK_MS) % 2 < 1 ? 0.3 : '';
    };
    const tick = () => {
      if (!wrap.isConnected) {
        learner.cancel();
        return;
      }
      render();
      requestAnimationFrame(tick);
    };
    render();
    requestAnimationFrame(tick);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function buildDecorations(view) {
  const widgets = new Map();
  for (const { from, to } of view.visibleRanges) {
    for (const call of findControlCalls(view.state, from, to)) {
      widgets.set(call.to, Decoration.widget({ widget: new ControlWidget(call.kind, call.num), side: 1 }));
    }
  }
  return Decoration.set(
    [...widgets].map(([pos, widget]) => widget.range(pos)),
    true,
  );
}

const theme = EditorView.baseTheme({
  '.cm-linectrl': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    marginLeft: '2px',
    padding: '0 3px',
    fontSize: '0.65em',
    verticalAlign: 'middle',
    lineHeight: '1.4',
    border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
    borderRadius: '3px',
  },
  '.cm-linectrl-value': {
    position: 'relative',
    display: 'inline-block',
    textAlign: 'center',
  },
  '.cm-linectrl-on': {
    color: '#fff',
  },
  '.cm-linectrl-off': {
    opacity: '0.45',
  },
  '.cm-linectrl-learn': {
    padding: '0',
    fontSize: '1.5em',
    lineHeight: '1',
    color: 'inherit',
    opacity: '0.5',
    cursor: 'pointer',
  },
  '.cm-linectrl-learn.cm-linectrl-armed': {
    color: '#f43f5e',
    opacity: '1',
  },
});

/**
 * Inline widgets after `IN(…)` and `BTN(…)` calls: the control's current value
 * and a learn button that writes the next CC or note number from the controller into the call. Escape disarms it.
 */
export const controlWidgets = [
  ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  Prec.highest(
    keymap.of([
      {
        key: 'Escape',
        run: () => controller.isLearning() && (controller.stopLearning(), true),
      },
    ]),
  ),
  theme,
];
