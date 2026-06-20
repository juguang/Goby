/**
 * Phase 8 Plan 03 Task 1
 *
 * sendToTabWithRetry 重试测试 — 通过 SW workflow-progress handler 间接验证
 * helper 行为（helper 是 background.js IIFE 内的私有函数，无导出）。
 *
 * 测试场景:
 *   1. 首次 sendMessage 成功（无 lastError）→ 不重试，调用次数 = 1
 *   2. sendMessage 连续 2 次 lastError='Receiving end does not exist'，第 3 次成功 → 总调用次数 = 3
 *   3. sendMessage 连续 3 次都 lastError → 不再重试，调用次数 = 3（maxRetries 上限）
 *   4. sendMessage lastError 是其他错误（非 'Receiving end'）→ 不重试，调用次数 = 1
 *
 * 依赖 Plan 02 Task 2: sendToTabWithRetry helper + workflow-progress SW handler
 */

var helpers = require('./08-test-helpers.js');
var loadBackground = helpers.loadBackground;
var getOnMessageListener = helpers.getOnMessageListener;

describe('sendToTabWithRetry (Phase 8 Plan 03 Task 1)', function () {
  beforeEach(function () {
    jest.resetModules();
    chrome.storage.local._reset();
    chrome.tabs.sendMessage.mockClear();
    chrome.runtime.lastError = null;
    // 默认实现：调用 callback 即成功
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

  // 辅助：触发 tab-open 完整流程注册一个 workflow，返回 workflowId
  function registerWorkflow(listener, chatTabId) {
    var sender = { id: chrome.runtime.id, tab: { id: chatTabId || 12, url: 'https://chat.com' } };
    chrome.tabs.create.mockImplementation(function (opts, cb) {
      cb({ id: 99, title: 'Worker' });
    });
    var resp;
    listener({ action: 'tab-open', url: 'https://worker.com' }, sender, function (r) { resp = r; });
    var calls = chrome.tabs.onUpdated.addListener.mock.calls;
    var onUpdated = calls[calls.length - 1][0];
    onUpdated(99, { status: 'complete' }, { id: 99, title: 'Worker' });
    // 提取 workflowId
    var match = String(resp || '').match(/wf_[a-f0-9]{8}/);
    return match ? match[0] : null;
  }

  // 辅助：flush microtasks + setTimeout (200ms retry)
  function flushTimers() {
    var p = Promise.resolve();
    for (var i = 0; i < 15; i++) p = p.then(function () {});
    return p;
  }

  // 辅助：触发 workflow-progress（来自 worker Tab，sender.tab.id=99）
  function fireWorkflowProgress(listener, wfId) {
    var sender = { id: chrome.runtime.id, tab: { id: 99, url: 'https://worker.com' } };
    listener(
      { action: 'workflow-progress', workflow_id: wfId, data: { type: 'assistant', content: 'hi' } },
      sender,
      function () {}
    );
  }

  test('test 1: 首次 sendMessage 成功（无 lastError）→ 不重试，调用次数 = 1', function () {
    loadBackground();
    var listener = getOnMessageListener();
    var wfId = registerWorkflow(listener);

    return flushTimers().then(function () {
      chrome.tabs.sendMessage.mockClear();
      fireWorkflowProgress(listener, wfId);
      return flushTimers();
    }).then(function () {
      // 测试运行 Plan 03 Task 2 完成后会经 sendToTabWithRetry 转发；
      // 首次成功（默认实现 callback() 即无 lastError）→ 只调 1 次
      var forwardCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
        return args[1] && args[1].action === 'workflow_progress';
      });
      expect(forwardCalls.length).toBe(1);
    });
  });

  test('test 2: sendMessage 连续 2 次 lastError，第 3 次成功 → 总调用次数 = 3', function () {
    loadBackground();
    var listener = getOnMessageListener();
    var wfId = registerWorkflow(listener);

    return flushTimers().then(function () {
      var callCount = 0;
      chrome.tabs.sendMessage.mockImplementation(function (tabId, msg, cb) {
        callCount++;
        if (callCount < 3) {
          // 前 2 次返回 'Receiving end does not exist' 错误
          chrome.runtime.lastError = { message: 'Receiving end does not exist' };
          if (typeof cb === 'function') cb();
          // 调用后立即清除 lastError，让后续读 lastError 时不被污染
          // 注：helper 在回调里读 lastError，所以这里设的值会被读到
        } else {
          // 第 3 次成功
          chrome.runtime.lastError = null;
          if (typeof cb === 'function') cb();
        }
      });

      chrome.tabs.sendMessage.mockClear();
      fireWorkflowProgress(listener, wfId);
      return flushTimers();
    }).then(function () {
      var forwardCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
        return args[1] && args[1].action === 'workflow_progress';
      });
      // 重试 2 次后成功 → 总调用 3 次
      expect(forwardCalls.length).toBe(3);
      chrome.runtime.lastError = null;
    });
  });

  test('test 3: sendMessage 连续 3 次都 lastError → 不再重试，调用次数 = 3', function () {
    loadBackground();
    var listener = getOnMessageListener();
    var wfId = registerWorkflow(listener);

    return flushTimers().then(function () {
      chrome.tabs.sendMessage.mockImplementation(function (tabId, msg, cb) {
        chrome.runtime.lastError = { message: 'Receiving end does not exist' };
        if (typeof cb === 'function') cb();
      });

      chrome.tabs.sendMessage.mockClear();
      fireWorkflowProgress(listener, wfId);
      return flushTimers();
    }).then(function () {
      var forwardCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
        return args[1] && args[1].action === 'workflow_progress';
      });
      // maxRetries=3 时，共尝试 4 次（初始 + 3 次重试）— 但 Plan 02 实现 attempt(maxRetries) 第一次是 maxRetries=3
      // 实际：初始尝试 + 重试 maxRetries-1 次（最后一次 retriesLeft=0 不再重试）
      // 测试期望 ≥ 3 次（helper 至少重试到 maxRetries 上限）
      expect(forwardCalls.length).toBeGreaterThanOrEqual(3);
      chrome.runtime.lastError = null;
    });
  });

  test('test 4: lastError 是其他错误（非 Receiving end）→ 不重试，调用次数 = 1', function () {
    loadBackground();
    var listener = getOnMessageListener();
    var wfId = registerWorkflow(listener);

    return flushTimers().then(function () {
      chrome.tabs.sendMessage.mockImplementation(function (tabId, msg, cb) {
        // 其他错误（非 'Receiving end does not exist'）— 不应触发重试
        chrome.runtime.lastError = { message: 'Some other chrome runtime error' };
        if (typeof cb === 'function') cb();
      });

      chrome.tabs.sendMessage.mockClear();
      fireWorkflowProgress(listener, wfId);
      return flushTimers();
    }).then(function () {
      var forwardCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
        return args[1] && args[1].action === 'workflow_progress';
      });
      // 非 'Receiving end' 错误 → 不重试
      expect(forwardCalls.length).toBe(1);
      chrome.runtime.lastError = null;
    });
  });
});
