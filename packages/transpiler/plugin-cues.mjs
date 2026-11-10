import { CUE_ID_SOURCE, cueRun } from '@strudel/core';
import { registerTranspilerPlugin } from './transpiler.mjs';

const DEFAULT_ARGS = [1, 0];

const isCueCall = (node) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  !node.callee.computed &&
  node.callee.property.name === 'c' &&
  node.arguments.length >= 1 &&
  node.arguments.length <= 3;

const literal = (value) => ({ type: 'Literal', value, raw: typeof value === 'string' ? `'${value}'` : String(value) });

function takenIds(input) {
  return new Set(Array.from(input.matchAll(new RegExp(`'(${CUE_ID_SOURCE})'`, 'g')), (match) => match[1]));
}

// Only the runtime knows whether the receiver is a pattern, so the call is routed through cueWithId
const cueTranspilerPlugin = {
  walk: (context) => {
    const { options, input, nodeOffset } = context;
    const isMinting = options.emitWidgets && cueRun.isMinting;
    const taken = isMinting ? takenIds(input) : new Set();

    return {
      enter(node) {
        if (!isMinting || !isCueCall(node)) return;

        const id = cueRun.mint(taken);
        const added = [...DEFAULT_ARGS.slice(node.arguments.length - 1), id].map(literal);
        context.cueMints ??= [];
        context.cueMints.push({
          id,
          at: node.arguments.at(-1).end + nodeOffset,
          insert: added.map((arg) => `, ${arg.raw}`).join(''),
        });
        node.arguments = [node.callee.object, literal(id), ...node.arguments];
        node.callee = { type: 'Identifier', name: 'cueWithId' };
      },
    };
  },
};

registerTranspilerPlugin(cueTranspilerPlugin);
