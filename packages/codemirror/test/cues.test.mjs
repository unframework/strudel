import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { insertCueIds } from '../cues.mjs';

function fakeView(doc) {
  const view = {
    state: EditorState.create({ doc }),
    dispatch: (spec) => (view.state = view.state.update(spec).state),
  };
  return view;
}

const mint = (at, id) => ({ at, insert: `, 1, 0, '${id}'` });

describe('insertCueIds', () => {
  it('writes every minted id into its call in one change', () => {
    const code = 'a.c(1)\nb.c(2)';
    const view = fakeView(code);

    insertCueIds(view, { code, meta: { cueMints: [mint(5, '#aaaa'), mint(12, '#bbbb')] } });

    expect(view.state.doc.toString()).toBe("a.c(1, 1, 0, '#aaaa')\nb.c(2, 1, 0, '#bbbb')");
  });

  it('writes into the evaluated block only', () => {
    const doc = 'a.c(1)\n\n\nb.c(2)';
    const view = fakeView(doc);

    insertCueIds(view, { code: 'b.c(2)', range: [9, 15], meta: { cueMints: [mint(14, '#bbbb')] } });

    expect(view.state.doc.toString()).toBe("a.c(1)\n\n\nb.c(2, 1, 0, '#bbbb')");
  });

  it('leaves the code alone when it was edited during evaluation', () => {
    const view = fakeView('a.c(10)');

    insertCueIds(view, { code: 'a.c(1)', meta: { cueMints: [mint(5, '#aaaa')] } });

    expect(view.state.doc.toString()).toBe('a.c(10)');
  });
});
