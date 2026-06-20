/**
 * Phase 8 Plan 04 Task 1
 *
 * chrome.windows.onRemoved 兜底测试（NAV-09 / D-16 / Pitfall 3）
 *
 * 当窗口关闭时，Chrome 可能不触发 tabs.onRemoved（Pitfall 3）— 必须有
 * windows.onRemoved 兜底，避免 chat Tab 永久卡 isProcessing=true。
 *
 * 测试场景:
 *   6. windows.onRemoved(windowId) → 遍历 _activeWorkflows 找 workerWindowId === windowId
 *      的 workflow，发 workflow_error 给 chatTabId + 清理 _activeWorkflows
 */

var helpers = require('./08-test-helpers.js');
var loadBackground = helpers.loadBackground;
var getOnMessageListener = helpers.getOnMessageListener;

describe('chrome.windows.onRemoved fallback (Phase 8 Plan 04)', function () {
  beforeEach(function () {
    jest.resetModules();
    chrome.storage.local._reset();
    chrome.tabs.create.mockClear();
    chrome.tabs.sendMessage.mockClear();
    chrome.tabs.onUpdated.addListener.mockClear();
    chrome.tabs.onUpdated.removeListener.mockClear();
    chrome.tabs.onRemoved.addListener.mockClear();
    chrome.windows.onRemoved.addListener.mockClear();
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

  // 辅助：注册 workflow，返回 {wfId, chatTabId, workerTabId, workerWindowId}
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

  // 辅助：取出 windows.onRemoved 注册的 listener
  function getWindowsOnRemovedListener() {
    expect(chrome.windows.onRemoved.addListener).toHaveBeenCalled();
    var calls = chrome.windows.onRemoved.addListener.mock.calls;
    return calls[calls.length - 1][0];
  }

  function flushTimers() {
    var p = Promise.resolve();
    for (var i = 0; i < 15; i++) p = p.then(function () {});
    return p;
  }

  // ---------------------------------------------------------------
  //  chrome.windows.onRemoved listener 兜底测试
  // ---------------------------------------------------------------

  test('test 6: windows.onRemoved(windowId) → workflow_error 发到 chatTabId + 清理 _activeWorkflows', function () {
    loadBackground();
    var listener = getOnMessageListener();

    return flushTimers().then(function () {
      var info = registerWorkflow(listener, { workerWindowId: 42 });
      return flushTimers().then(function () {
        var stored = chrome.storage.local._raw.active_workflows || {};
        expect(stored[info.wfId]).toBeTruthy();
        expect(stored[info.wfId].workerWindowId).toBe(42);

        chrome.tabs.sendMessage.mockClear();
        // 模拟窗口 42 关闭
        var winListener = getWindowsOnRemovedListener();
        winListener(42);
        return flushTimers();
      }).then(function () {
        // 验证 workflow_error 转发
        var errorCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
          return args[1] && args[1].action === 'workflow_error' &&
                 args[1].workflow_id === info.wfId;
        });
        expect(errorCalls.length).toBeGreaterThanOrEqual(1);
        expect(errorCalls[0][0]).toBe(info.chatTabId);
        expect(errorCalls[0][1].data.reason).toContain('（窗口关闭）');

        // 验证清理
        var storedAfter = chrome.storage.local._raw.active_workflows || {};
        expect(storedAfter[info.wfId]).toBeUndefined();
      });
    });
  });
});
