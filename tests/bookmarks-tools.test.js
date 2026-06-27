/**
 * Bookmarks Tools tests — bookmarks_search, bookmarks_list_tree, bookmarks_recent
 *
 * 260627-jbi: 让 LLM 能检索用户 Chrome 收藏夹
 *
 * Tests cover:
 * - SW message handler for each bookmarks action (bookmarks-search/bookmarks-tree/bookmarks-recent)
 * - Content Script nativeTools definitions for the 3 new tools
 */

// Polyfill TextEncoder/TextDecoder for jsdom
var { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Load chrome mock
require('./__mocks__/chrome.js');

/**
 * Load background.js — trigger IIFE to register onMessage listener
 */
function loadBackground() {
  jest.isolateModules(function () {
    require('../background.js');
  });
}

/**
 * Get the onMessage listener registered by background.js
 */
function getOnMessageListener() {
  expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
  var calls = chrome.runtime.onMessage.addListener.mock.calls;
  return calls[calls.length - 1][0];
}

/**
 * Load extension modules for CS tool definition tests
 */
function loadCsModules() {
  var purifyFactory = require('../lib/purify.min.js');
  window.DOMPurify = purifyFactory(window);
  window.marked = require('../lib/marked.min.js');
  require('../lib/i18n.js');
  require('../storage.js');
  require('../panel.js');
  require('../content-script.js');
}

/**
 * Helper: get CS tool by name
 */
function getTool(name) {
  return window.GobyAgent.nativeTools.find(function (t) {
    return t.function.name === name;
  });
}

// 测试夹具：一棵简化的书签树
function makeTree() {
  return [{
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: '书签栏',
        children: [
          { id: '10', title: 'GitHub', url: 'https://github.com', dateAdded: 1700000000000 },
          { id: '11', title: 'HN', url: 'https://news.ycombinator.com', dateAdded: 1700000001000 },
          {
            id: '12',
            title: 'Docs',
            children: [
              { id: '120', title: 'MDN', url: 'https://developer.mozilla.org', dateAdded: 1700000002000 },
              { id: '121', title: 'Chrome Ext Docs', url: 'https://developer.chrome.com/docs/extensions', dateAdded: 1700000003000 }
            ]
          }
        ]
      },
      {
        id: '2',
        title: '其他书签',
        children: [
          { id: '20', title: 'Recipe', url: 'https://example.com/recipe', dateAdded: 1700000004000 }
        ]
      }
    ]
  }];
}

// 测试夹具：扁平化的所有书签（用于 search / recent）
function makeAllBookmarks() {
  return [
    { id: '10', title: 'GitHub', url: 'https://github.com', dateAdded: 1700000000000 },
    { id: '11', title: 'HN', url: 'https://news.ycombinator.com', dateAdded: 1700000001000 },
    { id: '120', title: 'MDN', url: 'https://developer.mozilla.org', dateAdded: 1700000002000 },
    { id: '121', title: 'Chrome Ext Docs', url: 'https://developer.chrome.com/docs/extensions', dateAdded: 1700000003000 },
    { id: '20', title: 'Recipe', url: 'https://example.com/recipe', dateAdded: 1700000004000 }
  ];
}

// ================================================================
//  Test Suite 1: SW Handler tests
// ================================================================

describe('Bookmarks SW Handlers', function () {

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    delete chrome.runtime.lastError;
  });

  // ---------------------------------------------------------------
  //  bookmarks-search
  // ---------------------------------------------------------------
  test('bookmarks-search matches title and returns formatted list', async function () {
    chrome._setBookmarks(makeAllBookmarks());

    loadBackground();
    var listener = getOnMessageListener();

    var response = await new Promise(function (resolve) {
      listener(
        { action: 'bookmarks-search', query: 'github' },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
    });

    expect(response).toMatch(/匹配 1 条/);
    expect(response).toMatch(/GitHub/);
    expect(response).toMatch(/https:\/\/github\.com/);
    expect(chrome.bookmarks.search).toHaveBeenCalledWith('github', expect.any(Function));
  });

  test('bookmarks-search matches URL substring', async function () {
    chrome._setBookmarks(makeAllBookmarks());

    loadBackground();
    var listener = getOnMessageListener();

    var response = await new Promise(function (resolve) {
      listener(
        { action: 'bookmarks-search', query: 'mozilla' },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
    });

    expect(response).toMatch(/匹配 1 条/);
    expect(response).toMatch(/MDN/);
  });

  test('bookmarks-search respects limit parameter', async function () {
    // 5 个 'a' 都能匹配（URL 里都有 a）
    chrome._setBookmarks(makeAllBookmarks());

    loadBackground();
    var listener = getOnMessageListener();

    var response = await new Promise(function (resolve) {
      listener(
        { action: 'bookmarks-search', query: 'a', limit: 2 },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
    });

    // 显示前 2 条，但 total 报告所有匹配
    expect(response).toMatch(/显示前 2 条/);
  });

  test('bookmarks-search rejects empty query', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    var response = await new Promise(function (resolve) {
      listener(
        { action: 'bookmarks-search', query: '' },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
    });

    expect(response).toMatch(/Error.*query/);
    expect(chrome.bookmarks.search).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  //  bookmarks-tree
  // ---------------------------------------------------------------
  test('bookmarks-tree default folderId=0 uses getTree', async function () {
    chrome._setBookmarkTree(makeTree());

    loadBackground();
    var listener = getOnMessageListener();

    var response = await new Promise(function (resolve) {
      listener(
        { action: 'bookmarks-tree' },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
    });

    expect(chrome.bookmarks.getTree).toHaveBeenCalled();
    expect(chrome.bookmarks.getSubTree).not.toHaveBeenCalled();
    // depth=1 默认：应该包含根文件夹，但不递归到 docs 下
    expect(response).toMatch(/书签栏/);
    expect(response).toMatch(/其他书签/);
    expect(response).toMatch(/folderId=0/);
  });

  test('bookmarks-tree with folderId uses getSubTree', async function () {
    chrome._setBookmarkTree(makeTree());

    loadBackground();
    var listener = getOnMessageListener();

    var response = await new Promise(function (resolve) {
      listener(
        { action: 'bookmarks-tree', folderId: '12', depth: 2 },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
    });

    expect(chrome.bookmarks.getSubTree).toHaveBeenCalledWith('12', expect.any(Function));
    expect(chrome.bookmarks.getTree).not.toHaveBeenCalled();
    expect(response).toMatch(/MDN/);
    expect(response).toMatch(/Chrome Ext Docs/);
    expect(response).toMatch(/folderId=12/);
  });

  test('bookmarks-tree depth=1 does not recurse into subfolder contents', async function () {
    chrome._setBookmarkTree(makeTree());

    loadBackground();
    var listener = getOnMessageListener();

    var response = await new Promise(function (resolve) {
      listener(
        { action: 'bookmarks-tree', folderId: '1', depth: 1 },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
    });

    // depth=1：列出 "Docs" 文件夹名，但不应递归到 Docs 内部（MDN 等）
    expect(response).toMatch(/Docs/);
    expect(response).not.toMatch(/MDN/);
  });

  // ---------------------------------------------------------------
  //  bookmarks-recent
  // ---------------------------------------------------------------
  test('bookmarks-recent returns sorted by dateAdded desc', async function () {
    chrome._setBookmarks(makeAllBookmarks());

    loadBackground();
    var listener = getOnMessageListener();

    var response = await new Promise(function (resolve) {
      listener(
        { action: 'bookmarks-recent', count: 3 },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
    });

    expect(chrome.bookmarks.getRecent).toHaveBeenCalledWith(3, expect.any(Function));
    expect(response).toMatch(/最近 3 条书签/);
    // 排序：dateAdded 越大越前 → Recipe 应在 Chrome Ext Docs 前
    var recipeIdx = response.indexOf('Recipe');
    var extIdx = response.indexOf('Chrome Ext Docs');
    expect(recipeIdx).toBeLessThan(extIdx);
    expect(recipeIdx).toBeGreaterThan(-1);
  });

  test('bookmarks-recent default count=20 when not specified', async function () {
    chrome._setBookmarks(makeAllBookmarks());

    loadBackground();
    var listener = getOnMessageListener();

    await new Promise(function (resolve) {
      listener(
        { action: 'bookmarks-recent' },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
    });

    expect(chrome.bookmarks.getRecent).toHaveBeenCalledWith(20, expect.any(Function));
  });

  test('bookmarks-recent count is clamped to max 100', async function () {
    chrome._setBookmarks(makeAllBookmarks());

    loadBackground();
    var listener = getOnMessageListener();

    await new Promise(function (resolve) {
      listener(
        { action: 'bookmarks-recent', count: 9999 },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
    });

    expect(chrome.bookmarks.getRecent).toHaveBeenCalledWith(100, expect.any(Function));
  });

  // ---------------------------------------------------------------
  //  Error handling
  // ---------------------------------------------------------------
  test('bookmarks-search surfaces chrome.runtime.lastError', async function () {
    chrome._setBookmarks(makeAllBookmarks());
    chrome.bookmarks.search.mockImplementation(function (q, cb) {
      chrome.runtime.lastError = { message: 'Permission denied' };
      cb([]);
      delete chrome.runtime.lastError;
    });

    loadBackground();
    var listener = getOnMessageListener();

    var response = await new Promise(function (resolve) {
      listener(
        { action: 'bookmarks-search', query: 'x' },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
    });

    expect(response).toMatch(/Error.*Permission denied/);
  });
});

// ================================================================
//  Test Suite 2: Content Script tool definitions
// ================================================================

describe('Bookmarks CS Tool Definitions', function () {

  beforeAll(function () {
    loadCsModules();
  });

  test('all 3 bookmark tools are registered in nativeTools', function () {
    expect(getTool('bookmarks_search')).toBeDefined();
    expect(getTool('bookmarks_list_tree')).toBeDefined();
    expect(getTool('bookmarks_recent')).toBeDefined();
  });

  test('bookmarks_search requires query parameter', function () {
    var tool = getTool('bookmarks_search');
    expect(tool.function.parameters.required).toEqual(['query']);
    expect(tool.function.parameters.properties.query).toBeDefined();
    expect(tool.function.parameters.properties.limit).toBeDefined();
  });

  test('bookmarks_list_tree has folderId and depth params with defaults', function () {
    var tool = getTool('bookmarks_list_tree');
    expect(tool.function.parameters.properties.folderId.default).toBe('0');
    expect(tool.function.parameters.properties.depth.default).toBe(1);
  });

  test('bookmarks_recent has count param with default 20', function () {
    var tool = getTool('bookmarks_recent');
    expect(tool.function.parameters.properties.count.default).toBe(20);
  });

  test('bookmarks_search.execute sends correct SW message', async function () {
    var tool = getTool('bookmarks_search');
    // 替换 sendToSW（通过 spy content-script 的全局调用）
    var captured;
    var origSendMessage = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = jest.fn(function (msg, cb) {
      captured = msg;
      cb && cb('ok');
    });
    try {
      await tool.execute({ query: 'github', limit: 5 });
      expect(captured.action).toBe('bookmarks-search');
      expect(captured.query).toBe('github');
      expect(captured.limit).toBe(5);
    } finally {
      chrome.runtime.sendMessage = origSendMessage;
    }
  });
});
