/**
 * Phase 8 Plan 05 Task 1 — E2E workflow 集成测试
 *
 * 端到端验证 chat Tab → SW → worker Tab → SW → chat Tab 的完整 workflow 链路。
 * 单文件混合 SW + CS 模式（参考 navigation-tools.test.js + 08-workflow-handlers.test.js）。
 *
 * 简化策略（per PLAN.md Task 1 注释）:
 *   - chat Tab 用真实 loadCsModules（覆盖 processAgentMessage workflow break / resume）
 *   - worker Tab 用 mock state（直接构造 _agentState + 直接调 SW onMessage listener，
 *     跳过 worker Tab 的 CS 重复实例化，避免单测试内双 CS 状态冲突）
 *   - 重点验证：SW 中继逻辑（_activeWorkflows 注册/转发/清理）+ chat Tab resume 行为
 *
 * 测试场景:
 *   test 1 (happy path E2E):
 *     loadBackground → loadCsModules → 模拟 chat Tab 调 page_open_tab →
 *     SW 注册 active_workflows + 注入 workflow-init → 模拟 worker Tab 完成消息回传 →
 *     SW 转发 workflow_complete 给 chat Tab → chat Tab resume
 *
 *   test 2 (错误恢复 E2E):
 *     workflow 进行中模拟 worker Tab 关闭 → chrome.tabs.onRemoved listener 触发 →
 *     chat Tab 收到 workflow_error + isProcessing 恢复 false
 */

var helpers = require('./08-test-helpers.js');
var loadBackground = helpers.loadBackground;
var loadCsModules = helpers.loadCsModules;
var getOnMessageListener = helpers.getOnMessageListener;

describe('E2E workflow integration (Phase 8 Plan 05)', function () {

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    delete chrome.runtime.lastError;
    document.body.innerHTML = '';
    chrome.runtime.sendMessage.mockResolvedValue({ ok: true });

    // 让 SW→CS 转发实际触发 chat Tab CS 的 onMessage listener
    // 路由：tabId === chatTabId(12) → 调 chat Tab CS listener
    chrome.tabs.sendMessage.mockImplementation(function (tabId, msg, cb) {
      // 找到最近一次注册的 CS listener
      var calls = chrome.runtime.onMessage.addListener.mock.calls;
      // 从后往前找最末一个 CS listener（content-script.js 注册在 background.js 之后）
      var csListener = null;
      for (var i = calls.length - 1; i >= 0; i--) {
        csListener = calls[i][0];
        break;
      }
      if (tabId === 12 && csListener) {
        try {
          csListener(msg, { id: chrome.runtime.id, tab: { id: 12 } }, function () {});
        } catch (e) { /* 静默降级 */ }
      }
      if (typeof cb === 'function') cb();
      return Promise.resolve();
    });

    // 固定 UUID — SW 用 crypto.randomUUID().slice(0,8) 截取，结果必须是 8 hex 字符
    // （regex 匹配 wf_[a-f0-9]{8}）— 用 'abcdef12' 保证全部 hex
    if (!global.crypto) global.crypto = {};
    global.crypto.randomUUID = jest.fn(function () {
      return 'abcdef12-aaaa-bbbb-cccc-dddddddddddd';
    });
  });

  afterEach(function () {
    jest.restoreAllMocks();
    delete window.__gobyWorkflowId;
  });

  // 辅助：flush microtasks + setTimeout（200ms 重试间隔）
  function flushTimers(n) {
    var p = Promise.resolve();
    for (var i = 0; i < (n || 30); i++) p = p.then(function () {});
    return p;
  }

  // 辅助：取 CS onMessage listener（最后注册的那一个）
  function getCsOnMessageListener() {
    var calls = chrome.runtime.onMessage.addListener.mock.calls;
    return calls[calls.length - 1][0];
  }

  // 辅助：触发 tab-open 完整流程注册一个 workflow，返回 {wfId, chatTabId, workerTabId}
  function registerWorkflowViaTabOpen(swListener, opts) {
    var chatTabId = (opts && opts.chatTabId) || 12;
    var workerTabId = (opts && opts.workerTabId) || 99;
    var workerWindowId = (opts && opts.workerWindowId) || 1;
    var sender = { id: chrome.runtime.id, tab: { id: chatTabId, url: 'https://chat.com' } };
    chrome.tabs.create.mockImplementation(function (o, cb) {
      cb({ id: workerTabId, title: 'Worker', windowId: workerWindowId });
    });
    var resp;
    swListener({ action: 'tab-open', url: 'https://worker.com' }, sender, function (r) { resp = r; });
    var calls = chrome.tabs.onUpdated.addListener.mock.calls;
    var onUpdated = calls[calls.length - 1][0];
    onUpdated(workerTabId, { status: 'complete' }, { id: workerTabId, title: 'Worker', windowId: workerWindowId });
    var match = String(resp || '').match(/wf_[a-f0-9]{8}/);
    return { wfId: match ? match[0] : null, chatTabId: chatTabId, workerTabId: workerTabId, workerWindowId: workerWindowId };
  }

  // 辅助：取 chrome.tabs.onRemoved 注册的 listener
  function getOnRemovedListener() {
    expect(chrome.tabs.onRemoved.addListener).toHaveBeenCalled();
    var calls = chrome.tabs.onRemoved.addListener.mock.calls;
    return calls[calls.length - 1][0];
  }

  // ====================================================================
  //  test 1: happy path E2E
  // ====================================================================
  test('test 1: happy path E2E — chat Tab → SW → worker Tab → SW → chat Tab resume', async function () {
    // 加载 SW — 触发 IIFE 注册 onMessage + onRemoved listener
    loadBackground();
    var swListener = getOnMessageListener();

    // 等 SW top-level storage 恢复完成
    await flushTimers();

    // 加载 CS（chat Tab）— 触发 IIFE 注册 CS onMessage listener
    loadCsModules();
    var csListener = getCsOnMessageListener();

    // 在 listener 触发前先创建 session 让 _agentState.messages 初始化
    window.GobyAgent.createSession('https://chat.com');
    var chatAgentState = window.__gobyInternals._agentState;

    // 防止 processAgentMessage 真实跑 LLM（resume 路径也无副作用）
    var chatResumeSpy = jest.spyOn(window.GobyAgent, 'processAgentMessage').mockImplementation(function () {
      return Promise.resolve();
    });

    // === 步骤 1: 模拟 chat Tab Agent 调 page_open_tab → SW 注册 workflow ===
    // 直接调 SW onMessage listener 触发 tab-open 流程
    var info = registerWorkflowViaTabOpen(swListener, { chatTabId: 12, workerTabId: 99 });
    expect(info.wfId).toBeTruthy();

    await flushTimers();

    // === 步骤 2: 验证 SW _activeWorkflows 已注册 ===
    // storage.active_workflows 应包含 wfId entry
    var stored = chrome.storage.local._raw.active_workflows || {};
    expect(stored[info.wfId]).toBeDefined();
    expect(stored[info.wfId].chatTabId).toBe(12);
    expect(stored[info.wfId].workerTabId).toBe(99);
    expect(stored[info.wfId].status).toBe('active');

    // === 步骤 3: 验证 SW 通过 sendToTabWithRetry 向 worker Tab（id=99）注入 workflow-init ===
    var initCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
      return args[0] === 99 && args[1] && args[1].action === 'workflow-init';
    });
    expect(initCalls.length).toBeGreaterThanOrEqual(1);
    expect(initCalls[0][1].workflow_id).toBe(info.wfId);
    expect(Array.isArray(initCalls[0][1].inherited_messages)).toBe(true);
    expect(typeof initCalls[0][1].initial_user_message).toBe('string');

    // === 步骤 4: 模拟 worker Tab 调 page_finish_workflow(summary='Found X') ===
    // 直接调 SW onMessage listener，模拟 worker Tab 的请求
    var finishResp;
    swListener(
      {
        action: 'page-finish-workflow',
        workflow_id: info.wfId,
        summary: 'Found X'
      },
      { id: chrome.runtime.id, tab: { id: 99, url: 'https://worker.com' } },
      function (r) { finishResp = r; }
    );

    await flushTimers();

    // === 步骤 5: 验证 SW 转发 workflow_complete 到 chat Tab + 清理 active_workflows ===
    var completeCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
      return args[0] === 12 && args[1] && args[1].action === 'workflow_complete';
    });
    expect(completeCalls.length).toBeGreaterThanOrEqual(1);
    expect(completeCalls[0][1].workflow_id).toBe(info.wfId);
    expect(completeCalls[0][1].data.summary).toBe('Found X');
    expect(completeCalls[0][1].data.finalTabId).toBe(99);

    // 此时 sendMessage mock 会把消息路由给 csListener（chat Tab），模拟 chat Tab 收到 workflow_complete
    await flushTimers();

    // === 步骤 6: 验证 chat Tab resume — processAgentMessage 以 resume+fromWorkflow 调用 ===
    var resumeCall = chatResumeSpy.mock.calls.find(function (call) {
      return call[1] && call[1].resume === true && call[1].fromWorkflow === info.wfId;
    });
    expect(resumeCall).toBeTruthy();
    expect(resumeCall[0]).toBeNull();

    // === 步骤 7: 验证 chat Tab messages 含 '[From workflow wf_xxx] Found X' ===
    var contents = chatAgentState.messages.map(function (m) { return m.content; });
    var fromWorkflowFound = contents.some(function (c) {
      return String(c).indexOf('[From workflow ' + info.wfId + ']') !== -1 &&
             String(c).indexOf('Found X') !== -1;
    });
    expect(fromWorkflowFound).toBe(true);

    // === 步骤 8: 验证 active_workflows 在 complete 后被清理 ===
    var storedAfter = chrome.storage.local._raw.active_workflows || {};
    expect(storedAfter[info.wfId]).toBeUndefined();
  });

  // ====================================================================
  //  test 2: 错误恢复 E2E
  // ====================================================================
  test('test 2: 错误恢复 E2E — worker Tab 关闭 → chat Tab 收到 workflow_error + isProcessing 恢复', async function () {
    // 加载 SW
    loadBackground();
    var swListener = getOnMessageListener();
    await flushTimers();

    // 加载 CS（chat Tab）
    loadCsModules();
    var csListener = getCsOnMessageListener();

    window.GobyAgent.createSession('https://chat.com');
    var chatAgentState = window.__gobyInternals._agentState;
    // chat Tab 进入 processing 状态（模拟用户已发指令、Agent 调 page_open_tab 后 break）
    chatAgentState.isProcessing = true;

    // 防止 processAgentMessage 真实跑 LLM
    jest.spyOn(window.GobyAgent, 'processAgentMessage').mockImplementation(function () {
      return Promise.resolve();
    });

    // === 步骤 1-2: 模拟 chat Tab Agent 调 page_open_tab → SW 注册 workflow ===
    var info = registerWorkflowViaTabOpen(swListener, { chatTabId: 12, workerTabId: 99 });
    expect(info.wfId).toBeTruthy();
    await flushTimers();

    // 重置 mock 调用记录（保留 mockImplementation 路由）
    chrome.tabs.sendMessage.mockClear();

    // === 步骤 3: 模拟 worker Tab（id=99）被关闭 → 触发 chrome.tabs.onRemoved listener ===
    var onRemovedListener = getOnRemovedListener();
    onRemovedListener(99, { windowId: 1, isWindowClosing: false });

    await flushTimers();

    // === 步骤 4: 验证 SW 向 chat Tab（id=12）发了 workflow_error ===
    var errorCalls = chrome.tabs.sendMessage.mock.calls.filter(function (args) {
      return args[0] === 12 && args[1] && args[1].action === 'workflow_error';
    });
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);
    expect(errorCalls[0][1].workflow_id).toBe(info.wfId);
    expect(errorCalls[0][1].data.reason).toContain('工作 Tab 被关闭');

    // sendMessage mock 路由会把 workflow_error 派发给 csListener（chat Tab）
    await flushTimers();

    // === 步骤 5: 验证 chat Tab isProcessing 恢复 false（CS workflow_error handler 路径）===
    expect(chatAgentState.isProcessing).toBe(false);

    // === 步骤 6: 验证 chat Tab messages 含失败 assistant 消息 ===
    var contents = chatAgentState.messages.map(function (m) { return m.content; });
    var errFound = contents.some(function (c) {
      return String(c).indexOf('工作流 ' + info.wfId + ' 失败') !== -1;
    });
    expect(errFound).toBe(true);

    // === 步骤 7: 验证 active_workflows 在 onRemoved 后被清理（非窗口关闭路径立即清）===
    var storedAfter = chrome.storage.local._raw.active_workflows || {};
    expect(storedAfter[info.wfId]).toBeUndefined();
  });
});
