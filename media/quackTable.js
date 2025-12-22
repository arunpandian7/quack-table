// Provides callback for when HTML element loads
function waitForElement(selector) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                resolve(document.querySelector(selector));
                observer.disconnect();
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

    });
}

function waitForElements(selectors) {
    return new Promise(resolve => {
        let numWaiting = selectors.length
        const elements = selectors.map(() => null);
        const callback = (element, index) => {
            numWaiting--;
            elements[index] = element
            if (numWaiting == 0) {
                resolve(elements);
            }
        };
        selectors.forEach((selector, index) => {
            waitForElement(selector).then((element) => callback(element, index));
        });
    });

}

// https://tabulator.info/docs/6.2/format
function getFormatter(columnType) {
    switch (columnType) {
        case "DATE":
            return {
                formatter: function(cell, formatterParams, onRendered) {
                    const value = cell.getValue();
                    if (value === null || value === undefined) {
                        return '<span class="null-value">NULL</span>';
                    }
                    // Use datetime formatter for non-null values
                    const date = luxon.DateTime.fromISO(value, { zone: 'utc' });
                    return date.toFormat('yyyy-MM-dd');
                },
            };
        default:
            return {
                formatter: function(cell, formatterParams, onRendered) {
                    const value = cell.getValue();
                    if (value === null || value === undefined) {
                        return '<span class="null-value">NULL</span>';
                    }
                    // For other types, convert to string and preserve formatting
                    return String(value).replace(/\n/g, '<br>');
                },
            };
    }
}

(function () {
    // Get a reference to the VS Code webview api.
    // We use this API to post messages back to our extension.
    const vscode = acquireVsCodeApi();

    let autoQuery = true;

    let textAreaElement = undefined;
    let columnNames = []; // Store column names for autocomplete
    let suggestionBox = null;
    let selectedSuggestionIndex = -1;
    let currentSuggestions = [];
    
    // Common SQL keywords
    const SQL_KEYWORDS = [
        'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL',
        'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'AND', 'OR',
        'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL', 'DISTINCT', 'COUNT', 'SUM',
        'AVG', 'MIN', 'MAX', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'INSERT',
        'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE', 'VIEW', 'INDEX',
        'ASC', 'DESC', 'UNION', 'INTERSECT', 'EXCEPT', 'WITH'
    ];
    let loadingIconElement = undefined;
    let errorMessageElement = undefined;
    let tableElement = undefined;
    let table = undefined;
    let last_sql = undefined;

    // Whether the spinner is currently showoing
    let loadingScroll = false;

    // Whether or not there's additional query results to load
    let moreToLoad = false;

    // Offset to use when fetching additional results
    let scrollOffset = 0;

    // Cell selection state
    let selectedCells = new Set();
    let contextMenu = null;
    let copyNotification = null;

    // Cell selection and copy functionality
    function createContextMenu() {
        const menu = document.createElement('div');
        menu.className = 'cell-context-menu';
        menu.innerHTML = `
            <div class="context-menu-item" data-action="copy">
                <span>Copy Cell Value</span>
                <span class="shortcut">Ctrl+C</span>
            </div>
            <div class="context-menu-item" data-action="copy-all">
                <span>Copy All Selected</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="select-row">
                <span>Select Row</span>
            </div>
            <div class="context-menu-item" data-action="select-column">
                <span>Select Column</span>
            </div>
        `;
        document.body.appendChild(menu);
        return menu;
    }

    function createCopyNotification() {
        const notification = document.createElement('div');
        notification.className = 'copy-notification';
        notification.textContent = 'Copied to clipboard!';
        document.body.appendChild(notification);
        return notification;
    }

    function showCopyNotification() {
        if (copyNotification) {
            copyNotification.classList.add('show');
            setTimeout(() => {
                copyNotification.classList.remove('show');
            }, 1500);
        }
    }

    function clearSelection() {
        selectedCells.forEach(cell => {
            cell.getElement().classList.remove('selected-cell');
        });
        selectedCells.clear();
    }

    function selectCell(cell, isMultiSelect = false) {
        if (!isMultiSelect) {
            clearSelection();
        }
        const element = cell.getElement();
        element.classList.add('selected-cell');
        selectedCells.add(cell);
    }

    function copyCellValue(cell) {
        const value = cell.getValue();
        const text = value !== null && value !== undefined ? String(value) : '';
        navigator.clipboard.writeText(text).then(() => {
            showCopyNotification();
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });
    }

    function copySelectedCells() {
        if (selectedCells.size === 0) return;
        
        const values = Array.from(selectedCells).map(cell => {
            const value = cell.getValue();
            return value !== null && value !== undefined ? String(value) : '';
        });
        
        const text = values.join('\n');
        navigator.clipboard.writeText(text).then(() => {
            showCopyNotification();
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });
    }

    function selectRow(cell) {
        clearSelection();
        const row = cell.getRow();
        const cells = row.getCells();
        cells.forEach(c => {
            if (c.getColumn().getField()) { // Skip row number column
                selectCell(c, true);
            }
        });
    }

    function selectColumn(cell) {
        clearSelection();
        const column = cell.getColumn();
        const field = column.getField();
        if (!field) return; // Skip row number column
        
        table.getRows().forEach(row => {
            const cellInColumn = row.getCell(field);
            if (cellInColumn) {
                selectCell(cellInColumn, true);
            }
        });
    }

    function hideContextMenu() {
        if (contextMenu) {
            contextMenu.classList.remove('visible');
        }
    }

    function showContextMenu(x, y, cell) {
        if (!contextMenu) return;
        
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
        contextMenu.classList.add('visible');
        
        // Store the cell reference for context menu actions
        contextMenu.dataset.cellId = cell.getRow().getIndex() + '_' + cell.getColumn().getField();
        contextMenu.currentCell = cell;
    }

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.type) {
            case 'config':
                autoQuery = message.autoQuery;
                break;
            case 'query':
                loadingScroll = false;
                loadingIconElement.style.display = "none";
                textAreaElement.disabled = false;
                const executeBtn = document.getElementById('executeBtn');
                if (executeBtn) executeBtn.disabled = false;

                if (message.results) {
                    tableElement.style.display = "block"
                    moreToLoad = message.results.length >= CHUNK_SIZE
                    scrollOffset = 0

                    // Store column names for autocomplete
                    columnNames = message.describe.map(col => col.column_name);

                    // Update schema panel first to get stats
                    if (message.describe && message.statistics) {
                        updateSchemaPanel(message.describe, message.statistics);
                    }

                    const columns = [
                        { formatter: "rownum", hozAlign: "right", headerHozAlign: "center", width: 1, frozen: true, resizable: false, },
                        ...message.describe.map(column => {
                            const stats = message.statistics;
                            const totalRows = stats?.total_rows || 0;
                            const nulls = stats?.[column.column_name + '_nulls'] || 0;
                            const distinct = stats?.[column.column_name + '_distinct'] || 0;
                            const nullPct = totalRows > 0 ? ((nulls / totalRows) * 100).toFixed(1) : '0.0';
                            
                            return {
                                title: column.column_name,
                                field: column.column_name,
                                headerTooltip: function(e, cell) {
                                    const tooltip = document.createElement('div');
                                    tooltip.className = 'column-stats-tooltip';
                                    tooltip.innerHTML = `
                                        <div class="tooltip-header">
                                            <span class="tooltip-icon">📊</span>
                                            <strong>${escapeHtml(column.column_name)}</strong>
                                        </div>
                                        <div class="tooltip-row">
                                            <span class="tooltip-label">Type:</span>
                                            <span class="tooltip-value type-badge">${escapeHtml(column.column_type)}</span>
                                        </div>
                                        <div class="tooltip-row">
                                            <span class="tooltip-label">Null Count:</span>
                                            <span class="tooltip-value">${nulls.toLocaleString()}</span>
                                        </div>
                                        <div class="tooltip-row">
                                            <span class="tooltip-label">Null %:</span>
                                            <span class="tooltip-value ${nullPct > 50 ? 'high-null' : nullPct > 10 ? 'med-null' : 'low-null'}">${nullPct}%</span>
                                        </div>
                                        <div class="tooltip-row">
                                            <span class="tooltip-label">Distinct Values:</span>
                                            <span class="tooltip-value distinct-badge">${distinct.toLocaleString()}</span>
                                        </div>
                                    `;
                                    return tooltip;
                                },
                                ...getFormatter(column.column_type),
                            }
                        })
                    ];

                    if (table) {
                        table.replaceData(message.results);
                        table.setColumns(columns);
                    }
                    else {
                        table = new Tabulator("#results", {
                            height: "calc(100% + 10vh)",
                            data: message.results,
                            layout: "fitData",
                            placeholder: "No Results",
                            resizableColumnGuide: true,
                            columnDefaults: {
                                resizable: true,
                                headerSort: false,
                                formatter: "textarea",
                                maxInitialWidth: window.innerWidth * 0.4,
                            },
                            columns: columns
                        });
                        
                        // Initialize context menu and copy notification
                        if (!contextMenu) {
                            contextMenu = createContextMenu();
                            copyNotification = createCopyNotification();
                            
                            // Context menu event handlers
                            contextMenu.addEventListener('click', (e) => {
                                const item = e.target.closest('.context-menu-item');
                                if (!item) return;
                                
                                const action = item.dataset.action;
                                const cell = contextMenu.currentCell;
                                
                                if (!cell) return;
                                
                                switch(action) {
                                    case 'copy':
                                        copyCellValue(cell);
                                        break;
                                    case 'copy-all':
                                        copySelectedCells();
                                        break;
                                    case 'select-row':
                                        selectRow(cell);
                                        break;
                                    case 'select-column':
                                        selectColumn(cell);
                                        break;
                                }
                                
                                hideContextMenu();
                            });
                            
                            // Hide menu when clicking outside
                            document.addEventListener('click', (e) => {
                                if (!contextMenu.contains(e.target)) {
                                    hideContextMenu();
                                }
                            });
                        }
                        
                        // Cell click handler
                        table.on("cellClick", function(e, cell) {
                            // Skip row number column
                            if (!cell.getColumn().getField()) return;
                            
                            const isMultiSelect = e.ctrlKey || e.metaKey || e.shiftKey;
                            selectCell(cell, isMultiSelect);
                        });
                        
                        // Cell context menu handler
                        table.on("cellContext", function(e, cell) {
                            e.preventDefault();
                            
                            // Skip row number column
                            if (!cell.getColumn().getField()) return;
                            
                            // Select the cell if not already selected
                            if (!selectedCells.has(cell)) {
                                selectCell(cell, false);
                            }
                            
                            showContextMenu(e.pageX, e.pageY, cell);
                        });
                        
                        // Double-click to copy
                        table.on("cellDblClick", function(e, cell) {
                            if (!cell.getColumn().getField()) return;
                            copyCellValue(cell);
                        });
                        table.on("scrollVertical", function (top) {
                            const element = table.rowManager.element;
                            if (top >= element.scrollHeight - element.offsetHeight && !loadingScroll && moreToLoad) {
                                loadingScroll = true;
                                scrollOffset += CHUNK_SIZE;
                                loadingIconElement.style.display = "block"
                                textAreaElement.disabled = true
                                const sql = textAreaElement.parentElement.value;
                                vscode.postMessage({
                                    type: 'more',
                                    sql: sql,
                                    limit: CHUNK_SIZE,
                                    offset: scrollOffset
                                })
                            }
                        });
                    }

                }
                else if (message.message) {
                    console.error('[QuackTable:Frontend] Query error:', message.message);
                    tableElement.style.display = "none"
                    errorMessageElement.style.display = "block";
                    errorMessageElement.textContent = message.message;
                }
                break;

            case 'more':
                console.log('[QuackTable:Frontend] Processing more results');
                loadingScroll = false;
                loadingIconElement.style.display = "none";
                textAreaElement.disabled = false

                if (message.results.length < CHUNK_SIZE)
                    moreToLoad = false

                if (message.results.length > 0 && table) {
                    table.addData(message.results)
                }
                break;
        }
    });

    // Create suggestion box
    function createSuggestionBox() {
        if (suggestionBox) return;
        
        suggestionBox = document.createElement('div');
        suggestionBox.className = 'sql-suggestions';
        document.body.appendChild(suggestionBox);
        
        suggestionBox.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent losing focus
            const item = e.target.closest('.suggestion-item');
            if (item) {
                const index = parseInt(item.dataset.index);
                applySuggestion(currentSuggestions[index]);
            }
        });
    }
    
    function showSuggestions(textarea, suggestions, partial) {
        if (!suggestions || suggestions.length === 0) {
            hideSuggestions();
            return;
        }
        
        createSuggestionBox();
        currentSuggestions = suggestions;
        selectedSuggestionIndex = 0;
        
        // Position the suggestion box
        const rect = textarea.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(textarea);
        const lineHeight = parseFloat(computedStyle.lineHeight) || 20;
        
        suggestionBox.style.left = rect.left + 'px';
        suggestionBox.style.top = (rect.top + lineHeight + 5) + 'px';
        suggestionBox.style.minWidth = '200px';
        
        // Build suggestion list
        suggestionBox.innerHTML = suggestions.map((sugg, idx) => {
            const isKeyword = SQL_KEYWORDS.includes(sugg.toUpperCase());
            const type = isKeyword ? 'keyword' : 'column';
            const icon = isKeyword ? '🔤' : '📊';
            return `<div class="suggestion-item ${idx === 0 ? 'selected' : ''}" data-index="${idx}">
                <span class="suggestion-icon">${icon}</span>
                <span class="suggestion-text">${escapeHtml(sugg)}</span>
                <span class="suggestion-type">${type}</span>
            </div>`;
        }).join('');
        
        suggestionBox.style.display = 'block';
    }
    
    function hideSuggestions() {
        if (suggestionBox) {
            suggestionBox.style.display = 'none';
        }
        currentSuggestions = [];
        selectedSuggestionIndex = -1;
    }
    
    function updateSelectedSuggestion(direction) {
        if (currentSuggestions.length === 0) return;
        
        selectedSuggestionIndex += direction;
        if (selectedSuggestionIndex < 0) selectedSuggestionIndex = currentSuggestions.length - 1;
        if (selectedSuggestionIndex >= currentSuggestions.length) selectedSuggestionIndex = 0;
        
        // Update visual selection
        const items = suggestionBox.querySelectorAll('.suggestion-item');
        items.forEach((item, idx) => {
            item.classList.toggle('selected', idx === selectedSuggestionIndex);
        });
        
        // Scroll into view
        items[selectedSuggestionIndex]?.scrollIntoView({ block: 'nearest' });
    }
    
    function applySuggestion(suggestion) {
        if (!textAreaElement || !suggestion) return;
        
        const cursorPos = textAreaElement.selectionStart;
        const textBeforeCursor = textAreaElement.value.substring(0, cursorPos);
        const textAfterCursor = textAreaElement.value.substring(cursorPos);
        const lastWord = textBeforeCursor.split(/\s+/).pop();
        
        const newValue = textBeforeCursor.substring(0, textBeforeCursor.length - lastWord.length) + 
                       suggestion + ' ' + textAfterCursor;
        
        textAreaElement.value = newValue;
        const newCursorPos = cursorPos - lastWord.length + suggestion.length + 1;
        textAreaElement.selectionStart = textAreaElement.selectionEnd = newCursorPos;
        
        // Update the code-input display
        textAreaElement.dispatchEvent(new Event('input'));
        hideSuggestions();
    }
    
    function getSuggestions(partial) {
        if (!partial || partial.length < 2) return [];
        
        const lowerPartial = partial.toLowerCase();
        const suggestions = [];
        
        // Add matching columns first
        columnNames.forEach(col => {
            if (col.toLowerCase().startsWith(lowerPartial)) {
                suggestions.push(col);
            }
        });
        
        // Add matching SQL keywords
        SQL_KEYWORDS.forEach(keyword => {
            if (keyword.toLowerCase().startsWith(lowerPartial)) {
                suggestions.push(keyword);
            }
        });
        
        return suggestions.slice(0, 10); // Limit to 10 suggestions
    }

    // Initialize the text area syntax highlighting
    codeInput.registerTemplate("syntax-highlighted",
        codeInput.templates.prism(
            Prism,
            [
                new codeInput.plugins.Indent()
            ]
        )
    );

    // Define text-area event handlers
    const onKeyDown = (event) => {
        // Allow Ctrl/Cmd + Enter to send query
        if ((event.ctrlKey || event.metaKey) && event.code == "Enter") {
            event.preventDefault();
            event.stopPropagation();
            runQuery();
            return;
        }
        
        // Handle suggestion box navigation
        if (suggestionBox && suggestionBox.style.display === 'block') {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                event.stopPropagation();
                updateSelectedSuggestion(1);
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopPropagation();
                updateSelectedSuggestion(-1);
                return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                if (currentSuggestions[selectedSuggestionIndex]) {
                    applySuggestion(currentSuggestions[selectedSuggestionIndex]);
                }
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                hideSuggestions();
                return;
            }
        }
        
        // Ctrl/Cmd + Space to trigger suggestions
        if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
            event.preventDefault();
            const textarea = event.target;
            const cursorPos = textarea.selectionStart;
            const textBeforeCursor = textarea.value.substring(0, cursorPos);
            const lastWord = textBeforeCursor.split(/\s+/).pop();
            
            const suggestions = getSuggestions(lastWord || '');
            if (suggestions.length > 0) {
                showSuggestions(textarea, suggestions, lastWord);
            }
        }
    }

    const onInput = (event) => {
        vscode.setState({ sql: event.target.parentElement.value })
        
        // Show suggestions as user types
        const textarea = event.target;
        const cursorPos = textarea.selectionStart;
        const textBeforeCursor = textarea.value.substring(0, cursorPos);
        const lastWord = textBeforeCursor.split(/\s+/).pop();
        
        if (lastWord && lastWord.length >= 2) {
            const suggestions = getSuggestions(lastWord);
            if (suggestions.length > 0) {
                showSuggestions(textarea, suggestions, lastWord);
            } else {
                hideSuggestions();
            }
        } else {
            hideSuggestions();
        }
    }

    const onChange = () => {
        if (autoQuery) {
            runQuery();
        }
    }

    const runQuery = () => {
        const sql = textAreaElement.parentElement.value;

        // Ctrl/Cmd + Enter causes onChange to be called twice
        if (sql === last_sql) return;
        last_sql = sql;

        loadingScroll = true;
        tableElement.style.display = "none";
        loadingIconElement.style.display = "block";
        errorMessageElement.style.display = "none";
        textAreaElement.disabled = true;
        
        const executeBtn = document.getElementById('executeBtn');
        if (executeBtn) executeBtn.disabled = true;

        if (table) {
            table.replaceData([]);
            table.setColumns([]);
        }

        vscode.postMessage({
            type: 'query',
            sql: sql,
            limit: CHUNK_SIZE,
        });
    };

    waitForElements([
        "textarea", 
        "#results", 
        "#loadingIcon", 
        "#errorMessage",
        "#executeBtn"
    ]).then(([textarea, results, loadingIcon, errorMessage, executeBtn]) => {
        textAreaElement = textarea;
        loadingIconElement = loadingIcon;
        errorMessageElement = errorMessage;
        tableElement = results;

        // Execute button handler
        executeBtn.addEventListener('click', () => {
            runQuery();
        });

        // Register text-area event handlers
        textarea.addEventListener("input", onInput);
        textarea.addEventListener("change", onChange);
        textarea.addEventListener("keydown", onKeyDown, true);
        
        // Global keyboard shortcuts for cell operations
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + C to copy selected cells (when not in textarea)
            if ((e.ctrlKey || e.metaKey) && e.key === 'c' && document.activeElement !== textarea) {
                if (selectedCells.size > 0) {
                    e.preventDefault();
                    copySelectedCells();
                }
            }
            // Escape to clear selection
            if (e.key === 'Escape') {
                clearSelection();
                hideContextMenu();
            }
            // Ctrl/Cmd + A to select all cells (when table has focus)
            if ((e.ctrlKey || e.metaKey) && e.key === 'a' && document.activeElement !== textarea && table) {
                e.preventDefault();
                clearSelection();
                table.getRows().forEach(row => {
                    row.getCells().forEach(cell => {
                        if (cell.getColumn().getField()) {
                            selectCell(cell, true);
                        }
                    });
                });
            }
        });

        // Load stored query (if any) and trigger its execution
        const state = vscode.getState();
        if (state)
            textarea.parentElement.value = state.sql;
        textarea.dispatchEvent(new Event("input"));
        textarea.dispatchEvent(new Event("change"));

        // Initialize tabs after DOM is ready
        const tabButtons = document.querySelectorAll('.tab-button');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabName = button.dataset.tab;
                
                // Update buttons
                document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                // Update panes
                document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
                const targetPane = document.getElementById(tabName + 'Tab');
                if (targetPane) {
                    targetPane.classList.add('active');
                }
            });
        });

    })

    // Update Schema and Stats
    function updateSchemaPanel(describe, stats) {
        if (!describe || !stats) {
            return;
        }
        
        const totalRows = stats.total_rows || 0;
        
        // Update Schema Tab with statistics
        const schemaContent = document.getElementById('schemaContent');
        if (schemaContent) {
            let html = `<div class="stats-header">
                <h3>Table Schema</h3>
                <p>Total Rows: <strong>${totalRows.toLocaleString()}</strong></p>
                </div>
                <table class="schema-table"><thead><tr>
                <th>Column Name</th><th>Data Type</th><th>Null Count</th><th>Null %</th><th>Distinct Values</th>
            </tr></thead><tbody>`;

            describe.forEach(col => {
                const name = col.column_name;
                const nulls = stats[name + '_nulls'] || 0;
                const distinct = stats[name + '_distinct'] || 0;
                const nullPct = totalRows > 0 ? ((nulls / totalRows) * 100).toFixed(1) : '0.0';

                html += `<tr>
                    <td class="col-name">${escapeHtml(name)}</td>
                    <td><span class="col-type">${escapeHtml(col.column_type)}</span></td>
                    <td>${nulls.toLocaleString()}</td>
                    <td>${nullPct}%</td>
                    <td>${distinct.toLocaleString()}</td>
                </tr>`;
            });

            html += `</tbody></table>`;
            schemaContent.innerHTML = html;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

}());
