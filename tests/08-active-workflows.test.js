/**
 * Phase 8 Plan 02 Task 3
 *
 * active_workflows 注册测试 — 验证 tab-open handler 在 onUpdated complete 时
 * 生成 workflow UUID、调用 updateActiveWorkflows 注册映射、调用 sendToTabWithRetry
 * 注入 workflow-init、并在 sendResponse 字符串末尾追加 (workflow: wf_xxxxxxxx)。
 *
 * 测试场景:
 *   1. tab-open 调用后 storage.active_workflows 含一条 entry（key 形如 wf_xxxxxxxx）
 *   2. entry.chatTabId === sender.tab.id（发起 tab-open 的 chat Tab）
 *   3. entry.workerTabId === 新创建 tab 的 id
 *   4. sendResponse 字符串含 'workflow:'
 *   5. onUpdated complete 时调 chrome.tabs.sendMessage(workerTabId, { action:'workflow-init', workflow_id }) 至少 1 次
 */

var helpers = require('./08-test-helpers.js');
var loadBackground = helpers.loadBackground;
var getOnMessageListener = helpers.getOnMessageListener;

describe('active_workflows registration (Phase 8 Plan 02)', function () {
  beforeEach(function () {
    jest.resetModules();
    chrome.storage.local._reset();
    chrome.tabs.create.mockClear();
    chrome.tabs.sendMessage.mockClear();
    chrome.tabs.onUpdated.addListener.mockClear();
    chrome.tabs.onUpdated.removeListener.mockClear();
    chrome.runtime.lastError = null;
    // 默认 chrome.tabs.sendMessage 成功回调
    chrome.tabs.sendMessage.mockImplementation(function (tabId, msg, cb) {
      if (typeof cb === 'function') cb();
    });
    // 默认 randomUUID 返回可预测值
    if (!global.crypto) global.crypto = {};
    global.crypto.randomUUID = jest.fn(function () {
      return '12ab3f45-aaaa-bbbb-cccc-dddddddddddd';
    });
  });

  afterEach(function () {
    jest.restoreAllMocks();
  });

  // 辅助：触发 tab-open 完整流程并返回 sendResponse
  function fireTabOpen(listener, sender, url) {
    var senderObj = sender || { id: chrome.runtime.id, tab: { id: 12, url: 'https://a.com' } };
    var targetUrl = url || 'https://b.com';
    var createdTab = { id: 99, title: 'B 页面' };

    chrome.tabs.create.mockImplementation(function (opts, cb) {
      cb(createdTab);
    });

    var resp;
    listener(
      { action: 'tab-open', url: targetUrl },
      senderObj,
      function (r) { resp = r; }
    );

    // 触发 onUpdated complete
    var calls = chrome.tabs.onUpdated.addListener.mock.calls;
    var onUpdated = calls[calls.length - 1][0];
    onUpdated(createdTab.id, { status: 'complete' }, createdTab);

    return resp;
  }

  // 辅助：flush 所有异步（updateActiveWorkflows 写 storage + sendToTabWithRetry）
  function flushAsync() {
    // 多次 then 让 Promise 链 + setTimeout 走完
    var p = Promise.resolve();
    for (var i = 0; i < 10; i++) p = p.then(function () {});
    return p;
  }

  test('test 1: tab-open 调用后 storage.active_workflows 含一条 entry，key 形如 wf_[a-f0-9]{8}', function () {
    loadBackground();
    var listener = getOnMessageListener();

    fireTabOpen(listener);

    return flushAsync().then(function () {
      var stored = chrome.storage.local._raw.active_workflows;
      expect(stored).toBeTruthy();
      var keys = Object.keys(stored);
      expect(keys.length).toBeGreaterThanOrEqual(1);
      expect(keys[0]).toMatch(/^wf_[a-f0-9]{8}$/);

      // entry schema 含 7 个字段
      var entry = stored[keys[0]];
      expect(entry).toEqual(expect.objectContaining({
        workflowId: keys[0],
        chatTabId: expect.any(Number),
        workerTabId: expect.any(Number),
        chatOrigin: expect.any(String),
        workerOrigin: expect.any(String),
        startedAt: expect.any(Number),
        status: 'active'
      }));
    });
  });

  test('test 2: active_workflows entry.chatTabId === sender.tab.id (发起 tab-open 的 chat Tab)', function () {
    loadBackground();
    var listener = getOnMessageListener();

    fireTabOpen(listener, { id: chrome.runtime.id, tab: { id: 42, url: 'https://chat.com' } });

    return flushAsync().then(function () {
      var stored = chrome.storage.local._raw.active_workflows || {};
      var entries = Object.values(stored);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].chatTabId).toBe(42);
    });
  });

  test('test 3: active_workflows entry.workerTabId === 新创建 tab 的 id', function () {
    loadBackground();
    var listener = getOnMessageListener();

    fireTabOpen(listener);

    return flushAsync().then(function () {
      var stored = chrome.storage.local._raw.active_workflows || {};
      var entries = Object.values(stored);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].workerTabId).toBe(99); // fireTabOpen 写死 createdTab.id = 99
    });
  });

  test('test 4: sendResponse 字符串含 "workflow:"（让 chat Tab 知道启动了哪个 workflow）', function () {
    loadBackground();
    var listener = getOnMessageListener();

    var resp = fireTabOpen(listener);

    expect(typeof resp).toBe('string');
    expect(resp).toMatch(/workflow:/);
    // 含 wf_ 前缀的 workflow_id
    expect(resp).toMatch(/wf_[a-f0-9]{8}/);
  });

  test('test 5: onUpdated complete 时调 chrome.tabs.sendMessage(workerTabId, { action:"workflow-init", workflow_id }) 至少 1 次', function () {
    loadBackground();
    var listener = getOnMessageListener();

    fireTabOpen(listener);

    return flushAsync().then(function () {
      // 至少 1 次 sendMessage 调用含 action='workflow-init' + tabId=99（worker tab）
      var initCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
        var tabId = args[0];
        var msg = args[1];
        return tabId === 99 && msg && msg.action === 'workflow-init' && msg.workflow_id;
      });
      expect(initCalls.length).toBeGreaterThanOrEqual(1);
      expect(initCalls[0][1].workflow_id).toMatch(/^wf_[a-f0-9]{8}$/);
    });
  });
});
