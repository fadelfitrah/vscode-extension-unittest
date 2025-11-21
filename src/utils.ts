import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import ("node-fetch");

export async function createTestFile(filename: string, content: string) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) throw new Error('Buka folder dulu sebelum menyimpan file.');

  const filePath = path.join(workspaceFolders[0].uri.fsPath, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return vscode.Uri.file(filePath);
}

export async function callOpenRouter(apiKey: string, prompt: string) {
  const res = await fetch('https://api.openrouter.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    })
  });

  interface AIResponse {
    choices?: {
        message?: {
        content?: string;
        };
    }[];
  }

  const json = (await res.json()) as AIResponse;
  return json?.choices?.[0]?.message?.content || JSON.stringify(json);
}

export async function callGroq(apiKey: string, prompt: string) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama3-8b-8192',
      messages: [{ role: 'user', content: prompt }]
    })
  });

  interface AIResponse {
    choices?: {
        message?: {
        content?: string;
        };
    }[];
  }
  const json = (await res.json()) as AIResponse;
  return json?.choices?.[0]?.message?.content || JSON.stringify(json);
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'webview.js'));
  const htmlUri = vscode.Uri.joinPath(extensionUri, 'src', 'webview.html');
  const html = fs.readFileSync(htmlUri.fsPath, 'utf8');
  return html.replace('./webview.js', scriptUri.toString());
}
