/**
 * Cross-origin session inheritance tests (NAV-06 / D-01 / D-02 / D-04)
 *
 * 验证 content-script.js initSession 在新 origin 加载时的跨域继承行为：
 *   1. 新 origin 加载且 lastActiveSessions 含他域 session → inherited 5 条 messages + 1 条 user-role marker
 *   2. system marker 文本为 '[Context inherited from {origin}]'，role 为 'user'（非 system）
 *   3. lastActiveSessions 不含他域条目 → initSession 不报错、不 push inherited
 *   4. lastActiveSessions 仅含当前 origin 自己 → 不重复 push 自己的历史
 *   5. inherited messages 是最后 5 条（slice(-5)），不是全部
 *
 * Phase 8 Plan 01 Task 3（RED）
 */

var helpers = require('./08-test-helpers.js');
var loadCsModules = helpers.loadCsModules;

/**
 * 在 chrome.storage.local._raw 中预置一条他域 session 数据
 * @param {string} sessionId
 * @param {string} origin
 * @param {Array} messages  完整 messages 数组
 * @param {number} updatedAt
 */
function seedSession(sessionId, origin, messages, updatedAt) {
  var sessions = chrome.storage.local._raw.gobySessions || {};
  sessions[sessionId] = {
    origin: origin,
    title: origin,
    updatedAt: updatedAt,
    messageCount: messages.length,
    preview: '',
    messages: messages
  };
  chrome.storage.local._raw.gobySessions = sessions;
}

/**
 * 在 chrome.storage.local._raw 中预置 lastActiveSessions 索引
 * @param {Array} entries [{ sessionId, origin, updatedAt }]
 */
function seedLastActiveSessions(entries) {
  chrome.storage.local._raw.lastActiveSessions = entries;
}

/**
 * 生成 N 条 user/assistant 交替消息
 */
function makeMessages(n) {
  var arr = [];
  for (var i = 0; i < n; i++) {
    arr.push({ role: 'user', content: 'msg-' + i });
    arr.push({ role: 'assistant', content: 'resp-' + i });
  }
  return arr;
}

describe('cross-origin session inheritance', function () {

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    delete chrome.runtime.lastError;
    document.body.innerHTML = '';
    chrome.runtime.sendMessage.mockResolvedValue({ ok: true });
    // 模拟 b.com 加载（jsdom window.location.origin 可直接赋值）
    window.location.origin = 'https://b.com';
  });

  // ---------------------------------------------------------------
  //  Test 1: 新 origin 加载 + lastActiveSessions 含他域 session
  //          → 5 条 inherited + 1 条 marker
  // ---------------------------------------------------------------
  test('new origin inherits 5 messages + 1 marker from cross-origin session', async function () {
    // 预置 a.com session（6 条非 system 消息，验证 slice(-5) 取最后 5 条）
    var aMessages = [
      { role: 'system', content: 'sys-prompt' }
    ].concat(makeMessages(3)); // 6 条非 system
    seedSession('session_a_1', 'https://a.com', aMessages, 2000);
    seedLastActiveSessions([
      { sessionId: 'session_a_1', origin: 'https://a.com', updatedAt: 2000 }
    ]);

    // loadCsModules 内 content-script.js IIFE 自动通过 GobyPanel.init().then(initSession) 触发
    loadCsModules();

    // 等待自动 initSession 的异步链（loadSession → storage.get → push）完成
    await new Promise(function (resolve) { setTimeout(resolve, 10); });

    var messages = window.__gobyInternals._agentState.messages;
    var nonSystem = messages.filter(function (m) { return m.role !== 'system'; });
    // 5 条 inherited + 1 条 user-role marker = 6 条
    expect(nonSystem.length).toBe(6);

    // marker 是第一条非 system 消息
    expect(nonSystem[0].role).toBe('user');
    expect(nonSystem[0].content).toBe('[Context inherited from https://a.com]');
  });

  // ---------------------------------------------------------------
  //  Test 2: system marker 文本与 role（非 system）
  // ---------------------------------------------------------------
  test('system marker uses user-role and correct text format', async function () {
    var aMessages = [
      { role: 'user', content: 'a-question' },
      { role: 'assistant', content: 'a-answer' }
    ];
    seedSession('session_a_1', 'https://a.com', aMessages, 2000);
    seedLastActiveSessions([
      { sessionId: 'session_a_1', origin: 'https://a.com', updatedAt: 2000 }
    ]);

    loadCsModules();

    await new Promise(function (resolve) { setTimeout(resolve, 10); });

    var messages = window.__gobyInternals._agentState.messages;
    // 找到 marker
    var marker = null;
    for (var i = 0; i < messages.length; i++) {
      if (typeof messages[i].content === 'string' &&
          messages[i].content.indexOf('[Context inherited from') === 0) {
        marker = messages[i];
        break;
      }
    }
    expect(marker).not.toBeNull();
    expect(marker.role).toBe('user'); // D-04: 非 system 避免污染 LLM
    expect(marker.content).toBe('[Context inherited from https://a.com]');
  });

  // ---------------------------------------------------------------
  //  Test 3: lastActiveSessions 不含任何他域条目 → 静默降级
  // ---------------------------------------------------------------
  test('no cross-origin session in index → empty session, no inherited messages', async function () {
    // 完全空白的 storage（新扩展首启）
    loadCsModules();

    await new Promise(function (resolve) { setTimeout(resolve, 10); });

    var messages = window.__gobyInternals._agentState.messages;
    // 仅含 createSession 注入的 system prompt，无任何 inherited
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('system');

    // 没有 marker
    var hasMarker = messages.some(function (m) {
      return typeof m.content === 'string' &&
        m.content.indexOf('[Context inherited from') === 0;
    });
    expect(hasMarker).toBe(false);
  });

  // ---------------------------------------------------------------
  //  Test 4: lastActiveSessions 仅含当前 origin 自己 → 不重复 push 自己
  // ---------------------------------------------------------------
  test('index only contains current origin → no inheritance push', async function () {
    // 当前 origin 是 b.com，索引中只有 b.com 条目
    seedLastActiveSessions([
      { sessionId: 'session_b_1', origin: 'https://b.com', updatedAt: 1000 }
    ]);

    loadCsModules();

    await new Promise(function (resolve) { setTimeout(resolve, 10); });

    var messages = window.__gobyInternals._agentState.messages;
    // 仅含 createSession 注入的 system prompt
    expect(messages.length).toBe(1);

    // 没有 marker（不应继承自己 origin 的历史）
    var hasMarker = messages.some(function (m) {
      return typeof m.content === 'string' &&
        m.content.indexOf('[Context inherited from') === 0;
    });
    expect(hasMarker).toBe(false);
  });

  // ---------------------------------------------------------------
  //  Test 5: inherited messages 是 slice(-5)，不是全部
  // ---------------------------------------------------------------
  test('inherited messages are last 5 (slice(-5)), not all', async function () {
    // 预置 10 条 user/assistant 消息（共 20 条非 system）
    var manyMessages = [
      { role: 'system', content: 'sys-prompt' }
    ];
    for (var i = 0; i < 10; i++) {
      manyMessages.push({ role: 'user', content: 'q-' + i });
      manyMessages.push({ role: 'assistant', content: 'a-' + i });
    }
    // 总共 21 条；slice(-5) 取索引 16..20 = [a7, q8, a8, q9, a9]
    seedSession('session_a_big', 'https://a.com', manyMessages, 2000);
    seedLastActiveSessions([
      { sessionId: 'session_a_big', origin: 'https://a.com', updatedAt: 2000 }
    ]);

    loadCsModules();

    await new Promise(function (resolve) { setTimeout(resolve, 10); });

    var messages = window.__gobyInternals._agentState.messages;
    var nonSystem = messages.filter(function (m) { return m.role !== 'system'; });

    // 1 marker + 5 inherited = 6 条
    expect(nonSystem.length).toBe(6);

    // inherited 是 marker 之后的 5 条
    var inherited = nonSystem.slice(1);
    expect(inherited.length).toBe(5);
    var contents = inherited.map(function (m) { return m.content; });
    expect(contents).toEqual(['a-7', 'q-8', 'a-8', 'q-9', 'a-9']);
  });

});
