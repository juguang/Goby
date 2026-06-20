/**
 * Phase 8 Plan 03 Task 5 — D-10 缺口补全
 *
 * SW tab-open handler 在 sendToTabWithRetry 调用点（注入 workflow-init 给工作 Tab）前
 * 从 storage gobySessions 拉取 chat Tab 最后 5 条 messages 作为 inherited_messages，
 * 构造 initial_user_message = 'Working in workflow <id>, origin: <workerOrigin>'。
 *
 * 测试场景:
 *   1. workflow-init payload 含 inherited_messages 字段（Array）
 *   2. inherited_messages 长度 ≤ 5（只取最后 5 条）
 *   3. chat Tab 无 session → inherited_messages = []（空数组，不报错）
 *   4. initial_user_message 格式 'Working in workflow <wfId>, origin: <workerOrigin>'
 *   5. 拉取的是 sender.tab 的 session（非其他 Tab）
 *   6. payload 仍含 workflow_id 字段（Plan 02 基础字段不被破坏）
 *   7. storage 异常时降级到 inherited_messages=[]，handler 仍正常 sendResponse
 */

var helpers = require('./08-test-helpers.js');
var loadBackground = helpers.loadBackground;
var getOnMessageListener = helpers.getOnMessageListener;

describe('workflow-init payload D-10 (inherited + initial_user_message)', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.useFakeTimers();
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
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // 辅助：触发 tab-open 完整流程注册 workflow，返回 sendResponse + 信息
  function fireTabOpen(listener, opts) {
    opts = opts || {};
    var sender = opts.sender || { id: chrome.runtime.id, tab: { id: 12, url: 'https://chat.com' } };
    var targetUrl = opts.url || 'https://worker.com';
    var workerTabId = opts.workerTabId || 99;

    chrome.tabs.create.mockImplementation(function (o, cb) {
      cb({ id: workerTabId, title: 'Worker' });
    });

    var resp;
    listener({ action: 'tab-open', url: targetUrl }, sender, function (r) { resp = r; });

    var calls = chrome.tabs.onUpdated.addListener.mock.calls;
    var onUpdated = calls[calls.length - 1][0];
    onUpdated(workerTabId, { status: 'complete' }, { id: workerTabId, title: 'Worker' });

    var match = String(resp || '').match(/wf_[a-f0-9]{8}/);
    return { wfId: match ? match[0] : null, resp: resp };
  }

  // 辅助：预置 chat Tab session 数据到 storage gobySessions
  function seedChatSession(origin, messages, updatedAt) {
    var sessions = chrome.storage.local._raw.gobySessions || {};
    // sessionId 用 origin 哈希（这里简化为 origin 字面量）
    var sid = 'sid_' + origin.replace(/[^a-z0-9]/gi, '_');
    sessions[sid] = {
      origin: origin,
      title: origin,
      updatedAt: updatedAt || Date.now(),
      messageCount: messages.length,
      preview: '',
      messages: messages
    };
    chrome.storage.local._raw.gobySessions = sessions;
  }

  // 辅助：flush microtasks + advance timers
  function flushTimers() {
    for (var i = 0; i < 5; i++) jest.advanceTimersByTime(250);
    var p = Promise.resolve();
    for (var j = 0; j < 15; j++) p = p.then(function () {});
    return p;
  }

  // 辅助：从 chrome.tabs.sendMessage.mock.calls 找 workflow-init 消息
  function getWorkflowInitCall(workerTabId) {
    var initCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
      return args[0] === workerTabId && args[1] && args[1].action === 'workflow-init';
    });
    return initCalls.length > 0 ? initCalls[initCalls.length - 1][1] : null;
  }

  // ---------------------------------------------------------------
  //  测试 1-7
  // ---------------------------------------------------------------

  test('test 1: workflow-init payload 含 inherited_messages 字段（Array）', function () {
    loadBackground();
    var listener = getOnMessageListener();

    // 预置 chat Tab session 含 8 条 messages
    var msgs = [];
    for (var i = 0; i < 8; i++) msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'm-' + i });
    seedChatSession('https://chat.com', msgs, 1000);

    fireTabOpen(listener, { sender: { id: chrome.runtime.id, tab: { id: 12, url: 'https://chat.com' } } });

    return flushTimers().then(function () {
      var initMsg = getWorkflowInitCall(99);
      expect(initMsg).toBeTruthy();
      expect(Array.isArray(initMsg.inherited_messages)).toBe(true);
    });
  });

  test('test 2: inherited_messages 长度 ≤ 5（只取最后 5 条）', function () {
    loadBackground();
    var listener = getOnMessageListener();

    var msgs = [];
    for (var i = 0; i < 8; i++) msgs.push({ role: 'user', content: 'msg-' + i });
    seedChatSession('https://chat.com', msgs, 1000);

    fireTabOpen(listener, { sender: { id: chrome.runtime.id, tab: { id: 12, url: 'https://chat.com' } } });

    return flushTimers().then(function () {
      var initMsg = getWorkflowInitCall(99);
      expect(initMsg).toBeTruthy();
      expect(initMsg.inherited_messages.length).toBeLessThanOrEqual(5);
      // 验证是最后 5 条（slice(-5)）
      var last5 = msgs.slice(-5);
      expect(initMsg.inherited_messages.map(function (m) { return m.content; })).toEqual(
        last5.map(function (m) { return m.content; })
      );
    });
  });

  test('test 3: chat Tab 无 session → inherited_messages = []', function () {
    loadBackground();
    var listener = getOnMessageListener();

    // 不预置任何 session
    fireTabOpen(listener, { sender: { id: chrome.runtime.id, tab: { id: 12, url: 'https://chat.com' } } });

    return flushTimers().then(function () {
      var initMsg = getWorkflowInitCall(99);
      expect(initMsg).toBeTruthy();
      expect(Array.isArray(initMsg.inherited_messages)).toBe(true);
      expect(initMsg.inherited_messages.length).toBe(0);
    });
  });

  test('test 4: initial_user_message 格式 "Working in workflow <wfId>, origin: <workerOrigin>"', function () {
    loadBackground();
    var listener = getOnMessageListener();

    fireTabOpen(listener, {
      sender: { id: chrome.runtime.id, tab: { id: 12, url: 'https://chat.com' } },
      url: 'https://worker.com/path'
    });

    return flushTimers().then(function () {
      var initMsg = getWorkflowInitCall(99);
      expect(initMsg).toBeTruthy();
      expect(typeof initMsg.initial_user_message).toBe('string');
      // 含 workflow id
      expect(initMsg.initial_user_message).toContain(initMsg.workflow_id);
      // 格式：'Working in workflow <wfId>, origin: <workerOrigin>'
      // workerOrigin = message.url（新打开 tab 的 URL）
      expect(initMsg.initial_user_message).toMatch(/^Working in workflow /);
      expect(initMsg.initial_user_message).toContain('https://worker.com');
    });
  });

  test('test 5: 拉取的是 sender.tab 的 session（非其他 Tab）', function () {
    loadBackground();
    var listener = getOnMessageListener();

    // 预置两条 session — chat.com（sender）和 other.com
    seedChatSession('https://chat.com', [{ role: 'user', content: 'CHAT_TAB_MSG' }], 1000);
    seedChatSession('https://other.com', [{ role: 'user', content: 'OTHER_TAB_MSG' }], 2000);

    fireTabOpen(listener, { sender: { id: chrome.runtime.id, tab: { id: 12, url: 'https://chat.com' } } });

    return flushTimers().then(function () {
      var initMsg = getWorkflowInitCall(99);
      expect(initMsg).toBeTruthy();
      var contents = initMsg.inherited_messages.map(function (m) { return m.content; });
      expect(contents).toContain('CHAT_TAB_MSG');
      expect(contents).not.toContain('OTHER_TAB_MSG');
    });
  });

  test('test 6: payload 仍含 workflow_id 字段（Plan 02 基础字段不被破坏）', function () {
    loadBackground();
    var listener = getOnMessageListener();

    fireTabOpen(listener);

    return flushTimers().then(function () {
      var initMsg = getWorkflowInitCall(99);
      expect(initMsg).toBeTruthy();
      expect(initMsg.workflow_id).toMatch(/^wf_[a-f0-9]{8}$/);
    });
  });

  test('test 7: storage 拉 chat session 抛错时降级到 inherited_messages=[] + 仍正常 sendResponse', function () {
    loadBackground();
    var listener = getOnMessageListener();

    // 临时 mock storage.local.get 抛错（仅对 gobySessions key）
    var origGet = chrome.storage.local.get;
    chrome.storage.local.get = jest.fn(function (keys) {
      if (keys === 'gobySessions') {
        return Promise.reject(new Error('storage corrupted'));
      }
      return origGet.call(chrome.storage.local, keys);
    });

    var resp;
    var sender = { id: chrome.runtime.id, tab: { id: 12, url: 'https://chat.com' } };
    chrome.tabs.create.mockImplementation(function (o, cb) {
      cb({ id: 99, title: 'Worker' });
    });
    listener({ action: 'tab-open', url: 'https://worker.com' }, sender, function (r) { resp = r; });
    var calls = chrome.tabs.onUpdated.addListener.mock.calls;
    var onUpdated = calls[calls.length - 1][0];
    onUpdated(99, { status: 'complete' }, { id: 99, title: 'Worker' });

    return flushTimers().then(function () {
      // sendResponse 仍正常 — 含 (workflow:)
      expect(String(resp || '')).toMatch(/workflow:/);

      // 仍调 sendToTabWithRetry 发基础 workflow-init
      var initMsg = getWorkflowInitCall(99);
      expect(initMsg).toBeTruthy();
      expect(Array.isArray(initMsg.inherited_messages)).toBe(true);
      expect(initMsg.inherited_messages.length).toBe(0);
      // initial_user_message 仍构造（不依赖 storage）
      expect(typeof initMsg.initial_user_message).toBe('string');

      // 恢复
      chrome.storage.local.get = origGet;
    });
  });
});
