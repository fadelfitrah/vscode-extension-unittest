(function () {
  const vscode = acquireVsCodeApi();

  const provider = document.getElementById('provider');
  const openrouter = document.getElementById('openrouter');
  const groq = document.getElementById('groq');
  const saveKeys = document.getElementById('saveKeys');
  const sourceCode = document.getElementById('sourceCode');
  const numTests = document.getElementById('numTests');
  const filename = document.getElementById('filename');
  const generate = document.getElementById('generate');
  const save = document.getElementById('save');
  const result = document.getElementById('result');

  saveKeys.onclick = () => {
    vscode.postMessage({
      command: 'saveApiKeys',
      openrouterKey: openrouter.value,
      groqKey: groq.value
    });
  };

  generate.onclick = () => {
    vscode.postMessage({
      command: 'requestGeneration',
      payload: {
        provider: provider.value,
        source: sourceCode.value,
        numTests: parseInt(numTests.value, 10),
        filename: filename.value
      }
    });
    result.textContent = '⏳ Menghasilkan kode dari AI...';
  };

  save.onclick = () => {
    vscode.postMessage({
      command: 'generate',
      payload: {
        filename: filename.value,
        generatedCode: result.textContent
      }
    });
  };

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'generationResult') {
      result.textContent = msg.code;
    } else if (msg.command === 'generatedSaved') {
      result.textContent += `\n✅ File disimpan: ${msg.uri}`;
    }
  });
})();
