/**
 * Session Management tests — session CRUD, LRU eviction, sidebar UI
 *
 * Tests cover SESS-01, SESS-02, SESS-03, SESS-04, PANEL-08 requirements:
 * - DJB2 hash origin → deterministic session prefix
 * - createSession format: session_{djb2hash}_{timestamp}
 * - saveSession to chrome.storage.local key 'gobySessions'
 * - loadSession: load latest session for origin
 * - URL change (popstate/hashchange) → save + load
 * - 50 session LRU eviction via cleanupOldSessions
 * - Sidebar rendering, search, switch, delete, new, clear-all
 * - Session preview: first user message first 30 chars
 *
 * RED Phase: All 14 tests fail (session functions not yet implemented)
 * GREEN Phase: All 14 tests pass after Task 2 & Task 3 implementation
 */

// Polyfill TextEncoder/TextDecoder for jsdom
var { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Load chrome mock
require('./__mocks__/chrome.js');

/**
 * Load extension modules in dependency order
 */
function loadModules() {
  var purifyFactory = require('../lib/purify.min.js');
  window.DOMPurify = purifyFactory(window);
  window.marked = require('../lib/marked.min.js');
  require('../storage.js');
  require('../panel.js');
  require('../content-script.js');
}

/**
 * Helper: create a mock session data structure
 */
function createMockSession(origin, timestamp, userMessageText, msgCount) {
  var messages = [{ role: 'system', content: 'You are Goby' }];
  var count = msgCount || 3;
  for (var i = 0; i < count; i++) {
    messages.push({ role: 'user', content: i === 0 ? userMessageText : '消息 ' + i });
    messages.push({ role: 'assistant', content: '回复 ' + i });
  }
  return {
    origin: origin,
    title: new URL(origin).hostname,
    updatedAt: timestamp,
    messageCount: count * 2,
    preview: userMessageText ? userMessageText.substring(0, 30) : '',
    messages: messages
  };
}

// ================================================================
//   Session ID Generation
//   Tests 1-2: DJB2 hash consistency, createSession format
// ================================================================

describe('Session ID Generation', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    // Mock chrome.runtime.sendMessage to avoid unhandled promise rejections
    chrome.runtime.sendMessage.mockResolvedValue(undefined);
  });

  // ---------------------------------------------------------------
  //  Test 1: sessionIdForOrigin returns deterministic DJB2 hash
  //  Same origin → same result across multiple calls
  // ---------------------------------------------------------------
  test('Test 1: sessionIdForOrigin returns consistent DJB2 hash for same origin', function () {
    loadModules();

    expect(window.GobyAgent).toBeDefined();
    // RED: sessionIdForOrigin not implemented
    expect(typeof window.GobyAgent.sessionIdForOrigin).toBe('function');

    var origin1 = 'https://i.zte.com.cn';
    var origin2 = 'https://example.com';

    var hash1 = window.GobyAgent.sessionIdForOrigin(origin1);
    var hash1b = window.GobyAgent.sessionIdForOrigin(origin1);
    var hash2 = window.GobyAgent.sessionIdForOrigin(origin2);

    // Same origin → same hash every time
    expect(hash1).toBe(hash1b);
    // Different origin → different hash
    expect(hash1).not.toBe(hash2);
    // Hash starts with 'session_'
    expect(hash1).toMatch(/^session_/);
  });

  // ---------------------------------------------------------------
  //  Test 2: createSession returns 'session_{djb2hash}_{timestamp}'
  // ---------------------------------------------------------------
  test('Test 2: createSession returns session_{hash}_{timestamp} format', function () {
    loadModules();

    expect(window.GobyAgent).toBeDefined();
    // RED: createSession not implemented
    expect(typeof window.GobyAgent.createSession).toBe('function');

    var origin = 'https://i.zte.com.cn';
    var sessionId = window.GobyAgent.createSession(origin);

    // Format: session_{hash}_{timestamp}
    expect(typeof sessionId).toBe('string');
    expect(sessionId).toMatch(/^session_[a-z0-9]+_\d+$/);

    // Same origin should have same prefix (djb2 hash part)
    var sessionId2 = window.GobyAgent.createSession(origin);
    var prefix1 = sessionId.substring(0, sessionId.lastIndexOf('_'));
    var prefix2 = sessionId2.substring(0, sessionId2.lastIndexOf('_'));
    expect(prefix1).toBe(prefix2);
  });
});

// ================================================================
//   Session Persistence
//   Tests 3-6: saveSession, loadSession, URL change
// ================================================================

describe('Session Persistence', function () {
  function flushMicrotasks() {
    return new Promise(function (resolve) { setTimeout(resolve, 50); });
  }

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    chrome.runtime.sendMessage.mockResolvedValue(undefined);
  });

  // ---------------------------------------------------------------
  //  Test 3: saveSession saves state.messages to chrome.storage.local
  //  Key: 'gobySessions', includes origin/title/updatedAt/messageCount/preview
  // ---------------------------------------------------------------
  test('Test 3: saveSession stores messages with metadata to chrome.storage.local', async function () {
    loadModules();

    expect(window.GobyAgent).toBeDefined();
    // RED: saveSession not implemented
    expect(typeof window.GobyAgent.saveSession).toBe('function');

    // Set up state with some messages
    var origin = 'https://example.com';
    window.GobyAgent.createSession(origin);

    // Add some messages (simulate user interaction)
    // Access internal state to push messages
    var state = window.GobyAgent.getState();
    // Actually, after createSession, state.messages should have system prompt + we can push user message
    // We need to push messages for save to work with preview

    // We'll work directly with the state
    var internalState = window.__gobyInternals && window.__gobyInternals._agentState;
    if (internalState) {
      // createSession already set system prompt
      // Add a user message for preview
      internalState.messages.push({ role: 'user', content: '帮我搜索需求文档' });
      internalState.messages.push({ role: 'assistant', content: '好的，我来搜索' });
      internalState.activeOrigin = origin;
    }

    await window.GobyAgent.saveSession();

    // Check chrome.storage.local was written
    expect(chrome.storage.local.set).toHaveBeenCalled();

    // Find call with gobySessions key
    var sessionCalls = chrome.storage.local.set.mock.calls.filter(function (call) {
      return call[0] && call[0].gobySessions;
    });
    expect(sessionCalls.length).toBeGreaterThan(0);

    var savedSessions = sessionCalls[0][0].gobySessions;
    var sessionKeys = Object.keys(savedSessions);
    expect(sessionKeys.length).toBeGreaterThan(0);

    var saved = savedSessions[sessionKeys[0]];
    expect(saved.origin).toBe(origin);
    expect(saved.title).toBeDefined();
    expect(saved.updatedAt).toBeGreaterThan(0);
    expect(saved.messageCount).toBeGreaterThan(0);
    expect(saved.preview).toBeDefined();
    expect(saved.messages).toBeDefined();
    expect(Array.isArray(saved.messages)).toBe(true);
  });

  // ---------------------------------------------------------------
  //  Test 4: loadSession loads latest session by origin, restores messages
  // ---------------------------------------------------------------
  test('Test 4: loadSession loads latest session for origin', async function () {
    loadModules();

    expect(window.GobyAgent).toBeDefined();
    // RED: loadSession not implemented
    expect(typeof window.GobyAgent.loadSession).toBe('function');

    // Pre-populate storage with sessions
    var origin = 'https://example.com';
    var sessions = {};
    var sessionHashPrefix = 'session_abc123';

    // Older session
    var olderSession = createMockSession(origin, 100, '旧消息', 2);
    sessions[sessionHashPrefix + '_100'] = olderSession;

    // Newer session
    var newerSession = createMockSession(origin, 200, '新消息', 3);
    sessions[sessionHashPrefix + '_200'] = newerSession;

    await chrome.storage.local.set({ gobySessions: sessions });

    // loadSession should return the newer one
    var result = await window.GobyAgent.loadSession(origin);

    // RED: loadSession likely returns null or doesn't restore messages
    expect(result).not.toBeNull();

    // Check state was restored with messages from the newer session
    var state = window.GobyAgent.getState();
    expect(state.messages.length).toBeGreaterThan(0);
    expect(state.activeOrigin).toBe(origin);
  });

  // ---------------------------------------------------------------
  //  Test 5: First visit returns null, triggers createSession
  // ---------------------------------------------------------------
  test('Test 5: loadSession returns null when no session exists for origin', async function () {
    loadModules();

    expect(window.GobyAgent).toBeDefined();
    expect(typeof window.GobyAgent.loadSession).toBe('function');

    var origin = 'https://new-site.example.com';

    // No sessions exist for this origin
    var result = await window.GobyAgent.loadSession(origin);

    // RED: loadSession might not return null
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------
  //  Test 6: URL change triggers saveSession + loadSession
  // ---------------------------------------------------------------
  test('Test 6: popstate/hashchange triggers save + load session', async function () {
    loadModules();

    // RED: URL change event handlers not wired
    // We need to verify that window has popstate/hashchange listeners
    // that call saveSession and loadSession

    var saveSpy = jest.spyOn(window.GobyAgent, 'saveSession');
    var loadSpy = jest.spyOn(window.GobyAgent, 'loadSession');
    // Mock location origin
    var originalOrigin = window.location.origin;
    window.location.origin = 'https://example.com';

    window.GobyAgent.createSession('https://example.com');

    saveSpy.mockClear();
    loadSpy.mockClear();

    // Simulate popstate
    window.dispatchEvent(new Event('popstate'));

    await flushMicrotasks();

    // RED: No event listeners → spies not called
    expect(saveSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();

    saveSpy.mockRestore();
    loadSpy.mockRestore();
  });
});

// ================================================================
//   Session LRU Eviction
//   Test 7: 50 session limit + cleanupOldSessions
// ================================================================

describe('Session LRU Eviction', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    chrome.runtime.sendMessage.mockResolvedValue(undefined);
  });

  // ---------------------------------------------------------------
  //  Test 7: >50 sessions → oldest removed (LRU)
  // ---------------------------------------------------------------
  test('Test 7: cleanupOldSessions removes oldest when over 50', async function () {
    loadModules();

    expect(window.GobyAgent).toBeDefined();
    // RED: cleanupOldSessions not implemented
    expect(typeof window.GobyAgent.cleanupOldSessions).toBe('function');

    // Create 55 sessions (5 different origins, 11 each)
    var sessions = {};
    var ts = 1000;
    for (var i = 0; i < 55; i++) {
      var origin = 'https://site' + (i % 5) + '.com';
      var sessionKey = 'session_hash' + i + '_' + (ts + i);
      sessions[sessionKey] = createMockSession(origin, ts + i, '消息 ' + i, 2);
    }
    await chrome.storage.local.set({ gobySessions: sessions });

    await window.GobyAgent.cleanupOldSessions();

    // Check that storage now has at most 50 sessions
    var result = await chrome.storage.local.get('gobySessions');
    var remaining = result.gobySessions || {};
    var keys = Object.keys(remaining);
    expect(keys.length).toBeLessThanOrEqual(50);

    // The 5 oldest (earliest timestamps) should be removed
    // Oldest: i=0..4 (ts 1000..1004)
    // Since timestamps increase, the first 5 should be gone
    var removedKeys = ['session_hash0_1000', 'session_hash1_1001', 'session_hash2_1002', 'session_hash3_1003', 'session_hash4_1004'];
    for (var j = 0; j < removedKeys.length; j++) {
      expect(remaining[removedKeys[j]]).toBeUndefined();
    }
  });
});

// ================================================================
//   Session Sidebar UI
//   Tests 8-14: sidebar rendering, search, switch, delete, new, clear
// ================================================================

describe('Session Sidebar UI', function () {
  function flushMicrotasks() {
    return new Promise(function (resolve) { setTimeout(resolve, 50); });
  }

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    chrome.runtime.sendMessage.mockResolvedValue(undefined);
  });

  function loadModulesWithPanel() {
    loadModules();
    // Trigger panel creation by calling show
    return window.GobyPanel.show();
  }

  // ---------------------------------------------------------------
  //  Test 8: Sidebar renders session list with origin, preview, delete btn
  // ---------------------------------------------------------------
  test('Test 8: sidebar renders session items with origin, preview, delete button', async function () {
    await loadModulesWithPanel();

    // RED: GobyPanel.toggleSessionSidebar not implemented
    expect(typeof window.GobyPanel.toggleSessionSidebar).toBe('function');
    expect(typeof window.GobyPanel.renderSessionList).toBe('function');

    // Pre-populate storage with sessions
    var sessions = {};
    sessions['session_a_100'] = createMockSession('https://example.com', 100, '第一条会话消息', 3);
    sessions['session_b_200'] = createMockSession('https://test.org', 200, '测试会话', 2);
    await chrome.storage.local.set({ gobySessions: sessions });

    // Open sidebar (which should render list)
    window.GobyPanel.toggleSessionSidebar();

    await flushMicrotasks();

    var shadow = window.GobyPanel._shadowRoot;
    expect(shadow).not.toBeNull();

    // Check sidebar exists
    var sidebar = shadow.querySelector('.goby-session-sidebar');
    // RED: Sidebar DOM not created
    expect(sidebar).not.toBeNull();

    // Check session items exist
    var items = shadow.querySelectorAll('.goby-session-item');
    expect(items.length).toBeGreaterThan(0);

    // Check origin text is shown
    var originEls = shadow.querySelectorAll('.goby-session-origin');
    expect(originEls.length).toBeGreaterThan(0);

    // Check preview text is shown
    var previewEls = shadow.querySelectorAll('.goby-session-preview');
    expect(previewEls.length).toBeGreaterThan(0);

    // Check delete buttons exist
    var deleteBtns = shadow.querySelectorAll('.goby-session-delete-btn');
    expect(deleteBtns.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  //  Test 9: Search input filters session list (fuzzy match)
  // ---------------------------------------------------------------
  test('Test 9: search input filters session list by origin/title/preview', async function () {
    await loadModulesWithPanel();

    // RED: search filtering not implemented
    expect(typeof window.GobyPanel.renderSessionList).toBe('function');

    // Pre-populate with sessions from different domains
    var sessions = {};
    sessions['session_a'] = createMockSession('https://example.com', 100, '你好世界', 2);
    sessions['session_b'] = createMockSession('https://test.org', 200, '测试消息', 2);
    sessions['session_c'] = createMockSession('https://other.com', 300, '其他内容', 2);
    await chrome.storage.local.set({ gobySessions: sessions });

    // Open sidebar
    window.GobyPanel.toggleSessionSidebar();
    await flushMicrotasks();

    var shadow = window.GobyPanel._shadowRoot;
    expect(shadow).not.toBeNull();

    // Find search input
    var searchInput = shadow.querySelector('.goby-sidebar-search input');
    // RED: Sidebar not created
    expect(searchInput).not.toBeNull();

    // Simulate typing search text
    searchInput.value = 'example';
    searchInput.dispatchEvent(new Event('input'));

    await flushMicrotasks();

    // After filtering, only matching sessions should be visible
    var items = shadow.querySelectorAll('.goby-session-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('example');
  });

  // ---------------------------------------------------------------
  //  Test 10: Click session item → switch to that session
  // ---------------------------------------------------------------
  test('Test 10: clicking session item switches to selected session', async function () {
    await loadModulesWithPanel();

    // RED: session switching not implemented
    expect(typeof window.GobyAgent.switchToSession).toBe('function');

    // Pre-populate with sessions
    var sessions = {};
    sessions['session_a_100'] = createMockSession('https://example.com', 100, '会话A内容', 2);
    sessions['session_b_200'] = createMockSession('https://example.com', 200, '会话B内容', 3);
    await chrome.storage.local.set({ gobySessions: sessions });

    var switchSpy = jest.spyOn(window.GobyAgent, 'switchToSession');

    // Open sidebar
    window.GobyPanel.toggleSessionSidebar();
    await flushMicrotasks();

    var shadow = window.GobyPanel._shadowRoot;
    expect(shadow).not.toBeNull();

    // Click second session item
    var items = shadow.querySelectorAll('.goby-session-item');
    if (items.length >= 2) {
      items[1].click();
    }

    await flushMicrotasks();

    // RED: switchToSession not called
    expect(switchSpy).toHaveBeenCalled();

    // After switching, sidebar should close
    var sidebar = shadow.querySelector('.goby-session-sidebar');
    // RED: sidebar stays open or session switch not working
    expect(sidebar.className).not.toContain('open');

    switchSpy.mockRestore();
  });

  // ---------------------------------------------------------------
  //  Test 11: Delete button → confirm → delete session
  // ---------------------------------------------------------------
  test('Test 11: delete button click with confirm deletes session', async function () {
    await loadModulesWithPanel();

    // RED: delete button not wired
    expect(typeof window.GobyAgent.deleteSession).toBe('function');

    // Pre-populate storage
    var sessions = {};
    sessions['session_del_100'] = createMockSession('https://example.com', 100, '待删除会话', 2);
    await chrome.storage.local.set({ gobySessions: sessions });

    // Mock confirm to accept
    var originalConfirm = window.confirm;
    window.confirm = jest.fn().mockReturnValue(true);

    // Open sidebar
    window.GobyPanel.toggleSessionSidebar();
    await flushMicrotasks();

    var shadow = window.GobyPanel._shadowRoot;
    expect(shadow).not.toBeNull();

    var deleteSpy = jest.spyOn(window.GobyAgent, 'deleteSession');

    // Click delete button on the session item
    var deleteBtns = shadow.querySelectorAll('.goby-session-delete-btn');
    if (deleteBtns.length > 0) {
      deleteBtns[0].click();
    }

    await flushMicrotasks();

    // RED: deleteSession not called
    expect(deleteSpy).toHaveBeenCalled();
    // Verify session was removed from storage
    var result = await chrome.storage.local.get('gobySessions');
    var remaining = result.gobySessions || {};
    expect(Object.keys(remaining).length).toBe(0);

    deleteSpy.mockRestore();
    window.confirm = originalConfirm;
  });

  // ---------------------------------------------------------------
  //  Test 12: New session button creates new session
  // ---------------------------------------------------------------
  test('Test 12: new session button creates and switches to new session', async function () {
    await loadModulesWithPanel();

    // RED: new session button not wired
    var createSpy = jest.spyOn(window.GobyAgent, 'createSession');

    // Open sidebar
    window.GobyPanel.toggleSessionSidebar();
    await flushMicrotasks();

    var shadow = window.GobyPanel._shadowRoot;
    expect(shadow).not.toBeNull();

    var newBtn = shadow.querySelector('.goby-sidebar-new-btn');
    // RED: new btn not created
    expect(newBtn).not.toBeNull();

    newBtn.click();

    await flushMicrotasks();

    // RED: createSession not called
    expect(createSpy).toHaveBeenCalled();

    createSpy.mockRestore();
  });

  // ---------------------------------------------------------------
  //  Test 13: Clear all button deletes all sessions
  // ---------------------------------------------------------------
  test('Test 13: clear all button removes all sessions', async function () {
    await loadModulesWithPanel();

    // RED: clear all button not wired
    expect(typeof window.GobyAgent.deleteAllSessions).toBe('function');

    // Pre-populate with sessions
    var sessions = {};
    sessions['session_x'] = createMockSession('https://x.com', 100, 'X消息', 2);
    sessions['session_y'] = createMockSession('https://y.com', 200, 'Y消息', 2);
    await chrome.storage.local.set({ gobySessions: sessions });

    // Mock confirm
    var originalConfirm = window.confirm;
    window.confirm = jest.fn().mockReturnValue(true);

    // Open sidebar
    window.GobyPanel.toggleSessionSidebar();
    await flushMicrotasks();

    var shadow = window.GobyPanel._shadowRoot;
    expect(shadow).not.toBeNull();

    var clearBtn = shadow.querySelector('.goby-sidebar-clear-btn');
    // RED: clear btn not created
    expect(clearBtn).not.toBeNull();

    clearBtn.click();

    await flushMicrotasks();

    // Verify all sessions removed
    var result = await chrome.storage.local.get('gobySessions');
    var remaining = result.gobySessions || {};
    expect(Object.keys(remaining).length).toBe(0);

    window.confirm = originalConfirm;
  });

  // ---------------------------------------------------------------
  //  Test 14: Session preview = first user message first 30 chars
  // ---------------------------------------------------------------
  test('Test 14: session preview shows first user message first 30 chars', async function () {
    loadModules();

    // RED: session preview logic not implemented
    expect(typeof window.GobyAgent.saveSession).toBe('function');

    var origin = 'https://example.com';
    window.GobyAgent.createSession(origin);

    // Add messages with a longer user message
    var internalState = window.__gobyInternals && window.__gobyInternals._agentState;
    if (internalState) {
      internalState.activeOrigin = origin;
      internalState.messages.push({
        role: 'user',
        content: '帮我搜索需求文档中关于合同管理的部分，我需要找到最新的合同模板'
      });
      internalState.messages.push({ role: 'assistant', content: '好的，我来搜索' });
    }

    await window.GobyAgent.saveSession();

    // Verify preview is first 30 chars of first user message
    var result = await chrome.storage.local.get('gobySessions');
    var sessions = result.gobySessions || {};
    var keys = Object.keys(sessions);
    expect(keys.length).toBeGreaterThan(0);

    var saved = sessions[keys[0]];
    expect(saved.preview).toBe('帮我搜索需求文档中关于合同管理的');
  });
});
