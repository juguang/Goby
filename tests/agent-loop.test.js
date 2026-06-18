/**
 * Agent Loop tests — processAgentMessage, tool execution engine, limit protections
 *
 * Tests cover AGENT-01, AGENT-05 requirements from GOBY_DESIGN.md:
 * - Agent main loop (while iteration, max 15 rounds)
 * - Tool execution (calculator, clipboard, get_current_time)
 * - Timeout and retry mechanisms
 * - Limit protections (50 tool calls, 20 messages, 180K tokens)
 * - Status integration (round count, isProcessing)
 *
 * RED Phase: All tests fail because processAgentMessage, tool engine, limits
 * not yet implemented in content-script.js
 * GREEN Phase: All tests pass after Task 2 implementation
 */

// Polyfill TextEncoder/TextDecoder for jsdom
var { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Load chrome mock
require('./__mocks__/chrome.js');

/**
 * Load extension modules in dependency order
 */
function loadAgentModules() {
  var purifyFactory = require('../lib/purify.min.js');
  window.DOMPurify = purifyFactory(window);
  window.marked = require('../lib/marked.min.js');
  require('../storage.js');
  require('../panel.js');
  require('../content-script.js');
}

// ================================================================
//   Agent Main Loop
//   Tests 1-5: processAgentMessage basic flow, tool_calls routing,
//   tool result format, error retry, 15-round limit
// ================================================================

describe('Agent Main Loop', function () {
  var mockTimers = [];

  function flushMicrotasks() {
    return new Promise(function (resolve) { setTimeout(resolve, 5); });
  }

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    // Clean DOM
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    delete global.fetch;
    mockTimers.forEach(function (t) { clearTimeout(t); });
    mockTimers = [];
  });

  // ---------------------------------------------------------------
  //  Test 1: LLM returns plain text → displayed directly, 1 round
  // ---------------------------------------------------------------
  test('Test 1: LLM plain text response ends loop after 1 round', async function () {
    loadAgentModules();

    // Mock llm-stream to return plain text
    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        setTimeout(function () {
          if (window.GobyAgent && window.GobyAgent.handleStreamChunk) {
            window.GobyAgent.handleStreamChunk({
              type: 'done', done: true,
              content: '你好！我是 Goby',
              message: { role: 'assistant', content: '你好！我是 Goby' }
            });
          }
        }, 5);
        return Promise.resolve();
      }
      return Promise.resolve({});
    });

    // RED: Before implementing processAgentMessage, sendMessage does NOT
    // perform agent loop → no assistant message pushed to state
    window.GobyAgent.sendMessage('你好');

    await flushMicrotasks();

    var state = window.GobyAgent.getState();
    // Should have user message + assistant message (agent loop adds both)
    // RED: Only user message exists (no agent loop)
    expect(state.messages.length).toBe(2);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[1].role).toBe('assistant');
    expect(state.isProcessing).toBe(false);
  });

  // ---------------------------------------------------------------
  //  Test 2: LLM returns tool_calls → execute → result → next round
  // ---------------------------------------------------------------
  test('Test 2: tool_calls execution then text in 2 rounds', async function () {
    loadAgentModules();

    var callCount = 0;

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        callCount++;
        setTimeout(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          if (callCount === 1) {
            // First call: return tool_calls
            window.GobyAgent.handleStreamChunk({
              type: 'done', done: true, content: '',
              message: {
                role: 'assistant',
                content: '',
                tool_calls: {
                  '0': {
                    id: 'call_calc_1', type: 'function',
                    function: { name: 'calculator', arguments: { expression: '2+2' } }
                  }
                }
              }
            });
          } else {
            // Second call: return text
            window.GobyAgent.handleStreamChunk({
              type: 'done', done: true,
              content: '计算完成',
              message: { role: 'assistant', content: '计算完成' }
            });
          }
        }, 5);
        return Promise.resolve();
      }
      return Promise.resolve({});
    });

    window.GobyAgent.sendMessage('计算2+2');

    await flushMicrotasks();

    var state = window.GobyAgent.getState();
    // RED: Only user message exists, no tool result or assistant message
    // RED fails because processAgentMessage not implemented
    expect(state.messages.length).toBeGreaterThanOrEqual(3);

    // Check tool result exists
    var toolMsgs = state.messages.filter(function (m) { return m.role === 'tool'; });
    expect(toolMsgs.length).toBeGreaterThan(0);

    // Check final assistant text
    var assistantMsgs = state.messages.filter(function (m) { return m.role === 'assistant'; });
    expect(assistantMsgs.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  //  Test 3: Tool result format — role='tool' with required fields
  // ---------------------------------------------------------------
  test('Test 3: tool result has role=tool with tool_call_id, name, content', async function () {
    loadAgentModules();

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        setTimeout(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          window.GobyAgent.handleStreamChunk({
            type: 'done', done: true, content: '',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: {
                '0': {
                  id: 'call_calc_1', type: 'function',
                  function: { name: 'calculator', arguments: { expression: '3*4' } }
                }
              }
            }
          });
        }, 5);
        return Promise.resolve();
      }
      if (msg && msg.action === 'llm-request') {
        return Promise.resolve({ choices: [{ message: { content: 'summary' } }] });
      }
      return Promise.resolve({});
    });

    window.GobyAgent.sendMessage('3*4等于多少');

    await flushMicrotasks();

    var state = window.GobyAgent.getState();
    // RED: No tool messages exist at all
    var toolMsgs = state.messages.filter(function (m) { return m.role === 'tool'; });
    expect(toolMsgs.length).toBeGreaterThan(0);

    var toolResult = toolMsgs[0];
    expect(toolResult.tool_call_id).toBeDefined();
    expect(toolResult.name).toBeDefined();
    expect(toolResult.content).toBeDefined();
    // Tool result should be a non-error result from calculator
    expect(toolResult.content.indexOf('Error:')).toBe(-1);
  });

  // ---------------------------------------------------------------
  //  Test 4: Tool execution returns Error: → passed back to LLM
  // ---------------------------------------------------------------
  test('Test 4: tool error result returned to LLM for self-correction', async function () {
    loadAgentModules();

    // Mock calculator tool execute to return error
    // Must access after loading modules
    var calcTool = window.GobyAgent.nativeTools && window.GobyAgent.nativeTools.find(function (t) {
      return t.function.name === 'calculator';
    });
    if (calcTool) {
      calcTool.execute = function () { return 'Error: 无效表达式'; };
    }

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        setTimeout(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          window.GobyAgent.handleStreamChunk({
            type: 'done', done: true, content: '',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: {
                '0': {
                  id: 'call_calc_1', type: 'function',
                  function: { name: 'calculator', arguments: { expression: 'invalid' } }
                }
              }
            }
          });
        }, 5);
        return Promise.resolve();
      }
      if (msg && msg.action === 'llm-request') {
        return Promise.resolve({ choices: [{ message: { content: 'summary' } }] });
      }
      return Promise.resolve({});
    });

    window.GobyAgent.sendMessage('计算无效表达式');

    await flushMicrotasks();

    var state = window.GobyAgent.getState();
    // RED: No tool messages
    var toolMsgs = state.messages.filter(function (m) { return m.role === 'tool'; });
    expect(toolMsgs.length).toBeGreaterThan(0);

    // Error result should start with "Error:"
    var toolResult = toolMsgs[0];
    expect(toolResult.content.indexOf('Error:')).toBe(0);
  });

  // ---------------------------------------------------------------
  //  Test 5: Loop reaches 15 rounds → force stop with message
  // ---------------------------------------------------------------
  test('Test 5: 15 rounds max, shows "无法完成请求"', async function () {
    loadAgentModules();

    // Reduce max loops for test speed if exposed
    if (window.GobyAgent.setMaxLoops) {
      window.GobyAgent.setMaxLoops(3); // Smaller for faster test
    }

    var llmCallCount = 0;

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        llmCallCount++;
        setTimeout(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          if (llmCallCount < 20) {
            // Return tool_calls to keep loop going
            window.GobyAgent.handleStreamChunk({
              type: 'done', done: true, content: '',
              message: {
                role: 'assistant',
                content: '',
                tool_calls: {
                  '0': {
                    id: 'call_' + llmCallCount, type: 'function',
                    function: { name: 'get_current_time', arguments: {} }
                  }
                }
              }
            });
          }
        }, 5);
        return Promise.resolve();
      }
      if (msg && msg.action === 'llm-request') {
        return Promise.resolve({ choices: [{ message: { content: 'summary' } }] });
      }
      return Promise.resolve({});
    });

    window.GobyAgent.sendMessage('继续执行');

    await flushMicrotasks();

    var state = window.GobyAgent.getState();
    // Check if loop limit message exists
    var hasLimitMsg = state.messages.some(function (m) {
      return m.content && m.content.indexOf('无法完成请求') !== -1;
    });
    // RED: No limit message because processAgentMessage not implemented
    expect(hasLimitMsg).toBe(true);
  });
});

// ================================================================
//   Tool Execution Engine
//   Tests 6-7: Timeout, retry mechanism
// ================================================================

describe('Tool Execution Engine', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    delete global.fetch;
  });

  // ---------------------------------------------------------------
  //  Test 6: Tool timeout (15s) returns error to LLM
  // ---------------------------------------------------------------
  test('Test 6: tool execution timeout returns error message', async function () {
    loadAgentModules();

    // Set calculator timeout to 50ms for fast test
    var calcTool = window.GobyAgent.nativeTools && window.GobyAgent.nativeTools.find(function (t) {
      return t.function.name === 'calculator';
    });
    if (calcTool) {
      calcTool.timeout = 50;
      // Never-resolving promise
      calcTool.execute = function () {
        return new Promise(function () { /* never resolves */ });
      };
    }

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        setTimeout(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          window.GobyAgent.handleStreamChunk({
            type: 'done', done: true, content: '',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: {
                '0': {
                  id: 'call_timeout', type: 'function',
                  function: { name: 'calculator', arguments: { expression: '5+5' } }
                }
              }
            }
          });
        }, 5);
        return Promise.resolve();
      }
      if (msg && msg.action === 'llm-request') {
        return Promise.resolve({ choices: [{ message: { content: 'summary' } }] });
      }
      return Promise.resolve({});
    });

    window.GobyAgent.sendMessage('计算');

    // Wait enough for all retries (3 * 50ms) + overhead
    await new Promise(function (r) { setTimeout(r, 300); });

    var state = window.GobyAgent.getState();
    // RED: No tool messages
    var toolMsgs = state.messages.filter(function (m) { return m.role === 'tool'; });
    expect(toolMsgs.length).toBeGreaterThan(0);

    // Either timeout or skip message
    var lastTool = toolMsgs[toolMsgs.length - 1];
    expect(lastTool.content.indexOf('超时') !== -1 || lastTool.content.indexOf('跳过') !== -1).toBe(true);
  });

  // ---------------------------------------------------------------
  //  Test 7: Tool fails 3 times consecutively → skip
  // ---------------------------------------------------------------
  test('Test 7: 3 consecutive tool failures triggers skip', async function () {
    loadAgentModules();

    // Mock calculator to always fail
    var calcTool = window.GobyAgent.nativeTools && window.GobyAgent.nativeTools.find(function (t) {
      return t.function.name === 'calculator';
    });
    if (calcTool) {
      calcTool.execute = function () { return 'Error: 计算失败'; };
      calcTool.timeout = 50; // Fast timeout for retries
    }

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        setTimeout(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          window.GobyAgent.handleStreamChunk({
            type: 'done', done: true, content: '',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: {
                '0': {
                  id: 'call_retry', type: 'function',
                  function: { name: 'calculator', arguments: { expression: '1/0' } }
                }
              }
            }
          });
        }, 5);
        return Promise.resolve();
      }
      if (msg && msg.action === 'llm-request') {
        return Promise.resolve({ choices: [{ message: { content: 'summary' } }] });
      }
      return Promise.resolve({});
    });

    window.GobyAgent.sendMessage('计算错误');

    // Wait for retry + skip
    await new Promise(function (r) { setTimeout(r, 300); });

    var state = window.GobyAgent.getState();
    // RED: No tool messages
    var toolMsgs = state.messages.filter(function (m) { return m.role === 'tool'; });
    expect(toolMsgs.length).toBeGreaterThan(0);

    // Last result should be "已跳过"
    var lastTool = toolMsgs[toolMsgs.length - 1];
    expect(lastTool.content.indexOf('跳过')).not.toBe(-1);
  });
});

// ================================================================
//   Limit Protections
//   Tests 8-10: 50 tool calls, 20 messages, 180K tokens
// ================================================================

describe('Limit Protections', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    delete global.fetch;
  });

  // ---------------------------------------------------------------
  //  Test 8: Session reaches 50 tool calls → blocked with message
  // ---------------------------------------------------------------
  test('Test 8: 50 tool calls reached, shows limit message', async function () {
    loadAgentModules();

    // Use exposed test hook to set counter near limit
    if (window.GobyAgent._setToolCallCounter) {
      window.GobyAgent._setToolCallCounter(49);
    }

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        setTimeout(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          // Return tool_calls to trigger one more (50th) call
          window.GobyAgent.handleStreamChunk({
            type: 'done', done: true, content: '',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: {
                '0': {
                  id: 'call_limit', type: 'function',
                  function: { name: 'calculator', arguments: { expression: '1+1' } }
                }
              }
            }
          });
        }, 5);
        return Promise.resolve();
      }
      if (msg && msg.action === 'llm-request') {
        return Promise.resolve({ choices: [{ message: { content: 'summary' } }] });
      }
      return Promise.resolve({});
    });

    window.GobyAgent.sendMessage('继续计算');

    await new Promise(function (r) { setTimeout(r, 100); });

    // RED: No limit message because processAgentMessage not implemented
    var state = window.GobyAgent.getState();
    var hasLimitMsg = state.messages.some(function (m) {
      return m.content && m.content.indexOf('上限') !== -1;
    });
    // RED fails here
    expect(hasLimitMsg).toBe(true);
  });

  // ---------------------------------------------------------------
  //  Test 9: Messages exceed 20 → oldest auto-dropped
  // ---------------------------------------------------------------
  test('Test 9: messages exceed 20, oldest auto-dropped', async function () {
    loadAgentModules();

    // Pre-fill state with 30 messages (well exceeding limit)
    var state = window.GobyAgent.getState();
    for (var i = 0; i < 30; i++) {
      state.messages.push({ role: 'user', content: '旧消息 ' + i });
    }

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        setTimeout(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          window.GobyAgent.handleStreamChunk({
            type: 'done', done: true,
            content: '新回复',
            message: { role: 'assistant', content: '新回复' }
          });
        }, 5);
        return Promise.resolve();
      }
      if (msg && msg.action === 'llm-request') {
        return Promise.resolve({ choices: [{ message: { content: 'summary' } }] });
      }
      return Promise.resolve({});
    });

    window.GobyAgent.sendMessage('新消息');

    // Wait for done handler to fire
    await new Promise(function (r) { setTimeout(r, 100); });

    var stateAfter = window.GobyAgent.getState();
    // Without enforcement: 30+ msgs + user + assistant, total >> 30
    // With enforcement: trimmed to 20 + user + assistant, total <= 22
    // RED: No enforcement, messages count > 30
    expect(stateAfter.messages.length).toBeLessThanOrEqual(25);
  });

  // ---------------------------------------------------------------
  //  Test 10: Token estimate >= 180K → trigger LLM summary
  // ---------------------------------------------------------------
  test('Test 10: token >= 180K triggers compactConversationAsync', async function () {
    loadAgentModules();

    // Pre-fill state with a large message that exceeds 180K tokens
    // Chinese chars: ~0.5 token/char, so 400K chars = ~200K tokens
    var largeContent = '';
    for (var k = 0; k < 400000; k++) {
      largeContent += '测';
    }
    var state = window.GobyAgent.getState();
    state.messages.push({ role: 'user', content: largeContent });

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        setTimeout(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          window.GobyAgent.handleStreamChunk({
            type: 'done', done: true,
            content: '摘要完成',
            message: { role: 'assistant', content: '摘要完成' }
          });
        }, 5);
        return Promise.resolve();
      }
      // Mock llm-request for compactConversationAsync
      if (msg && msg.action === 'llm-request') {
        return Promise.resolve({
          choices: [{ message: { role: 'assistant', content: '【模拟摘要】这是对话摘要测试' } }]
        });
      }
      return Promise.resolve({});
    });

    window.GobyAgent.sendMessage('继续');

    await new Promise(function (r) { setTimeout(r, 100); });

    // RED: No compactConversationAsync implemented
    var stateAfter = window.GobyAgent.getState();
    var hasSummary = stateAfter.messages.some(function (m) {
      return m.content && m.content.indexOf('对话摘要') !== -1;
    });
    // RED fails here
    expect(hasSummary).toBe(true);
  });
});

// ================================================================
//   Status Integration
//   Round count updates and isProcessing state management
// ================================================================

describe('Status Integration', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    delete global.fetch;
  });

  test('isProcessing is true during agent loop, false after', async function () {
    loadAgentModules();

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        setTimeout(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          window.GobyAgent.handleStreamChunk({
            type: 'done', done: true,
            content: '完成',
            message: { role: 'assistant', content: '完成' }
          });
        }, 5);
        return Promise.resolve();
      }
      return Promise.resolve({});
    });

    // RED: isProcessing not managed by agent loop yet
    expect(window.GobyAgent.getState().isProcessing).toBe(false);

    window.GobyAgent.sendMessage('测试');

    // During processing, isProcessing should be true
    // RED: isProcessing stays false
    await new Promise(function (r) { setTimeout(r, 10); });
    expect(window.GobyAgent.getState().isProcessing).toBe(true);

    // After completion, isProcessing should be false
    await new Promise(function (r) { setTimeout(r, 50); });
    expect(window.GobyAgent.getState().isProcessing).toBe(false);
  });

  test('round count updates during agent loop', async function () {
    loadAgentModules();

    var callCount = 0;

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'llm-stream') {
        callCount++;
        setTimeout(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          if (callCount < 3) {
            // Keep returning tool_calls to advance rounds
            window.GobyAgent.handleStreamChunk({
              type: 'done', done: true, content: '',
              message: {
                role: 'assistant', content: '',
                tool_calls: {
                  '0': {
                    id: 'call_r' + callCount, type: 'function',
                    function: { name: 'get_current_time', arguments: {} }
                  }
                }
              }
            });
          } else {
            // Return text to end
            window.GobyAgent.handleStreamChunk({
              type: 'done', done: true,
              content: '全部完成',
              message: { role: 'assistant', content: '全部完成' }
            });
          }
        }, 5);
        return Promise.resolve();
      }
      if (msg && msg.action === 'llm-request') {
        return Promise.resolve({ choices: [{ message: { content: 'summary' } }] });
      }
      return Promise.resolve({});
    });

    // Spy on updateRoundCount
    var roundSpy = jest.spyOn(window.GobyPanel, 'updateRoundCount');
    roundSpy.mockClear();

    window.GobyAgent.sendMessage('多轮对话');

    await new Promise(function (r) { setTimeout(r, 100); });

    // RED: updateRoundCount never called
    expect(roundSpy).toHaveBeenCalled();

    // Should have been called at least with round numbers
    var calls = roundSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(1);

    roundSpy.mockRestore();
  });
});
