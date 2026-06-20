/**
 * Background Service Worker tests — save-session handler (Fix C)
 *
 * Fix C 把 saveSession 从 content-script 直接写 storage 改为委托 SW 完成。
 * SW 寿命长于 page，整页 navigation 后 SW 仍能完成 storage.set + LRU 淘汰，
 * 根治"navigation 截断 storage 写入导致会话丢失"问题。
 *
 * 这些测试直接驱动 background.js 注册的 chrome.runtime.onMessage listener，
 * 验证 save-session handler 的合并写入 + LRU 淘汰行为。
 */

// Polyfill TextEncoder/TextDecoder for jsdom
var { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Load chrome mock
require('./__mocks__/chrome.js');

/**
 * Load background.js — 触发 IIFE 注册 chrome.runtime.onMessage listener
 */
function loadBackground() {
  jest.isolateModules(function () {
    require('../background.js');
  });
}

/**
 * 获取 background.js 注册的 onMessage listener
 */
function getOnMessageListener() {
  expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
  var calls = chrome.runtime.onMessage.addListener.mock.calls;
  // 找最后一个 listener（jest.resetModules 后重载会重新注册）
  return calls[calls.length - 1][0];
}

/**
 * 构造模拟 sessionData
 */
function makeSessionData(origin, updatedAt, preview) {
  return {
    origin: origin,
    title: origin.replace('https://', ''),
    updatedAt: updatedAt,
    messageCount: 2,
    preview: preview || 'hello',
    messages: [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: preview || 'hello' },
      { role: 'assistant', content: 'hi' }
    ]
  };
}

// ================================================================
//   save-session handler
// ================================================================

describe('Background SW save-session handler', function () {

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
  });

  // ---------------------------------------------------------------
  //  Test 1: save-session 合并写入 storage
  //  SW 收到 save-session 后，读取现有 gobySessions → 合并 → 写入
  // ---------------------------------------------------------------
  test('Test 1: save-session merges and writes session to chrome.storage.local', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    // 预置一条已有会话
    var existingData = makeSessionData('https://old.example.com', 1000, 'old message');
    await chrome.storage.local.set({ gobySessions: { session_old_1: existingData } });

    // 构造 sendResponse Promise
    var responsePromise = new Promise(function (resolve) {
      var msg = {
        action: 'save-session',
        sessionId: 'session_new_1',
        sessionData: makeSessionData('https://new.example.com', 2000, 'new message')
      };
      var sender = { id: chrome.runtime.id, tab: { id: 1 } };
      var ret = listener(msg, sender, resolve);
      // listener returns true 表示异步响应
      expect(ret).toBe(true);
    });

    var response = await responsePromise;

    // SW 应返回 ok:true
    expect(response).toEqual({ ok: true });

    // 验证 storage 中两条会话都在
    var result = await chrome.storage.local.get('gobySessions');
    var sessions = result.gobySessions || {};
    expect(Object.keys(sessions).length).toBe(2);
    expect(sessions.session_old_1).toBeDefined();
    expect(sessions.session_old_1.preview).toBe('old message');
    expect(sessions.session_new_1).toBeDefined();
    expect(sessions.session_new_1.preview).toBe('new message');
  });

  // ---------------------------------------------------------------
  //  Test 2: save-session 缺 sessionId 或 sessionData 返回 ok:false
  // ---------------------------------------------------------------
  test('Test 2: save-session rejects missing sessionId/sessionData', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      listener({ action: 'save-session', sessionId: null, sessionData: null }, { id: chrome.runtime.id }, resolve);
    });

    var response = await responsePromise;
    expect(response.ok).toBe(false);
    expect(response.error).toBeDefined();
  });

  // ---------------------------------------------------------------
  //  Test 3: save-session LRU 淘汰 — 超过 50 条时删最旧
  // ---------------------------------------------------------------
  test('Test 3: save-session LRU evicts oldest when exceeding 50 sessions', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    // 预置 50 条会话，updatedAt 从 1000 递增
    var initial = {};
    for (var i = 0; i < 50; i++) {
      var id = 'session_' + i;
      initial[id] = makeSessionData('https://example' + i + '.com', 1000 + i, 'msg ' + i);
    }
    await chrome.storage.local.set({ gobySessions: initial });

    // 触发 save-session，新增第 51 条（updatedAt 最大）
    var responsePromise = new Promise(function (resolve) {
      listener({
        action: 'save-session',
        sessionId: 'session_new_51',
        sessionData: makeSessionData('https://new51.example.com', 99999, 'newest')
      }, { id: chrome.runtime.id }, resolve);
    });

    var response = await responsePromise;
    expect(response).toEqual({ ok: true });

    var result = await chrome.storage.local.get('gobySessions');
    var sessions = result.gobySessions || {};

    // 总数仍是 50（淘汰 1 条最旧）
    expect(Object.keys(sessions).length).toBe(50);

    // 最旧的那条（session_0, updatedAt=1000）应被淘汰
    expect(sessions.session_0).toBeUndefined();

    // 新加的那条应存在
    expect(sessions.session_new_51).toBeDefined();
    expect(sessions.session_new_51.preview).toBe('newest');

    // 第二旧的（session_1, updatedAt=1001）应保留
    expect(sessions.session_1).toBeDefined();
  });

  // ---------------------------------------------------------------
  //  Test 4: save-session ≤ 50 条时不触发淘汰
  // ---------------------------------------------------------------
  test('Test 4: save-session does not evict when total <= 50', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    // 预置 49 条
    var initial = {};
    for (var i = 0; i < 49; i++) {
      initial['session_' + i] = makeSessionData('https://example' + i + '.com', 1000 + i, 'msg ' + i);
    }
    await chrome.storage.local.set({ gobySessions: initial });

    var responsePromise = new Promise(function (resolve) {
      listener({
        action: 'save-session',
        sessionId: 'session_49',
        sessionData: makeSessionData('https://example49.com', 1049, 'msg 49')
      }, { id: chrome.runtime.id }, resolve);
    });

    var response = await responsePromise;
    expect(response).toEqual({ ok: true });

    var result = await chrome.storage.local.get('gobySessions');
    expect(Object.keys(result.gobySessions).length).toBe(50);
    expect(result.gobySessions.session_0).toBeDefined();
    expect(result.gobySessions.session_49).toBeDefined();
  });

  // ---------------------------------------------------------------
  //  Test 5: save-session 覆盖同 sessionId（更新而非新增）
  // ---------------------------------------------------------------
  test('Test 5: save-session overwrites existing sessionId with new data', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    await chrome.storage.local.set({
      gobySessions: {
        session_x: makeSessionData('https://x.example.com', 1000, 'old preview')
      }
    });

    var responsePromise = new Promise(function (resolve) {
      listener({
        action: 'save-session',
        sessionId: 'session_x',
        sessionData: makeSessionData('https://x.example.com', 2000, 'new preview')
      }, { id: chrome.runtime.id }, resolve);
    });

    var response = await responsePromise;
    expect(response).toEqual({ ok: true });

    var result = await chrome.storage.local.get('gobySessions');
    expect(Object.keys(result.gobySessions).length).toBe(1);
    expect(result.gobySessions.session_x.preview).toBe('new preview');
    expect(result.gobySessions.session_x.updatedAt).toBe(2000);
  });

  // ---------------------------------------------------------------
  //  Test 6: 验证其他扩展来源消息被忽略（sender.id !== chrome.runtime.id）
  // ---------------------------------------------------------------
  test('Test 6: ignores messages from non-extension senders', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      // sender.id 不匹配 — listener 应 return false 不调 sendResponse
      var ret = listener(
        { action: 'save-session', sessionId: 'x', sessionData: { origin: 'x' } },
        { id: 'unknown-extension-id' },
        resolve
      );
      expect(ret).toBe(false);
      // 给 listener 一个 tick 时间，确认 sendResponse 没被调用
      setTimeout(function () { resolve({ __skipped: true }); }, 10);
    });

    var response = await responsePromise;
    expect(response.__skipped).toBe(true);

    // storage 不应被写入
    var result = await chrome.storage.local.get('gobySessions');
    expect(result.gobySessions).toBe(null);
  });

});
