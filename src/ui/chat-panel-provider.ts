import * as vscode from "vscode";
import * as ejs from "ejs";
import { ContextManager } from "../context/context-manager";
import { modelsInfo } from "../ai/ai-providers-info";

export class ChatPanelProvider {
  private static panel: vscode.WebviewPanel | null = null;

  static render() {
    const ctx = ContextManager.getInstance();
    const vscodeCtx = ctx.getVSCodeContext();

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "aiCoderChat",
        "AI Coder Chat",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(vscodeCtx.extensionUri, "assets"),
          ],
        }
      );

      this.panel.webview.onDidReceiveMessage(this.handleMessage);
      this.panel.onDidDispose(() => {
        this.panel = null;
      });
    }

    this.loadHtml();
    if (!this.panel.visible) {
      this.panel.reveal();
    }
  }

  private static async loadHtml() {
    const ctx = ContextManager.getInstance();
    const vscodeCtx = ctx.getVSCodeContext();

    const viewPath = vscode.Uri.joinPath(
      vscodeCtx.extensionUri,
      "views",
      "chat.ejs"
    ).fsPath;

    const stylesUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscodeCtx.extensionUri,
        "assets",
        "styles",
        "styles.css"
      )
    );
    const chatStylesUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscodeCtx.extensionUri,
        "assets",
        "styles",
        "chat.css"
      )
    );
    const chatScriptUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscodeCtx.extensionUri,
        "assets",
        "js",
        "chat",
        "chat.js"
      )
    );

    const currentModel = ctx.getCurrentModel();
    const html = await ejs.renderFile(viewPath, {
      stylesUri,
      chatStylesUri,
      chatScriptUri,
      modelsInfo,
      currentModel,
    });

    this.panel!.webview.html = html;
  }

  private static handleMessage(message: any) {
    // vscode.window.showInformationMessage(`Message type: ${message.type}; data: ${JSON.stringify(message)}`);
    switch (message.type) {
      case "sendMessage":
        return ChatPanelProvider.handleSendMessageMessage(message.data);
      case "modelChanged":
        return ChatPanelProvider.handleModelChanged(message.data);
      default:
        throw new Error("Action not found!");
    }
  }

  private static handleSendMessageMessage(data: any) {
    vscode.window.showInformationMessage(`User message: ${data}`);
    // Here you would process the message with the selected model
  }

  private static handleModelChanged(model: string) {
    const ctx = ContextManager.getInstance();
    ctx.setCurrentModel(modelsInfo[model]);
    vscode.window.showInformationMessage(
      `Model changed to: ${modelsInfo[model].name}`
    );
    // Here you would update any settings or configurations based on the model
  }
}
