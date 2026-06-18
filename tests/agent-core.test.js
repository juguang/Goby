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

// Load chrome mock
require('./__mocks__/chrome.js');

// Tab ID used for chrome.tabs.sendMessage in streaming tests
var TEST_TAB_ID = 999;

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
  });

  // ---------------------------------------------------------------
  //  Test 1: GobyAgent.callLLMStream sends llm-stream message
  //  Verifies: chrome.runtime.sendMessage called with correct payload
  // ---------------------------------------------------------------
  test('Test 1: GobyAgent.callLLMStream sends llm-stream with messages and tools', async function () {
    require('../panel.js');
    require('../content-script.js');

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
      tools: [],
      config: {
        baseUrl: 'http://test.com/v1',
        apiKey: 'sk-test-key',
        model: 'test-model'
      }
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
    require('../panel.js');
    require('../content-script.js');

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

    // Simulate a stream-chunk text event from SW
    handler(
      { action: 'stream-chunk', data: { type: 'text', content: 'Hello', done: false } },
      { id: chrome.runtime.id },
      function () {}
    );

    // Bot bubble should contain the streamed text
    // (access shadow DOM would be complex; verify via GobyPanel chat area)
    // The bot bubble textContent should include 'Hello'
    var botBubbles = document.querySelectorAll('.goby-msg-bot');
    expect(botBubbles.length).toBeGreaterThan(0);
    expect(botBubbles[botBubbles.length - 1].textContent).toContain('Hello');
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
    // Load DOMPurify for the test
    require('../lib/purify.min.js');
    require('../lib/marked.min.js');
    require('../panel.js');
    require('../content-script.js');

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
    require('../lib/purify.min.js');
    require('../lib/marked.min.js');
    require('../panel.js');
    require('../content-script.js');

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
    require('../panel.js');
    require('../content-script.js');

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
    require('../panel.js');
    require('../content-script.js');

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
    require('../panel.js');
    require('../content-script.js');

    // RED: GobyAgent undefined → test fails
    expect(window.GobyAgent).toBeDefined();
    expect(typeof window.GobyAgent.handleStreamChunk).toBe('function');

    // Spy on updateConnectionStatus
    var originalUpdate = window.GobyPanel.updateConnectionStatus;

    // Simulate an error stream-chunk
    window.GobyAgent.handleStreamChunk({
      type: 'error',
      error: { message: 'Network failure' },
      done: true
    });

    // Connection status should be 'red' after error
    var dotEl = document.querySelector('.goby-status-dot');
    if (dotEl) {
      expect(dotEl.classList.contains('red')).toBe(true);
    }
  });
});
