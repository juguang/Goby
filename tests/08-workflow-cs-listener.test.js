/**
 * Phase 8 Plan 03 Task 4
 *
 * CS onMessage listener: workflow-init / workflow_progress / workflow_complete / workflow_error
 *
 * 测试场景:
 *   workflow-init:
 *     1. listener 收到 workflow-init → window.__gobyWorkflowId + push inherited + initial + processAgentMessage(isWorkflowInit:true)
 *     2. _agentState.messages 含 inherited 和 initial_user_message
 *
 *   workflow_progress:
 *     3. listener 收到 workflow_progress → GobyPanel.appendMessage('bot', '[W-wf_xxxx] thinking...')
 *
 *   workflow_complete (单独文件 08-resume-on-complete.test.js):
 *     4. push '[From workflow wf_x] <summary>' + processAgentMessage(null, {resume:true, fromWorkflow})
 *
 *   workflow_error:
 *     5. push assistant message '工作流 wf_x 失败: <reason>' + isProcessing=false
 */

var helpers = require('./08-test-helpers.js');
var loadCsModules = helpers.loadCsModules;

describe('CS workflow message listener (Phase 8 Plan 03 Task 4)', function () {

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    delete chrome.runtime.lastError;
    document.body.innerHTML = '';
    chrome.runtime.sendMessage.mockResolvedValue({ ok: true });
    delete window.__gobyWorkflowId;
    loadCsModules();
  });

  afterEach(function () {
    jest.restoreAllMocks();
    delete window.__gobyWorkflowId;
  });

  // 辅助：取 CS 最近注册的 onMessage listener
  function getCsOnMessageListener() {
    var calls = chrome.runtime.onMessage.addListener.mock.calls;
    return calls[calls.length - 1][0];
  }

  // 辅助：flush microtasks
  function flushAsync(n) {
    var p = Promise.resolve();
    for (var i = 0; i < (n || 10); i++) p = p.then(function () {});
    return p;
  }

  // ---------------------------------------------------------------
  //  workflow-init
  // ---------------------------------------------------------------

  test('test 1: workflow-init 设置 __gobyWorkflowId + push inherited/initial + 调 processAgentMessage', async function () {
    // 在 listener 触发前先创建 session 让 _agentState.messages 初始化
    window.GobyAgent.createSession('https://worker.com');
    var internal = window.__gobyInternals._agentState;

    // spy processAgentMessage — 防止真实跑 LLM
    var spy = jest.spyOn(window.GobyAgent, 'processAgentMessage').mockImplementation(function () {
      return Promise.resolve();
    });

    var listener = getCsOnMessageListener();

    listener(
      {
        action: 'workflow-init',
        workflow_id: 'wf_abc12345',
        inherited_messages: [
          { role: 'user', content: 'hi from chat' },
          { role: 'assistant', content: 'ok' }
        ],
        initial_user_message: 'Working in workflow wf_abc12345, origin: https://worker.com'
      },
      { id: chrome.runtime.id },
      function () {}
    );

    await flushAsync();

    expect(window.__gobyWorkflowId).toBe('wf_abc12345');
    // 调 processAgentMessage(null, { isWorkflowInit: true })
    expect(spy).toHaveBeenCalled();
    var lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    expect(lastCall[0]).toBeNull();
    expect(lastCall[1] && lastCall[1].isWorkflowInit).toBe(true);

    // 测试 isWorkflowInit 路径不应设置 interrupted（避免误触发 initSession resume）
    //（断言 _agentState.interrupted 不为 true）
    expect(internal.interrupted).not.toBe(true);
  });

  test('test 2: _agentState.messages 含 inherited_messages 和 initial_user_message', async function () {
    window.GobyAgent.createSession('https://worker.com');
    jest.spyOn(window.GobyAgent, 'processAgentMessage').mockImplementation(function () {
      return Promise.resolve();
    });

    var listener = getCsOnMessageListener();

    listener(
      {
        action: 'workflow-init',
        workflow_id: 'wf_abc12345',
        inherited_messages: [
          { role: 'user', content: 'inherited-1' }
        ],
        initial_user_message: 'Working in workflow wf_abc12345'
      },
      { id: chrome.runtime.id },
      function () {}
    );

    await flushAsync();

    var messages = window.__gobyInternals._agentState.messages;
    var contents = messages.map(function (m) { return m.content; });
    expect(contents).toContain('inherited-1');
    expect(contents).toContain('Working in workflow wf_abc12345');
  });

  // ---------------------------------------------------------------
  //  workflow_progress
  // ---------------------------------------------------------------

  test('test 3: workflow_progress 调 GobyPanel.appendMessage("bot", "[W-wf_xxxx] content")', async function () {
    var appendSpy = jest.spyOn(window.GobyPanel, 'appendMessage').mockImplementation(function () {});

    var listener = getCsOnMessageListener();

    listener(
      {
        action: 'workflow_progress',
        workflow_id: 'wf_abc12345',
        data: { type: 'assistant', content: 'thinking about the task' }
      },
      { id: chrome.runtime.id },
      function () {}
    );

    await flushAsync();

    expect(appendSpy).toHaveBeenCalled();
    var lastCallArgs = appendSpy.mock.calls[appendSpy.mock.calls.length - 1];
    expect(lastCallArgs[0]).toBe('bot');
    // badge 前缀含 workflow id 前 8 字符（wf_abc12 或完整 wf_abc12345，取前 8 char）
    expect(String(lastCallArgs[1])).toMatch(/\[W-/);
    expect(String(lastCallArgs[1])).toContain('thinking about the task');
  });

  // ---------------------------------------------------------------
  //  workflow_error
  // ---------------------------------------------------------------

  test('test 5: workflow_error push assistant 失败消息 + 恢复 isProcessing=false', async function () {
    window.GobyAgent.createSession('https://chat.com');
    var internal = window.__gobyInternals._agentState;
    internal.isProcessing = true;

    var appendSpy = jest.spyOn(window.GobyPanel, 'appendMessage').mockImplementation(function () {});

    var listener = getCsOnMessageListener();

    listener(
      {
        action: 'workflow_error',
        workflow_id: 'wf_abc12345',
        data: { reason: '工作 Tab 被关闭' }
      },
      { id: chrome.runtime.id },
      function () {}
    );

    await flushAsync();

    // messages 含失败 assistant 消息
    var contents = internal.messages.map(function (m) { return m.content; });
    var errFound = contents.some(function (c) {
      return String(c).indexOf('工作流 wf_abc12345 失败') !== -1 &&
             String(c).indexOf('工作 Tab 被关闭') !== -1;
    });
    expect(errFound).toBe(true);
    // isProcessing 恢复
    expect(internal.isProcessing).toBe(false);
  });
});
