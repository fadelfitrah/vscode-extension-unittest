import * as vscode from "vscode";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
// runtime-safe fetch: prefer globalThis.fetch, otherwise try to require node-fetch at runtime
let runtimeFetch: any = (globalThis as any).fetch;
import { spawn } from "child_process";
import * as os from "os";
import { randomBytes } from "crypto";

// Load .env dari root project ekstensi (opsional)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export function activate(context: vscode.ExtensionContext) {
  console.log("generator-vscode-unittest: activate() called");
  
  try {
    // Register the WebviewViewProvider
    const provider = new UnittestViewProvider(context.extensionUri);
    
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        UnittestViewProvider.viewType, 
        provider,
        {
          webviewOptions: {
            retainContextWhenHidden: true
          }
        }
      )
    );
    
    console.log("generator-vscode-unittest: provider registered successfully");

    // Register command to open panel
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "generator-vscode-unittest.openPanel",
        async () => {
          try {
            await vscode.commands.executeCommand('unittestGeneratorView.focus');
          } catch (error) {
            console.error("Failed to focus view:", error);
            vscode.window.showInformationMessage("Please click the Unittest Generator icon in the activity bar.");
          }
        }
      )
    );

  } catch (err) {
    console.error("generator-vscode-unittest: activation error", err);
    vscode.window.showErrorMessage(
      "Extension activation failed: " + ((err as any)?.message || String(err))
    );
  }
}


export function deactivate() {
  
}

class UnittestViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'unittestGeneratorView';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    console.log("Resolving webview view...");

    // Configure webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Set HTML content
    webviewView.webview.html = this._getWebviewContent(webviewView.webview);

    let lastActiveFile = { code: "", fileName: "" };

    const updateActiveFile = () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "python") {
        lastActiveFile.code = editor.document.getText();
        lastActiveFile.fileName = path.basename(editor.document.fileName);
        this._postMessage(webviewView, {
          command: "loadCode",
          code: lastActiveFile.code,
          fileName: lastActiveFile.fileName,
        });
      }
    };

    const sendPythonFiles = async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        this._postMessage(webviewView, { command: "fileList", files: [] });
        return;
      }

      try {
        const pyFiles = await vscode.workspace.findFiles("**/*.py", "**/node_modules/**");
        const root = workspaceFolders[0].uri.fsPath.replace(/\\/g, "/");
        const files = pyFiles.map((uri) =>
          uri.fsPath.replace(/\\/g, "/").replace(root + "/", "")
        );
        
        this._postMessage(webviewView, { command: "fileList", files });
      } catch (error) {
        console.error("Error finding Python files:", error);
        this._postMessage(webviewView, { command: "fileList", files: [] });
      }
    };

    // Setup message handling
    this._setupMessageHandlers(webviewView);

    // Setup file watchers and event listeners
    this._setupEventListeners(webviewView, updateActiveFile, sendPythonFiles);

    // Initial data load
    updateActiveFile();
    sendPythonFiles();

    console.log("Webview view resolved successfully");
  }

  private _setupMessageHandlers(webviewView: vscode.WebviewView) {
    webviewView.webview.onDidReceiveMessage(async (message) => {
      console.log("Received message from webview:", message.command);
      
      try {
        switch (message.command) {
          case "ready":
            this._postMessage(webviewView, { command: "status", message: "Extension ready" });
            break;
            
          case "requestFileList":
            await this._sendPythonFiles(webviewView);
            break;
            
          case "generate":
            await this._handleGenerateTest(webviewView, message);
            break;
            
          case "saveFile":
            await this._handleSaveFile(webviewView, message);
            break;
            
          case "generateCoverage":
            await this._handleGenerateCoverage(webviewView);
            break;
            
          default:
            console.warn("Unknown command:", message.command);
        }
      } catch (error: any) {
        console.error("Error handling message:", error);
        vscode.window.showErrorMessage(`Error: ${error?.message || String(error)}`);
      }
    });
  }

  private _setupEventListeners(
    webviewView: vscode.WebviewView, 
    updateActiveFile: () => void, 
    sendPythonFiles: () => void
  ) {
    // File system watcher for Python files
    const pythonWatcher = vscode.workspace.createFileSystemWatcher("**/*.py");
    pythonWatcher.onDidCreate(() => sendPythonFiles());
    pythonWatcher.onDidDelete(() => sendPythonFiles());
    pythonWatcher.onDidChange(() => sendPythonFiles());

    // Editor events
    const disposables = [
      pythonWatcher,
      vscode.window.onDidChangeActiveTextEditor(() => updateActiveFile()),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.languageId === "python") {
          updateActiveFile();
        }
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          updateActiveFile();
          sendPythonFiles();
        }
      })
    ];

    // Cleanup on dispose
    webviewView.onDidDispose(() => {
      disposables.forEach(disposable => disposable.dispose());
    });
  }

  private async _sendPythonFiles(webviewView: vscode.WebviewView) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this._postMessage(webviewView, { command: "fileList", files: [] });
      return;
    }

    try {
      const pyFiles = await vscode.workspace.findFiles("**/*.py", "**/node_modules/**");
      const root = workspaceFolders[0].uri.fsPath.replace(/\\/g, "/");
      const files = pyFiles.map((uri) =>
        uri.fsPath.replace(/\\/g, "/").replace(root + "/", "")
      );
      
      this._postMessage(webviewView, { command: "fileList", files });
    } catch (error) {
      console.error("Error finding Python files:", error);
      this._postMessage(webviewView, { command: "fileList", files: [] });
    }
  }

  private async _handleGenerateTest(webviewView: vscode.WebviewView, message: any) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage("Workspace tidak ditemukan.");
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const selectedFilePath = path.join(rootPath, message.fileName);

    if (!fs.existsSync(selectedFilePath)) {
      vscode.window.showErrorMessage(`File ${selectedFilePath} tidak ditemukan.`);
      return;
    }

    try {
      const code = fs.readFileSync(selectedFilePath, "utf8");
      vscode.window.showInformationMessage("Generating unit tests...");

      const result = await generateUnitTest(
        message.provider,
        message.fileName,
        code,
        parseInt(message.testCases || "3", 10),
        message.framework || "unittest",
        !!message.mocking,
        parseInt(message.coverage || "80", 10)
      );

      this._postMessage(webviewView, {
        command: "showResult",
        result,
        metadata: {
          provider: message.provider,
          framework: message.framework,
          mocking: message.mocking,
          testCases: message.testCases,
          coverage: message.coverage,
          generation_time: new Date().toISOString(),
        },
      });

      vscode.window.showInformationMessage("Unit tests generated successfully!");
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to generate tests: ${error.message}`);
    }
  }

  private async _handleSaveFile(webviewView: vscode.WebviewView, message: any) {
    try {
      const result = message.result;
      const basename = path.basename(message.fileName, ".py");
      const newFileName = `test_${basename}.py`;
      
      const activeDoc = vscode.window.activeTextEditor?.document;
      const dir = activeDoc ? 
        path.dirname(activeDoc.fileName) : 
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
      
      const newFilePath = path.join(dir, newFileName);
      fs.writeFileSync(newFilePath, result, "utf8");

      // Log test generation
      await this._logTestGeneration(message, basename, newFileName);

      vscode.window.showInformationMessage(`✅ Test file saved as ${newFileName}`);
      
      // Open the new file
      const newDocument = await vscode.workspace.openTextDocument(newFilePath);
      await vscode.window.showTextDocument(newDocument);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to save file: ${error.message}`);
    }
  }

  private async _logTestGeneration(message: any, basename: string, newFileName: string) {
    try {
      const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
      const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
      
      const entry = {
        runId,
        file_tested: basename + ".py",
        test_file: newFileName,
        generator: "AI Unit Test Generator",
        provider: message.metadata?.provider || "",
        framework: message.metadata?.framework || "",
        mocking: !!message.metadata?.mocking,
        test_count: parseInt(message.metadata?.testCases || "0", 10),
        coverage_target: parseInt(message.metadata?.coverage || "0", 10),
        generation_time: message.metadata?.generation_time || new Date().toISOString(),
        status: "generated",
        tests_total: 0,
        tests_passed: 0,
        tests_failed: 0,
      };

      writeTestLogEntry(projectRoot, entry);
      generateMarkdownReport(projectRoot);
    } catch (error: any) {
      console.log("⚠️ Gagal menulis log test:", error?.message || error);
    }
  }

  private async _handleGenerateCoverage(webviewView: vscode.WebviewView) {
    try {
      await runCoverageAndParse({ webview: webviewView.webview } as any);
    } catch (error: any) {
      this._postMessage(webviewView, {
        command: "coverageResult",
        success: false,
        message: error?.message || String(error)
      });
    }
  }

  private _postMessage(webviewView: vscode.WebviewView, message: any) {
    if (webviewView?.webview) {
      webviewView.webview.postMessage(message);
    }
  }

  private _getWebviewContent(webview: vscode.Webview): string {
    const htmlPath = path.join(this._extensionUri.fsPath, "resources", "panel.html");

    try {
      let htmlContent = fs.readFileSync(htmlPath, "utf8");

      htmlContent = this._updateResourceUrls(htmlContent, webview);

      return htmlContent;
    } catch (error) {
      console.log("Error reading panel.html:", error);
      
      return this._getFallbackHtmlContent();
    }
  }

  private _updateResourceUrls(htmlContent: string, webview: vscode.Webview): string {
    return htmlContent;
  }

  private _getFallbackHtmlContent(): string {
    // Simple fallback HTML in case the external file can't be loaded
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: 'Segoe UI', sans-serif; 
            background: #1e1e1e; 
            color: #cccccc; 
            padding: 20px; 
          }
          .error { 
            color: #f48771; 
            text-align: center; 
            margin-top: 50px; 
          }
        </style>
      </head>
      <body>
        <div class="error">
          <h2>⚠️ Failed to load interface</h2>
          <p>Please check if resources/webview.html exists</p>
        </div>
      </body>
      </html>
    `;
  }
}



async function generateUnitTest(
  provider: string,
  fileName: string,
  code: string,
  testCount: number,
  framework: string,
  mocking: boolean,
  coverage: number
): Promise<string> {
  const prompt = `
You are an AI assistant that generates Python unittest code.

Generate a complete unittest for the following Python code:
${code}

Requirements:
1. The title of the code is ${fileName}.
2. Use the standard Python ${framework} module.
3. Create ${testCount} meaningful test cases.
4. Use mocking/stubbing: ${mocking}.
5. Aim for ${coverage}% code coverage.
6. Do not provide explanations, give me only output Python code.
7. The answer must start with 'import ${framework}'.
`;

  const AIResponse = {
    choices: [{ message: { content: "" } }],
  };

  let res: any;
  let apiKey: string | undefined;
  let url: string | undefined;
  let model: string | undefined;

  switch (provider) {
    case "openai":
      apiKey = process.env.GROQ_API_KEY;
      url = "https://api.groq.com/openai/v1/chat/completions";
      model = "openai/gpt-oss-20b";
      break;

    case "metalamma":
      apiKey = process.env.GROQ_API_KEY;
      url = "https://api.groq.com/openai/v1/chat/completions";
      model = "meta-llama/llama-4-maverick-17b-128e-instruct";
      break;

    case "qwen":
      apiKey = process.env.GROQ_API_KEY;
      url = "https://api.groq.com/openai/v1/chat/completions";
      model = "qwen/qwen3-32b";
      break;

    case "dash":
      apiKey = process.env.OPENROUTER_API_KEY;
      url = "https://openrouter.ai/api/v1/chat/completions";
      model = "openrouter/sherlock-dash-alpha";
      break;

    case "kimi":
      apiKey = process.env.GROQ_API_KEY;
      url = "https://api.groq.com/openai/v1/chat/completions";
      model = "moonshotai/kimi-k2-instruct";
      break;

    case "deepseek":
      apiKey = process.env.OPENROUTER_API_KEY;
      url = "https://openrouter.ai/api/v1/chat/completions";
      model = "deepseek/deepseek-chat";
      break;

    default:
      throw new Error("Unknown provider selected: " + provider);
  }

  if (!apiKey) {
    throw new Error(`API key for ${provider} not found in .env`);
  }

  // resolve fetch implementation at runtime to avoid ESM bundling issues
  if (!runtimeFetch) {
    try {
      // use eval to avoid webpack statically resolving require
      const req: any = eval("require");
      const nf = req("node-fetch");
      runtimeFetch = nf && nf.default ? nf.default : nf;
    } catch (e) {
      // leave runtimeFetch undefined
    }
  }

  if (!runtimeFetch) {
    throw new Error("No fetch implementation available (global fetch or node-fetch)");
  }

  res = await runtimeFetch(url!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are an AI assistant that writes Python unittests.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API request failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as typeof AIResponse;
  return json?.choices?.[0]?.message?.content || "No response";
}

const runCommand = (cmd: string, args: string[], cwd?: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, shell: true });
    let output = "";

    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.stderr.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      resolve(output + `\nProcess exited with code ${code}`);
    });

    proc.on("error", (err) => reject(err));
  });
};

async function runCoverageAndParse(panelLike: { webview: vscode.Webview }) {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) {
    panelLike.webview.postMessage({
      command: "coverageResult",
      success: false,
      message: "No workspace detected.",
    });
    return;
  }

  try {
    await runCommand("coverage", ["run", "-m", "unittest", "discover"], workspace);
    await runCommand("coverage", ["json", "-o", "coverage.json"], workspace);

    const covPath = path.join(workspace, "coverage.json");
    const json = JSON.parse(fs.readFileSync(covPath, "utf8"));

    const files = Object.entries(json.files || {}).map(([file, data]: any) => ({
      file,
      percent_covered: data.summary?.percent_covered || 0,
      covered_lines: (data.summary?.num_statements || 0) - (data.summary?.missing_lines || 0),
      missing_lines: data.summary?.missing_lines || [],
    }));

    panelLike.webview.postMessage({
      command: "coverageResult",
      success: true,
      data: { total: json.totals, files },
    });
  } catch (err: any) {
    panelLike.webview.postMessage({
      command: "coverageResult",
      success: false,
      message: err?.message || String(err),
    });
  }
}

function safeParseJSON(filePath: string) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeTestLogEntry(projectRoot: string, entry: any) {
  const logPath = path.join(projectRoot, "test_log.json");
  let data: any = { metadata: {}, results: [], summary: {} };

  try {
    if (fs.existsSync(logPath)) {
      const parsed = safeParseJSON(logPath);
      if (parsed) data = parsed;
      else {
        data = {
          metadata: data.metadata || {
            generator: "AI Unit Test Generator",
            created: new Date().toISOString(),
          },
          results: [],
          summary: {},
        };
      }
    } else {
      data.metadata = {
        generator: "AI Unit Test Generator",
        created: new Date().toISOString(),
      };
      data.results = [];
    }

    data.results.push(entry);

    data.summary = {
      total_runs: data.results.length,
      total_tests: data.results.reduce((s: number, r: any) => s + (r.tests_total || 0), 0),
      total_passed: data.results.reduce((s: number, r: any) => s + (r.tests_passed || 0), 0),
      total_failed: data.results.reduce((s: number, r: any) => s + (r.tests_failed || 0), 0),
    };

    fs.writeFileSync(logPath, JSON.stringify(data, null, 2), "utf8");
  } catch (err: any) {
    console.error("Failed to write test_log.json:", err?.message || err);
    vscode.window.showErrorMessage("Gagal menyimpan test_log.json — periksa permission / disk space.");
  }
}

function generateMarkdownReport(projectRoot: string) {
  const logPath = path.join(projectRoot, "test_log.json");
  const mdPath = path.join(projectRoot, "unit_test_report.md");

  if (!fs.existsSync(logPath)) return;

  const data = safeParseJSON(logPath);
  if (!data) return;

  const meta = data.metadata || {};
  let md = `# 🧪 AI Unit Test Report

**Generator:** ${meta.generator || "AI Unit Test Generator"}  
**Created:** ${meta.created || ""}

---

## 📂 Test Runs Summary

| File Tested | Test File | Total | Passed | Failed | Status | RunId |
|-------------|-----------|-------|--------|--------|--------|-------|
`;

  (data.results || []).forEach((r: any) => {
    md += `| ${r.file_tested || ""} | ${r.test_file || ""} | ${r.tests_total || 0} | ${r.tests_passed || 0} | ${r.tests_failed || 0} | ${r.status || ""} | ${r.runId || ""} |
`;
  });

  md += `

---

Generated automatically by the extension.
`;
  try {
    fs.writeFileSync(mdPath, md, "utf8");
  } catch (err: any) {
    console.error("Failed to write unit_test_report.md:", err?.message || err);
  }
}

let __lastSavedTest: any = null;
