/**
 * Phase 8 Plan 03 Task 2
 *
 * SW workflow-progress + page-finish-workflow handler 测试
 *
 * workflow-progress handler 测试:
 *   1. 预置 _activeWorkflows[wf_x].chatTabId=12 + workerTabId=99 →
 *      listener 收到 workflow-progress（sender.tab.id=99）→
 *      chrome.tabs.sendMessage 被以 (12, {action:'workflow_progress', workflow_id:'wf_x', data:{...}}) 调用
 *   2. workflow_id 不在 _activeWorkflows → handler 不转发（不抛错）
 *   3. sender.tab.id !== workerTabId → 拒绝转发（T-08-08 防伪造）
 *
 * page-finish-workflow handler 测试:
 *   4. 调 page-finish-workflow → chrome.tabs.sendMessage(12, {action:'workflow_complete', workflow_id, data:{summary, finalTabId}}) + sendResponse('已结束 workflow ...')
 *   5. page-finish-workflow 调用后 _activeWorkflows 中 wf_x 条目被 delete
 *   6. storage.active_workflows 不再含 wf_x key
 */

var helpers = require('./08-test-helpers.js');
var loadBackground = helpers.loadBackground;
var getOnMessageListener = helpers.getOnMessageListener;

describe('Workflow SW Handlers (Phase 8 Plan 03 Task 2)', function () {
  beforeEach(function () {
    jest.resetModules();
    chrome.storage.local._reset();
    chrome.tabs.sendMessage.mockClear();
    chrome.runtime.lastError = null;
    chrome.tabs.sendMessage.mockImplementation(function (tabId, msg, cb) {
      if (typeof cb === 'function') cb();
    });
    if (!global.crypto) global.crypto = {};
    global.crypto.randomUUID = jest.fn(function () {
      return '12ab3f45-aaaa-bbbb-cccc-dddddddddddd';
    });
  });

  afterEach(function () {
    jest.restoreAllMocks();
  });

  // 辅助：触发 tab-open 完整流程注册一个 workflow，返回 {wfId, chatTabId, workerTabId}
  function registerWorkflow(listener, opts) {
    var chatTabId = (opts && opts.chatTabId) || 12;
    var workerTabId = (opts && opts.workerTabId) || 99;
    var sender = { id: chrome.runtime.id, tab: { id: chatTabId, url: 'https://chat.com' } };
    chrome.tabs.create.mockImplementation(function (o, cb) {
      cb({ id: workerTabId, title: 'Worker' });
    });
    var resp;
    listener({ action: 'tab-open', url: 'https://worker.com' }, sender, function (r) { resp = r; });
    var calls = chrome.tabs.onUpdated.addListener.mock.calls;
    var onUpdated = calls[calls.length - 1][0];
    onUpdated(workerTabId, { status: 'complete' }, { id: workerTabId, title: 'Worker' });
    var match = String(resp || '').match(/wf_[a-f0-9]{8}/);
    return { wfId: match ? match[0] : null, chatTabId: chatTabId, workerTabId: workerTabId };
  }

  // 辅助：flush microtasks + setTimeout
  function flushTimers() {
    var p = Promise.resolve();
    for (var i = 0; i < 15; i++) p = p.then(function () {});
    return p;
  }

  // ---------------------------------------------------------------
  //  workflow-progress handler
  // ---------------------------------------------------------------

  test('test 1: workflow-progress 转发到 chatTabId，sender.tab.id 匹配 workerTabId', function () {
    loadBackground();
    var listener = getOnMessageListener();

    return flushTimers().then(function () {
      var info = registerWorkflow(listener);
      return flushTimers().then(function () {
        chrome.tabs.sendMessage.mockClear();

        listener(
          { action: 'workflow-progress', workflow_id: info.wfId, data: { type: 'assistant', content: 'thinking...' } },
          { id: chrome.runtime.id, tab: { id: info.workerTabId, url: 'https://worker.com' } },
          function () {}
        );
        return flushTimers();
      }).then(function () {
        // 验证：sendMessage 被以 chatTabId + workflow_progress 消息调用
        var forwardCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
          return args[1] && args[1].action === 'workflow_progress' &&
                 args[1].workflow_id === info.wfId;
        });
        expect(forwardCalls.length).toBeGreaterThanOrEqual(1);
        expect(forwardCalls[0][0]).toBe(info.chatTabId);
        expect(forwardCalls[0][1].data).toEqual({ type: 'assistant', content: 'thinking...' });
      });
    });
  });

  test('test 2: workflow_id 不在 _activeWorkflows → handler 不转发，不抛错', function () {
    loadBackground();
    var listener = getOnMessageListener();

    return flushTimers().then(function () {
      chrome.tabs.sendMessage.mockClear();

      listener(
        { action: 'workflow-progress', workflow_id: 'wf_unknown', data: { content: 'x' } },
        { id: chrome.runtime.id, tab: { id: 99, url: 'https://worker.com' } },
        function () {}
      );
      return flushTimers();
    }).then(function () {
      var forwardCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
        return args[1] && args[1].action === 'workflow_progress';
      });
      expect(forwardCalls.length).toBe(0);
    });
  });

  test('test 3: sender.tab.id !== workerTabId → 拒绝转发（T-08-08 防伪造）', function () {
    loadBackground();
    var listener = getOnMessageListener();

    return flushTimers().then(function () {
      var info = registerWorkflow(listener);
      return flushTimers().then(function () {
        chrome.tabs.sendMessage.mockClear();

        // 用错误的 sender.tab.id（非 workerTabId=99）— 应被拒绝
        listener(
          { action: 'workflow-progress', workflow_id: info.wfId, data: { content: 'spoofed' } },
          { id: chrome.runtime.id, tab: { id: 7777, url: 'https://evil.com' } },
          function () {}
        );
        return flushTimers();
      }).then(function () {
        var forwardCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
          return args[1] && args[1].action === 'workflow_progress';
        });
        expect(forwardCalls.length).toBe(0);
      });
    });
  });

  // ---------------------------------------------------------------
  //  page-finish-workflow handler
  // ---------------------------------------------------------------

  test('test 4: page-finish-workflow 转发 workflow_complete + sendResponse 已结束', function () {
    loadBackground();
    var listener = getOnMessageListener();
    var resp;

    return flushTimers().then(function () {
      var info = registerWorkflow(listener);
      return flushTimers().then(function () {
        chrome.tabs.sendMessage.mockClear();

        listener(
          { action: 'page-finish-workflow', workflow_id: info.wfId, summary: '搜索完成，找到 3 条结果' },
          { id: chrome.runtime.id, tab: { id: info.workerTabId, url: 'https://worker.com' } },
          function (r) { resp = r; }
        );
        return flushTimers();
      }).then(function () {
        // 验证 sendMessage 被以 chatTabId + workflow_complete + data 调用
        var completeCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
          return args[1] && args[1].action === 'workflow_complete';
        });
        expect(completeCalls.length).toBe(1);
        expect(completeCalls[0][0]).toBe(info.chatTabId);
        expect(completeCalls[0][1].workflow_id).toBe(info.wfId);
        expect(completeCalls[0][1].data.summary).toBe('搜索完成，找到 3 条结果');
        expect(completeCalls[0][1].data.finalTabId).toBe(info.workerTabId);
        // sendResponse 字符串
        expect(resp).toMatch(/已结束 workflow/);
        expect(resp).toContain(info.wfId);
      });
    });
  });

  test('test 5: page-finish-workflow 调用后 _activeWorkflows 中 wf 条目被 delete', function () {
    loadBackground();
    var listener = getOnMessageListener();

    var info;
    return flushTimers().then(function () {
      info = registerWorkflow(listener);
      return flushTimers();
    }).then(function () {
      // 验证 entry 存在
      var stored = chrome.storage.local._raw.active_workflows || {};
      expect(stored[info.wfId]).toBeTruthy();

      listener(
        { action: 'page-finish-workflow', workflow_id: info.wfId, summary: 'done' },
        { id: chrome.runtime.id, tab: { id: info.workerTabId, url: 'https://worker.com' } },
        function () {}
      );
      return flushTimers();
    }).then(function () {
      // 验证 _activeWorkflows[wfId] 已被 delete
      var stored = chrome.storage.local._raw.active_workflows || {};
      expect(stored[info.wfId]).toBeUndefined();
    });
  });

  test('test 6: page-finish-workflow 调用后 storage.active_workflows 不再含 wf key', function () {
    loadBackground();
    var listener = getOnMessageListener();

    var info;
    return flushTimers().then(function () {
      info = registerWorkflow(listener);
      return flushTimers();
    }).then(function () {
      var keysBefore = Object.keys(chrome.storage.local._raw.active_workflows || {});
      expect(keysBefore).toContain(info.wfId);

      listener(
        { action: 'page-finish-workflow', workflow_id: info.wfId, summary: 'x' },
        { id: chrome.runtime.id, tab: { id: info.workerTabId, url: 'https://worker.com' } },
        function () {}
      );
      return flushTimers();
    }).then(function () {
      var keysAfter = Object.keys(chrome.storage.local._raw.active_workflows || {});
      expect(keysAfter).not.toContain(info.wfId);
    });
  });
});
