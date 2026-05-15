import { useMemo, useCallback } from 'react';
import { useSettings } from '../../../settings.mjs';
import { getMetadata } from '../../../metadata_parser.js';

/**
 * Extract snippets from pattern code.
 * A snippet starts with `// @snippet <label>` and ends at the next blank line.
 */
function extractSnippets(code) {
  const snippets = [];
  const lines = code.split('\n');
  let current = null;

  for (const line of lines) {
    if (line.trim().startsWith('// @snippet ')) {
      if (current) snippets.push(current.trimEnd());
      current = line + '\n';
    } else if (current) {
      if (line.trim() === '') {
        snippets.push(current.trimEnd());
        current = null;
      } else {
        current += line + '\n';
      }
    }
  }
  if (current) snippets.push(current.trimEnd());
  return snippets;
}

/**
 * Get the label from a snippet (first line after "// @snippet ")
 */
function getSnippetLabel(snippet) {
  const match = snippet.match(/^\/\/ @snippet (.+)/);
  return match ? match[1].trim() : 'untitled';
}

function SnippetCard({ snippet }) {
  const handleClick = useCallback((e) => {
    e.target.select();
  }, []);

  return (
    <textarea
      readOnly
      value={snippet}
      onClick={handleClick}
      onFocus={handleClick}
      className="w-full bg-background text-foreground text-xs font-mono p-2 rounded border border-muted resize-none cursor-pointer hover:border-foreground focus:outline-none focus:border-foreground"
      style={{ height: '80px' }}
    />
  );
}

function PatternSnippets({ patternTitle, snippets }) {
  // Sort snippets alphabetically by label (case-insensitive)
  const sortedSnippets = useMemo(() => {
    return [...snippets].sort((a, b) => {
      const labelA = getSnippetLabel(a).toLowerCase();
      const labelB = getSnippetLabel(b).toLowerCase();
      return labelA.localeCompare(labelB);
    });
  }, [snippets]);

  return (
    <div className="mb-4">
      <h3 className="text-sm font-medium text-foreground mb-2 px-1">{patternTitle}</h3>
      <div className="space-y-2">
        {sortedSnippets.map((snippet, idx) => (
          <SnippetCard key={idx} snippet={snippet} />
        ))}
      </div>
    </div>
  );
}

export function SnippetsTab() {
  const { userPatterns } = useSettings();

  // Extract snippets from all patterns, grouped by pattern
  const patternSnippets = useMemo(() => {
    const result = [];

    for (const [id, pattern] of Object.entries(userPatterns)) {
      const snippets = extractSnippets(pattern.code || '');
      if (snippets.length === 0) continue;

      const meta = getMetadata(pattern.code);
      const metaTitle = meta.title?.trim() || null;
      let title = metaTitle;
      if (!title) {
        const date = new Date(pattern.created_at);
        if (!isNaN(date)) {
          title = date.toLocaleDateString();
        } else {
          title = id || 'unnamed';
        }
      }

      result.push({ title, snippets, id, hasTitle: !!metaTitle, createdAt: pattern.created_at });
    }

    // Sort patterns same way as PatternsTab: titled first (alphabetically), then untitled by date
    result.sort((a, b) => {
      const aHasTitle = a.hasTitle;
      const bHasTitle = b.hasTitle;
      if (aHasTitle && bHasTitle) {
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      }
      if (aHasTitle) return -1;
      if (bHasTitle) return 1;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });

    return result;
  }, [userPatterns]);

  const totalSnippets = patternSnippets.reduce((sum, p) => sum + p.snippets.length, 0);

  return (
    <div className="w-full h-full text-foreground flex flex-col overflow-hidden">
      <div className="px-2 py-2 border-b border-muted text-sm text-muted-foreground">
        {totalSnippets} snippet{totalSnippets !== 1 ? 's' : ''} from {patternSnippets.length} pattern
        {patternSnippets.length !== 1 ? 's' : ''}
      </div>
      <div className="overflow-auto p-2">
        {patternSnippets.length === 0 ? (
          <div className="text-sm text-muted-foreground p-2">
            No snippets found. Add <code className="bg-muted px-1 rounded">// @snippet label</code> comments to your
            patterns.
          </div>
        ) : (
          patternSnippets.map(({ title, snippets, id }) => (
            <PatternSnippets key={id} patternTitle={title} snippets={snippets} />
          ))
        )}
      </div>
    </div>
  );
}
