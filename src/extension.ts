import * as vscode from "vscode";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
const runtimeFetch = globalThis.fetch;
import { spawn } from "child_process";
import * as os from "os";
import { randomBytes } from "crypto";

// Load .env dari root project ekstensi (opsional)

export function activate(context: vscode.ExtensionContext) {
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
  try {
    const provider = new UnitTestViewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        UnitTestViewProvider.viewType,
        provider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "generator-vscode-unittest.reloadFiles",
        async () => {
          await vscode.commands.executeCommand("unitTestGeneratorView.focus");
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
            await vscode.commands.executeCommand("unitTestGeneratorView.focus");
          } catch (error) {
            console.error("Failed to focus view:", error);
            vscode.window.showInformationMessage(
              "Please click the Unit Test Generator icon in the activity bar."
            );
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

export function deactivate() {}

// Configuration Interfaces
interface TestGenerationConfig {
  // AI Provider Configuration
  aiProvider:
    | "openai"
    | "mettalamma"
    | "groq"
    | "phi3"
    | "codexmini"
    | "deepseek";
  model: string;
  temperature: number;
  maxTokens: number;

  // Language and Framework Configuration
  programmingLanguage: "python" | "javascript" | "java";
  testFramework: string;
  testStyle: "given_when_then" | "arrange_act_assert";
  includeAssertions: boolean;
  includeEdgeCases: boolean;
  includeErrorCases: boolean;

  // Code Coverage Targets
  coverageTarget: number;
  includeBranchCoverage: boolean;

  // Mocking Strategy
  mockingFramework: string;
  autoMockExternalDeps: boolean;

  // Code Quality Rules
  maxFunctionComplexity: number;
  requireDocstrings: boolean;
  enforceNamingConventions: boolean;
  maxTestLines: number;

  // Generation Behavior
  generateSetupTeardown: boolean;
  includeParameterizedTests: boolean;
  testIsolation: boolean;
  // Maximum desired test cases to generate
  testCount: number;
}

interface TestQualityMetrics {
  qualityScore: "Poor" | "Fair" | "Good" | "Excellent";
  estimatedCoverage: number;
  testCount: number;
  assertionCount: number;
  hasEdgeCases: boolean;
  hasErrorCases: boolean;
  hasMocking: boolean;
  complexity: number;
}

// Language and Framework Mappings - HANYA 3 BAHASA
const LANGUAGE_FRAMEWORKS: Record<
  string,
  { testFrameworks: string[]; mockingFrameworks: string[] }
> = {
  python: {
    testFrameworks: ["unittest", "pytest"],
    mockingFrameworks: ["unittest.mock", "pytest-mock"],
  },
  javascript: {
    testFrameworks: ["jest", "mocha"],
    mockingFrameworks: ["jest", "sinon"],
  },
  java: {
    testFrameworks: ["junit", "testng"],
    mockingFrameworks: ["mockito"],
  },
};

// Default Configuration per Language
const DEFAULT_CONFIG_BY_LANGUAGE: Record<
  string,
  Partial<TestGenerationConfig>
> = {
  python: {
    testFramework: "unittest",
    mockingFramework: "unittest.mock",
    requireDocstrings: true,
  },
  javascript: {
    testFramework: "jest",
    mockingFramework: "jest",
    requireDocstrings: true,
  },
  java: {
    testFramework: "junit",
    mockingFramework: "mockito",
    requireDocstrings: true,
  },
};

// Base Default Configuration
const DEFAULT_TEST_CONFIG: TestGenerationConfig = {
  // AI Provider
  aiProvider: "openai",
  model: "gpt-4",
  temperature: 0.1,
  maxTokens: 2000,

  // Language and Framework
  programmingLanguage: "python",
  testFramework: "unittest",
  testStyle: "given_when_then",
  includeAssertions: true,
  includeEdgeCases: true,
  includeErrorCases: true,

  // Coverage
  coverageTarget: 80,
  includeBranchCoverage: true,

  // Mocking
  mockingFramework: "unittest.mock",
  autoMockExternalDeps: true,

  // Code Quality
  maxFunctionComplexity: 6,
  requireDocstrings: true,
  enforceNamingConventions: true,
  maxTestLines: 50,

  // Generation Behavior
  generateSetupTeardown: true,
  includeParameterizedTests: true,
  testIsolation: true,
  testCount: 3,
};

class UnitTestViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "unittestGeneratorView";
  private _view?: vscode.WebviewView;
  private _currentFileList: any[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  private _updateFileListCache(files: any[]) {
    this._currentFileList = files;
    console.log(`Updated file list cache with ${files.length} files`);
  }

  private _isFirstLoad: boolean = true;
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
      localResourceRoots: [
        this._extensionUri,
        vscode.Uri.joinPath(this._extensionUri, "resources"),
      ],
    };

    // Set HTML content
    webviewView.webview.html = this._getWebviewContent(webviewView.webview);

    let lastActiveFile = { code: "", fileName: "", language: "" };

    const updateActiveFile = () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const doc = editor.document;
        lastActiveFile.code = doc.getText();
        lastActiveFile.fileName = path.basename(doc.fileName);
        lastActiveFile.language = doc.languageId;

        // Hanya proses jika bahasa didukung
        if (["python", "javascript", "java"].includes(doc.languageId)) {
          this._postMessage(webviewView, {
            command: "loadCode",
            code: lastActiveFile.code,
            fileName: lastActiveFile.fileName,
            language: doc.languageId,
          });

          // Send available frameworks for this language
          this._sendLanguageFrameworks(webviewView, doc.languageId);

          if (this._isFirstLoad) {
            this._postMessage(webviewView, {
              command: "selectedFile",
              file: {
                path: doc.fileName,
                language: doc.languageId,
                fullPath: doc.fileName,
              },
            });
            this._isFirstLoad = false;
          }
        }
      }
    };

    const sendSourceFiles = async () => {
      const activeLanguage =
        vscode.window.activeTextEditor?.document.languageId;
      const validLanguage = ["python", "javascript", "java"].includes(
        activeLanguage || ""
      )
        ? activeLanguage
        : "python";

      await this._sendSourceFiles(webviewView, validLanguage);
    };

    // Setup message handling
    this._setupMessageHandlers(webviewView);

    // Setup file watchers and event listeners
    this._setupEventListeners(webviewView, updateActiveFile);

    // Initial data load
    updateActiveFile();
    sendSourceFiles();

    setTimeout(() => {
      this._postMessage(webviewView, {
        command: "status",
        message: "Extension ready. Auto-loaded active file.",
        type: "success",
      });
    }, 500);

    console.log("Webview view resolved successfully");
  }

  private _setupMessageHandlers(webviewView: vscode.WebviewView) {
    webviewView.webview.onDidReceiveMessage(async (message) => {
      console.log("Received message from webview:", message.command);

      try {
        switch (message.command) {
          case "ready":
            await this._autoSelectInitialFile(webviewView);
            const activeLanguage =
              vscode.window.activeTextEditor?.document.languageId;
            await this._sendSourceFiles(webviewView, activeLanguage);
            this._postMessage(webviewView, {
              command: "status",
              message: "Extension ready",
              type: "success",
            });
            break;

          case "requestFileList":
            await this._sendSourceFiles(webviewView, message.language);
            break;

          case "languageChanged":
            // Handle ketika language berubah di webview
            await this._sendSourceFiles(webviewView, message.language);
            break;

          case "openFilePicker":
            await this._openFilePicker(webviewView);
            break;

          case "getLanguageFrameworks":
            this._sendLanguageFrameworks(webviewView, message.language);
            break;

          case "generate":
            await this._handleGenerateTest(webviewView, message);
            break;

          case "saveFile":
            await this._handleSaveFile(webviewView, message);
            break;

          case "generateCoverage":
            await this._handleGenerateCoverage(webviewView, message);
            break;

          case "analyzeQuality":
            await this._handleAnalyzeQuality(webviewView, message);
            break;

          default:
            console.warn("Unknown command:", message.command);
        }
      } catch (error: any) {
        console.error("Error handling message:", error);
        vscode.window.showErrorMessage(
          `Error: ${error?.message || String(error)}`
        );
      }
    });
  }

  private _setupEventListeners(
    webviewView: vscode.WebviewView,
    updateActiveFile: () => void
  ) {
    let refreshTimeout: NodeJS.Timeout | undefined;

    const refreshFileList = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {
        const activeLanguage =
          vscode.window.activeTextEditor?.document.languageId;
        const validLanguage = ["python", "javascript", "java"].includes(
          activeLanguage || ""
        )
          ? activeLanguage
          : undefined;
        this._sendSourceFiles(webviewView, validLanguage);
      }, 1000);
    };
    // File system watcher untuk 3 bahasa saja
    const sourceWatcher = vscode.workspace.createFileSystemWatcher(
      "**/*.{py,js,java}",
      false,
      false,
      false
    );

    sourceWatcher.onDidCreate(() => refreshFileList());
    sourceWatcher.onDidDelete(() => refreshFileList());
    sourceWatcher.onDidChange(() => refreshFileList());

    let editorChangeTimeout: NodeJS.Timeout | undefined;

    const debouncedUpdate = () => {
      if (editorChangeTimeout) clearTimeout(editorChangeTimeout);
      editorChangeTimeout = setTimeout(() => {
        updateActiveFile();
        // Hanya refresh file list jika benar-benar perlu
        if (webviewView.visible) {
          const editor = vscode.window.activeTextEditor;
          if (
            editor &&
            ["python", "javascript", "java"].includes(
              editor.document.languageId
            )
          ) {
            this._sendSourceFiles(webviewView, editor.document.languageId);
          }
        }
      }, 500);
    };
    // Editor events
    const disposables = [
      sourceWatcher,
      vscode.window.onDidChangeActiveTextEditor(() => debouncedUpdate()),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (["python", "javascript", "java"].includes(doc.languageId)) {
          debouncedUpdate();
        }
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          debouncedUpdate();
        }
      }),
    ];

    // Cleanup on dispose
    webviewView.onDidDispose(() => {
      disposables.forEach((disposable) => disposable.dispose());
      if (refreshTimeout) clearTimeout(refreshTimeout);
      if (editorChangeTimeout) clearTimeout(editorChangeTimeout);
    });
  }

  private async _autoSelectInitialFile(webviewView: vscode.WebviewView) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const doc = editor.document;
    if (!["python", "javascript", "java"].includes(doc.languageId)) return;

    // Kirim file yang aktif ke webview
    this._postMessage(webviewView, {
      command: "selectedFile",
      file: {
        path: path.basename(doc.fileName),
        language: doc.languageId,
        fullPath: doc.fileName,
      },
    });

    this._postMessage(webviewView, {
      command: "configUpdate",
      config: {
        defaultLanguage: doc.languageId,
      },
    });
  }

  private _fileListCache: { [key: string]: any[] } = {};
  private _lastCacheTime: number = 0;
  private readonly CACHE_TTL = 30000;

  private async _sendSourceFiles(
    webviewView: vscode.WebviewView,
    selectedLanguage?: string
  ) {
    // Declare webviewView variable
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      this._postMessage(webviewView, { command: "fileList", files: [] });
      return;
    }

    try {
      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      const now = Date.now();

      if (
        this._fileListCache["all"] &&
        now - this._lastCacheTime < this.CACHE_TTL
      ) {
        console.log("Using cached global file list");
        this._currentFileList = this._fileListCache["all"];
        this._postMessage(webviewView, {
          command: "fileList",
          files: this._fileListCache["all"],
        });
        return;
      }

      const pattern = "**/*.{py,js,java}";
      const excludePattern = `{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/target/**,**/bin/**,**/out/**,**/*.min.*}`;

      console.time(`findFiles-${selectedLanguage || "all"}`);
      const files = await vscode.workspace.findFiles(
        pattern,
        excludePattern,
        1000
      );
      console.timeEnd(`findFiles-${selectedLanguage || "all"}`);

      if (files.length === 0) {
        // Cek apakah workspace benar-benar kosong
        const allFiles = await vscode.workspace.findFiles("**/*", null, 10);
        console.log(`Total files in workspace: ${allFiles.length}`);

        if (allFiles.length === 0) {
          this._postMessage(webviewView, {
            command: "fileList",
            files: [],
            message: "Workspace is empty or contains no files.",
          });
        } else {
          this._postMessage(webviewView, {
            command: "fileList",
            files: [],
            message: `No ${selectedLanguage || "source"} files found. Found ${
              allFiles.length
            } other files.`,
          });
        }
        this._currentFileList = [];
        return;
      }

      const root = workspaceRoot.replace(/\\/g, "/");
      const rootWithSlash = root.endsWith("/") ? root : root + "/";

      const fileList = files.slice(0, 50).map((uri) => {
        const fullPath = uri.fsPath.replace(/\\/g, "/");
        const relativePath = fullPath.replace(rootWithSlash, "");

        return {
          path: relativePath,
          language: getLanguageFromExtension(path.extname(uri.fsPath)),
          fullPath: fullPath,
          normalizedPath: relativePath.toLowerCase().replace(/\\/g, "/"),
        };
      });

      this._fileListCache["all"] = fileList;
      this._lastCacheTime = now;

      this._updateCurrentFileList(fileList);
      console.log(`Saved ${fileList.length} files to currentFileList`);

      console.timeEnd("processFiles");
      console.log(`Found ${fileList.length} files for all`);

      this._postMessage(webviewView, {
        command: "fileList",
        files: fileList,
      });
    } catch (error) {
      console.error("ERROR in _sendSourceFiles:", error);
      this._postMessage(webviewView, {
        command: "fileList",
        files: [],
      });
      this._currentFileList = [];
    }
  }

  private _updateCurrentFileList(files: any[]) {
    this._currentFileList = files;
    console.log(`Updated currentFileList with ${files.length} files`);
    if (files.length > 0) {
      console.log(
        "First 3 files:",
        files.slice(0, 3).map((f) => ({
          path: f.path,
          language: f.language,
        }))
      );
    }
  }

  private _sendLanguageFrameworks(
    webviewView: vscode.WebviewView,
    language: string
  ) {
    // Hanya kirim frameworks untuk bahasa yang didukung
    if (!["python", "javascript", "java"].includes(language)) {
      language = "python"; // Default ke python jika tidak dikenal
    }

    const frameworks = LANGUAGE_FRAMEWORKS[language] || {
      testFrameworks: ["custom"],
      mockingFrameworks: ["custom"],
    };

    this._postMessage(webviewView, {
      command: "languageFrameworks",
      language,
      frameworks,
    });
  }

  private async _openFilePicker(webviewView: vscode.WebviewView) {
    const shouldShowProgress = this._currentFileList.length === 0;

    if (shouldShowProgress) {
      return vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Loading source files...",
          cancellable: true,
        },
        async (progress, token) => {
          return this._performFilePick(webviewView, progress, token);
        }
      );
    } else {
      return this._performFilePick(webviewView);
    }
  }

  private async _performFilePick(
    webviewView: vscode.WebviewView,
    progress?: vscode.Progress<{ message?: string }>,
    token?: vscode.CancellationToken
  ) {
    try {
      if (progress) {
        progress.report({ message: "Scanning workspace..." });
      }

      // MODIFIKASI: Selalu muat ulang file list, jangan bergantung pada cache
      const activeLanguage =
        vscode.window.activeTextEditor?.document.languageId;
      const validLanguage = ["python", "javascript", "java"].includes(
        activeLanguage || ""
      )
        ? activeLanguage
        : undefined;

      // MODIFIKASI: Simpan promise dari _sendSourceFiles untuk menunggu selesai
      const fileLoadPromise = this._sendSourceFiles(webviewView, validLanguage);

      // MODIFIKASI: Tunggu sampai file list benar-benar terisi
      await fileLoadPromise;

      // MODIFIKASI: Tunggu sedikit untuk memastikan _currentFileList terisi
      await new Promise((resolve) => setTimeout(resolve, 300));

      // MODIFIKASI: Periksa apakah ada file setelah loading
      if (this._currentFileList.length === 0) {
        // Coba sekali lagi tanpa filter bahasa
        await this._sendSourceFiles(webviewView, undefined);
        await new Promise((resolve) => setTimeout(resolve, 300));

        if (this._currentFileList.length === 0) {
          vscode.window.showWarningMessage(
            "No source files found. Make sure you have .py, .js, or .java files in your workspace."
          );
          return;
        }
      }

      if (progress) {
        progress.report({ message: "Preparing file list..." });
      }

      // MODIFIKASI: Debug logging untuk memastikan file list terisi
      console.log(`File picker loaded ${this._currentFileList.length} files`);
      if (this._currentFileList.length > 0) {
        console.log(
          "Sample files:",
          this._currentFileList.slice(0, 3).map((f) => ({
            path: f.path,
            language: f.language,
          }))
        );
      }

      const MAX_FILES_PER_LANGUAGE = 100;
      const languageGroups: { [key: string]: any[] } = {};

      const pathToFileMap: Map<string, any> = new Map();

      this._currentFileList.slice(0, 300).forEach((file) => {
        // Limit display
        const lang = file.language || "unknown";
        if (!languageGroups[lang]) {
          languageGroups[lang] = [];
        }
        if (languageGroups[lang].length < MAX_FILES_PER_LANGUAGE) {
          languageGroups[lang].push(file);
          const displayPath = file.path; // Path relatif
          pathToFileMap.set(displayPath, file);

          // Juga simpan basename untuk pencarian alternatif
          const basename = path.basename(file.path);
          if (!pathToFileMap.has(basename)) {
            pathToFileMap.set(basename, file);
          }
        }
      });

      const quickPickItems: vscode.QuickPickItem[] = [];

      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const activeFile = {
          path: path.basename(editor.document.fileName),
          language: editor.document.languageId,
          fullPath: editor.document.fileName,
        };

        if (["python", "javascript", "java"].includes(activeFile.language)) {
          quickPickItems.push({
            label: "$(star) Current File",
            kind: vscode.QuickPickItemKind.Separator,
          });

          quickPickItems.push({
            label: `$(file) ${activeFile.path}`,
            description: `(${activeFile.language}) - CURRENT`,
            detail: "CURENT_ACTIVE_FILE ",
          });

          quickPickItems.push({
            label: "",
            kind: vscode.QuickPickItemKind.Separator,
          });

          pathToFileMap.set("CURRENT_ACTIVE_FILE", {
            path: activeFile.path,
            language: activeFile.language,
            fullPath: activeFile.fullPath,
          });
        }
      }

      // MODIFIKASI: Debug jumlah file per bahasa
      console.log("Language groups:", Object.keys(languageGroups));
      Object.keys(languageGroups).forEach((lang) => {
        console.log(`  ${lang}: ${languageGroups[lang].length} files`);
      });

      // Tambahkan files grouped by language
      Object.keys(languageGroups)
        .sort()
        .forEach((lang) => {
          const files = languageGroups[lang];
          if (files.length === 0) return;

          quickPickItems.push({
            label: `$(folder) ${
              lang.charAt(0).toUpperCase() + lang.slice(1)
            } (${files.length})`,
            kind: vscode.QuickPickItemKind.Separator,
          });

          files.forEach((file) => {
            quickPickItems.push({
              label: `$(file) ${path.basename(file.path)}`,
              description: `(${file.language})`,
              detail: file.path,
            });
          });
        });

      // MODIFIKASI: Tambahkan fallback jika masih kosong
      if (quickPickItems.length === 0) {
        console.log("No quick pick items generated, showing fallback");
        quickPickItems.push({
          label: "No source files found",
          description: "Create .py, .js, or .java files first",
        });
      }

      const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: "Select a source file (type to filter)...",
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected && selected.detail) {
        let selectedFile = null;

        if (selected.detail === "CURRENT_ACTIVE_FILE") {
          selectedFile = pathToFileMap.get("CURRENT_ACTIVE_FILE");
        } else {
          selectedFile = pathToFileMap.get(selected.detail);

          if (!selectedFile) {
            console.log(`File not found by detail: "${selected.detail}"`);
            console.log("Available paths:", Array.from(pathToFileMap.keys()));

            // Coba cari dengan basename
            const basename = path.basename(selected.detail);
            selectedFile = this._currentFileList.find(
              (f) => path.basename(f.path) === basename
            );

            if (!selectedFile) {
              // Cari dengan partial match
              selectedFile = this._currentFileList.find(
                (f) =>
                  f.path.includes(selected.detail!) ||
                  selected.detail!.includes(f.path)
              );
            }
          }
        }
        if (selectedFile) {
          console.log("Selected file found:", selectedFile);
          this._postMessage(webviewView, {
            command: "selectedFile",
            file: selectedFile,
          });
        } else {
          console.error("File not found:", selected.detail);
          vscode.window.showErrorMessage(
            `File "${selected.detail}" not found in workspace. Please select another file.`
          );
        }
      }
    } catch (error: any) {
      if (
        error instanceof vscode.CancellationError ||
        error?.name === "Canceled"
      ) {
        console.log("File picker canceled");
      } else {
        console.error("Error in file picker:", error);
        vscode.window.showErrorMessage(`File picker error: ${error.message}`);
      }
    }
  }

  private async _handleGenerateTest(
    webviewView: vscode.WebviewView,
    message: any
  ) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage("Workspace tidak ditemukan.");
      return;
    }

    const file = message.file;
    const selectedFilePath: string | undefined = file?.fullPath;

    if (!selectedFilePath) {
      vscode.window.showErrorMessage("No file selected.");
      return;
    }

    if (!fs.existsSync(selectedFilePath)) {
      vscode.window.showErrorMessage(
        `Selected file not found: ${selectedFilePath}`
      );
      return;
    }

    try {
      const code = fs.readFileSync(selectedFilePath, "utf8");
      if (!code.trim()) {
        vscode.window.showErrorMessage(
          `File yang dipilih (${message.file}) kosong. Tidak ada kode untuk dibuatkan unit test.`
        );
        return;
      }

      const language =
        message.language ||
        getLanguageFromExtension(path.extname(selectedFilePath));

      // Validasi bahasa
      if (!["python", "javascript", "java"].includes(language)) {
        vscode.window.showErrorMessage(
          `Bahasa ${language} tidak didukung. Hanya Python, JavaScript, dan Java yang didukung.`
        );
        return;
      }

      vscode.window.showInformationMessage(
        `Generating ${language} unit tests...`
      );

      // Build configuration from user input
      const config: TestGenerationConfig = {
        ...DEFAULT_TEST_CONFIG,
        programmingLanguage: language as "python" | "javascript" | "java",
        testFramework:
          message.framework ||
          DEFAULT_CONFIG_BY_LANGUAGE[language]?.testFramework ||
          "custom",
        coverageTarget: parseInt(message.coverage || "80", 10),
        testCount: parseInt(
          String(message.testCases || DEFAULT_TEST_CONFIG.testCount),
          10
        ),
        includeEdgeCases: message.includeEdgeCases !== false,
        testStyle: message.testStyle || DEFAULT_TEST_CONFIG.testStyle,
        includeErrorCases: message.includeErrorCases !== false,
        autoMockExternalDeps: !!message.mocking,
        mockingFramework:
          message.mockingFramework ||
          DEFAULT_CONFIG_BY_LANGUAGE[language]?.mockingFramework ||
          "",
      };

      const result = await generateUnitTest(
        message.provider,
        path.basename(selectedFilePath),
        code,
        config
      );

      const qualityMetrics = result.qualityMetrics;

      this._postMessage(webviewView, {
        command: "showResult",
        result: result.testCode,
        metadata: {
          provider: message.provider,
          language: language,
          framework: message.framework,
          mocking: message.mocking,
          mockingFramework: message.mockingFramework,
          testCases: message.testCases,
          coverage: message.coverage,
          generation_time: new Date().toISOString(),
          qualityMetrics: qualityMetrics,
        },
      });

      vscode.window.showInformationMessage(
        "Unit tests generated successfully!"
      );
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to generate tests: ${errorMessage}`
      );
    }
  }

  private async _handleSaveFile(webviewView: vscode.WebviewView, message: any) {
    try {
      const result = message.result;
      const sourceFileName = message.fileName;
      const language = message.language;
      const extension = path.extname(sourceFileName);
      const basename = path.basename(sourceFileName, extension);

      // Determine test file naming convention based on language
      const testFileName = getTestFileName(basename, extension, language);

      const activeDoc = vscode.window.activeTextEditor?.document;
      const dir = activeDoc
        ? path.dirname(activeDoc.fileName)
        : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";

      const newFilePath = path.join(dir, testFileName);
      fs.writeFileSync(newFilePath, result, "utf8");

      // Log test generation
      await this._logTestGeneration(
        message,
        basename + extension,
        testFileName
      );

      vscode.window.showInformationMessage(
        `✅ Test file saved as ${testFileName}`
      );

      // Open the new file
      const newDocument = await vscode.workspace.openTextDocument(newFilePath);
      await vscode.window.showTextDocument(newDocument);
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to save file: ${errorMessage}`);
    }
  }

  private async _handleAnalyzeQuality(
    webviewView: vscode.WebviewView,
    message: any
  ) {
    try {
      const testCode = message.testCode;
      const qualityMetrics = analyzeTestQuality(testCode, message.sourceCode);
      this._postMessage(webviewView, {
        command: "qualityAnalysis",
        metrics: qualityMetrics,
      });
    } catch (error: any) {
      console.error("Quality analysis failed:", error);
    }
  }

  private async _logTestGeneration(
    message: any,
    basename: string,
    newFileName: string
  ) {
    try {
      const projectRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
      const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;

      const entry = {
        runId,
        file_tested: basename,
        test_file: newFileName,
        generator: "AI Unit Test Generator",
        language: message.metadata?.language || "",
        provider: message.metadata?.provider || "",
        framework: message.metadata?.framework || "",
        mocking: !!message.metadata?.mocking,
        mockingFramework: message.metadata?.mockingFramework || "",
        test_count: parseInt(message.metadata?.testCases || "0", 10),
        coverage_target: parseInt(message.metadata?.coverage || "0", 10),
        generation_time:
          message.metadata?.generation_time || new Date().toISOString(),
        quality_metrics: message.metadata?.qualityMetrics || {},
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

  private async _handleGenerateCoverage(
    webviewView: vscode.WebviewView,
    message: any
  ) {
    try {
      await runCoverageAndParse(
        { webview: webviewView.webview } as any,
        message.language
      );
    } catch (error: any) {
      this._postMessage(webviewView, {
        command: "coverageResult",
        success: false,
        message: error?.message || String(error),
      });
    }
  }

  private _postMessage(webviewView: vscode.WebviewView, message: any) {
    if (webviewView?.webview) {
      webviewView.webview.postMessage(message);
    }
  }

  private _getIconUri(webview: vscode.Webview, iconName: string): vscode.Uri {
    try {
      const iconPath = vscode.Uri.joinPath(
        this._extensionUri,
        "resources",
        iconName
      );

      const iconUri = webview.asWebviewUri(iconPath);
      console.log(`Icon URI for ${iconName}: ${iconUri.toString()}`);
      return iconUri;
    } catch (error) {
      console.log(`Error getting icon URI for ${iconName}:`, error);
      return webview.asWebviewUri(
        vscode.Uri.file(
          path.join(this._extensionUri.fsPath, "resources", iconName)
        )
      );
    }
  }

  private _getWebviewContent(webview: vscode.Webview): string {
    const iconUri = this._getIconUri(webview, "icon.png");
    const htmlPath = path.join(
      this._extensionUri.fsPath,
      "resources",
      "panel.html"
    );

    try {
      let htmlContent = fs.readFileSync(htmlPath, "utf8");

      const escapeJson = JSON.stringify(LANGUAGE_FRAMEWORKS)
        .replace(/`/g, "\\`")
        .replace(/\$/g, "\\$");
      // Replace placeholders (allow optional spaces inside braces)
      htmlContent = htmlContent.replace(
        /\{\s*ICON_URI\s*\}/g,
        iconUri.toString()
      );
      // Inject language frameworks data into template
      htmlContent = htmlContent.replace(
        /\{LANGUAGE_FRAMEWORKS_ESCAPED\}/g,
        escapeJson
      );
      return htmlContent;
    } catch (error) {
      console.log("Error reading panel.html:", error);
      return this._getFallbackHtmlContent();
    }
  }

  private _getFallbackHtmlContent(): string {
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
          <p>Please check if resources/panel.html exists</p>
        </div>
      </body>
      </html>
    `;
  }
}

// Enhanced test generation with quality features
async function generateUnitTest(
  provider: string,
  fileName: string,
  code: string,
  config: TestGenerationConfig
): Promise<{ testCode: string; qualityMetrics: TestQualityMetrics }> {
  const prompt = buildTestPrompt(fileName, code, config);

  const AIResponse = {
    choices: [{ message: { content: "" } }],
  };

  let apiKey: string | undefined;
  let url: string | undefined;
  let model: string | undefined;

  // Provider configuration mapping
  const providerConfig = {
    openai: {
      apiKey: process.env.GROQ_API_KEY,
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: "openai/gpt-oss-20b",
    },
    metalamma: {
      apiKey: process.env.GROQ_API_KEY,
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: "meta-llama/llama-4-maverick-17b-128e-instruct",
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY,
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: "groq/compound",
    },
    phi3: {
      apiKey: process.env.OPENROUTER_API_KEY,
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: "microsoft/phi-3-mini-128k-instruct",
    },
    codexmini: {
      apiKey: process.env.OPENROUTER_API_KEY,
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: "openai/codex-mini",
    },
    deepseek: {
      apiKey: process.env.OPENROUTER_API_KEY,
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: "deepseek/deepseek-chat",
    },
  };

  const providerInfo = providerConfig[provider as keyof typeof providerConfig];
  if (!providerInfo) {
    throw new Error("Unknown provider selected: " + provider);
  }

  ({ apiKey, url, model } = providerInfo);

  if (!apiKey) {
    throw new Error(`API key for ${provider} not found in .env`);
  }

  if (!runtimeFetch) {
    throw new Error("No fetch implementation available");
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 8000);

  const res = await runtimeFetch(url!, {
    signal: controller.signal,
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
          content: `You are an expert ${config.programmingLanguage} test engineer that writes high-quality, maintainable unit tests for ${config.testFramework}.`,
        },
        { role: "user", content: prompt },
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API request failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as typeof AIResponse;
  const testCode = json?.choices?.[0]?.message?.content || "No response";

  // Analyze quality of generated tests
  const qualityMetrics = analyzeTestQuality(
    testCode,
    config.programmingLanguage
  );

  return { testCode, qualityMetrics };
}

// Build comprehensive prompt with quality requirements
export function buildTestPrompt(
  fileName: string,
  code: string,
  config: TestGenerationConfig
): string {
  const maxTests =
    Number.isInteger(config.testCount) && config.testCount > 0
      ? config.testCount
      : DEFAULT_TEST_CONFIG.testCount;

  const languageSpecificGuidelines = getLanguageSpecificGuidelines(
    config.programmingLanguage,
    config.testFramework
  );

  return `
You are an expert ${
    config.programmingLanguage
  } test engineer. Generate high-quality unit tests following these STRICT requirements:

## GENERATION CONFIGURATION:
- Programming Language: ${config.programmingLanguage}
- Test Framework: ${config.testFramework}
- Test Style: ${config.testStyle}
- Coverage Target: ${config.coverageTarget}%
- Mocking Framework: ${config.mockingFramework}
- Max Test Cases: ${maxTests}
- Include Edge Cases: ${config.includeEdgeCases}
- Include Error Cases: ${config.includeErrorCases}
- Max Test Complexity: ${config.maxFunctionComplexity} 

## LANGUAGE-SPECIFIC GUIDELINES:
${languageSpecificGuidelines}

## CODE QUALITY RULES:
${
  config.requireDocstrings
    ? "- Every test MUST have descriptive docstrings/comments"
    : ""
}
${
  config.enforceNamingConventions
    ? `- Use appropriate naming conventions for ${config.programmingLanguage}`
    : ""
}
${
  config.maxTestLines
    ? `- Maximum ${config.maxTestLines} lines per test function`
    : ""
}
- Tests must be isolated and independent
- Use descriptive test names that explain the scenario

## TEST STRUCTURE REQUIREMENTS:
${
  config.testStyle === "given_when_then"
    ? `- Follow Given-When-Then pattern:
  # Given - setup initial conditions
  # When - execute the action
  # Then - verify the results`
    : `- Follow Arrange-Act-Assert pattern:
  # Arrange - setup test data
  # Act - call the function
  # Assert - verify outcomes`
}

${
  config.autoMockExternalDeps
    ? `## MOCKING STRATEGY:
- Automatically mock all external dependencies
- Use ${config.mockingFramework} for mocking
- Mock external API calls, database operations, file I/O
`
    : ""
}

## SPECIFIC INSTRUCTIONS:
1. Cover happy path scenarios
${
  config.includeEdgeCases ? "2. Include boundary conditions and edge cases" : ""
}
${config.includeErrorCases ? "3. Test error conditions and exceptions" : ""}
${
  config.includeParameterizedTests
    ? "4. Use parameterized tests for similar test cases"
    : ""
}
5. Ensure tests are fast and isolated
6. Use meaningful assertions with descriptive messages

## SOURCE CODE TO TEST:
\`\`\`${config.programmingLanguage}
${code}
\`\`\`

Generate comprehensive unit tests that achieve ${
    config.coverageTarget
  }% coverage. Focus on testing behavior, not implementation.

Return ONLY the ${
    config.programmingLanguage
  } test code without any explanations or markdown formatting.
`;
}

// Get language-specific testing guidelines - HANYA 3 BAHASA
function getLanguageSpecificGuidelines(
  language: string,
  framework: string
): string {
  const guidelines: Record<string, string> = {
    python: `- Use ${
      framework === "pytest" ? "@pytest.fixture" : "setUp()/tearDown()"
    } for setup
- Import unittest.mock for mocking
- Use assert statements appropriately
- Follow PEP 8 style guidelines`,
    javascript: `- Use ${
      framework === "jest" ? "describe/it" : "describe/it"
    } blocks
- Use expect() assertions
- Mock using ${framework === "jest" ? "jest.mock()" : "sinon"}
- Use async/await for asynchronous tests`,
    java: `- Use ${
      framework === "junit" ? "@Test annotations" : "appropriate annotations"
    }
- Follow Java naming conventions
- Use ${framework === "mockito" ? "@Mock annotations" : "appropriate mocking"}
- Use JUnit 5 assertions`,
  };

  return (
    guidelines[language] || `- Follow best practices for ${language} testing`
  );
}

function classifyQuality(
  testCount: number,
  assertionCount: number,
  edge: boolean,
  error: boolean,
  mock: boolean
): "Poor" | "Fair" | "Good" | "Excellent" {
  if (
    testCount >= 5 &&
    assertionCount >= testCount * 1.5 &&
    edge &&
    error &&
    mock
  )
    return "Excellent";

  if (testCount >= 3 && assertionCount >= testCount * 1.2 && (edge || error))
    return "Good";

  if (testCount >= 2) return "Fair";

  return "Poor";
}

function estimateCoverage(
  testCount: number,
  assertionCount: number,
  edge: boolean,
  error: boolean
): number {
  return Math.min(
    100,
    testCount * 15 + assertionCount * 3 + (edge ? 10 : 0) + (error ? 10 : 0)
  );
}

function estimateComplexity(code: string): number {
  const controls = (
    code.match(/\bif\b|\bfor\b|\bwhile\b|\btry\b|\bcatch\b|\bswitch\b/g) || []
  ).length;

  const linesPenalty = Math.floor(code.split("\n").length / 40);

  return Math.max(1, controls + linesPenalty);
}

type SupportedLanguage = "python" | "javascript" | "java";

function hasMocking(code: string, language: SupportedLanguage): boolean {
  const patterns: Record<SupportedLanguage, RegExp> = {
    python: /\bmock\b|\bpatch\b|MagicMock/,
    javascript: /\bjest\.mock\b|\bsinon\b/,
    java: /\b@Mock\b|\bMockito\b/,
  };

  return patterns[language].test(code);
}

function hasEdgeCases(code: string): boolean {
  return /\bedge\b|\bboundary\b|\bmin\b|\bmax\b|\bzero\b|\bempty\b/i.test(code);
}

function countAssertions(code: string, language: SupportedLanguage): number {
  const patterns: Record<SupportedLanguage, RegExp> = {
    python: /\bassert\s|\bself\.assert/g,
    javascript: /\bexpect\s*\(/g,
    java: /\bassert\w+\s*\(/g,
  };

  return (code.match(patterns[language]) || []).length;
}

function hasErrorCases(code: string): boolean {
  return /\bexception\b|\berror\b|\bthrow\b|\btry\b|\bcatch\b/i.test(code);
}

// Analyze test quality metrics - HANYA 3 BAHASA
function analyzeTestQuality(
  testCode: string,
  language: "python" | "javascript" | "java"
) {
  const testCount = countTests(testCode, language);
  const assertionCount = countAssertions(testCode, language);
  const edge = hasEdgeCases(testCode);
  const error = hasErrorCases(testCode);
  const mock = hasMocking(testCode, language);
  const complexity = estimateComplexity(testCode);
  const coverage = estimateCoverage(testCount, assertionCount, edge, error);

  return {
    qualityScore: classifyQuality(testCount, assertionCount, edge, error, mock),
    estimatedCoverage: coverage,
    testCount,
    assertionCount,
    hasEdgeCases: edge,
    hasErrorCases: error,
    hasMocking: mock,
    complexity,
  };
}

// Get language from file extension - HANYA 3 BAHASA
function getLanguageFromExtension(extension: string): string {
  const extensionMap: Record<string, string> = {
    ".py": "python",
    ".js": "javascript",
    ".java": "java",
  };

  return extensionMap[extension.toLowerCase()] || "python"; // Default ke python
}

// Get file extension for language - HANYA 3 BAHASA
function getFileExtension(language: string): string {
  const languageMap: Record<string, string> = {
    python: "py",
    javascript: "js",
    java: "java",
  };

  return languageMap[language] || "py";
}

// Get test file name based on language conventions - HANYA 3 BAHASA
function getTestFileName(
  basename: string,
  extension: string,
  language: string
): string {
  const conventions: Record<string, string> = {
    python: `test_${basename}.py`,
    javascript: `${basename}.test${extension}`,
    java: `${basename}Test.java`,
  };

  return conventions[language] || `test_${basename}${extension}`;
}

// Existing utility functions
const runCommand = (
  cmd: string,
  args: string[],
  cwd?: string
): Promise<string> => {
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

function normalizeLanguage(lang?: string): "python" | "javascript" | "java" {
  if (!lang) return "python";

  const value = lang.toLowerCase();

  if (value.startsWith("py")) return "python";
  if (value === "js" || value.includes("javascript")) return "javascript";
  if (value.includes("java")) return "java";

  return "python";
}

function countTests(code: string, language: SupportedLanguage): number {
  const patterns: Record<SupportedLanguage, RegExp> = {
    python: /\bdef\s+test_/g,
    javascript: /\b(it|test)\s*\(/g,
    java: /\b@Test\b/g,
  };

  return (code.match(patterns[language]) || []).length;
}

async function runCoverageAndParse(
  panelLike: { webview: vscode.Webview },
  getLanguageFrameworks?: string
) {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) {
    panelLike.webview.postMessage({
      command: "coverageResult",
      success: false,
      message: "No workspace detected.",
    });
    return;
  }

  const language = normalizeLanguage(getLanguageFrameworks);

  try {
    const coverageCommands: Record<
      "python" | "javascript" | "java",
      { run: string[]; report: string[] }
    > = {
      python: {
        run: ["coverage", "run", "-m", "unittest", "discover"],
        report: ["coverage", "json", "-o", "coverage.json"],
      },
      javascript: {
        run: ["npx", "jest", "--coverage"],
        report: ["node", "-e", "console.log('Coverage generated by jest')"],
      },
      java: {
        run: ["./mvnw", "test", "jacoco:report"],
        report: ["node", "-e", "console.log('Coverage generated by jacoco')"],
      },
    };

    const commands = coverageCommands[language];

    await runCommand(commands.run[0], commands.run.slice(1), workspace);

    if (commands.report) {
      await runCommand(commands.report[0], commands.report.slice(1), workspace);
    }

    const covPath = path.join(workspace, "coverage.json");
    if (fs.existsSync(covPath)) {
      const json = JSON.parse(fs.readFileSync(covPath, "utf8"));

      const files = Object.entries(json.files || {}).map(
        ([file, data]: any) => ({
          file,
          percent_covered: data.summary?.percent_covered || 0,
          covered_lines:
            (data.summary?.num_statements || 0) -
            (data.summary?.missing_lines || 0),
          missing_lines: data.summary?.missing_lines || [],
        })
      );

      panelLike.webview.postMessage({
        command: "coverageResult",
        success: true,
        data: { total: json.totals, files },
        language, // 🔥 kirim balik bahasa final
      });
    } else {
      panelLike.webview.postMessage({
        command: "coverageResult",
        success: true,
        data: { total: { percent_covered: 0 }, files: [] },
        message: `Coverage executed but report format not supported for ${language}`,
        language,
      });
    }
  } catch (err: any) {
    panelLike.webview.postMessage({
      command: "coverageResult",
      success: false,
      message: err?.message || String(err),
      language,
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
      total_tests: data.results.reduce(
        (s: number, r: any) => s + (r.tests_total || 0),
        0
      ),
      total_passed: data.results.reduce(
        (s: number, r: any) => s + (r.tests_passed || 0),
        0
      ),
      total_failed: data.results.reduce(
        (s: number, r: any) => s + (r.tests_failed || 0),
        0
      ),
      languages_used: [
        ...new Set(data.results.map((r: any) => r.language || "python")),
      ],
    };

    fs.writeFileSync(logPath, JSON.stringify(data, null, 2), "utf8");
  } catch (err: any) {
    console.error("Failed to write test_log.json:", err?.message || err);
    vscode.window.showErrorMessage(
      "Gagal menyimpan test_log.json — periksa permission / disk space."
    );
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
**Languages Used:** ${data.summary?.languages_used?.join(", ") || "Python"}

---

## 📂 Test Runs Summary

| Language | File Tested | Test File | Total | Passed | Failed | Status | RunId |
|----------|-------------|-----------|-------|--------|--------|--------|-------|
`;

  (data.results || []).forEach((r: any) => {
    md += `| ${r.language || "python"} | ${r.file_tested || ""} | ${
      r.test_file || ""
    } | ${r.tests_total || 0} | ${r.tests_passed || 0} | ${
      r.tests_failed || 0
    } | ${r.status || ""} | ${r.runId || ""} |
`;
  });

  md += `

---

Generated automatically by the multi-language unit test extension.
`;

  try {
    fs.writeFileSync(mdPath, md, "utf8");
  } catch (err: any) {
    console.error("Failed to write unit_test_report.md:", err?.message || err);
  }
}

let __lastSavedTest: any = null;
