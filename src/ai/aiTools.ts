import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface WriteFileParams {
    path: string;
    content: string;
    mode?: 'replace' | 'insert';
}

export const aiTools: { [key: string]: Function } = {
    write_file: async (params: WriteFileParams): Promise<void> => {
        const { path: filePath, content, mode = 'replace' } = params;
        
        // Resolve path if relative
        let resolvedPath = filePath;
        if (!path.isAbsolute(filePath) && vscode.workspace.workspaceFolders?.length) {
            resolvedPath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
        }
        
        // Ensure directory exists
        const directory = path.dirname(resolvedPath);
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }
        
        // Write file
        if (mode === 'replace' || !fs.existsSync(resolvedPath)) {
            fs.writeFileSync(resolvedPath, content);
        } else if (mode === 'insert') {
            // For insert mode, we need to find the active editor with this file
            const editors = vscode.window.visibleTextEditors;
            const editor = editors.find(e => e.document.uri.fsPath === resolvedPath);
            
            if (editor) {
                const position = editor.selection.active;
                const edit = new vscode.WorkspaceEdit();
                edit.insert(editor.document.uri, position, content);
                await vscode.workspace.applyEdit(edit);
            } else {
                // If no editor is open with this file, append to the end
                const existingContent = fs.readFileSync(resolvedPath, 'utf8');
                fs.writeFileSync(resolvedPath, existingContent + content);
            }
        }
    }
};