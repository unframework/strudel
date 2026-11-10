import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { cueRun } from '@strudel/core';
import { insertCueIds } from '../cues.mjs';

function fakeView(doc) {
  const view = {
    state: EditorState.create({ doc }),
    dispatch: (spec) => (view.state = view.state.update(spec).state),
  };
  return view;
}

function mint(at, isClaimed = true) {
  const id = cueRun.mint(new Set());
  if (isClaimed) {
    cueRun.arm(id, 1, 0);
  }
  return { id, at, insert: '!' };
}

describe('insertCueIds', () => {
  it('writes every minted id into its call in one change', () => {
    const code = 'a.c(1)\nb.c(2)';
    const view = fakeView(code);

    insertCueIds(view, { code, meta: { cueMints: [mint(5), mint(12)] } });

    expect(view.state.doc.toString()).toBe('a.c(1!)\nb.c(2!)');
  });

  it('writes into the evaluated block only', () => {
    const doc = 'a.c(1)\n\n\nb.c(2)';
    const view = fakeView(doc);

    insertCueIds(view, { code: 'b.c(2)', range: [9, 15], meta: { cueMints: [mint(14)] } });

    expect(view.state.doc.toString()).toBe('a.c(1)\n\n\nb.c(2!)');
  });

  it('leaves the code alone when it was edited during evaluation', () => {
    const view = fakeView('a.c(10)');

    insertCueIds(view, { code: 'a.c(1)', meta: { cueMints: [mint(5)] } });

    expect(view.state.doc.toString()).toBe('a.c(10)');
  });

  it('skips ids that no pattern used', () => {
    const code = 'a.c(1)';
    const view = fakeView(code);

    insertCueIds(view, { code, meta: { cueMints: [mint(5, false)] } });

    expect(view.state.doc.toString()).toBe(code);
  });
});
