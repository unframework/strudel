import { describe, expect, it } from 'vitest';
import { ensureSyntaxTree } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { controlCallEndingAt, findControlCalls } from '../controls/calls.mjs';

function parse(doc) {
  const state = EditorState.create({ doc, extensions: javascript() });
  ensureSyntaxTree(state, doc.length);
  return state;
}

function calls(doc) {
  const state = parse(doc);
  return findControlCalls(state, 0, doc.length).map(({ kind, num, to }) => ({ kind, num, to }));
}

function learn(doc, num) {
  const state = parse(doc);
  const [call] = findControlCalls(state, 0, doc.length);
  return state.update({ changes: call.edit(num) }).state.doc.toString();
}

describe('findControlCalls', () => {
  it('reads control calls with literal numbers', () => {
    expect(calls('s("bd").gain(IN(12)).mask(BTN(36, 1))')).toEqual([
      { kind: 'cc', num: 12, to: 19 },
      { kind: 'note', num: 36, to: 36 },
    ]);
    expect(calls('BTN()')).toEqual([{ kind: 'note', num: null, to: 5 }]);
  });

  it('skips calls with computed numbers or other callees', () => {
    expect(calls('IN(cc) + BTN(1.5) + RADIO(16) + x.IN(3) + IN(12')).toEqual([]);
  });

  it('finds the call ending at a position', () => {
    const state = parse('IN(12).range(0, 5)');
    expect(controlCallEndingAt(state, 6)).toMatchObject({ kind: 'cc', num: 12 });
    expect(controlCallEndingAt(state, 18)).toBe(null);
  });
});

describe('ControlCall.edit', () => {
  it('replaces or inserts the number', () => {
    expect(learn('IN(12, 0.5)', 7)).toBe('IN(7, 0.5)');
    expect(learn('BTN()', 36)).toBe('BTN(36)');
  });
});
