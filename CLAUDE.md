# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Compile TypeScript (output to ./out/)
npm run compile

# Watch mode for development
npm run watch

# Lint
npm run lint

# Package the extension as .vsix
npx vsce package
```

To test the extension, press **F5** in VS Code (or use the "Run Extension" launch configuration). This compiles and opens an Extension Development Host window.

## Architecture

QuackTable is a VS Code extension that registers a **custom editor** (`quackTable.explorer`) for `.parquet`, `.pq`, `.parq`, and `.csv` files.

### Extension host (TypeScript in `src/`)

- **`extension.ts`** — Entry point. Registers `ParquetDocumentProvider` and a shared `outputChannel` for debug logging.
- **`parquetDocument.ts`** — Two classes:
  - `ParquetDocument` (implements `vscode.CustomDocument`): Creates an in-memory DuckDB database and a SQL view over the opened file (`read_parquet` or `read_csv`). Handles `runQuery` (DESCRIBE + SELECT + stats in one round trip) and `fetchMore` (pagination via LIMIT/OFFSET).
  - `ParquetDocumentProvider` (implements `vscode.CustomReadonlyEditorProvider`): Builds the webview HTML (injecting library URIs and config values), and routes messages between the webview and the document.
- **`dispose.ts`** — Base `Disposable` class and `disposeAll` helper, following the VS Code disposable pattern.
- **`util.ts`** — `getNonce()` for Content Security Policy nonces.

### Webview frontend (`media/`)

- **`quackTable.js`** — All frontend logic. Communicates with the extension host via `vscode.postMessage` / `window.addEventListener('message')`. Key responsibilities:
  - Sends `{ type: 'query', sql, limit }` and `{ type: 'more', sql, limit, offset }` messages to the extension.
  - Renders results using **Tabulator.js** with lazy/infinite scroll (chunks controlled by `CHUNK_SIZE` injected from settings).
  - SQL autocomplete (columns + keywords) using a custom suggestion box.
  - Schema tab populated from `DESCRIBE` results and statistics.
  - Cell selection, copy (Ctrl+C), context menu, and Ctrl+A select-all.
- **`quackTable.css`** — Extension-specific styles.
- Third-party bundled libraries (not to be edited): `tabulator.min.js/css`, `prism.js/css`, `code-input.min.js/css`, `indent.min.js`, `luxon.min.js`.

### Message protocol (extension ↔ webview)

| Direction | Type | Payload |
|-----------|------|---------|
| ext → webview | `config` | `{ autoQuery: boolean }` |
| webview → ext | `query` | `{ sql, limit }` |
| webview → ext | `more` | `{ sql, limit, offset }` |
| ext → webview | `query` | `{ success, results, describe, statistics }` |
| ext → webview | `more` | `{ success, results }` |

### Key extension settings

- `quack-table.tableName` / `quack-table.useFileNameAsTableName` — controls the DuckDB view name.
- `quack-table.defaultQuery` — initial SQL with `${tableName}` interpolation.
- `quack-table.chunkSize` — rows per fetch (injected as `CHUNK_SIZE` constant into webview).
- `quack-table.autoQuery` — auto-run on input change vs. Ctrl+Enter only.

### Build output

TypeScript compiles to `./out/` (gitignored). The extension entry point is `./out/extension.js`. The `media/` directory is served as-is to the webview.
