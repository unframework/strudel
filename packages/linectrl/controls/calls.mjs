import { syntaxTree } from '@codemirror/language';

const KINDS = { IN: 'cc', BIN: 'note' };

export const LEARN_TYPES = { cc: 'cc', note: 'noteon' };

const PUNCTUATION = new Set(['(', ')', ',', 'LineComment', 'BlockComment']);

/**
 * A control call in the code whose number is a literal or not written yet, e.g. `IN(12)`, `BIN()`.
 * @typedef {Object} ControlCall
 * @property {'cc' | 'note'} kind
 * @property {number | null} num CC or note number, null for `IN()`
 * @property {number} to end of the call
 * @property {function(number): Object} edit learned number → change that writes it
 */

/**
 * @param {EditorState} state
 * @param {number} from
 * @param {number} to
 * @returns {ControlCall[]}
 */
export function findControlCalls(state, from, to) {
  const calls = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      const call = node.name === 'CallExpression' && readControlCall(state, node.node);
      call && calls.push(call);
    },
  });
  return calls;
}

/**
 * @param {EditorState} state
 * @param {number} pos
 * @returns {ControlCall | null}
 */
export function controlCallEndingAt(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === 'CallExpression' && node.to === pos) {
      return readControlCall(state, node);
    }
  }
  return null;
}

function readControlCall(state, node) {
  const callee = node.firstChild;
  const kind = callee?.name === 'VariableName' && KINDS[state.sliceDoc(callee.from, callee.to)];
  const argList = callee?.nextSibling;
  if (!kind || argList?.name !== 'ArgList') {
    return null;
  }
  const args = childNodes(argList);
  const [first] = args;
  if (args.some((arg) => arg.type.isError) || (first && first.name !== 'Number')) {
    return null;
  }

  const num = first ? Number(state.sliceDoc(first.from, first.to)) : null;
  if (num !== null && !Number.isInteger(num)) {
    return null;
  }
  const at = first ?? { from: argList.firstChild.to, to: argList.firstChild.to };
  return { kind, num, to: node.to, edit: (learned) => ({ from: at.from, to: at.to, insert: String(learned) }) };
}

function childNodes(node) {
  const children = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    PUNCTUATION.has(child.name) || children.push(child);
  }
  return children;
}
