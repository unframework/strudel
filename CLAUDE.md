# CLAUDE.md - AI Assistant Guide for Strudel

Strudel is a live coding pattern language for music on the web, inspired by TidalCycles. It allows users to create algorithmic music patterns using a JavaScript-based DSL with a web-based REPL interface.

## Repository Structure

This is a **pnpm workspace monorepo**:

```
strudel/
├── packages/          # Core packages (published to npm as @strudel/*)
├── website/           # Astro-based documentation and REPL
├── tools/             # Auxiliary tools
├── test/              # Shared tests
├── jsdoc/             # JSDoc configuration
├── docs/              # Documentation content
```

### Key Packages

- **@strudel/core** - Pattern system foundation (sequences, patterns, events)
- **@strudel/mini** - Mini-notation parser for concise pattern syntax
- **@strudel/tonal** - Music theory utilities (scales, chords, harmony)
- **@strudel/webaudio** - Web Audio API integration for sound
- **@strudel/transpiler** - JavaScript transpiler for pattern syntax
- **@strudel/repl** - REPL functionality and state management
- **@strudel/codemirror** - CodeMirror integration for code editing
- **@strudel/superdough** - Default audio engine
- **@strudel/midi** - MIDI output support
- **@strudel/osc** - OSC (Open Sound Control) support
- **@strudel/draw** - Canvas/SVG drawing for visuals

## Development

```bash
pnpm i              # Install all dependencies and symlink packages
pnpm dev            # Start development server (website REPL)
pnpm osc            # Start OSC server

pnpm test           # Run all tests with vitest
pnpm test-ui        # Run tests with UI
pnpm test-coverage  # Run tests with coverage report
cd packages/[name] && pnpm test

pnpm lint           # Run ESLint
pnpm codeformat     # Format all files with Prettier
pnpm format-check   # Check formatting
pnpm check          # Run all CI checks (format, lint, test)

pnpm build          # Build website for production
pnpm preview        # Preview production build
pnpm jsdoc-json     # Generate JSDoc JSON (required before build/test)
```

### Adding Dependencies

- Use `pnpm add <package>` in the specific package directory
- Or use `pnpm add -w <package>` for root workspace dependencies
- Workspace packages reference each other with `workspace:*` in package.json

## Architecture & Patterns

Based on TidalCycles' approach:

- **Pattern**: Represents events happening over time
- **Cycle**: The fundamental time unit (typically 2 seconds for 120 BPM)

Patterns are **functional and immutable**. They are queried for events within a time range using `queryArc(begin, end)`.

- **Mini-notation**: Compact syntax for sequences, e.g., `"bd sd [hh hh] cp"`
- **Parameters**: Most parameters can be patterned, e.g., `note("c3 [e3 g3]").speed("1 2")`
- **Chaining**: Method chaining for transformations, e.g., `note("c3").fast(2).slow(0.5)`

Mini-notation is transpiled to JavaScript internally.

### Website (UI)

The website uses:
- **Astro** - Static site generator with React islands
- **React** - For interactive components (REPL, settings, etc.)
- **CodeMirror 6** - Code editor
- **Tailwind CSS** - Styling
- **Nanostores** - State management
- **Supabase** - Backend for saving/loading patterns

### File Naming

- JavaScript files use `.mjs` or `.js` (ES modules)
- React components use `.jsx` or `.tsx`
- Tests use `.test.mjs` or `.test.js`
