import * as vscode from 'vscode';
import * as path from 'path';
import * as duckdb from 'duckdb';
import { getNonce } from './util';
import { outputChannel } from './extension';

function sanitizeTableName(name: string): string {
  const s = name.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[0-9]/.test(s) ? '_' + s : s;
}

interface ColumnInfo {
  name: string;
  type: string;
}

interface QueryResult {
  columns: string[];
  rows: any[][];
  error?: string;
}

class ParquetDocument implements vscode.CustomDocument {
  readonly uri: vscode.Uri;
  readonly tableName: string;
  private _db: duckdb.Database;

  constructor(uri: vscode.Uri, tableName: string) {
    this.uri = uri;
    this.tableName = tableName;
    this._db = new duckdb.Database(':memory:');
  }

  async initialize(): Promise<void> {
    const filePath = this.uri.fsPath.replace(/\\/g, '/').replace(/'/g, "''");
    const ext = path.extname(this.uri.fsPath).toLowerCase();
    let readFn: string;
    if (ext === '.csv') {
      readFn = `read_csv_auto('${filePath}')`;
    } else if (ext === '.json' || ext === '.jsonl') {
      readFn = `read_json_auto('${filePath}')`;
    } else {
      readFn = `read_parquet('${filePath}')`;
    }
    await this._exec(`CREATE OR REPLACE VIEW "${this.tableName}" AS SELECT * FROM ${readFn}`);
    outputChannel.appendLine(`ParquetDocument: registered view "${this.tableName}" for ${this.uri.fsPath}`);
  }

  async getSchema(): Promise<ColumnInfo[]> {
    return new Promise((resolve, reject) => {
      this._db.all(`DESCRIBE "${this.tableName}"`, (err, rows) => {
        if (err) { reject(err); return; }
        resolve((rows || []).map((r: any) => ({ name: r.column_name, type: r.column_type })));
      });
    });
  }

  async runQuery(sql: string, limit: number, offset: number): Promise<QueryResult> {
    return new Promise((resolve) => {
      const wrapped = `SELECT * FROM (\n${sql.replace(/;$/, '')}\n) LIMIT ${limit} OFFSET ${offset}`;
      this._db.all(wrapped, (err, rows) => {
        if (err) { resolve({ columns: [], rows: [], error: err.message }); return; }
        if (!rows || rows.length === 0) { resolve({ columns: [], rows: [] }); return; }
        const columns = Object.keys(rows[0]);
        const rowArrays = rows.map(row => columns.map(col => {
          const val = row[col];
          return typeof val === 'bigint' ? Number(val) : val;
        }));
        resolve({ columns, rows: rowArrays });
      });
    });
  }

  async countQuery(sql: string): Promise<number> {
    return new Promise((resolve) => {
      this._db.all(`SELECT COUNT(*) AS cnt FROM (\n${sql.replace(/;$/, '')}\n)`, (err, rows) => {
        if (err || !rows || rows.length === 0) { resolve(-1); return; }
        const cnt = rows[0].cnt;
        resolve(typeof cnt === 'bigint' ? Number(cnt) : cnt);
      });
    });
  }

  async getNullPercents(columns: ColumnInfo[]): Promise<Record<string, number>> {
    if (!columns.length) return {};
    const exprs = columns.map((col, i) => {
      const quoted = col.name.replace(/"/g, '""');
      return `COUNT("${quoted}") AS __c${i}__`;
    }).join(', ');
    return new Promise((resolve) => {
      this._db.all(`SELECT COUNT(*) AS __total__, ${exprs} FROM "${this.tableName}"`, (err, rows) => {
        if (err || !rows || !rows[0]) { resolve({}); return; }
        const row = rows[0];
        const total = Number(row.__total__) || 0;
        if (total === 0) {
          resolve(Object.fromEntries(columns.map(c => [c.name, 0])));
          return;
        }
        const result: Record<string, number> = {};
        columns.forEach((col, i) => {
          const nonNull = Number(row[`__c${i}__`]) || 0;
          result[col.name] = Math.round(((total - nonNull) / total) * 1000) / 10; // one decimal
        });
        resolve(result);
      });
    });
  }

  async saveAsCsv(sql: string, outputPath: string): Promise<void> {
    const escaped = outputPath.replace(/\\/g, '/').replace(/'/g, "''");
    await this._exec(`COPY (${sql.replace(/;$/, '')}) TO '${escaped}' (HEADER, DELIMITER ',')`);
  }

  private _exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this._db.exec(sql, (err) => err ? reject(err) : resolve());
    });
  }

  dispose() {
    this._db.close();
    outputChannel.appendLine(`ParquetDocument: disposed ${this.uri.fsPath}`);
  }
}

export class ParquetEditorProvider implements vscode.CustomReadonlyEditorProvider<ParquetDocument> {
  static readonly viewType = 'quackTable.dataExplorer';

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      ParquetEditorProvider.viewType,
      new ParquetEditorProvider(context),
      { webviewOptions: { retainContextWhenHidden: true } }
    );
  }

  constructor(private readonly _context: vscode.ExtensionContext) {}

  async openCustomDocument(uri: vscode.Uri): Promise<ParquetDocument> {
    const tableName = await this._pickAlias(uri);
    const doc = new ParquetDocument(uri, tableName);
    try {
      await doc.initialize();
    } catch (err) {
      outputChannel.appendLine(`ParquetEditorProvider: init error for ${uri.fsPath}: ${err}`);
    }
    return doc;
  }

  private async _pickAlias(uri: vscode.Uri): Promise<string> {
    const fileName = sanitizeTableName(path.parse(uri.fsPath).name);
    const dirName = sanitizeTableName(path.basename(path.dirname(uri.fsPath)));
    const baseName = path.basename(uri.fsPath);

    type Item = vscode.QuickPickItem & { value: string };

    const items: Item[] = [
      { label: fileName, description: 'file name (default)', value: fileName, picked: true },
    ];
    if (dirName && dirName !== fileName && dirName !== '.' && dirName !== '_') {
      items.push({ label: dirName, description: 'parent directory name', value: dirName });
    }
    items.push({ label: '$(edit) Enter custom alias…', description: '', value: '__custom__' });

    const picked = await vscode.window.showQuickPick<Item>(items, {
      title: `Table alias for ${baseName}`,
      placeHolder: 'Pick a name to use in SQL queries (e.g. SELECT * FROM <alias>)',
    });

    if (!picked || picked.value === fileName) return fileName;

    if (picked.value === '__custom__') {
      const custom = await vscode.window.showInputBox({
        title: `Custom alias for ${baseName}`,
        prompt: 'Enter a table alias (letters, numbers, underscores only)',
        value: fileName,
        validateInput: (v) => {
          if (!v.trim()) return 'Alias cannot be empty';
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v.trim())) {
            return 'Must start with a letter or underscore, and contain only letters, numbers, or underscores';
          }
          return null;
        },
      });
      return custom?.trim() ? custom.trim() : fileName;
    }

    return picked.value;
  }

  async resolveCustomEditor(
    document: ParquetDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._context.extensionUri, 'media'),
        vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', 'monaco-editor', 'min'),
      ],
    };
    webviewPanel.webview.html = this._getHtml(webviewPanel.webview, document);
    webviewPanel.webview.onDidReceiveMessage(msg => this._handleMessage(msg, document, webviewPanel));
  }

  private async _handleMessage(message: any, document: ParquetDocument, panel: vscode.WebviewPanel) {
    const post = (msg: any) => panel.webview.postMessage(msg);

    switch (message.type) {
      case 'ready': {
        try {
          const schema = await document.getSchema();
          const nullPercents = await document.getNullPercents(schema).catch(() => ({}));
          post({
            type: 'init',
            tableName: document.tableName,
            schema,
            nullPercents,
            defaultQuery: `SELECT * FROM "${document.tableName}"`,
          });
        } catch (err: any) {
          post({ type: 'init', tableName: document.tableName, schema: [], nullPercents: {}, defaultQuery: `SELECT * FROM "${document.tableName}"`, error: err.message });
        }
        break;
      }
      case 'query': {
        const startTime = Date.now();
        try {
          const result = await document.runQuery(message.sql, message.limit || 500, 0);
          const totalRows = result.error ? -1 : await document.countQuery(message.sql);
          post({ type: 'queryResult', ...result, totalRows, executionMs: Date.now() - startTime });
        } catch (err: any) {
          post({ type: 'queryResult', columns: [], rows: [], totalRows: 0, executionMs: Date.now() - startTime, error: err.message });
        }
        break;
      }
      case 'fetchMore': {
        const result = await document.runQuery(message.sql, message.limit || 500, message.offset || 0);
        post({ type: 'moreRows', rows: result.rows });
        break;
      }
      case 'saveAsCsv': {
        const saveUri = await vscode.window.showSaveDialog({
          filters: { 'CSV Files': ['csv'] },
          defaultUri: vscode.Uri.file('results.csv'),
        });
        if (!saveUri) break;
        try {
          await document.saveAsCsv(message.sql, saveUri.fsPath);
          vscode.window.showInformationMessage(`QuackTable: saved to ${saveUri.fsPath}`);
        } catch (err: any) {
          vscode.window.showErrorMessage(`QuackTable: save failed — ${err.message}`);
        }
        break;
      }
    }
  }

  private _getHtml(webview: vscode.Webview, document: ParquetDocument): string {
    const nonce = getNonce();
    const editorJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'editor.js'));
    const editorCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'editor.css'));
    const monacoVsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', 'monaco-editor', 'min', 'vs'));
    const cspSource = webview.cspSource;
    const fileName = path.basename(document.uri.fsPath);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} blob: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource}; worker-src blob:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${editorCssUri}">
  <title>${fileName}</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">var require = { paths: { vs: '${monacoVsUri}' } };</script>
  <script nonce="${nonce}" src="${monacoVsUri}/loader.js"></script>
  <script nonce="${nonce}" src="${editorJsUri}"></script>
</body>
</html>`;
  }
}
