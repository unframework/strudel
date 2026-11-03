import { ensureSyntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';

const PARSE_TIMEOUT_MS = 100;

export function lastArgumentRange(state, callEnd) {
  const tree = ensureSyntaxTree(state, callEnd, PARSE_TIMEOUT_MS);
  if (!tree) {
    throw new Error('editor is still parsing the code');
  }
  let node = tree.resolveInner(callEnd, -1);
  while (node && !(node.name === 'CallExpression' && node.to === callEnd)) {
    node = node.parent;
  }
  const closing = node?.getChild('ArgList')?.lastChild;
  const last = closing?.name === ')' ? closing.prevSibling : null;
  if (!last || last.name === '(') {
    throw new Error(`no call with arguments ends at ${callEnd}`);
  }
  return { from: last.from, to: last.to };
}

function editorOf(widgetDom) {
  const view = EditorView.findFromDOM(widgetDom.closest('.cm-editor'));
  if (!view) {
    throw new Error('widget is not in an editor');
  }
  return view;
}

// widgets are placed right after the call they belong to
export function replaceWidgetCallArgument(widgetDom, text) {
  const view = editorOf(widgetDom);
  const { from, to } = lastArgumentRange(view.state, view.posAtDOM(widgetDom));
  if (view.state.sliceDoc(from, to) !== text) {
    view.dispatch({ changes: { from, to, insert: text } });
  }
}

export function remeasureOnResize(widgetDom) {
  const observer = new ResizeObserver(() => widgetDom.isConnected && editorOf(widgetDom).requestMeasure());
  observer.observe(widgetDom);
  return () => observer.disconnect();
}
