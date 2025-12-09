import * as vscode from "vscode";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
let runtimeFetch: any = (globalThis as any).fetch;
import { spawn } from "child_process";
import * as os from "os";
import { randomBytes } from "crypto";

// Load .env dari root project ekstensi (opsional)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export function activate(context: vscode.ExtensionContext) {
  console.log("generator-vscode-unittest: activate() called");

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
  aiProvider: "openai" | "mettalamma" | "qwen" | "dash" | "kimi" | "deepseek";
  model: string;
  temperature: number;
  maxTokens: number;

  // Language and Framework Configuration
  programmingLanguage: string;
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
  qualityScore: string;
  estimatedCoverage: number;
  testCount: number;
  assertionCount: number;
  hasEdgeCases: boolean;
  hasErrorCases: boolean;
  hasMocking: boolean;
  complexity: number;
  smells?: { [key: string]: boolean };
  smellCount?: number;
  estimatedBranchesCoverage?: number;
  estimatedMutationScore?: number;
}

// Language and Framework Mappings
const LANGUAGE_FRAMEWORKS: Record<
  string,
  { testFrameworks: string[]; mockingFrameworks: string[] }
> = {
  python: {
    testFrameworks: ["unittest", "pytest", "nose"],
    mockingFrameworks: ["unittest.mock", "pytest-mock", "freezegun"],
  },
  javascript: {
    testFrameworks: ["jest", "mocha", "jasmine", "vitest"],
    mockingFrameworks: ["jest", "sinon", "testdouble"],
  },
  typescript: {
    testFrameworks: ["jest", "mocha", "jasmine", "vitest"],
    mockingFrameworks: ["jest", "sinon", "testdouble"],
  },
  java: {
    testFrameworks: ["junit", "testng", "mockito"],
    mockingFrameworks: ["mockito", "easymock", "powermock"],
  },
  csharp: {
    testFrameworks: ["nunit", "xunit", "mstest"],
    mockingFrameworks: ["moq", "nsubstitute", "fakeiteasy"],
  },
  go: {
    testFrameworks: ["testing", "testify", "ginkgo"],
    mockingFrameworks: ["gomock", "testify/mock"],
  },
  rust: {
    testFrameworks: ["builtin", "proptest", "quickcheck"],
    mockingFrameworks: ["mockall", "mockito"],
  },
  php: {
    testFrameworks: ["phpunit", "pest"],
    mockingFrameworks: ["mockery", "prophecy"],
  },
  ruby: {
    testFrameworks: ["minitest", "rspec"],
    mockingFrameworks: ["rspec-mocks", "mocha"],
  },
  kotlin: {
    testFrameworks: ["kotest", "junit", "spek"],
    mockingFrameworks: ["mockk", "mockito"],
  },
  swift: {
    testFrameworks: ["xctest", "quick", "nimble"],
    mockingFrameworks: ["cuckoo", "swiftmock"],
  },
  cpp: {
    testFrameworks: ["gtest", "catch2", "doctest"],
    mockingFrameworks: ["gmock", "trompeloeil"],
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
  typescript: {
    testFramework: "jest",
    mockingFramework: "jest",
    requireDocstrings: true,
  },
  java: {
    testFramework: "junit",
    mockingFramework: "mockito",
    requireDocstrings: true,
  },
  csharp: {
    testFramework: "nunit",
    mockingFramework: "moq",
    requireDocstrings: true,
  },
  go: {
    testFramework: "testing",
    mockingFramework: "gomock",
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
  public static readonly viewType = "unitTestGeneratorView";
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

    let lastActiveFile = { code: "", fileName: "", language: "" };

    const updateActiveFile = () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const doc = editor.document;
        lastActiveFile.code = doc.getText();
        lastActiveFile.fileName = path.basename(doc.fileName);
        lastActiveFile.language = doc.languageId;

        this._postMessage(webviewView, {
          command: "loadCode",
          code: lastActiveFile.code,
          fileName: lastActiveFile.fileName,
          language: lastActiveFile.language,
        });

        // Send available frameworks for this language
        this._sendLanguageFrameworks(webviewView, lastActiveFile.language);
      }
    };

    const sendSourceFiles = async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        this._postMessage(webviewView, { command: "fileList", files: [] });
        return;
      }

      try {
        // Get all source files based on supported languages
        const sourceExtensions = Object.keys(LANGUAGE_FRAMEWORKS)
          .map((lang) => `**/*.${getFileExtension(lang)}`)
          .concat(
            "**/*.js",
            "**/*.ts",
            "**/*.jsx",
            "**/*.tsx",
            "**/*.java",
            "**/*.cs",
            "**/*.go",
            "**/*.rs",
            "**/*.php",
            "**/*.rb",
            "**/*.kt",
            "**/*.swift",
            "**/*.cpp",
            "**/*.h",
            "**/*.hpp"
          );

        const files = await vscode.workspace.findFiles(
          `{${sourceExtensions.join(",")}}`,
          "**/node_modules/**,**/vendor/**,**/.git/**"
        );

        const root = workspaceFolders[0].uri.fsPath.replace(/\\/g, "/");
        const fileList = files.map((uri) => ({
          path: uri.fsPath.replace(/\\/g, "/").replace(root + "/", ""),
          language: getLanguageFromExtension(path.extname(uri.fsPath)),
        }));

        this._postMessage(webviewView, {
          command: "fileList",
          files: fileList,
        });
      } catch (error) {
        console.error("Error finding source files:", error);
        this._postMessage(webviewView, { command: "fileList", files: [] });
      }
    };

    // Setup message handling
    this._setupMessageHandlers(webviewView);

    // Setup file watchers and event listeners
    this._setupEventListeners(webviewView, updateActiveFile, sendSourceFiles);

    // Initial data load
    updateActiveFile();
    sendSourceFiles();

    console.log("Webview view resolved successfully");
  }

  private _setupMessageHandlers(webviewView: vscode.WebviewView) {
    webviewView.webview.onDidReceiveMessage(async (message) => {
      console.log("Received message from webview:", message.command);

      try {
        switch (message.command) {
          case "ready":
            await this._sendSourceFiles(webviewView);
            this._postMessage(webviewView, {
              command: "status",
              message: "Extension ready",
            });
            break;

          case "requestFileList":
            await this._sendSourceFiles(webviewView);
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
    updateActiveFile: () => void,
    sendSourceFiles: () => void
  ) {
    // File system watcher for source files
    const sourceExtensions = Object.keys(LANGUAGE_FRAMEWORKS)
      .map((lang) => `**/*.${getFileExtension(lang)}`)
      .join(",");

    const sourceWatcher = vscode.workspace.createFileSystemWatcher(
      `{${sourceExtensions},**/*.js,**/*.ts,**/*.java,**/*.cs,**/*.go,**/*.rs,**/*.php,**/*.rb,**/*.kt,**/*.swift,**/*.cpp,**/*.h}`
    );

    sourceWatcher.onDidCreate(() => sendSourceFiles());
    sourceWatcher.onDidDelete(() => sendSourceFiles());
    sourceWatcher.onDidChange(() => sendSourceFiles());

    // Editor events
    const disposables = [
      sourceWatcher,
      vscode.window.onDidChangeActiveTextEditor(() => updateActiveFile()),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        updateActiveFile();
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          updateActiveFile();
          sendSourceFiles();
        }
      }),
    ];

    // Cleanup on dispose
    webviewView.onDidDispose(() => {
      disposables.forEach((disposable) => disposable.dispose());
    });
  }

  private async _sendSourceFiles(webviewView: vscode.WebviewView) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this._postMessage(webviewView, { command: "fileList", files: [] });
      return;
    }

    try {
      const sourceExtensions = Object.keys(LANGUAGE_FRAMEWORKS)
        .map((lang) => `**/*.${getFileExtension(lang)}`)
        .concat(
          "**/*.js",
          "**/*.ts",
          "**/*.jsx",
          "**/*.tsx",
          "**/*.java",
          "**/*.cs",
          "**/*.go",
          "**/*.rs",
          "**/*.php",
          "**/*.rb",
          "**/*.kt",
          "**/*.swift",
          "**/*.cpp",
          "**/*.h",
          "**/*.hpp"
        );

      const files = await vscode.workspace.findFiles(
        `{${sourceExtensions.join(",")}}`,
        "**/node_modules/**,**/vendor/**,**/.git/**"
      );

      const root = workspaceFolders[0].uri.fsPath.replace(/\\/g, "/");
      const fileList = files.map((uri) => ({
        path: uri.fsPath.replace(/\\/g, "/").replace(root + "/", ""),
        language: getLanguageFromExtension(path.extname(uri.fsPath)),
      }));

      this._postMessage(webviewView, { command: "fileList", files: fileList });
    } catch (error) {
      console.error("Error finding source files:", error);
      this._postMessage(webviewView, { command: "fileList", files: [] });
    }
  }

  private _sendLanguageFrameworks(
    webviewView: vscode.WebviewView,
    language: string
  ) {
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

  private async _handleGenerateTest(
    webviewView: vscode.WebviewView,
    message: any
  ) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage("Workspace tidak ditemukan.");
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const selectedFilePath = path.join(rootPath, message.fileName);

    if (!fs.existsSync(selectedFilePath)) {
      vscode.window.showErrorMessage(
        `File ${selectedFilePath} tidak ditemukan.`
      );
      return;
    }

    try {
      const code = fs.readFileSync(selectedFilePath, "utf8");
      if (!code.trim()) {
        vscode.window.showErrorMessage(
          `File yang dipilih (${message.fileName}) kosong. Tidak ada kode untuk dibuatkan unit test.`
        );
        return;
      }

      const language =
        message.language ||
        getLanguageFromExtension(path.extname(selectedFilePath));
      vscode.window.showInformationMessage(
        `Generating ${language} unit tests...`
      );

      // Build configuration from user input
      const config: TestGenerationConfig = {
        ...DEFAULT_TEST_CONFIG,
        programmingLanguage: language,
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
          "custom",
      };

      const result = await generateUnitTest(
        message.provider,
        message.fileName,
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
      vscode.window.showErrorMessage(
        `Failed to generate tests: ${error.message}`
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
      vscode.window.showErrorMessage(`Failed to save file: ${error.message}`);
    }
  }

  private async _handleAnalyzeQuality(
    webviewView: vscode.WebviewView,
    message: any
  ) {
    try {
      const qualityMetrics = analyzeTestQuality(
        message.testCode,
        message.sourceCode,
        message.language
      );
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
      htmlContent = htmlContent.replace(/{ICON_URI}/g, iconUri.toString());
      // Inject language frameworks data
      htmlContent = htmlContent.replace(
        /{LANGUAGE_FRAMEWORKS}/g,
        JSON.stringify(LANGUAGE_FRAMEWORKS)
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

  // resolve fetch implementation at runtime
  if (!runtimeFetch) {
    try {
      const req: any = eval("require");
      const nf = req("node-fetch");
      runtimeFetch = nf && nf.default ? nf.default : nf;
    } catch (e) {
      // leave runtimeFetch undefined
    }
  }

  if (!runtimeFetch) {
    throw new Error("No fetch implementation available");
  }

  const res = await runtimeFetch(url!, {
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
    code,
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

// Get language-specific testing guidelines
function getLanguageSpecificGuidelines(
  language: string,
  framework: string
): string {
  const guidelines: Record<string, string> = {
    python: `- Use ${
      framework === "pytest" ? "@pytest.fixture" : "setUp()/tearDown()"
    } for setup
- Import unittest.mock for mocking
- Use assert statements appropriately`,
    javascript: `- Use ${
      framework === "jest" ? "describe/it" : "describe/it"
    } blocks
- Use expect() assertions
- Mock using ${framework === "jest" ? "jest.mock()" : "sinon"}`,
    typescript: `- Use ${
      framework === "jest" ? "describe/it" : "describe/it"
    } blocks
- Include type definitions
- Mock using ${framework === "jest" ? "jest.mock()" : "sinon"}`,
    java: `- Use ${
      framework === "junit" ? "@Test annotations" : "appropriate annotations"
    }
- Follow Java naming conventions
- Use ${framework === "mockito" ? "@Mock annotations" : "appropriate mocking"}`,
    csharp: `- Use ${framework} attributes
- Follow C# naming conventions
- Use appropriate assertion library`,
    go: `- Use testing package
- Follow Go naming conventions (TestXxx)
- Use table-driven tests when appropriate`,
  };

  return (
    guidelines[language] || `- Follow best practices for ${language} testing`
  );
}

// Analyze test quality metrics
function analyzeTestQuality(
  testCode: string,
  sourceCode: string,
  language: string = "python"
) {
  // Language-specific assertion patterns
  const assertionPatterns: Record<string, RegExp[]> = {
    python: [/\bassert\s|\bself\.assert|\bunittest\.assert|\bpytest\.assert/g],
    javascript: [/\bexpect\(|\bassert\(|\bshould\.equal|\btoBe\(|\btoEqual\(/g],
    typescript: [/\bexpect\(|\bassert\(|\bshould\.equal|\btoBe\(|\btoEqual\(/g],
    java: [/\bassertThat\(|\bassertEquals\(|\bassertTrue\(|\bassertFalse\(/g],
    csharp: [
      /\bAssert\.Equal\(|\bAssert\.True\(|\bAssert\.False\(|\bAssert\.NotNull\(/g,
    ],
    go: [/\bt\.Error\(|\bt\.Errorf\(|\bt\.Fatal\(|\bt\.Fatalf\(/g],
  };

  // Language-specific test function patterns
  const testFunctionPatterns: Record<string, RegExp[]> = {
    python: [/\bdef\s+test_/g],
    javascript: [/\bit\(|\bdescribe\(/g],
    typescript: [/\bit\(|\bdescribe\(/g],
    java: [/\b@Test\b|\bpublic void test/g],
    csharp: [/\b\[Test\]|\bpublic void Test/g],
    go: [/\bfunc Test\w+\(/g],
  };

  const lower = testCode.toLowerCase();

  // Count test functions
  const patterns = testFunctionPatterns[language] || [
    /def test_|it\(|describe\(|@Test|func Test/g,
  ];
  let testCount = 0;
  patterns.forEach((pattern) => {
    testCount += (testCode.match(pattern) || []).length;
  });

  // Count assertions
  const assertionPattern = assertionPatterns[language] || [
    /assert|expect|should|toBe|toEqual|assertEquals/g,
  ];
  let assertionCount = 0;
  assertionPattern.forEach((pattern) => {
    assertionCount += (testCode.match(pattern) || []).length;
  });

  const hasEdgeCases =
    /\bedge|\bboundary|\bmin\b|\bmax\b|\bzero|\bempty|\bnull\b|\bnone\b/.test(
      lower
    );

  const hasErrorCases =
    /\berror|\bexception|\btry\b|\bexcept\b|\braise\b|\bcatch\b|\bthrow\b/.test(
      lower
    );

  const hasMocking =
    /\bmock|patch|MagicMock|Mock\b|jest\.mock|sinon|@Mock|Mockito/.test(
      testCode
    );

  // ---------- COMPLEXITY ESTIMATION ----------
  const controlStructures = (
    testCode.match(
      /\bif\b|\belse\b|\bfor\b|\bwhile\b|\btry\b|\bcatch\b|\bswitch\b/g
    ) || []
  ).length;

  const cognitivePenalty = Math.floor(testCode.split("\n").length / 40);
  const complexity = Math.max(1, controlStructures + cognitivePenalty);

  // ---------- QUALITY LEVEL CLASSIFICATION ----------
  let qualityScore = "Poor";

  if (testCount >= 2 && assertionCount >= testCount) {
    qualityScore = "Fair";
  }
  if (
    testCount >= 3 &&
    assertionCount >= testCount * 1.2 &&
    (hasEdgeCases || hasErrorCases)
  ) {
    qualityScore = "Good";
  }
  if (
    testCount >= 5 &&
    assertionCount >= testCount * 1.5 &&
    hasEdgeCases &&
    hasErrorCases &&
    hasMocking
  ) {
    qualityScore = "Excellent";
  }

  // ---------- ESTIMATED COVERAGE ----------
  const estimatedCoverage = Math.min(
    100,
    testCount * 15 +
      assertionCount * 3 +
      (hasEdgeCases ? 10 : 0) +
      (hasErrorCases ? 10 : 0)
  );

  // ---------- OUTPUT ----------
  return {
    qualityScore,
    estimatedCoverage,
    testCount,
    assertionCount,
    hasEdgeCases,
    hasErrorCases,
    hasMocking,
    complexity,
  };
}

// Get language from file extension
function getLanguageFromExtension(extension: string): string {
  const extensionMap: Record<string, string> = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".java": "java",
    ".cs": "csharp",
    ".go": "go",
    ".rs": "rust",
    ".php": "php",
    ".rb": "ruby",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".swift": "swift",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".h": "cpp",
    ".hpp": "cpp",
    ".hxx": "cpp",
  };

  return extensionMap[extension.toLowerCase()] || "python";
}

// Get file extension for language
function getFileExtension(language: string): string {
  const languageMap: Record<string, string> = {
    python: "py",
    javascript: "js",
    typescript: "ts",
    java: "java",
    csharp: "cs",
    go: "go",
    rust: "rs",
    php: "php",
    ruby: "rb",
    kotlin: "kt",
    swift: "swift",
    cpp: "cpp",
  };

  return languageMap[language] || "py";
}

// Get test file name based on language conventions
function getTestFileName(
  basename: string,
  extension: string,
  language: string
): string {
  const conventions: Record<string, string> = {
    python: `test_${basename}.py`,
    javascript: `${basename}.test${extension}`,
    typescript: `${basename}.test${extension}`,
    java: `${basename}Test.java`,
    csharp: `${basename}Tests.cs`,
    go: `${basename}_test.go`,
    rust: `${basename}_test.rs`,
    php: `${basename}Test.php`,
    ruby: `${basename}_test.rb`,
    kotlin: `${basename}Test.kt`,
    swift: `${basename}Tests.swift`,
    cpp: `${basename}_test.cpp`,
  };

  return conventions[language] || `test_${basename}${extension}`;
}

// Calculate code complexity (simplified)
function calculateComplexity(code: string): number {
  const lines = code.split("\n").length;
  const branches = (
    code.match(/if|elif|else|for|while|try|catch|switch|case/g) || []
  ).length;
  return Math.max(1, Math.round(lines * 0.1 + branches));
}

// Existing utility functions (keep these as they are)
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

async function runCoverageAndParse(
  panelLike: { webview: vscode.Webview },
  language: string = "python"
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

  try {
    // Language-specific coverage commands
    const coverageCommands: Record<
      string,
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
      typescript: {
        run: ["npx", "jest", "--coverage"],
        report: ["node", "-e", "console.log('Coverage generated by jest')"],
      },
      java: {
        run: ["./mvnw", "test", "jacoco:report"],
        report: ["node", "-e", "console.log('Coverage generated by jacoco')"],
      },
      csharp: {
        run: ["dotnet", "test", '--collect:"XPlat Code Coverage"'],
        report: [
          "dotnet",
          "reportgenerator",
          "-reports:*/coverage.cobertura.xml",
          "-targetdir:coveragereport",
        ],
      },
    };

    const commands = coverageCommands[language] || coverageCommands.python;

    await runCommand(commands.run[0], commands.run.slice(1), workspace);

    if (commands.report) {
      await runCommand(commands.report[0], commands.report.slice(1), workspace);
    }

    // Try to read coverage report
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
      });
    } else {
      panelLike.webview.postMessage({
        command: "coverageResult",
        success: true,
        data: { total: { percent_covered: 0 }, files: [] },
        message: `Coverage executed but report format not supported for ${language}`,
      });
    }
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
