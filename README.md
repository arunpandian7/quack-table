# QuackTable - Structured Data Explorer for VS Code

**Your ultimate file explorer for structured data formats** - Seamlessly view, query, and analyze Parquet, CSV, and JSON files directly in Visual Studio Code with the lightning-fast power of DuckDB.

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue)](https://marketplace.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🚀 Why QuackTable?

Working with large structured data files shouldn't mean waiting for slow tools or dealing with complex setups. QuackTable brings the speed and power of analytical databases directly into your editor.

### 🎯 Key Features

- **⚡ Lightning-Fast Performance**: Built on [DuckDB](https://duckdb.org/) - scan millions of rows in seconds with efficient columnar processing
- **📊 Interactive SQL Editor**: Write and execute SQL queries with intelligent autocomplete for column names and SQL keywords
- **🔍 Schema Inspector**: View column types, null percentages, and distinct value counts at a glance
- **🎨 Rich Data Visualization**: Interactive table with sorting, filtering, and cell selection
- **📊 Instant Statistics**: Automatic calculation of data quality metrics for every column
- **🎈 Theme-Aware UI**: Beautiful interface that adapts to your VS Code theme (light/dark/custom)
- **⏱️ Lazy Loading**: Efficiently handles massive datasets by loading data on-demand
- **📋 Multiple Format Support**: Works with Parquet (.parquet, .pq), CSV (.csv), and more

---

## 📸 See It In Action

![QuackTable Demo](./docs/iris.gif)

*Query and explore structured data files with an intuitive interface*

---

## 🚀 Quick Start

### Installation

1. **Install from VS Code Marketplace**
   - Open VS Code
   - Press `Ctrl+P` (or `Cmd+P` on Mac)
   - Type: `ext install DeflateAwning.quack-table`
   - Press Enter

2. **Open a Data File**
   - Open any `.parquet`, `.pq`, or `.csv` file
   - QuackTable automatically activates and displays your data

3. **Start Querying**
   - Use the built-in SQL editor to query your data
   - Press `Ctrl+Enter` (or `Cmd+Enter`) to execute queries
   - Click the **▶ Execute** button to run your query

---

## 🎨 Features in Detail

### 💻 SQL Query Editor

- **Syntax Highlighting**: Full SQL syntax highlighting with theme-aware colors
- **Smart Autocomplete**: 
  - Type to see column name suggestions
  - Press `Ctrl+Space` to manually trigger autocomplete
  - Includes SQL keywords (SELECT, FROM, WHERE, JOIN, etc.)
- **Keyboard Shortcuts**:
  - `Ctrl+Enter` / `Cmd+Enter`: Execute query
  - `Tab` or `Enter`: Accept suggestion
  - `Esc`: Close suggestions
  - Arrow keys: Navigate suggestions

### 📑 Schema Tab

Get instant insights into your data structure:

- **Column Name**: All column names from your dataset
- **Data Type**: SQL data types (INTEGER, VARCHAR, DOUBLE, etc.)
- **Null Count**: Number of null values per column
- **Null Percentage**: Percentage of missing data
- **Distinct Values**: Cardinality of each column

Perfect for quick data profiling and quality assessment!

### 📊 Data Tab

- **Interactive Table**: Powered by Tabulator.js for smooth scrolling and interaction
- **Column Tooltips**: Hover over column headers to see detailed statistics
- **Cell Operations**:
  - Click to select cells
  - `Ctrl+Click` / `Cmd+Click`: Multi-select
  - `Ctrl+C` / `Cmd+C`: Copy selected cells
  - `Ctrl+A` / `Cmd+A`: Select all cells
  - Right-click for context menu
- **Infinite Scroll**: Load more data as you scroll

---

## ⚙️ Configuration

Customize QuackTable to match your workflow:

### Available Settings

```json
{
  // Default SQL query when opening files
  "quack-table.defaultQuery": "SELECT * FROM ${tableName}",
  
  // Table name for SQL queries
  "quack-table.tableName": "data",
  
  // Use filename as table name
  "quack-table.useFileNameAsTableName": false,
  
  // Number of rows to fetch per request
  "quack-table.chunkSize": 100,
  
  // Auto-execute query on file open
  "quack-table.autoQuery": false
}
```

### How to Configure

1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "QuackTable"
3. Adjust settings to your preference

---

## 📚 Supported File Formats

| Format | Extensions | Description |
|--------|------------|-------------|
| **Apache Parquet** | `.parquet`, `.pq` | Columnar storage format optimized for analytics |
| **CSV** | `.csv` | Comma-separated values |
| **JSON** | `.json`, `.jsonl` | JSON and line-delimited JSON (coming soon) |

---

## 🔧 Technical Details

### Architecture

- **Backend**: TypeScript + Node.js
- **Database Engine**: [DuckDB](https://duckdb.org/) - An in-process analytical database
- **Frontend**: JavaScript with Webview API
- **Table Renderer**: [Tabulator](http://tabulator.info/) - Interactive table library
- **Syntax Highlighting**: Prism.js with VS Code theme integration

### Performance

- **Columnar Processing**: DuckDB reads only required columns
- **Parallel Execution**: Multi-threaded query processing
- **Memory Efficient**: Streaming results with configurable chunk sizes
- **Zero-Copy**: Direct file access without loading entire file into memory

### Requirements

- **VS Code**: Version 1.85.0 or higher
- **Operating Systems**: Windows, macOS, Linux
- **Node.js**: Bundled with extension (no installation needed)

---

## 🛠️ Troubleshooting

### Query Not Executing?

- Ensure your SQL syntax is valid
- Check that column names are correctly spelled
- Try using the autocomplete feature (`Ctrl+Space`)

### File Won't Open?

- Verify the file extension is supported (.parquet, .pq, .csv)
- Check file permissions
- Ensure the file isn't corrupted

### Performance Issues?

- Reduce `chunkSize` in settings for faster initial load
- Use `LIMIT` clause in your queries for large datasets
- Consider filtering data with `WHERE` clauses

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

1. **Report Bugs**: Open an issue on GitHub
2. **Suggest Features**: Share your ideas in discussions
3. **Submit Pull Requests**: Fork, code, and submit PRs
4. **Spread the Word**: Star the repo and share with colleagues

### Development Setup

```bash
# Clone the repository
git clone https://github.com/arun/quack-table.git
cd quack-table

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Open in VS Code
code .

# Press F5 to launch Extension Development Host
```

---

## 📝 Roadmap

- [ ] JSON and JSONL file support
- [ ] Export query results to CSV/Parquet
- [ ] Data visualization charts
- [ ] Column sorting and filtering in UI
- [ ] Query history and favorites
- [ ] Support for compressed files (.gz, .bz2)
- [ ] Advanced statistics (histograms, correlations)
- [ ] Multi-file queries (JOIN across files)

---

## 💬 Support & Community

- **🐛 Issues**: [GitHub Issues](https://github.com/arun/quack-table/issues)
- **💬 Discussions**: [GitHub Discussions](https://github.com/arun/quack-table/discussions)
- **⭐ Star the Project**: [GitHub Repository](https://github.com/arun/quack-table)
- **📧 Email**: support@quacktable.dev

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🙏 Acknowledgments

- **DuckDB Team**: For the incredible analytical database
- **VS Code Team**: For the extensible editor platform
- **Tabulator.js**: For the powerful table component
- **Prism.js**: For syntax highlighting

---

## 🌟 Why "QuackTable"?

Because DuckDB goes "quack" and tables are what we explore! 🦆

---

**Made with ❤️ for data engineers, analysts, and developers who love working with data.**

*Transform your VS Code into a powerful data exploration tool - Download QuackTable today!*
