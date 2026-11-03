import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { lastArgumentRange } from '../inlineWidget.mjs';

const stateOf = (doc) => EditorState.create({ doc, extensions: [javascript()] });

describe('lastArgumentRange', () => {
  it('finds the last argument of the call ending at a position', () => {
    const doc = `x()\nmarkers('voice:0', [[0.4, 0], [1, 2, 'a']]);\n$: s("bd")`;
    const callEnd = doc.indexOf(';');
    const { from, to } = lastArgumentRange(stateOf(doc), callEnd);
    expect(doc.slice(from, to)).toBe(`[[0.4, 0], [1, 2, 'a']]`);
  });

  it('rejects positions that do not end a call with arguments', () => {
    expect(() => lastArgumentRange(stateOf('markers()'), 9)).toThrow();
    expect(() => lastArgumentRange(stateOf('markers(1, 2)'), 5)).toThrow();
  });
});
