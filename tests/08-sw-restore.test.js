/**
 * Phase 8 Plan 02 Task 1
 *
 * SW restart recovery 测试 — 验证 MV3 SW 在 idle kill 后从 storage.local
 * 恢复 _activeWorkflows 内存映射的能力（应对 RESEARCH.md Pitfall 1）。
 *
 * 测试场景:
 *   1. storage 预置 active_workflows → loadBackground() 后 SW 转发能正确路由到 chatTabId
 *   2. storage 为空时 loadBackground() 不报错
 *
 * 依赖 background.js SW top-level 同步代码:
 *   - chrome.storage.local.get('active_workflows').then(...) 恢复 _activeWorkflows
 *   - workflow-progress handler 用 _activeWorkflows[workflowId].chatTabId 路由转发
 */

var helpers = require('./08-test-helpers.js');
var loadBackground = helpers.loadBackground;
var getOnMessageListener = helpers.getOnMessageListener;

describe('SW restart recovery (Phase 8 Plan 02)', function () {
  beforeEach(function () {
    // 清空 mock 状态 + 重置 storage
    jest.resetModules();
    jest.useFakeTimers();
    chrome.storage.local._reset();
    chrome.tabs.sendMessage.mockClear();
    chrome.runtime.lastError = null;
    // 重置 chrome.tabs.sendMessage 默认实现（成功）
    chrome.tabs.sendMessage.mockImplementation(function (tabId, msg, cb) {
      if (typeof cb === 'function') cb();
    });
  });

  afterEach(function () {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('test 1: SW restart 后从 storage 预置 active_workflows 恢复，workflow-progress 正确路由到 chatTabId', function () {
    // 预置 storage — 模拟 SW 上一次写入的 active_workflows 记录
    chrome.storage.local._raw.active_workflows = {
      'wf_x1234567': {
        workflowId: 'wf_x1234567',
        chatTabId: 1,
        workerTabId: 2,
        chatOrigin: 'https://a.com',
        workerOrigin: 'https://b.com',
        startedAt: 1719000000000,
        status: 'active'
      }
    };

    // 触发 SW IIFE — 内部 top-level 代码同步从 storage 恢复 _activeWorkflows
    loadBackground();
    var listener = getOnMessageListener();

    // 注意：SW top-level 用 chrome.storage.local.get().then() 异步恢复内存映射，
    // 必须先 flush microtasks 让 Promise 完成，否则 _activeWorkflows 仍是初始 {}
    return Promise.resolve().then().then().then().then().then(function () {
      // 模拟工作 Tab 发来 workflow-progress 消息（workflow_id 命中预置记录）
      // sender.tab.id=2 === workerTabId 防 spoofing 校验通过
      var sender = { id: chrome.runtime.id, tab: { id: 2 } };
      listener(
        { action: 'workflow-progress', workflow_id: 'wf_x1234567', data: { content: 'hi' } },
        sender,
        function () {}
      );

      // Phase 8 Plan 03：handler 现在用 sendToTabWithRetry 异步转发（return true）
      // 需 flush microtasks + advance fake timers 让 200ms 重试链走完
      jest.advanceTimersByTime(250);
      return Promise.resolve().then().then().then().then().then().then();
    }).then(function () {
      // SW 应该用 chatTabId=1 转发该消息（从 storage 恢复的路由信息）
      // Phase 8 Plan 03：转发消息 action='workflow_progress'（D-08 消息 schema，
      // 与工作 Tab 入站 action='workflow-progress' 区分）
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          action: 'workflow_progress',
          workflow_id: 'wf_x1234567'
        }),
        expect.any(Function)
      );
    });
  });

  test('test 2: storage 为空时 loadBackground() 不报错，_activeWorkflows 内存映射为空对象', function () {
    // storage 不含 active_workflows key
    expect(function () {
      loadBackground();
    }).not.toThrow();

    var listener = getOnMessageListener();
    expect(typeof listener).toBe('function');

    // 转发一条 workflow-progress 消息 — 没有匹配的 workflowId 时应静默降级不抛错
    var sender = { id: chrome.runtime.id, tab: { id: 99 } };
    expect(function () {
      listener(
        { action: 'workflow-progress', workflow_id: 'wf_unknown1', data: {} },
        sender,
        function () {}
      );
    }).not.toThrow();
  });
});
