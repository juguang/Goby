/**
 * Phase 8 Plan 04 Task 1
 *
 * chrome.tabs.onRemoved 错误恢复测试（NAV-09 / D-16）
 *
 * 工作 Tab 意外关闭时（chrome.tabs.onRemoved），SW 必须向 chat Tab 发
 * workflow_error 通知（避免 chat Tab 永久卡 isProcessing=true）。
 *
 * 测试场景:
 *   1. tab 关闭 → workflow_error 发到 chatTabId，reason '工作 Tab 被关闭'
 *   2. tab 关闭 + isWindowClosing:true → reason 含 '（窗口关闭）' 后缀
 *   3. listener 调用后 _activeWorkflows[wf_x] 被 delete + storage 清掉
 *   4. listener 收到无关 tab id（非 workflow 的 tab）→ 无副作用（不调 sendMessage）
 *   5. isWindowClosing:true → 不立即 delete（让 windows.onRemoved 兜底），
 *      但标记 status='error' 防止重复通知
 */

var helpers = require('./08-test-helpers.js');
var loadBackground = helpers.loadBackground;
var getOnMessageListener = helpers.getOnMessageListener;

describe('chrome.tabs.onRemoved error recovery (Phase 8 Plan 04)', function () {
  beforeEach(function () {
    jest.resetModules();
    chrome.storage.local._reset();
    chrome.tabs.create.mockClear();
    chrome.tabs.sendMessage.mockClear();
    chrome.tabs.onUpdated.addListener.mockClear();
    chrome.tabs.onUpdated.removeListener.mockClear();
    chrome.tabs.onRemoved.addListener.mockClear();
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

  // 辅助：触发 tab-open 完整流程注册一个 workflow，返回 {wfId, chatTabId, workerTabId, windowId}
  function registerWorkflow(listener, opts) {
    var chatTabId = (opts && opts.chatTabId) || 12;
    var workerTabId = (opts && opts.workerTabId) || 99;
    var workerWindowId = (opts && opts.workerWindowId) || 1;
    var sender = { id: chrome.runtime.id, tab: { id: chatTabId, url: 'https://chat.com' } };
    chrome.tabs.create.mockImplementation(function (o, cb) {
      cb({ id: workerTabId, title: 'Worker', windowId: workerWindowId });
    });
    var resp;
    listener({ action: 'tab-open', url: 'https://worker.com' }, sender, function (r) { resp = r; });
    var calls = chrome.tabs.onUpdated.addListener.mock.calls;
    var onUpdated = calls[calls.length - 1][0];
    onUpdated(workerTabId, { status: 'complete' }, { id: workerTabId, title: 'Worker', windowId: workerWindowId });
    var match = String(resp || '').match(/wf_[a-f0-9]{8}/);
    return { wfId: match ? match[0] : null, chatTabId: chatTabId, workerTabId: workerTabId, workerWindowId: workerWindowId };
  }

  // 辅助：取出 chrome.tabs.onRemoved 注册的 listener
  function getOnRemovedListener() {
    expect(chrome.tabs.onRemoved.addListener).toHaveBeenCalled();
    var calls = chrome.tabs.onRemoved.addListener.mock.calls;
    return calls[calls.length - 1][0];
  }

  // 辅助：flush microtasks + setTimeout
  function flushTimers() {
    var p = Promise.resolve();
    for (var i = 0; i < 15; i++) p = p.then(function () {});
    return p;
  }

  // ---------------------------------------------------------------
  //  chrome.tabs.onRemoved listener 测试
  // ---------------------------------------------------------------

  test('test 1: tab 关闭 → workflow_error 发到 chatTabId，reason "工作 Tab 被关闭"', function () {
    loadBackground();
    var listener = getOnMessageListener();

    return flushTimers().then(function () {
      var info = registerWorkflow(listener);
      return flushTimers().then(function () {
        chrome.tabs.sendMessage.mockClear();

        // 模拟工作 Tab 关闭（非窗口关闭场景）
        var onRemoved = getOnRemovedListener();
        onRemoved(info.workerTabId, { windowId: info.workerWindowId, isWindowClosing: false });
        return flushTimers();
      }).then(function () {
        // 验证 sendMessage 被以 chatTabId + workflow_error 调用
        var errorCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
          return args[1] && args[1].action === 'workflow_error' &&
                 args[1].workflow_id === info.wfId;
        });
        expect(errorCalls.length).toBeGreaterThanOrEqual(1);
        expect(errorCalls[0][0]).toBe(info.chatTabId);
        expect(errorCalls[0][1].data.reason).toContain('工作 Tab 被关闭');
        expect(errorCalls[0][1].data.reason).not.toContain('（窗口关闭）');
      });
    });
  });

  test('test 2: tab 关闭 + isWindowClosing:true → reason 含 "（窗口关闭）" 后缀', function () {
    loadBackground();
    var listener = getOnMessageListener();

    return flushTimers().then(function () {
      var info = registerWorkflow(listener);
      return flushTimers().then(function () {
        chrome.tabs.sendMessage.mockClear();

        var onRemoved = getOnRemovedListener();
        // 窗口关闭场景
        onRemoved(info.workerTabId, { windowId: info.workerWindowId, isWindowClosing: true });
        return flushTimers();
      }).then(function () {
        var errorCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
          return args[1] && args[1].action === 'workflow_error' &&
                 args[1].workflow_id === info.wfId;
        });
        expect(errorCalls.length).toBeGreaterThanOrEqual(1);
        expect(errorCalls[0][1].data.reason).toContain('（窗口关闭）');
      });
    });
  });

  test('test 3: tab 关闭（非窗口关闭）后 _activeWorkflows[wf_x] 被 delete + storage 清掉', function () {
    loadBackground();
    var listener = getOnMessageListener();

    return flushTimers().then(function () {
      var info = registerWorkflow(listener);
      return flushTimers().then(function () {
        var stored = chrome.storage.local._raw.active_workflows || {};
        expect(stored[info.wfId]).toBeTruthy();

        var onRemoved = getOnRemovedListener();
        onRemoved(info.workerTabId, { windowId: info.workerWindowId, isWindowClosing: false });
        return flushTimers();
      }).then(function () {
        var stored = chrome.storage.local._raw.active_workflows || {};
        expect(stored[info.wfId]).toBeUndefined();
      });
    });
  });

  test('test 4: 无关 tab id 关闭 → 无 workflow_error 副作用', function () {
    loadBackground();
    var listener = getOnMessageListener();

    return flushTimers().then(function () {
      registerWorkflow(listener);
      return flushTimers().then(function () {
        chrome.tabs.sendMessage.mockClear();

        var onRemoved = getOnRemovedListener();
        // 无关 tab id — 不应触发任何 workflow_error
        onRemoved(12345, { windowId: 999, isWindowClosing: false });
        return flushTimers();
      }).then(function () {
        var errorCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
          return args[1] && args[1].action === 'workflow_error';
        });
        expect(errorCalls.length).toBe(0);
      });
    });
  });

  test('test 5: isWindowClosing:true → 不立即 delete，标记 status="error"（让 windows.onRemoved 兜底）', function () {
    loadBackground();
    var listener = getOnMessageListener();

    return flushTimers().then(function () {
      var info = registerWorkflow(listener);
      return flushTimers().then(function () {
        var onRemoved = getOnRemovedListener();
        // 窗口关闭 — 不应立即 delete，但应标记 status='error'
        onRemoved(info.workerTabId, { windowId: info.workerWindowId, isWindowClosing: true });
        return flushTimers();
      }).then(function () {
        var stored = chrome.storage.local._raw.active_workflows || {};
        // 仍存在（未立即删除）
        expect(stored[info.wfId]).toBeTruthy();
        // 但 status 已标 error
        expect(stored[info.wfId].status).toBe('error');
      });
    });
  });
});
