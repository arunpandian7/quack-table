/* global require, acquireVsCodeApi */
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  // State
  let schema = [];
  let nullPercents = {};
  let tableName = '';
  let currentSql = '';
  let totalRows = -1;
  let loadedRows = 0;
  let isFetching = false;
  let monacoEditor = null;
  let selectedCell = null; // { rowIdx, colIdx, value }

  require(['vs/editor/editor.main'], function (monaco) {
    buildLayout();
    initMonaco(monaco);
    registerCompletions(monaco);
    bindEvents();
    vscode.postMessage({ type: 'ready' });
  });

  /* ── Layout ─────────────────────────────────────────────── */

  function buildLayout() {
    document.getElementById('app').innerHTML = `
      <div class="layout">
        <div class="schema-panel" id="schema-panel">
          <div class="schema-header">Schema</div>
          <div class="schema-body" id="schema-body">
            <div class="placeholder">Loading…</div>
          </div>
        </div>
        <div class="main-panel">
          <div class="editor-pane" id="editor-pane">
            <div id="monaco-container"></div>
            <div class="toolbar">
              <button class="btn btn-primary" id="run-btn" title="Ctrl+Enter">▶ Run</button>
              <button class="btn" id="save-btn" title="Export results to CSV">↓ Save CSV</button>
              <span class="toolbar-status" id="status"></span>
            </div>
          </div>
          <div class="resize-handle" id="resize-handle"></div>
          <div class="results-pane" id="results-pane">
            <div class="results-scroll" id="results-scroll">
              <div class="placeholder">Run a query to see results</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ── Monaco ──────────────────────────────────────────────── */

  function initMonaco(monaco) {
    const isDark = document.body.className.includes('vscode-dark') ||
      document.body.className.includes('vscode-high-contrast');

    monacoEditor = monaco.editor.create(
      document.getElementById('monaco-container'),
      {
        value: '',
        language: 'sql',
        theme: isDark ? 'vs-dark' : 'vs',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 13,
        lineHeight: 20,
        padding: { top: 8, bottom: 8 },
        automaticLayout: true,
        suggestOnTriggerCharacters: true,
        quickSuggestions: { other: true, comments: false, strings: false },
        wordBasedSuggestions: 'off',
        tabSize: 2,
        renderLineHighlight: 'line',
        scrollbar: { vertical: 'auto', horizontal: 'auto' },
      }
    );

    monacoEditor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      runQuery
    );
  }

  function registerCompletions(monaco) {
    monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', '.', '"'],
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const items = [];

        // Table name
        if (tableName) {
          items.push({
            label: tableName,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: `"${tableName}"`,
            range,
            detail: 'table',
            sortText: '0',
          });
        }

        // Columns
        for (const col of schema) {
          items.push({
            label: col.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: col.name,
            range,
            detail: col.type,
            documentation: col.type,
            sortText: '1' + col.name,
          });
        }

        // SQL keywords
        const keywords = [
          'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET',
          'HAVING', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN',
          'ON', 'AS', 'DISTINCT', 'ALL', 'UNION', 'INTERSECT', 'EXCEPT',
          'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT(*)',
          'AND', 'OR', 'NOT', 'IN', 'NOT IN', 'EXISTS',
          'IS NULL', 'IS NOT NULL', 'LIKE', 'ILIKE', 'BETWEEN',
          'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
          'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST',
          'CAST', 'COALESCE', 'NULLIF', 'IFF',
          'STRFTIME', 'DATE_TRUNC', 'DATE_DIFF', 'NOW', 'TODAY',
          'ARRAY_AGG', 'STRING_AGG', 'LIST_AGG',
          'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'OVER', 'PARTITION BY',
          'WITH', 'RECURSIVE', 'VALUES', 'LATERAL',
        ];
        for (const kw of keywords) {
          items.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            sortText: '2' + kw,
          });
        }

        return { suggestions: items };
      },
    });
  }

  /* ── Events ──────────────────────────────────────────────── */

  function bindEvents() {
    document.getElementById('run-btn').addEventListener('click', runQuery);
    document.getElementById('save-btn').addEventListener('click', () => {
      if (!monacoEditor) return;
      vscode.postMessage({ type: 'saveAsCsv', sql: monacoEditor.getValue() });
    });

    // Vertical resize handle between editor and results
    const handle = document.getElementById('resize-handle');
    const editorPane = document.getElementById('editor-pane');
    let dragging = false;
    let startY = 0;
    let startHeight = 0;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startY = e.clientY;
      startHeight = editorPane.getBoundingClientRect().height;
      document.body.style.cursor = 'ns-resize';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const delta = e.clientY - startY;
      const newHeight = Math.max(80, Math.min(startHeight + delta, window.innerHeight - 120));
      editorPane.style.height = newHeight + 'px';
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
      document.body.style.cursor = '';
    });

    // Infinite scroll
    document.getElementById('results-scroll').addEventListener('scroll', onScroll);

    // Keyboard shortcuts on results
    document.addEventListener('keydown', onKeyDown);
  }

  /* ── Query execution ─────────────────────────────────────── */

  function runQuery() {
    if (!monacoEditor) return;
    const sql = monacoEditor.getValue().trim();
    if (!sql) return;
    currentSql = sql;
    totalRows = -1;
    loadedRows = 0;
    selectedCell = null;
    setStatus('Running…');
    setResultsHtml('<div class="placeholder">Running query…</div>');
    vscode.postMessage({ type: 'query', sql, limit: 500 });
  }

  function onScroll() {
    if (isFetching || totalRows < 0) return;
    const el = document.getElementById('results-scroll');
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
      if (loadedRows < totalRows) {
        isFetching = true;
        vscode.postMessage({ type: 'fetchMore', sql: currentSql, offset: loadedRows, limit: 500 });
      }
    }
  }

  /* ── Message handler ─────────────────────────────────────── */

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init': {
        tableName = msg.tableName;
        schema = msg.schema || [];
        nullPercents = msg.nullPercents || {};
        renderSchema();
        if (monacoEditor) {
          monacoEditor.setValue(msg.defaultQuery);
          monacoEditor.setPosition({ lineNumber: 1, column: msg.defaultQuery.length + 1 });
        }
        if (msg.error) {
          showError(msg.error);
        } else {
          runQuery();
        }
        break;
      }
      case 'queryResult': {
        loadedRows = (msg.rows || []).length;
        totalRows = msg.totalRows ?? -1;
        if (msg.error) {
          showError(msg.error);
          setStatus('Error');
        } else {
          renderTable(msg.columns, msg.rows);
          const rowLabel = totalRows >= 0 ? `${loadedRows} / ${totalRows} rows` : `${loadedRows} rows`;
          setStatus(`${rowLabel}${msg.executionMs != null ? ' · ' + msg.executionMs + ' ms' : ''}`);
        }
        break;
      }
      case 'moreRows': {
        appendRows(msg.rows || []);
        loadedRows += (msg.rows || []).length;
        isFetching = false;
        break;
      }
    }
  });

  /* ── Render ──────────────────────────────────────────────── */

  function renderSchema() {
    const body = document.getElementById('schema-body');
    if (!schema.length) {
      body.innerHTML = '<div class="placeholder">No columns found</div>';
      return;
    }
    body.innerHTML =
      `<div class="schema-table-name" title="${esc(tableName)}">${esc(tableName)}</div>` +
      schema.map(col => {
        const pct = nullPercents[col.name];
        const hasPct = pct !== undefined;
        const pctLabel = hasPct ? (pct % 1 === 0 ? pct + '%' : pct.toFixed(1) + '%') : '';
        const nullCls = pct === 100 ? 'null-pct all' : pct > 0 ? 'null-pct some' : 'null-pct none';
        const tooltip = `${col.type}${hasPct ? ' · ' + pctLabel + ' null' : ''}`;
        return `<div class="schema-col" title="${esc(tooltip)}">
          <span class="schema-col-name">${esc(col.name)}</span>
          <span class="schema-col-type">${esc(col.type)}</span>
          ${hasPct ? `<span class="${nullCls}">${pctLabel}</span>` : ''}
        </div>`;
      }).join('');
  }

  function renderTable(columns, rows) {
    if (!columns.length) {
      setResultsHtml('<div class="placeholder">Query returned no rows</div>');
      return;
    }
    const thHtml = columns.map(c => `<th class="grid-th">${esc(String(c))}</th>`).join('');
    setResultsHtml(
      `<table class="grid"><thead><tr>${thHtml}</tr></thead><tbody id="grid-body"></tbody></table>`
    );
    appendRows(rows);
  }

  function appendRows(rows) {
    const body = document.getElementById('grid-body');
    if (!body || !rows.length) return;
    const frag = document.createDocumentFragment();
    const startIdx = loadedRows;
    rows.forEach((row, i) => {
      const tr = document.createElement('tr');
      row.forEach((cell, j) => {
        const td = document.createElement('td');
        const isNull = cell === null || cell === undefined;
        td.className = 'grid-td' + (isNull ? ' null' : '');
        td.textContent = isNull ? 'null' : formatCell(cell);
        td.addEventListener('click', () => selectCell(startIdx + i, j, isNull ? null : formatCell(cell), td));
        tr.appendChild(td);
      });
      frag.appendChild(tr);
    });
    body.appendChild(frag);
  }

  function selectCell(rowIdx, colIdx, value, el) {
    document.querySelectorAll('.grid-td.selected').forEach(c => c.classList.remove('selected'));
    selectedCell = { rowIdx, colIdx, value };
    el.classList.add('selected');
  }

  function onKeyDown(e) {
    if (e.ctrlKey && e.key === 'c' && selectedCell !== null) {
      navigator.clipboard.writeText(selectedCell.value === null ? '' : String(selectedCell.value));
    }
  }

  /* ── Helpers ─────────────────────────────────────────────── */

  function setResultsHtml(html) {
    document.getElementById('results-scroll').innerHTML = html;
  }

  function showError(msg) {
    setResultsHtml(`<div class="error-msg">${esc(msg)}</div>`);
  }

  function setStatus(text) {
    const el = document.getElementById('status');
    if (el) el.textContent = text;
  }

  function formatCell(value) {
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
