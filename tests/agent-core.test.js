/**
 * Agent Core tests — LLM streaming, DOMPurify pipeline, fallback mechanisms
 *
 * Tests cover:
 * - callLLMStream/callLLM through Service Worker proxy (AGENT-02, AGENT-03)
 * - stream-chunk rendering pipeline with marked.parse → DOMPurify.sanitize (SEC-01)
 * - DOMPurify whitelist: safe tags allowed, dangerous tags/attributes rejected
 * - Reasoning field fallback for Qwen (reasoning) and DeepSeek (reasoning_content)
 *
 * RED Phase: All 8 tests fail (GobyAgent, background handlers not yet implemented)
 * GREEN Phase: All 8 tests pass after Task 2 & Task 3 implementation
 */

// Polyfill TextEncoder/TextDecoder for jsdom (not provided by JSDOM environment)
var { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Load chrome mock
require('./__mocks__/chrome.js');

// Tab ID used for chrome.tabs.sendMessage in streaming tests
var TEST_TAB_ID = 999;

/**
 * Load all browser extension modules in the correct dependency order.
 * DOMPurify and marked must be set manually in Node.js/JSDOM (they export
 * via module.exports rather than setting window globals).
 */
function loadAgentModules() {
  // DOMPurify v3 factory: call with window to get DOMPurify instance
  var purifyFactory = require('../lib/purify.min.js');
  window.DOMPurify = purifyFactory(window);

  // marked v15: set as window global
  window.marked = require('../lib/marked.min.js');

  // Extension modules (manifest content_scripts order)
  require('../storage.js');
  require('../panel.js');
  require('../content-script.js');
}

// ================================================================
//   LLM Streaming via Service Worker
//   Tests 1-3: callLLMStream → SW proxy → stream-chunk delivery
// ================================================================
describe('LLM Streaming via Service Worker', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    // Clean DOM artifacts from previous panel.js execution
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) { el.remove(); });
    // Clean up any mock fetch
    delete global.fetch;

    // Default mock: resolve llm-stream so callLLMStream promises complete
    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        process.nextTick(function () {
          if (window.GobyAgent && window.GobyAgent.handleStreamChunk) {
            window.GobyAgent.handleStreamChunk({
              type: 'done', done: true,
              content: '',
              message: { role: 'assistant', content: '' }
            });
          }
        });
        return Promise.resolve();
      }
      return Promise.resolve({});
    });
  });

  // ---------------------------------------------------------------
  //  Test 1: GobyAgent.callLLMStream sends llm-stream message
  //  Verifies: chrome.runtime.sendMessage called with correct payload
  // ---------------------------------------------------------------
  test('Test 1: GobyAgent.callLLMStream sends llm-stream with messages and tools', async function () {
    loadAgentModules();

    // RED: GobyAgent is undefined → test fails at first assertion
    expect(window.GobyAgent).toBeDefined();
    expect(typeof window.GobyAgent.callLLMStream).toBe('function');

    var onChunk = jest.fn();
    await window.GobyAgent.callLLMStream(
      [{ role: 'user', content: '测试消息' }],
      onChunk
    );

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'llm-stream',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: '测试消息' })
        ]),
        tools: expect.any(Array)
      })
    );
  });

  // ---------------------------------------------------------------
  //  Test 2: SW llm-stream handler reads config, constructs fetch
  //  Verifies: chrome.storage.local.get → fetch() → SSE parsing
  // ---------------------------------------------------------------
  test('Test 2: background.js onMessage handler reads config and constructs fetch for llm-stream', async function () {
    require('../background.js');

    // RED: background.js (current ~12 lines) does NOT register onMessage listener
    // GREEN: rewritten background.js registers onMessage.addListener
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    var handler = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    expect(typeof handler).toBe('function');

    // Pre-set storage with active profile
    await chrome.storage.local.set({
      agentConfig: {
        profiles: {
          '测试': { baseUrl: 'http://test.com/v1', apiKey: 'sk-test-key', model: 'test-model' }
        },
        activeProfile: '测试'
      }
    });
    chrome.storage.local.get.mockClear();

    // Mock SSE stream
    var encoder = new TextEncoder();
    var streamReads = [
      { done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n') },
      { done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":" World"}}]}\n\n') },
      { done: false, value: encoder.encode('data: [DONE]\n\n') },
      { done: true, value: undefined }
    ];
    var readIndex = 0;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: function () { return 'text/event-stream'; } },
      body: {
        getReader: function () {
          return {
            read: function () {
              var result = streamReads[readIndex];
              readIndex++;
              return Promise.resolve(result);
            }
          };
        }
      }
    });

    var sendResponse = jest.fn();
    var message = {
      action: 'llm-stream',
      messages: [{ role: 'user', content: 'hi' }],
      tools: []
    };
    var sender = { id: chrome.runtime.id, tab: { id: TEST_TAB_ID } };

    // Invoke the handler synchronously (it should return true for async response)
    var result = handler(message, sender, sendResponse);

    // Wait for async fetch + SSE parsing to complete
    await new Promise(function (resolve) { setTimeout(resolve, 200); });

    // Should have read config from storage
    expect(chrome.storage.local.get).toHaveBeenCalled();

    // Should have called fetch with the right URL and headers
    expect(global.fetch).toHaveBeenCalled();
    var fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[0]).toContain('/chat/completions');
    expect(fetchCall[1].method).toBe('POST');
    expect(fetchCall[1].headers['Authorization']).toBe('Bearer sk-test-key');
    expect(fetchCall[1].body).toContain('"stream":true');

    // Should have forwarded chunks to content script via tabs.sendMessage
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      TEST_TAB_ID,
      expect.objectContaining({ action: 'stream-chunk' })
    );

    // Should have received text chunks ("Hello", " World")
    var streamChunks = chrome.tabs.sendMessage.mock.calls.filter(function (call) {
      return call[1] && call[1].action === 'stream-chunk' && call[1].data && call[1].data.type === 'text';
    });
    expect(streamChunks.length).toBeGreaterThan(0);

    // Should have received a done chunk with full content
    var doneChunks = chrome.tabs.sendMessage.mock.calls.filter(function (call) {
      return call[1] && call[1].action === 'stream-chunk' && call[1].data && call[1].data.done === true;
    });
    expect(doneChunks.length).toBe(1);
    expect(doneChunks[0][1].data.message.role).toBe('assistant');
    expect(doneChunks[0][1].data.message.content).toBe('Hello World');
  });

  // ---------------------------------------------------------------
  //  Test 3: stream-chunk appends delta.content to bot bubble textContent
  //  Verifies: Content Script receives chunk and updates panel DOM
  // ---------------------------------------------------------------
  test('Test 3: stream-chunk text appends to current bot bubble textContent', async function () {
    loadAgentModules();

    // RED: if GobyAgent doesn't have handleStreamChunk, the stream-chunk handler
    // in content-script.js's onMessage won't work → test fails
    expect(window.GobyAgent).toBeDefined();
    expect(typeof window.GobyAgent.handleStreamChunk).toBe('function');

    // Get the content-script's onMessage listener
    // First listener registered: background.js (if loaded) or content-script.js
    // We need the one from content-script.js - find it
    var handlers = chrome.runtime.onMessage.addListener.mock.calls;
    expect(handlers.length).toBeGreaterThan(0);
    var handler = handlers[0][0]; // content-script registers first in its IIFE

    // Trigger user message to create conversation context
    window.GobyAgent.sendMessage('你好');
    await new Promise(function (resolve) { setTimeout(resolve, 50); });

    // Set up spy BEFORE the action
    var streamingSpy = jest.spyOn(window.GobyPanel, 'appendStreamingChunk');
    streamingSpy.mockClear();

    // Simulate a stream-chunk text event from SW
    handler(
      { action: 'stream-chunk', data: { type: 'text', content: 'Hello', done: false } },
      { id: chrome.runtime.id },
      function () {}
    );

    // Bot bubble should contain the streamed text
    expect(streamingSpy).toHaveBeenCalledWith('Hello', false);
    streamingSpy.mockRestore();
  });
});

// ================================================================
//   DOMPurify Sanitization Pipeline
//   Tests 4-5: marked.parse → DOMPurify.sanitize safety
// ================================================================
describe('DOMPurify Sanitization Pipeline', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) { el.remove(); });
  });

  // ---------------------------------------------------------------
  //  Test 4: done chunk triggers DOMPurify.sanitize(marked.parse(content))
  //  Verifies: GobyAgent.renderMarkdown converts markdown → safe HTML
  // ---------------------------------------------------------------
  test('Test 4: stream-chunk done triggers GobyAgent.renderMarkdown via DOMPurify.sanitize', async function () {
    loadAgentModules();

    // RED: GobyAgent undefined → test fails
    expect(window.GobyAgent).toBeDefined();
    expect(typeof window.GobyAgent.renderMarkdown).toBe('function');

    // Simple markdown input
    var result = window.GobyAgent.renderMarkdown('# Hello World\n\nThis is **bold** and `code`.');

    // Verify it returns a string (not the original markdown)
    expect(typeof result).toBe('string');
    // Should have converted markdown to HTML
    expect(result).toContain('h1');
    expect(result).toContain('Hello World');
    // Bold should be <strong> or <b>
    expect(result).toContain('bold');
  });

  // ---------------------------------------------------------------
  //  Test 5: DOMPurify whitelist: allows safe tags, rejects dangerous
  //  Verifies: ALLOWED_TAGS and ALLOWED_ATTR work correctly
  // ---------------------------------------------------------------
  test('Test 5: DOMPurify whitelist allows p/br/strong... and rejects script/iframe/onclick', function () {
    loadAgentModules();

    // RED: GobyAgent undefined → test fails
    expect(window.GobyAgent).toBeDefined();
    expect(typeof window.GobyAgent.renderMarkdown).toBe('function');

    // Allowed: paragraphs, bold, lists
    var safeHtml = '<p>Safe <strong>text</strong></p><ul><li>Item</li></ul>';
    var result = window.GobyAgent.renderMarkdown(safeHtml);
    expect(result).toContain('<p>');
    expect(result).toContain('<strong>');
    expect(result).toContain('<ul>');

    // Rejected: script tag
    var withScript = '<p>Text</p><script>alert(1)</script>';
    result = window.GobyAgent.renderMarkdown(withScript);
    expect(result).not.toContain('script');
    expect(result).toContain('<p>');

    // Rejected: iframe
    var withIframe = '<p>Text</p><iframe src="http://evil.com"></iframe>';
    result = window.GobyAgent.renderMarkdown(withIframe);
    expect(result).not.toContain('iframe');

    // Rejected: onclick attribute
    var withOnClick = '<a href="http://example.com" onclick="alert(1)">link</a>';
    result = window.GobyAgent.renderMarkdown(withOnClick);
    expect(result).not.toContain('onclick');

    // Allowed anchor tag with href
    var withLink = '<a href="http://example.com">link</a>';
    result = window.GobyAgent.renderMarkdown(withLink);
    expect(result).toContain('href="http://example.com"');
    expect(result).toContain('</a>');

    // Allowed: code, pre, h1-h6, blockquote, img, em, del
    var moreSafe = '<pre><code>code block</code></pre><blockquote>quote</blockquote><img src="img.png" alt="test">';
    result = window.GobyAgent.renderMarkdown(moreSafe);
    expect(result).toContain('<pre>');
    expect(result).toContain('<blockquote>');
    expect(result).toContain('<img');
  });
});

// ================================================================
//   LLM Non-Streaming & Fallback
//   Tests 6-8: callLLM, reasoning fallback, error handling
// ================================================================
describe('LLM Non-Streaming & Fallback', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) { el.remove(); });
  });

  // ---------------------------------------------------------------
  //  Test 6: content empty fallback to reasoning/reasoning_content
  //  Verifies: getFallbackContent returns reasoning fields when
  //            content is empty (Qwen: reasoning, DeepSeek: reasoning_content)
  // ---------------------------------------------------------------
  test('Test 6: GobyAgent.getFallbackContent returns reasoning when content empty', function () {
    loadAgentModules();

    // RED: GobyAgent undefined → test fails
    expect(window.GobyAgent).toBeDefined();
    expect(typeof window.GobyAgent.getFallbackContent).toBe('function');

    // Case 1: content present → return content
    var delta1 = { content: 'Hello', reasoning: 'thinking...' };
    expect(window.GobyAgent.getFallbackContent(delta1)).toBe('Hello');

    // Case 2: content empty, reasoning present (Qwen format)
    var delta2 = { reasoning: '这是我思考的过程...' };
    expect(window.GobyAgent.getFallbackContent(delta2)).toBe('这是我思考的过程...');

    // Case 3: content empty, reasoning_content present (DeepSeek format)
    var delta3 = { reasoning_content: 'Let me think step by step...' };
    expect(window.GobyAgent.getFallbackContent(delta3)).toBe('Let me think step by step...');

    // Case 4: content empty, both empty → return ''
    var delta4 = {};
    expect(window.GobyAgent.getFallbackContent(delta4)).toBe('');

    // Case 5: content takes priority over reasoning
    var delta5 = { content: 'Final answer', reasoning: 'Internal reasoning' };
    expect(window.GobyAgent.getFallbackContent(delta5)).toBe('Final answer');
  });

  // ---------------------------------------------------------------
  //  Test 7: callLLM non-streaming sends llm-request, returns full JSON
  //  Verifies: GobyAgent.callLLM sends non-streaming message
  // ---------------------------------------------------------------
  test('Test 7: GobyAgent.callLLM sends llm-request and returns full JSON response', async function () {
    loadAgentModules();

    // RED: GobyAgent undefined → test fails
    expect(window.GobyAgent).toBeDefined();
    expect(typeof window.GobyAgent.callLLM).toBe('function');

    // Mock chrome.runtime.sendMessage to return a fake response
    chrome.runtime.sendMessage.mockImplementation(function (message) {
      if (message && message.action === 'llm-request') {
        return Promise.resolve({
          choices: [{ message: { role: 'assistant', content: '非流式响应内容' } }]
        });
      }
      return Promise.resolve({});
    });

    var result = await window.GobyAgent.callLLM([
      { role: 'user', content: '测试' }
    ]);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'llm-request' })
    );
    expect(result).toBeDefined();
    expect(result.choices).toBeDefined();
    expect(result.choices[0].message.content).toBe('非流式响应内容');
  });

  // ---------------------------------------------------------------
  //  Test 8: connection failure sets connectionStatus to 'red'
  //  Verifies: HandleStreamChunk error → updateConnectionStatus('red')
  // ---------------------------------------------------------------
  test('Test 8: stream error sets connectionStatus to red', function () {
    loadAgentModules();

    // RED: GobyAgent undefined → test fails
    expect(window.GobyAgent).toBeDefined();
    expect(typeof window.GobyAgent.handleStreamChunk).toBe('function');

    // Spy on updateConnectionStatus
    var connectionSpy = jest.spyOn(window.GobyPanel, 'updateConnectionStatus');
    connectionSpy.mockClear();

    // Simulate an error stream-chunk
    window.GobyAgent.handleStreamChunk({
      type: 'error',
      error: { message: 'Network failure' },
      done: true
    });

    // Connection status should be 'red' after error
    expect(connectionSpy).toHaveBeenCalledWith('red');
    connectionSpy.mockRestore();
  });
});

// ================================================================
//   enforceMessageLimit (260620-i08 Task 1)
//   消息状态机修复: system 分离 + tool 配对保护
// ================================================================
describe('enforceMessageLimit', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) { el.remove(); });
  });

  function buildMessages(count, role) {
    var arr = [];
    for (var i = 0; i < count; i++) {
      arr.push({ role: role, content: 'msg-' + role + '-' + i });
    }
    return arr;
  }

  // ---------------------------------------------------------------
  //  Test 1: system prompt 始终保留，不计入 MAX_MESSAGES=20 上限
  //  构造 [system, u1..u20]（共 21 条）触发 enforceMessageLimit
  // ---------------------------------------------------------------
  test('Test 1: system prompt always preserved when total exceeds MAX_MESSAGES', function () {
    loadAgentModules();
    var internals = window.__gobyInternals;
    expect(typeof internals.enforceMessageLimit).toBe('function');

    var msgs = [{ role: 'system', content: 'system-prompt' }];
    msgs = msgs.concat(buildMessages(20, 'user'));
    internals._agentState.messages = msgs;

    internals.enforceMessageLimit();

    var result = internals._agentState.messages;
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('system-prompt');
    // 保留区 convoMsgs 长度 ≤ MAX_MESSAGES=20
    var convoCount = result.length - 1; // 减去 system
    expect(convoCount).toBeLessThanOrEqual(20);
  });

  // ---------------------------------------------------------------
  //  Test 2: 总条数 ≤ MAX_MESSAGES 时内容完全不变
  // ---------------------------------------------------------------
  test('Test 2: no change when total length ≤ MAX_MESSAGES', function () {
    loadAgentModules();
    var internals = window.__gobyInternals;

    var msgs = [{ role: 'system', content: 'sys' }];
    msgs = msgs.concat(buildMessages(10, 'user'));
    var originalSnapshot = JSON.parse(JSON.stringify(msgs));
    internals._agentState.messages = msgs;

    internals.enforceMessageLimit();

    var result = internals._agentState.messages;
    expect(result.length).toBe(originalSnapshot.length);
    for (var i = 0; i < result.length; i++) {
      expect(result[i].role).toBe(originalSnapshot[i].role);
      expect(result[i].content).toBe(originalSnapshot[i].content);
    }
  });

  // ---------------------------------------------------------------
  //  Test 3: tool 配对保护 — assistant.tool_calls 与 tool 结果一起保留
  //  构造 [system, u1, assistant(tool_calls id=X), tool(tool_call_id=X), u2..u16]
  //  超过 MAX_MESSAGES=20 时，splitIdx 应扩展保护 assistant
  // ---------------------------------------------------------------
  test('Test 3: tool↔assistant.tool_calls pairing preserved by splitIdx extension', function () {
    loadAgentModules();
    var internals = window.__gobyInternals;

    // 构造：system + 4 条前缀 + assistant(tool_calls id=X) + tool(tool_call_id=X) + 16 条对话 = 22 条
    var msgs = [{ role: 'system', content: 'sys' }];
    msgs.push({ role: 'user', content: 'u-pre-1' });
    msgs.push({ role: 'assistant', content: 'a-pre-1' });
    msgs.push({ role: 'user', content: 'u-pre-2' });
    msgs.push({ role: 'assistant', content: 'a-pre-2' });
    // 关键：assistant 带 tool_calls，配对的 tool 结果紧随其后
    msgs.push({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_X', type: 'function', function: { name: 'page_query', arguments: '{}' } }]
    });
    msgs.push({
      role: 'tool',
      tool_call_id: 'call_X',
      name: 'page_query',
      content: 'result-X'
    });
    // 再加 16 条对话，让保留区开头落在 tool 消息附近
    for (var i = 0; i < 16; i++) {
      msgs.push({ role: 'user', content: 'tail-' + i });
    }
    // 总数：1 + 4 + 1 + 1 + 16 = 23 条，convoMsgs = 22
    internals._agentState.messages = msgs;

    internals.enforceMessageLimit();

    var result = internals._agentState.messages;
    // system 必须保留
    expect(result[0].role).toBe('system');

    // 找 assistant(tool_calls id=call_X) 和 tool(tool_call_id=call_X) 的位置
    var foundAssistant = -1;
    var foundTool = -1;
    for (var k = 0; k < result.length; k++) {
      if (result[k].role === 'assistant' && result[k].tool_calls) {
        for (var t = 0; t < result[k].tool_calls.length; t++) {
          if (result[k].tool_calls[t].id === 'call_X') {
            foundAssistant = k;
          }
        }
      }
      if (result[k].role === 'tool' && result[k].tool_call_id === 'call_X') {
        foundTool = k;
      }
    }
    // 两者必须同时保留（要么都在，要么都不在 — 不能孤立）
    if (foundTool !== -1) {
      expect(foundAssistant).not.toBe(-1);
      expect(foundAssistant).toBeLessThan(foundTool);
    } else {
      // 如果 tool 被丢弃（assistant 也被丢弃），不能只留孤立 tool
      expect(foundAssistant).toBe(-1);
    }
  });

  // ---------------------------------------------------------------
  //  Test 4: 保留区开头孤立 tool 被清理
  //  构造场景让配对的 assistant.tool_calls 落在删除区无法扩展
  //  保留区开头的孤立 tool 应被 shift 掉
  // ---------------------------------------------------------------
  test('Test 4: orphaned tool at retention head cleaned up', function () {
    loadAgentModules();
    var internals = window.__gobyInternals;

    // system + 5 条前缀对话 + assistant(tool_calls id=ORPHAN) + tool(tool_call_id=ORPHAN) + 18 条尾巴
    // 让 splitIdx 落在 assistant(tool_calls id=ORPHAN) 与 tool 之间 — assistant 被丢弃，tool 在保留区开头
    var msgs = [{ role: 'system', content: 'sys' }];
    msgs.push({ role: 'user', content: 'pre1' });
    msgs.push({ role: 'assistant', content: 'pre2' });
    msgs.push({ role: 'user', content: 'pre3' });
    msgs.push({ role: 'assistant', content: 'pre4' });
    msgs.push({ role: 'user', content: 'pre5' });
    // 关键 assistant.tool_calls — 落在删除区
    msgs.push({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_ORPHAN', type: 'function', function: { name: 'p', arguments: '{}' } }]
    });
    // tool 结果 — 落在保留区开头
    msgs.push({
      role: 'tool',
      tool_call_id: 'call_ORPHAN',
      name: 'p',
      content: 'orphan-result'
    });
    // 18 条尾巴，保留区 convoMsgs 应该 ≤ 20
    for (var i = 0; i < 18; i++) {
      msgs.push({ role: 'user', content: 'tail-' + i });
    }
    // 总条数：1 system + 5 + 1 + 1 + 18 = 26 条
    internals._agentState.messages = msgs;

    internals.enforceMessageLimit();

    var result = internals._agentState.messages;
    // 保留区开头不能是孤立 tool 消息
    expect(result[0].role).toBe('system');
    expect(result[1].role).not.toBe('tool');
    // 必须没有任何 tool_call_id === 'call_ORPHAN' 的孤立 tool
    for (var k = 0; k < result.length; k++) {
      if (result[k].role === 'tool' && result[k].tool_call_id === 'call_ORPHAN') {
        // 找到则必须前面有匹配 assistant.tool_calls — 否则失败
        var hasMatchingAssistant = false;
        for (var j = 0; j < k; j++) {
          if (result[j].role === 'assistant' && result[j].tool_calls) {
            for (var t = 0; t < result[j].tool_calls.length; t++) {
              if (result[j].tool_calls[t].id === 'call_ORPHAN') {
                hasMatchingAssistant = true;
              }
            }
          }
        }
        expect(hasMatchingAssistant).toBe(true);
      }
    }
  });

  // ---------------------------------------------------------------
  //  Test 5: 多 tool_calls 部分 in/out 边界 — assistant 整体保留
  //  assistant.tool_calls=[{id:'A'},{id:'B'}]
  //  A 的 tool 在删除区，B 的 tool 在保留区 — splitIdx 扩展到 assistant 位置
  //  A 的 tool 作为保留区开头孤立 tool 被清理（因为 B 也匹配 assistant）
  // ---------------------------------------------------------------
  test('Test 5: multi tool_calls partial in/out — assistant preserved, orphan tool cleaned', function () {
    loadAgentModules();
    var internals = window.__gobyInternals;

    // 构造：system + 前缀 + assistant(tool_calls=[A,B]) + tool(A) + tool(B) + tail
    // 让 splitIdx 落在 assistant 与 tool(A) 之间 — assistant 已在保留区，A 和 B 都应保留
    var msgs = [{ role: 'system', content: 'sys' }];
    // 4 条前缀
    msgs.push({ role: 'user', content: 'pre1' });
    msgs.push({ role: 'assistant', content: 'pre2' });
    msgs.push({ role: 'user', content: 'pre3' });
    msgs.push({ role: 'assistant', content: 'pre4' });
    // 关键 assistant
    msgs.push({
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_A', type: 'function', function: { name: 'p', arguments: '{}' } },
        { id: 'call_B', type: 'function', function: { name: 'p', arguments: '{}' } }
      ]
    });
    msgs.push({ role: 'tool', tool_call_id: 'call_A', name: 'p', content: 'A-result' });
    msgs.push({ role: 'tool', tool_call_id: 'call_B', name: 'p', content: 'B-result' });
    // 18 条尾巴
    for (var i = 0; i < 18; i++) {
      msgs.push({ role: 'user', content: 'tail-' + i });
    }
    // 总条数：1 + 4 + 1 + 2 + 18 = 26
    internals._agentState.messages = msgs;

    internals.enforceMessageLimit();

    var result = internals._agentState.messages;
    // 如果 assistant(tool_calls=[A,B]) 保留，则 A 和 B 两个 tool 都不能孤立
    // 收集 assistant 暴露的 tool_call ids
    var knownToolCallIds = {};
    for (var k = 0; k < result.length; k++) {
      if (result[k].role === 'assistant' && result[k].tool_calls) {
        for (var t = 0; t < result[k].tool_calls.length; t++) {
          if (result[k].tool_calls[t].id) {
            knownToolCallIds[result[k].tool_calls[t].id] = true;
          }
        }
      }
    }
    // 验证所有 tool 消息都有匹配的 assistant.tool_calls
    for (var k2 = 0; k2 < result.length; k2++) {
      if (result[k2].role === 'tool' && result[k2].tool_call_id) {
        expect(knownToolCallIds[result[k2].tool_call_id]).toBe(true);
      }
    }
  });
});
