import { syntaxTree } from '@codemirror/language';

const KINDS = { IN: 'in', BTN: 'btn', PUSH: 'push', RADIO: 'radio' };

export const LEARN_TYPES = { in: 'cc', btn: 'noteon', push: 'noteon', radio: 'noteon' };

const PUNCTUATION = new Set(['(', ')', '[', ']', ',', 'LineComment', 'BlockComment']);

/**
 * A control call in the code whose addresses are number literals, e.g. `IN(12)`, `BTN()`,
 * `RADIO([16, 17], 1)`.
 * @typedef {Object} ControlCall
 * @property {'in' | 'btn' | 'push' | 'radio'} kind
 * @property {number[]} addr CC or note numbers written so far, empty for `IN()`
 * @property {number} to end of the call
 * @property {function(number): (Object | null)} edit learned number → change that writes it,
 *   null when RADIO already has it
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
  if (args.some((arg) => arg.type.isError)) {
    return null;
  }

  const list = kind === 'radio' ? readRadioList(argList, args) : readSingle(argList, args);
  const addr = list?.items.map((item) => Number(state.sliceDoc(item.from, item.to)));
  if (!addr?.every((num) => Number.isInteger(num))) {
    return null;
  }
  return { kind, addr, to: node.to, edit: (num) => list.edit(num, addr) };
}

function readSingle(argList, args) {
  const [first] = args;
  if (first && first.name !== 'Number') {
    return null;
  }
  const at = first ?? { from: argList.firstChild.to, to: argList.firstChild.to };
  return {
    items: first ? [first] : [],
    edit: (num) => ({ from: at.from, to: at.to, insert: String(num) }),
  };
}

function readRadioList(argList, args) {
  const isArrayForm = args[0]?.name === 'ArrayExpression';
  const items = isArrayForm ? childNodes(args[0]) : args;
  const open = (isArrayForm ? args[0] : argList).firstChild.to;
  if (!items.every((item) => item.name === 'Number')) {
    return null;
  }
  return {
    items,
    edit: (num, addr) => {
      if (addr.includes(num)) {
        return null;
      }
      const last = items.at(-1);
      return last ? { from: last.to, insert: `, ${num}` } : { from: open, insert: String(num) };
    },
  };
}

function childNodes(node) {
  const children = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    PUNCTUATION.has(child.name) || children.push(child);
  }
  return children;
}
