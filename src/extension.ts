import * as vscode from 'vscode';
import { ParquetEditorProvider } from './parquetEditorProvider';

export const outputChannel = vscode.window.createOutputChannel('QuackTable');

export function activate(context: vscode.ExtensionContext) {
    outputChannel.appendLine('QuackTable extension activated');
    outputChannel.appendLine(`Node version: ${process.version}`);
    outputChannel.appendLine(`Platform: ${process.platform}`);

    try {
        context.subscriptions.push(ParquetEditorProvider.register(context));
        outputChannel.appendLine('Custom editor provider registered successfully');
    } catch (error) {
        outputChannel.appendLine(`ERROR: Failed to register custom editor provider: ${error}`);
        vscode.window.showErrorMessage(`QuackTable: Failed to activate — ${error}`);
        throw error;
    }

    context.subscriptions.push(outputChannel);
}

export function deactivate() {
    outputChannel.appendLine('QuackTable extension deactivated');
}
