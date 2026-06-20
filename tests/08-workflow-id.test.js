/**
 * Phase 8 Plan 02 Task 1
 *
 * workflow UUID 短格式生成测试 — 验证 tab-open handler 调用后生成的 workflow_id
 * 符合 `wf_[a-f0-9]{8}` 格式（D-05 决策），并覆盖 fallback 路径（Pitfall 6 防御）。
 *
 * 测试场景:
 *   3. tab-open 调用后生成 workflow_id 形如 `wf_xxxxxxxx`（8 hex 字符）
 *   4. 连续 2 次 tab-open 调用生成不同 workflow_id
 *   5. crypto.randomUUID 抛错或缺失时，workflow_id 仍以 `wf_` 开头（fallback 到 Date.now+Math.random）
 */

var helpers = require('./08-test-helpers.js');
var loadBackground = helpers.loadBackground;
var getOnMessageListener = helpers.getOnMessageListener;

describe('workflow UUID generation (Phase 8 Plan 02)', function () {
  beforeEach(function () {
    jest.resetModules();
    chrome.storage.local._reset();
    chrome.tabs.create.mockClear();
    chrome.tabs.onUpdated.addListener.mockClear();
    chrome.tabs.onUpdated.removeListener.mockClear();
  });

  afterEach(function () {
    jest.restoreAllMocks();
    // 恢复 crypto.randomUUID 默认行为
    if (!global.crypto) global.crypto = {};
    global.crypto.randomUUID = jest.fn(function () {
      return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    });
  });

  // 辅助：模拟 chrome.tabs.create 立即回调，并暴露 onUpdated listener 让测试触发
  function triggerTabOpen(listener, createTab) {
    var createOpts = createOpts || {};
    var createdTab = createTab || { id: 99, title: '新标签页' };

    chrome.tabs.create.mockImplementation(function (opts, cb) {
      cb(createdTab);
    });

    var sendResponseArg = null;
    listener(
      { action: 'tab-open', url: 'https://b.com' },
      { id: chrome.runtime.id, tab: { id: 12, url: 'https://a.com' } },
      function (resp) { sendResponseArg = resp; }
    );

    // 取出 onUpdated listener 并触发 status=complete
    expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalled();
    var onUpdatedCalls = chrome.tabs.onUpdated.addListener.mock.calls;
    var onUpdatedListener = onUpdatedCalls[onUpdatedCalls.length - 1][0];
    onUpdatedListener(createdTab.id, { status: 'complete' }, createdTab);

    return sendResponseArg;
  }

  test('test 3: tab-open 调用后生成的 workflow_id 形如 `wf_[a-f0-9]{8}`', function () {
    // 设置一个固定的 randomUUID 让结果可预测
    if (!global.crypto) global.crypto = {};
    global.crypto.randomUUID = jest.fn(function () {
      return '12ab3f45-aaaa-bbbb-cccc-dddddddddddd';
    });

    loadBackground();
    var listener = getOnMessageListener();

    var resp = triggerTabOpen(listener, { id: 99, title: 'B 页面' });

    // sendResponse 字符串应含 workflow: wf_12ab3f45
    expect(typeof resp).toBe('string');
    expect(resp).toMatch(/workflow: wf_12ab3f45/);

    // storage 中也应记录同 workflow_id
    expect(chrome.storage.local._raw.active_workflows).toBeTruthy();
    var keys = Object.keys(chrome.storage.local._raw.active_workflows);
    expect(keys).toContain('wf_12ab3f45');
    // 整体 key 格式校验
    expect(keys[0]).toMatch(/^wf_[a-f0-9]{8}$/);
  });

  test('test 4: 连续 2 次 tab-open 调用生成不同 workflow_id', function () {
    // 让 randomUUID 每次返回不同值
    var counter = 0;
    var uuids = [
      '11111111-aaaa-bbbb-cccc-dddddddddddd',
      '22222222-aaaa-bbbb-cccc-dddddddddddd'
    ];
    if (!global.crypto) global.crypto = {};
    global.crypto.randomUUID = jest.fn(function () {
      return uuids[counter++ % uuids.length];
    });

    loadBackground();
    var listener = getOnMessageListener();

    // 第一次 tab-open
    chrome.tabs.create.mockImplementation(function (opts, cb) {
      cb({ id: 100, title: 'Tab1' });
    });
    var resp1;
    listener(
      { action: 'tab-open', url: 'https://b1.com' },
      { id: chrome.runtime.id, tab: { id: 12, url: 'https://a.com' } },
      function (r) { resp1 = r; }
    );
    var calls1 = chrome.tabs.onUpdated.addListener.mock.calls;
    var onUpdated1 = calls1[calls1.length - 1][0];
    onUpdated1(100, { status: 'complete' }, { id: 100 });

    // 第二次 tab-open
    chrome.tabs.create.mockImplementation(function (opts, cb) {
      cb({ id: 101, title: 'Tab2' });
    });
    var resp2;
    listener(
      { action: 'tab-open', url: 'https://b2.com' },
      { id: chrome.runtime.id, tab: { id: 12, url: 'https://a.com' } },
      function (r) { resp2 = r; }
    );
    var calls2 = chrome.tabs.onUpdated.addListener.mock.calls;
    var onUpdated2 = calls2[calls2.length - 1][0];
    onUpdated2(101, { status: 'complete' }, { id: 101 });

    // 提取两次的 workflow_id 并断言不同
    function extractWorkflowId(str) {
      var m = /workflow: (wf_[a-f0-9]{8})/.exec(str);
      return m ? m[1] : null;
    }
    var id1 = extractWorkflowId(resp1);
    var id2 = extractWorkflowId(resp2);
    expect(id1).toMatch(/^wf_[a-f0-9]{8}$/);
    expect(id2).toMatch(/^wf_[a-f0-9]{8}$/);
    expect(id1).not.toBe(id2);

    // storage 中应同时存在两条记录
    var stored = chrome.storage.local._raw.active_workflows || {};
    expect(stored[id1]).toBeTruthy();
    expect(stored[id2]).toBeTruthy();
  });

  test('test 5: crypto.randomUUID 缺失时 fallback 到 Date.now+Math.random（仍以 wf_ 开头）', function () {
    // 删除 randomUUID — 模拟非 secure context（HTTP 页面，Pitfall 6）
    if (!global.crypto) global.crypto = {};
    var savedUuid = global.crypto.randomUUID;
    delete global.crypto.randomUUID;

    try {
      loadBackground();
      var listener = getOnMessageListener();

      var resp = triggerTabOpen(listener, { id: 99, title: 'fallback' });

      // 仍以 wf_ 开头
      expect(typeof resp).toBe('string');
      var m = /workflow: (wf_\w+)/.exec(resp);
      expect(m).toBeTruthy();
      expect(m[1].indexOf('wf_')).toBe(0);

      // storage 中也含该 key（可能不是 8 hex，但仍是 wf_ 前缀）
      var keys = Object.keys(chrome.storage.local._raw.active_workflows || {});
      expect(keys.some(function (k) { return k.indexOf('wf_') === 0; })).toBe(true);
    } finally {
      global.crypto.randomUUID = savedUuid;
    }
  });
});
