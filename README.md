# QuackTable

View, query, and analyze Parquet and CSV files directly in VS Code, powered by DuckDB.

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=arunpandian7.quack-table)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

![QuackTable Demo](./docs/iris.gif)

---

## Features

- **SQL Editor** — Write and execute SQL queries with autocomplete for column names and keywords
- **Schema Tab** — View column types, null counts, null %, and distinct value counts
- **Lazy Loading** — Handles large files by fetching data in chunks
- **Theme-Aware UI** — Adapts to your VS Code light/dark/custom theme
- **Copilot Integration** — Use `@quacktable` in GitHub Copilot Chat to ask questions about your data

## Supported Formats

| Format | Extensions |
|--------|------------|
| Apache Parquet | `.parquet`, `.pq`, `.parq` |
| CSV | `.csv` |

## Usage

Open any `.parquet`, `.pq`, `.parq`, or `.csv` file — QuackTable activates automatically.

- `Ctrl+Enter` / `Cmd+Enter` — Execute query
- `Ctrl+Space` — Trigger autocomplete
- `Ctrl+C` — Copy selected cells
- `Ctrl+A` — Select all cells

## Configuration

```json
{
  "quack-table.defaultQuery": "SELECT * FROM ${tableName}",
  "quack-table.tableName": "data",
  "quack-table.useFileNameAsTableName": false,
  "quack-table.chunkSize": 100,
  "quack-table.autoQuery": false
}
```

## Requirements

- VS Code 1.85.0 or higher

## Contributing

Bug reports and PRs are welcome on [GitHub](https://github.com/arunpandian7/quack-table).

## License

MIT
