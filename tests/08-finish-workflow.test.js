/**
 * Phase 8 Plan 03 Task 3
 *
 * page_finish_workflow 工具 schema + execute 测试 + BR-2 break 扩展测试
 *
 * 测试场景:
 *   1. getTool('page_finish_workflow') 返回定义，parameters.properties.summary 存在，required 含 'summary'
 *   2. tool.timeout === 15000
 *   3. window.__gobyWorkflowId 未设置时 execute resolve 'Error: ...'
 *   4. window.__gobyWorkflowId 设置时 execute 调 chrome.runtime.sendMessage 含 page-finish-workflow
 *   5. description 含 'worker tab' 字样（Pitfall 8 防御）
 *   6. 工具结果含 '(workflow_started' 触发循环 break（扩展 BR-2 detection）
 */

var helpers = require('./08-test-helpers.js');
var loadCsModules = helpers.loadCsModules;
var getTool = helpers.getTool;

describe('page_finish_workflow tool + break detection (Phase 8 Plan 03 Task 3)', function () {

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    delete chrome.runtime.lastError;
    document.body.innerHTML = '';
    chrome.runtime.sendMessage.mockResolvedValue('OK');
    delete window.__gobyWorkflowId;
    loadCsModules();
  });

  afterEach(function () {
    jest.restoreAllMocks();
    delete window.__gobyWorkflowId;
  });

  // ---------------------------------------------------------------
  //  page_finish_workflow 工具定义
  // ---------------------------------------------------------------

  test('test 1: getTool(page_finish_workflow) 返回定义，schema 含 summary 字段', function () {
    var tool = getTool('page_finish_workflow');
    expect(tool).toBeTruthy();
    expect(tool.function.parameters.properties.summary).toBeTruthy();
    expect(tool.function.parameters.required).toContain('summary');
  });

  test('test 2: tool.timeout === 15000', function () {
    var tool = getTool('page_finish_workflow');
    expect(tool.timeout).toBe(15000);
  });

  test('test 3: window.__gobyWorkflowId 未设置 → execute resolve Error 字符串', async function () {
    var tool = getTool('page_finish_workflow');
    delete window.__gobyWorkflowId;
    var result = await tool.execute({ summary: 'done' });
    expect(String(result)).toMatch(/Error/);
    expect(String(result)).toMatch(/workflow_id|工作 Tab|worker tab/i);
  });

  test('test 4: window.__gobyWorkflowId 设置 → execute 调 page-finish-workflow', async function () {
    window.__gobyWorkflowId = 'wf_test123';
    var capturedMsg = null;
    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      capturedMsg = msg;
      return Promise.resolve('已结束 workflow wf_test123');
    });

    var tool = getTool('page_finish_workflow');
    var result = await tool.execute({ summary: '搜索完成' });

    expect(capturedMsg).toBeTruthy();
    expect(capturedMsg.action).toBe('page-finish-workflow');
    expect(capturedMsg.workflow_id).toBe('wf_test123');
    expect(capturedMsg.summary).toBe('搜索完成');
    expect(String(result)).toContain('wf_test123');
  });

  test('test 5: description 含 "worker tab" 字样（Pitfall 8 防御 — LLM 不在 chat Tab 误调）', function () {
    var tool = getTool('page_finish_workflow');
    expect(tool.function.description.toLowerCase()).toContain('worker tab');
  });

  // ---------------------------------------------------------------
  //  BR-2 break 扩展（workflow_started detection）
  // ---------------------------------------------------------------

  test('test 6: 工具结果含 (workflow_started) → 触发循环 break，只调 1 次 LLM', async function () {
    var llmCalls = 0;
    chrome.runtime.sendMessage.mockImplementation(function (msg, callback) {
      if (msg && msg.action === 'llm-stream') {
        llmCalls++;
        process.nextTick(function () {
          if (!window.GobyAgent || !window.GobyAgent.handleStreamChunk) return;
          window.GobyAgent.handleStreamChunk({
            type: 'done', done: true, content: '',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: {
                '0': {
                  id: 'call_pe_1', type: 'function',
                  function: { name: 'page_open_tab', arguments: { url: 'https://b.com' } }
                }
              }
            }
          });
        });
        return Promise.resolve();
      }
      if (msg && msg.action === 'tab-open') {
        // sendToSW 用 Promise 风格（chrome.runtime.sendMessage(payload).then(resolve)）
        // 返回 Promise.resolve(响应字符串)，CS 在 execute 内追加 (workflow_started)
        return Promise.resolve('已打开标签页 [99] B 页面 (workflow: wf_12ab3f45)');
      }
      if (callback) callback(undefined);
      return Promise.resolve({});
    });

    var origin = 'https://example.com';
    window.GobyAgent.createSession(origin);
    var internal = window.__gobyInternals._agentState;
    internal.activeOrigin = origin;
    internal.messages.push({ role: 'user', content: '打开B' });

    await window.GobyAgent.processAgentMessage('openB', {});
    // flush microtasks
    await new Promise(function (r) { process.nextTick(r); });
    await new Promise(function (r) { process.nextTick(r); });

    // BR-2 break: workflow_started 后立即 break，只调 1 次 LLM
    expect(llmCalls).toBe(1);
  });
});
