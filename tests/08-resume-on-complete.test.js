/**
 * Phase 8 Plan 03 Task 4 — workflow_complete resume 测试
 *
 * 测试场景:
 *   test 4: listener 收到 workflow_complete →
 *     push '[From workflow wf_x] <summary>' user message +
 *     调 processAgentMessage(null, { resume: true, fromWorkflow: 'wf_x' })
 */

var helpers = require('./08-test-helpers.js');
var loadCsModules = helpers.loadCsModules;

describe('workflow_complete resume (Phase 8 Plan 03 Task 4)', function () {

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

  function getCsOnMessageListener() {
    var calls = chrome.runtime.onMessage.addListener.mock.calls;
    return calls[calls.length - 1][0];
  }

  function flushAsync(n) {
    var p = Promise.resolve();
    for (var i = 0; i < (n || 10); i++) p = p.then(function () {});
    return p;
  }

  test('test 4: workflow_complete push [From workflow ...] + 触发 resume', async function () {
    window.GobyAgent.createSession('https://chat.com');
    var internal = window.__gobyInternals._agentState;

    var spy = jest.spyOn(window.GobyAgent, 'processAgentMessage').mockImplementation(function () {
      return Promise.resolve();
    });
    var appendSpy = jest.spyOn(window.GobyPanel, 'appendMessage').mockImplementation(function () {});

    var listener = getCsOnMessageListener();

    listener(
      {
        action: 'workflow_complete',
        workflow_id: 'wf_abc12345',
        data: { summary: '搜索完成，找到 3 条结果', finalTabId: 99 }
      },
      { id: chrome.runtime.id },
      function () {}
    );

    await flushAsync();

    // push user message '[From workflow wf_abc12345] 搜索完成...'
    var contents = internal.messages.map(function (m) { return m.content; });
    var fromWorkflowFound = contents.some(function (c) {
      return String(c).indexOf('[From workflow wf_abc12345]') !== -1 &&
             String(c).indexOf('搜索完成') !== -1;
    });
    expect(fromWorkflowFound).toBe(true);

    // 调 processAgentMessage(null, { resume: true, fromWorkflow: 'wf_abc12345' })
    expect(spy).toHaveBeenCalled();
    var lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    expect(lastCall[0]).toBeNull();
    expect(lastCall[1] && lastCall[1].resume).toBe(true);
    expect(lastCall[1] && lastCall[1].fromWorkflow).toBe('wf_abc12345');
  });
});
