import { CUE_ID_SOURCE, cueRun } from '@strudel/core';
import { registerTranspilerPlugin } from './transpiler.mjs';

const DEFAULT_ARGS = [1, 0];

const isCueCall = (node) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  !node.callee.computed &&
  node.callee.property.name === 'c';

const literal = (value) => ({ type: 'Literal', value, raw: typeof value === 'string' ? `'${value}'` : String(value) });

function takenIds(input) {
  return new Set(Array.from(input.matchAll(new RegExp(`'(${CUE_ID_SOURCE})'`, 'g')), (match) => match[1]));
}

const cueTranspilerPlugin = {
  walk: (context) => {
    const { options, input, nodeOffset } = context;
    const isMinting = options.emitWidgets && cueRun.isMinting;
    const taken = isMinting ? takenIds(input) : new Set();

    return {
      enter(node) {
        if (!isCueCall(node) || node.arguments.length >= 4) return;
        if (node.arguments.length === 0) {
          throw new Error('.c() needs the pattern to change to, like "800".c("2000")');
        }
        if (!isMinting) return;

        const id = cueRun.mint(taken);
        const added = [...DEFAULT_ARGS.slice(node.arguments.length - 1), id].map(literal);
        context.cueMints ??= [];
        context.cueMints.push({
          at: node.arguments.at(-1).end + nodeOffset,
          insert: added.map((arg) => `, ${arg.raw}`).join(''),
        });
        node.arguments.push(...added);
      },
    };
  },
};

registerTranspilerPlugin(cueTranspilerPlugin);
