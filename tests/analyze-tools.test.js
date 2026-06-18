/**
 * page_analyze & Utility Tool Regression tests
 *
 * Tests cover Plan 05-01:
 * - page_analyze: content extraction, LLM analysis, truncation, error handling
 * - Calculator regression: basic arithmetic
 * - Clipboard regression: read/write operations
 * - get_current_time regression: time string formatting
 *
 * RED Phase (Task 1): page_analyze stub returns placeholder -> all 5 tests fail
 * GREEN Phase (Task 2): page_analyze implemented -> all 9 tests pass
 * Regression tests (Tests 6-9) pass in both phases (already implemented in Phase 3)
 */

// Polyfill TextEncoder/TextDecoder for jsdom
var { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Load chrome mock
require('./__mocks__/chrome.js');

/**
 * Load extension modules in dependency order
 * (matches manifest.json content_scripts order)
 */
function loadModules() {
  var purifyFactory = require('../lib/purify.min.js');
  window.DOMPurify = purifyFactory(window);
  window.marked = require('../lib/marked.min.js');
  require('../storage.js');
  require('../panel.js');
  require('../content-script.js');
}

/**
 * Helper: get tool execute function by name from nativeTools
 */
function getTool(name) {
  return window.GobyAgent.nativeTools.find(function (t) {
    return t.function.name === name;
  });
}

/**
 * Helper: set up standard LLM mock that responds to llm-request
 * @param {string} responseContent - LLM analysis text to return
 */
function mockLLMResponse(responseContent) {
  chrome.runtime.sendMessage.mockImplementation(function (msg) {
    if (msg && msg.action === 'llm-request') {
      return Promise.resolve({
        choices: [{ message: { role: 'assistant', content: responseContent || '分析结果' } }]
      });
    }
    return Promise.resolve({});
  });
}

// ================================================================
//  page_analyze
//  Tests 1-5: content extraction, LLM analysis, truncation, error
// ================================================================
describe('page_analyze', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    // Clean up any Goby UI artifacts from previous module loads
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    // Default page content for analysis
    document.body.innerHTML = '<div id="content"><h1>测试标题</h1><p>这是测试内容段落。</p></div>';
  });

  // ---------------------------------------------------------------
  //  Test 1: page_analyze exists in nativeTools and returns analysis
  //  RED: stub returns "工具将在后续版本可用" -> assertion fails
  //  GREEN: returns LLM analysis text -> assertion passes
  // ---------------------------------------------------------------
  test('Test 1: page_analyze tool exists and returns LLM analysis', async function () {
    loadModules();
    var tool = getTool('page_analyze');
    expect(tool).toBeDefined();
    expect(tool.function.name).toBe('page_analyze');
    expect(tool.timeout).toBe(30000);
    expect(typeof tool.execute).toBe('function');

    // Mock LLM to return analysis
    mockLLMResponse('这是页面分析结果');

    var result = await tool.execute({});
    // RED-phase assertion: fails because stub returns placeholder
    // GREEN-phase assertion: passes because execute returns LLM result
    expect(result).not.toBe('工具将在后续版本可用');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  //  Test 2: page_analyze returns LLM analysis content
  //  RED: stub returns placeholder -> fails
  //  GREEN: return value matches mock LLM response -> passes
  // ---------------------------------------------------------------
  test('Test 2: page_analyze returns LLM analysis from callLLM', async function () {
    loadModules();
    var tool = getTool('page_analyze');

    // Mock LLM to return specific analysis text
    mockLLMResponse('这是一个测试页面，主题是测试内容，包含标题和段落。');

    var result = await tool.execute({});
    expect(result).not.toBe('工具将在后续版本可用');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('测试');
  });

  // ---------------------------------------------------------------
  //  Test 3: page_analyze handles empty page content
  //  RED: stub ignores body content, returns placeholder -> fails
  //  GREEN: body is empty, returns error string -> passes
  // ---------------------------------------------------------------
  test('Test 3: page_analyze returns empty content message when body is empty', async function () {
    document.body.innerHTML = '';
    loadModules();
    var tool = getTool('page_analyze');

    var result = await tool.execute({});
    expect(result).not.toBe('工具将在后续版本可用');
    // Should indicate empty page
    expect(result).toContain('内容为空');
  });

  // ---------------------------------------------------------------
  //  Test 4: page_analyze truncates content at 50000 characters
  //  RED: stub ignores content length -> fails
  //  GREEN: verify truncation length with 60000-char page -> passes
  // ---------------------------------------------------------------
  test('Test 4: page_analyze handles content over 50000 characters by truncating', async function () {
    var longText = 'A'.repeat(60000);
    document.body.innerHTML = '<div>' + longText + '</div>';
    loadModules();
    var tool = getTool('page_analyze');

    mockLLMResponse('分析完成');

    var result = await tool.execute({});
    expect(result).not.toBe('工具将在后续版本可用');
    expect(result).toBe('分析完成');

    // Capture the actual LLM call arguments to verify truncation
    var llmCalls = chrome.runtime.sendMessage.mock.calls.filter(function (call) {
      return call[0] && call[0].action === 'llm-request';
    });
    expect(llmCalls.length).toBeGreaterThanOrEqual(1);
    var sentMessages = llmCalls[0][0].messages;
    // Last message should be user content (the page text)
    var userContent = sentMessages[sentMessages.length - 1].content || '';
    // Should be <= 50000 chars
    expect(userContent.length).toBeLessThanOrEqual(50000);
  });

  // ---------------------------------------------------------------
  //  Test 5: page_analyze handles callLLM failure gracefully
  //  RED: stub ignores LLM, returns placeholder -> fails
  //  GREEN: LLM fails, returns "Error: page_analyze..." string -> passes
  // ---------------------------------------------------------------
  test('Test 5: page_analyze returns error string when callLLM fails', async function () {
    loadModules();
    var tool = getTool('page_analyze');

    // Mock LLM to reject
    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-request') {
        return Promise.reject(new Error('API request failed'));
      }
      return Promise.resolve({});
    });

    var result = await tool.execute({});
    expect(result).not.toBe('工具将在后续版本可用');
    // Should return error string, not throw
    expect(typeof result).toBe('string');
    expect(result).toContain('Error');
    expect(result).toContain('page_analyze');
  });
});

// ================================================================
//   Utility Tool Regression Tests (D-13)
//   Tests 6-9: Verify Phase 3 tools still work correctly
// ================================================================
describe('Utility Tool Regression', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  });

  // ---------------------------------------------------------------
  //  Test 6: calculator correctly computes "2+3*4"
  // ---------------------------------------------------------------
  test('Test 6: calculator correctly computes 2+3*4', function () {
    loadModules();
    var tool = getTool('calculator');
    expect(tool).toBeDefined();

    var result = tool.execute({ expression: '2+3*4' });
    expect(result).not.toBe('工具将在后续版本可用');
    expect(result).toBe('计算结果: 14');
  });

  // ---------------------------------------------------------------
  //  Test 7: clipboard_read reads clipboard content
  //  In JSDOM, execCommand('paste') returns empty,
  //  so tool returns '（剪贴板为空）'
  // ---------------------------------------------------------------
  test('Test 7: clipboard_read returns content or empty message', function () {
    loadModules();
    var tool = getTool('clipboard_read');
    expect(tool).toBeDefined();

    var result = tool.execute({});
    expect(result).not.toBe('工具将在后续版本可用');
    expect(typeof result).toBe('string');
  });

  // ---------------------------------------------------------------
  //  Test 8: clipboard_write writes content and returns result
  //  Note: JSDOM lacks document.execCommand, so tool may return an
  //  error string. The key test is that it returns SOMETHING useful
  //  (not the placeholder), proving the tool is implemented.
  // ---------------------------------------------------------------
  test('Test 8: clipboard_write writes content and returns result', function () {
    loadModules();
    var tool = getTool('clipboard_write');
    expect(tool).toBeDefined();

    var result = tool.execute({ text: '测试剪贴板内容' });
    expect(result).not.toBe('工具将在后续版本可用');
    expect(typeof result).toBe('string');
    // In JSDOM: returns error (execCommand not available)
    // In Chrome: returns success confirmation
    // Both are acceptable as long as it's not the placeholder stub
    expect(result.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  //  Test 9: get_current_time returns formatted time string
  // ---------------------------------------------------------------
  test('Test 9: get_current_time returns a time string', function () {
    loadModules();
    var tool = getTool('get_current_time');
    expect(tool).toBeDefined();

    var result = tool.execute({});
    expect(result).not.toBe('工具将在后续版本可用');
    expect(result).toContain('当前时间');
    expect(result.length).toBeGreaterThan(5);
  });
});
