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
  return findControlCalls(state, 0, doc.length).map(({ kind, addr, to }) => ({ kind, addr, to }));
}

function learn(doc, num) {
  const state = parse(doc);
  const [call] = findControlCalls(state, 0, doc.length);
  const change = call.edit(num);
  return change && state.update({ changes: change }).state.doc.toString();
}

describe('findControlCalls', () => {
  it('reads control calls with literal addresses', () => {
    expect(calls('s("bd").gain(IN(12)).mask(BTN(36, 1))')).toEqual([
      { kind: 'in', addr: [12], to: 19 },
      { kind: 'btn', addr: [36], to: 36 },
    ]);
    expect(calls('PUSH()')).toEqual([{ kind: 'push', addr: [], to: 6 }]);
    expect(calls('RADIO(16, 17) + RADIO([18, 19], 1)')).toEqual([
      { kind: 'radio', addr: [16, 17], to: 13 },
      { kind: 'radio', addr: [18, 19], to: 34 },
    ]);
  });

  it('skips calls with computed addresses or other callees', () => {
    expect(calls('IN(cc) + BTN(1.5) + RADIO(16, n) + x.IN(3) + IN(12')).toEqual([]);
  });

  it('finds the call ending at a position', () => {
    const state = parse('IN(12).range(0, 5)');
    expect(controlCallEndingAt(state, 6)).toMatchObject({ kind: 'in', addr: [12] });
    expect(controlCallEndingAt(state, 18)).toBe(null);
  });
});

describe('ControlCall.edit', () => {
  it('replaces or inserts the single address', () => {
    expect(learn('IN(12, 0.5)', 7)).toBe('IN(7, 0.5)');
    expect(learn('BTN()', 36)).toBe('BTN(36)');
  });

  it('appends a new RADIO note', () => {
    expect(learn('RADIO()', 16)).toBe('RADIO(16)');
    expect(learn('RADIO(16, 17)', 18)).toBe('RADIO(16, 17, 18)');
    expect(learn('RADIO([], 1)', 16)).toBe('RADIO([16], 1)');
    expect(learn('RADIO([16], 1)', 17)).toBe('RADIO([16, 17], 1)');
    expect(learn('RADIO(16, 17)', 17)).toBe(null);
  });
});
