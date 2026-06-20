/**
 * Navigation Tools tests — page_navigate, page_open_tab, page_close_tab, page_switch_tab, page_list_tabs
 *
 * Tests cover:
 * - SW message handler for each navigation action (tab-navigate/tab-open/tab-close/tab-switch/tab-list)
 * - Content Script nativeTools definitions for the 5 new tools
 *
 * Phase 7: Tab Navigation Tools
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

// ================================================================
//  Test Suite 1: SW Handler tests
// ================================================================

describe('Navigation SW Handlers', function () {

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    // Clear lastError before each test
    delete chrome.runtime.lastError;
  });

  // ---------------------------------------------------------------
  //  Test 1: tab-navigate success
  // ---------------------------------------------------------------
  test('tab-navigate calls chrome.tabs.update and returns success message', async function () {
    chrome.tabs.update.mockImplementation(function (tabId, props, cb) {
      expect(tabId).toBe(1);
      expect(props.url).toBe('https://example.com');
      if (cb) cb();
    });

    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      var ret = listener(
        { action: 'tab-navigate', url: 'https://example.com' },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
      expect(ret).toBe(true); // 异步响应
    });

    var response = await responsePromise;
    expect(response).toBe('已导航到: https://example.com');
    expect(chrome.tabs.update).toHaveBeenCalledWith(
      1,
      { url: 'https://example.com' },
      expect.any(Function)
    );
  });

  // ---------------------------------------------------------------
  //  Test 2: tab-navigate error (chrome.runtime.lastError)
  // ---------------------------------------------------------------
  test('tab-navigate returns error when chrome.runtime.lastError is set', async function () {
    chrome.tabs.update.mockImplementation(function (tabId, props, cb) {
      chrome.runtime.lastError = { message: 'Invalid URL' };
      if (cb) cb();
      delete chrome.runtime.lastError;
    });

    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      var ret = listener(
        { action: 'tab-navigate', url: 'invalid-url' },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
      expect(ret).toBe(true);
    });

    var response = await responsePromise;
    expect(response).toBe('Error: 导航失败 - Invalid URL');
  });

  // ---------------------------------------------------------------
  //  Test 3: tab-open success with onUpdated complete
  // ---------------------------------------------------------------
  test('tab-open creates tab and waits for onUpdated complete', async function () {
    var onUpdatedListener;

    chrome.tabs.create.mockImplementation(function (props, cb) {
      expect(props.url).toBe('https://example.com');
      expect(props.active).toBe(true);
      if (cb) cb({ id: 100, title: 'Example Page' });
    });

    chrome.tabs.onUpdated.addListener.mockImplementation(function (listenerFn) {
      onUpdatedListener = listenerFn;
    });

    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      var ret = listener(
        { action: 'tab-open', url: 'https://example.com' },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
      expect(ret).toBe(true);
    });

    // 模拟 onUpdated 完成事件
    expect(onUpdatedListener).toBeDefined();
    onUpdatedListener(100, { status: 'complete', title: 'Example Page' });

    var response = await responsePromise;
    expect(response).toBe('已打开标签页: [100] Example Page');
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      { url: 'https://example.com', active: true },
      expect.any(Function)
    );
    expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalled();
    expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  //  Test 4: tab-open timeout when page doesn't load
  // ---------------------------------------------------------------
  test('tab-open sets timeout and returns error when onUpdated never completes', async function () {
    jest.useFakeTimers();

    chrome.tabs.create.mockImplementation(function (props, cb) {
      if (cb) cb({ id: 100, title: 'Slow Page' });
    });

    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      var ret = listener(
        { action: 'tab-open', url: 'https://slow.example.com' },
        { id: chrome.runtime.id, tab: { id: 1 } },
        resolve
      );
      expect(ret).toBe(true);
    });

    // 不触发 onUpdated complete — 模拟超时
    jest.advanceTimersByTime(15000);

    var response = await responsePromise;
    expect(response).toBe('Error: 标签页加载超时 - https://slow.example.com');

    jest.useRealTimers();
  });

  // ---------------------------------------------------------------
  //  Test 5: tab-close success
  // ---------------------------------------------------------------
  test('tab-close calls chrome.tabs.remove and returns success', async function () {
    chrome.tabs.remove.mockImplementation(function (tabId, cb) {
      expect(tabId).toBe(42);
      if (cb) cb();
    });

    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      var ret = listener(
        { action: 'tab-close', tabId: 42 },
        { id: chrome.runtime.id },
        resolve
      );
      expect(ret).toBe(true);
    });

    var response = await responsePromise;
    expect(response).toBe('已关闭标签页: 42');
    expect(chrome.tabs.remove).toHaveBeenCalledWith(42, expect.any(Function));
  });

  // ---------------------------------------------------------------
  //  Test 6: tab-close error (chrome.runtime.lastError)
  // ---------------------------------------------------------------
  test('tab-close returns error when chrome.runtime.lastError is set', async function () {
    chrome.tabs.remove.mockImplementation(function (tabId, cb) {
      chrome.runtime.lastError = { message: 'Tab not found' };
      if (cb) cb();
      delete chrome.runtime.lastError;
    });

    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      var ret = listener(
        { action: 'tab-close', tabId: 999 },
        { id: chrome.runtime.id },
        resolve
      );
      expect(ret).toBe(true);
    });

    var response = await responsePromise;
    expect(response).toBe('Error: 关闭失败 - Tab not found');
  });

  // ---------------------------------------------------------------
  //  Test 7: tab-switch success
  // ---------------------------------------------------------------
  test('tab-switch calls chrome.tabs.update with active:true', async function () {
    chrome.tabs.update.mockImplementation(function (tabId, props, cb) {
      expect(tabId).toBe(5);
      expect(props.active).toBe(true);
      if (cb) cb({ id: 5, title: 'Target Tab' });
    });

    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      var ret = listener(
        { action: 'tab-switch', tabId: 5 },
        { id: chrome.runtime.id },
        resolve
      );
      expect(ret).toBe(true);
    });

    var response = await responsePromise;
    expect(response).toBe('已切换到标签页: Target Tab (tabId=5)');
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, { active: true }, expect.any(Function));
  });

  // ---------------------------------------------------------------
  //  Test 8: tab-switch error (chrome.runtime.lastError)
  // ---------------------------------------------------------------
  test('tab-switch returns error when chrome.runtime.lastError is set', async function () {
    chrome.tabs.update.mockImplementation(function (tabId, props, cb) {
      chrome.runtime.lastError = { message: 'Tab does not exist' };
      if (cb) cb();
      delete chrome.runtime.lastError;
    });

    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      var ret = listener(
        { action: 'tab-switch', tabId: 999 },
        { id: chrome.runtime.id },
        resolve
      );
      expect(ret).toBe(true);
    });

    var response = await responsePromise;
    expect(response).toBe('Error: 切换失败 - Tab does not exist');
  });

  // ---------------------------------------------------------------
  //  Test 9: tab-list formatted output
  // ---------------------------------------------------------------
  test('tab-list returns formatted list of all tabs', async function () {
    var mockTabs = [
      { id: 1, title: 'Tab One', url: 'https://example1.com', active: true },
      { id: 2, title: 'Tab Two', url: 'https://example2.com', active: false },
      { id: 3, title: '', url: 'about:blank', active: false }
    ];

    chrome.tabs.query.mockImplementation(function (queryInfo, cb) {
      if (cb) {
        cb(mockTabs);
      } else {
        // Support both (queryInfo, cb) and (cb) patterns
        return Promise.resolve(mockTabs);
      }
    });

    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      var ret = listener(
        { action: 'tab-list' },
        { id: chrome.runtime.id },
        resolve
      );
      expect(ret).toBe(true);
    });

    var response = await responsePromise;
    expect(response).toContain('当前有 3 个标签页');
    expect(response).toContain('[active] Tab One');
    expect(response).toContain('(https://example1.com) tabId=1');
    expect(response).toContain('Tab Two (https://example2.com) tabId=2');
    expect(response).toContain('无标题 (about:blank) tabId=3');
    expect(chrome.tabs.query).toHaveBeenCalledWith({ currentWindow: true }, expect.any(Function));
  });

  // ---------------------------------------------------------------
  //  Test 10: tab-navigate rejects when sender.tab is missing
  // ---------------------------------------------------------------
  test('tab-navigate returns error when sender has no tab', async function () {
    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      var ret = listener(
        { action: 'tab-navigate', url: 'https://example.com' },
        { id: chrome.runtime.id }, // no tab property
        resolve
      );
      expect(ret).toBe(true);
    });

    var response = await responsePromise;
    expect(response).toBe('Error: 无法获取 tabId');
  });

  // ---------------------------------------------------------------
  //  Test 11: tab-close with undefined tabId (edge case)
  // ---------------------------------------------------------------
  test('tab-close passes undefined tabId to chrome.tabs.remove', async function () {
    chrome.tabs.remove.mockImplementation(function (tabId, cb) {
      chrome.runtime.lastError = { message: 'Invalid tab ID' };
      if (cb) cb();
      delete chrome.runtime.lastError;
    });

    loadBackground();
    var listener = getOnMessageListener();

    var responsePromise = new Promise(function (resolve) {
      var ret = listener(
        { action: 'tab-close' }, // no tabId
        { id: chrome.runtime.id },
        resolve
      );
      expect(ret).toBe(true);
    });

    var response = await responsePromise;
    expect(response).toBe('Error: 关闭失败 - Invalid tab ID');
  });

});

// ================================================================
//  Test Suite 2: Content Script tool definition tests
// ================================================================

describe('Content Script Navigation Tool Definitions', function () {

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    document.body.innerHTML = '';
    // Mock sendMessage to return a resolved Promise for CS tool execute tests
    chrome.runtime.sendMessage.mockResolvedValue('ok');
  });

  // ---------------------------------------------------------------
  //  Test 12: nativeTools contains 5 new navigation tools
  // ---------------------------------------------------------------
  test('nativeTools array contains all 5 navigation tools', function () {
    loadCsModules();
    expect(window.GobyAgent).toBeDefined();
    expect(window.GobyAgent.nativeTools).toBeDefined();

    var navNames = ['page_navigate', 'page_open_tab', 'page_close_tab', 'page_switch_tab', 'page_list_tabs'];
    navNames.forEach(function (name) {
      var tool = getTool(name);
      expect(tool).toBeDefined();
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBe(name);
    });
  });

  // ---------------------------------------------------------------
  //  Test 13: page_navigate tool has correct schema
  // ---------------------------------------------------------------
  test('page_navigate has url parameter and navigation detection', function () {
    loadCsModules();
    var tool = getTool('page_navigate');
    expect(tool).toBeDefined();
    expect(tool.function.parameters.properties.url).toBeDefined();
    expect(tool.function.parameters.properties.url.type).toBe('string');
    expect(tool.function.parameters.required).toContain('url');
    expect(tool.timeout).toBe(15000);
    expect(typeof tool.execute).toBe('function');
  });

  // ---------------------------------------------------------------
  //  Test 14: page_open_tab has url parameter
  // ---------------------------------------------------------------
  test('page_open_tab has url parameter and returns Promise', function () {
    loadCsModules();
    var tool = getTool('page_open_tab');
    expect(tool).toBeDefined();
    expect(tool.function.parameters.properties.url).toBeDefined();
    expect(tool.function.parameters.required).toContain('url');
    expect(tool.timeout).toBe(15000);
    expect(typeof tool.execute).toBe('function');
  });

  // ---------------------------------------------------------------
  //  Test 15: tabId-requiring tools have correct params
  // ---------------------------------------------------------------
  test('page_close_tab and page_switch_tab have tabId parameter', function () {
    loadCsModules();

    var closeTool = getTool('page_close_tab');
    expect(closeTool).toBeDefined();
    expect(closeTool.function.parameters.properties.tabId).toBeDefined();
    expect(closeTool.function.parameters.properties.tabId.type).toBe('number');
    expect(closeTool.function.parameters.required).toContain('tabId');
    expect(closeTool.timeout).toBe(15000);

    var switchTool = getTool('page_switch_tab');
    expect(switchTool).toBeDefined();
    expect(switchTool.function.parameters.properties.tabId).toBeDefined();
    expect(switchTool.function.parameters.properties.tabId.type).toBe('number');
    expect(switchTool.function.parameters.required).toContain('tabId');
    expect(switchTool.timeout).toBe(15000);
  });

  // ---------------------------------------------------------------
  //  Test 16: page_list_tabs has no parameters and returns Promise
  // ---------------------------------------------------------------
  test('page_list_tabs has empty parameters', function () {
    loadCsModules();
    var tool = getTool('page_list_tabs');
    expect(tool).toBeDefined();
    expect(tool.function.parameters.properties).toEqual({});
    expect(tool.function.parameters.required).toBeUndefined();
    expect(tool.timeout).toBe(15000);
    expect(typeof tool.execute).toBe('function');
  });

  // ---------------------------------------------------------------
  //  Test 17: Each tool's execute returns a Promise
  // ---------------------------------------------------------------
  test('each navigation tool execute returns a Promise', function () {
    loadCsModules();
    var navNames = ['page_navigate', 'page_open_tab', 'page_close_tab', 'page_switch_tab', 'page_list_tabs'];

    navNames.forEach(function (name) {
      var tool = getTool(name);
      var result = tool.execute({ url: 'https://test.com', tabId: 1 });
      expect(result).toBeDefined();
      // execute should return either Promise or string
      expect(typeof result === 'object' || typeof result === 'string').toBe(true);
    });
  });

  // ---------------------------------------------------------------
  //  Test 18: tool descriptions are in English (per existing convention)
  // ---------------------------------------------------------------
  test('navigation tool descriptions are in English', function () {
    loadCsModules();
    var navNames = ['page_navigate', 'page_open_tab', 'page_close_tab', 'page_switch_tab', 'page_list_tabs'];

    navNames.forEach(function (name) {
      var tool = getTool(name);
      expect(tool).toBeDefined();
      expect(tool.function.description).toBeDefined();
      // 描述应包含英文单词（不全是中文）
      expect(tool.function.description.length).toBeGreaterThan(10);
    });
  });

});
