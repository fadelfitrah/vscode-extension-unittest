import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { buildTestPrompt } from '../extension';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('buildTestPrompt respects testCount from config', () => {
		const sourceCode = `def add(a, b):\n    return a + b`;
		const config: any = {
			...{
				testFramework: 'unittest',
				testStyle: 'given_when_then',
				coverageTarget: 80,
				testing: true,
			},
			testCount: 5,
		};

		const prompt = buildTestPrompt('sample.py', sourceCode, config);
		// The prompt should contain the requested max test cases
		assert.ok(prompt.includes('Max Test Cases: 5'));
	});

	test('buildTestPrompt falls back to default for invalid testCount', () => {
		const sourceCode = `def add(a, b):\n    return a + b`;
		const config: any = { testCount: 0, testFramework: 'unittest' };

		const prompt = buildTestPrompt('sample.py', sourceCode, config);
		// default testCount in DEFAULT_TEST_CONFIG is 3
		assert.ok(prompt.includes('Max Test Cases: 3'));
	});

	test('buildTestPrompt includes mocking section when mocking enabled', () => {
		const sourceCode = `def add(a, b):\n    return a + b`;
		const config: any = { testCount: 2, testFramework: 'unittest', autoMockExternalDeps: true, mockingFramework: 'unittest.mock' };

		const prompt = buildTestPrompt('sample.py', sourceCode, config);
		assert.ok(prompt.includes('MOCKING STRATEGY'));
		assert.ok(prompt.includes('Use unittest.mock'));
	});

	test('buildTestPrompt omits mocking section when mocking disabled', () => {
		const sourceCode = `def add(a, b):\n    return a + b`;
		const config: any = { testCount: 2, testFramework: 'unittest', autoMockExternalDeps: false, mockingFramework: 'unittest.mock' };

		const prompt = buildTestPrompt('sample.py', sourceCode, config);
		assert.ok(!prompt.includes('MOCKING STRATEGY'));
		assert.ok(!prompt.includes('Use unittest.mock'));
	});
});
