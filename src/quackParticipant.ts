import * as vscode from 'vscode';
import * as path from 'path';
import { ActiveDocumentTracker } from './activeDocumentTracker';
import { outputChannel } from './extension';

export function registerChatParticipant(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant('quacktable', handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'duck.svg');
  context.subscriptions.push(participant);
}

async function handler(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  const ctx = ActiveDocumentTracker.get();

  if (!ctx) {
    stream.markdown(
      'No QuackTable file is currently focused.\n\n' +
      'Open a `.parquet`, `.csv`, or `.json` file first, then ask me anything.'
    );
    return {};
  }

  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  outputChannel.appendLine(`QuackTable chat: found ${models.length} model(s): ${models.map(m => m.id).join(', ')}`);

  if (!models.length) {
    stream.markdown(
      'GitHub Copilot is not available. ' +
      'Please install the **GitHub Copilot Chat** extension and sign in.'
    );
    return {};
  }

  const messages = buildMessages(request, chatContext, ctx);
  outputChannel.appendLine(`QuackTable chat: sending ${messages.length} message(s) to ${models[0].id}`);

  try {
    stream.progress('Thinking…');
    const response = await models[0].sendRequest(messages, {}, token);
    // response.text is an async iterable of plain strings (text parts only)
    for await (const text of response.text) {
      stream.markdown(text);
    }
    outputChannel.appendLine('QuackTable chat: response complete');
  } catch (err: any) {
    outputChannel.appendLine(`QuackTable chat error: ${err?.message ?? err}`);
    if (err?.code === vscode.LanguageModelError.Blocked().code) {
      stream.markdown('The request was blocked by the content filter.');
    } else {
      stream.markdown(`Error: ${err?.message ?? err}`);
    }
  }

  return {};
}

function buildMessages(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  ctx: ReturnType<typeof ActiveDocumentTracker.get>
): vscode.LanguageModelChatMessage[] {
  const schemaText = ctx!.schema
    .map(col => {
      const pct = ctx!.nullPercents[col.name];
      const nullHint = pct !== undefined && pct > 0 ? ` -- ${pct}% null` : '';
      return `  ${col.name} ${col.type}${nullHint}`;
    })
    .join('\n');

  const fileName = path.basename(ctx!.filePath);

  let commandHint = '';
  if (request.command === 'suggest') {
    commandHint =
      '\n\nThe user wants you to suggest 5 useful SQL queries for this dataset. ' +
      'Cover a mix of: overview, filtering, aggregation, sorting, and one analytical/window query. ' +
      'For each query include a one-line comment explaining what it does.';
  } else if (request.command === 'explain') {
    commandHint =
      '\n\nThe user wants you to explain what the current SQL query does, ' +
      'step by step, in plain English. Also mention any potential issues.';
  } else if (request.command === 'fix') {
    commandHint =
      '\n\nThe user wants you to fix or improve the current SQL query. ' +
      'Show the corrected query and briefly explain what was wrong.';
  }

  let sampleRowsText = '';
  if (ctx!.sampleColumns.length > 0 && ctx!.sampleRows.length > 0) {
    const header = '| ' + ctx!.sampleColumns.join(' | ') + ' |';
    const sep = '| ' + ctx!.sampleColumns.map(() => '---').join(' | ') + ' |';
    const rows = ctx!.sampleRows.map(row => '| ' + row.map(v => String(v ?? '')).join(' | ') + ' |').join('\n');
    sampleRowsText = `\nSample rows (up to 5):\n${header}\n${sep}\n${rows}\n`;
  }

  const systemPrompt =
    `You are a DuckDB SQL expert helping the user analyse a data file in QuackTable (a VS Code extension).\n\n` +
    `File: ${fileName}\n` +
    `Table alias: "${ctx!.tableName}"\n\n` +
    `Schema:\n${schemaText}\n\n` +
    `Current SQL:\n\`\`\`sql\n${ctx!.currentSql}\n\`\`\`\n` +
    sampleRowsText +
    `\nRules:\n` +
    `- Use DuckDB SQL syntax (not standard SQL where they differ).\n` +
    `- Always quote the table name with double-quotes: \`"${ctx!.tableName}"\`.\n` +
    `- Wrap every SQL snippet in a \`\`\`sql code block.\n` +
    `- Keep answers concise and practical.` +
    commandHint;

  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
  ];

  // Replay conversation history
  for (const turn of chatContext.history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .filter((p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart)
        .map(p => p.value.value)
        .join('');
      if (text) messages.push(vscode.LanguageModelChatMessage.Assistant(text));
    }
  }

  messages.push(vscode.LanguageModelChatMessage.User(request.prompt));
  return messages;
}
