/**
 * lastActiveSessions index maintenance tests (NAV-06 / D-03)
 *
 * 验证 SW save-session handler 同步维护 chrome.storage.local['lastActiveSessions']:
 *   1. save-session 后索引含一条 { sessionId, origin, updatedAt } 记录
 *   2. 不同 sessionId 多次保存 → 索引条数对应增长
 *   3. LRU 淘汰：超过 10 条时最旧的被移除
 *   4. 同 sessionId 多次保存 → 索引仅 1 条（去重 + updatedAt 刷新）
 *   5. 索引按 updatedAt desc 排序（最新在前）
 *
 * Phase 8 Plan 01 Task 1（RED）
 */

var helpers = require('./08-test-helpers.js');
var loadBackground = helpers.loadBackground;
var getOnMessageListener = helpers.getOnMessageListener;

// 触发 save-session handler 的辅助函数：返回 Promise<response>
function triggerSaveSession(listener, sessionId, origin, updatedAt) {
  var sessionData = {
    origin: origin,
    title: origin,
    updatedAt: updatedAt,
    messageCount: 2,
    preview: 'msg',
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'msg' }
    ]
  };
  return new Promise(function (resolve) {
    listener(
      { action: 'save-session', sessionId: sessionId, sessionData: sessionData },
      { id: chrome.runtime.id, tab: { id: 1 } },
      resolve
    );
  });
}

describe('lastActiveSessions index maintenance', function () {

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    delete chrome.runtime.lastError;
  });

  // ---------------------------------------------------------------
  //  Test 1: 单次 save-session 后索引含一条记录
  // ---------------------------------------------------------------
  test('save-session writes one entry to lastActiveSessions index', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    var response = await triggerSaveSession(listener, 's1', 'https://a.com', 1000);
    expect(response).toEqual({ ok: true });

    var raw = chrome.storage.local._raw.lastActiveSessions;
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.length).toBe(1);
    expect(raw[0].sessionId).toBe('s1');
    expect(raw[0].origin).toBe('https://a.com');
    expect(raw[0].updatedAt).toBe(1000);
  });

  // ---------------------------------------------------------------
  //  Test 2: 连续 2 次 save-session 不同 sessionId → 2 条
  // ---------------------------------------------------------------
  test('two save-session with different sessionId produce 2 index entries', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    await triggerSaveSession(listener, 's1', 'https://a.com', 1000);
    await triggerSaveSession(listener, 's2', 'https://b.com', 2000);

    var raw = chrome.storage.local._raw.lastActiveSessions;
    expect(raw.length).toBe(2);
  });

  // ---------------------------------------------------------------
  //  Test 3: LRU 淘汰 — 11 次不同 sessionId → 索引最多 10 条
  // ---------------------------------------------------------------
  test('LRU eviction: 11 different sessions → index capped at 10', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    for (var i = 0; i < 11; i++) {
      await triggerSaveSession(listener, 's' + i, 'https://o' + i + '.com', 1000 + i);
    }

    var raw = chrome.storage.local._raw.lastActiveSessions;
    expect(raw.length).toBe(10);
    // 最旧的 's0' 应该已被淘汰
    var sessionIds = raw.map(function (e) { return e.sessionId; });
    expect(sessionIds).not.toContain('s0');
    // 最新的 's10' 应当在索引中
    expect(sessionIds).toContain('s10');
  });

  // ---------------------------------------------------------------
  //  Test 4: 同 sessionId 多次保存 → 索引仅 1 条（去重 + updatedAt 刷新）
  // ---------------------------------------------------------------
  test('same sessionId saved multiple times → only 1 entry with updated timestamp', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    await triggerSaveSession(listener, 's1', 'https://a.com', 1000);
    await triggerSaveSession(listener, 's1', 'https://a.com', 5000);
    await triggerSaveSession(listener, 's1', 'https://a.com', 9000);

    var raw = chrome.storage.local._raw.lastActiveSessions;
    expect(raw.length).toBe(1);
    expect(raw[0].sessionId).toBe('s1');
    expect(raw[0].updatedAt).toBe(9000);
  });

  // ---------------------------------------------------------------
  //  Test 5: 索引按 updatedAt desc 排序（最新在前）
  // ---------------------------------------------------------------
  test('index is sorted by updatedAt desc (most recent first)', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    // 故意乱序写入
    await triggerSaveSession(listener, 's_old', 'https://a.com', 1000);
    await triggerSaveSession(listener, 's_newest', 'https://b.com', 5000);
    await triggerSaveSession(listener, 's_middle', 'https://c.com', 3000);

    var raw = chrome.storage.local._raw.lastActiveSessions;
    expect(raw.length).toBe(3);
    expect(raw[0].sessionId).toBe('s_newest');
    expect(raw[0].updatedAt).toBe(5000);
    expect(raw[1].sessionId).toBe('s_middle');
    expect(raw[1].updatedAt).toBe(3000);
    expect(raw[2].sessionId).toBe('s_old');
    expect(raw[2].updatedAt).toBe(1000);
  });

});
