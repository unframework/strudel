import { useCallback } from 'react';
import { useSnippets } from '../../snippets.mjs';

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
  return (
    <div className="mb-4">
      <h3 className="text-sm font-medium text-foreground mb-2 px-1">{patternTitle}</h3>
      <div className="space-y-2">
        {snippets.map((snippet, idx) => (
          <SnippetCard key={idx} snippet={snippet} />
        ))}
      </div>
    </div>
  );
}

export function SnippetsTab() {
  const patternSnippets = useSnippets();

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
