/**
 * Phase 8 共享测试 helper
 *
 * 提供 4 个 helper：
 *   - loadBackground:        加载 background.js（触发 SW IIFE，注册 onMessage listener）
 *   - loadCsModules:         加载 CS 依赖（DOMPurify + marked + i18n + storage + panel + content-script）
 *   - getOnMessageListener:  从 chrome.runtime.onMessage.addListener.mock.calls 取最近一次注册的 listener
 *   - getTool:               从 window.GobyAgent.nativeTools 按名字取工具定义
 *
 * 复用 navigation-tools.test.js:11-57 的内联 helper 模式（已稳定的 Phase 7 模式）。
 */

// Polyfill TextEncoder/TextDecoder for jsdom
var util = require('util');
if (!global.TextEncoder) global.TextEncoder = util.TextEncoder;
if (!global.TextDecoder) global.TextDecoder = util.TextDecoder;

// 加载 chrome mock（必须在 background.js / content-script.js 之前）
require('./__mocks__/chrome.js');

/**
 * 加载 background.js — 触发 IIFE 注册 onMessage listener
 */
function loadBackground() {
  jest.isolateModules(function () {
    require('../background.js');
  });
}

/**
 * 加载 CS 依赖（顺序遵循 navigation-tools.test.js:40-48）
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
 * 取 SW 最近注册的 onMessage listener
 */
function getOnMessageListener() {
  expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
  var calls = chrome.runtime.onMessage.addListener.mock.calls;
  return calls[calls.length - 1][0];
}

/**
 * 从 nativeTools 数组按 function.name 查工具
 */
function getTool(name) {
  return window.GobyAgent.nativeTools.find(function (t) {
    return t.function.name === name;
  });
}

module.exports = {
  loadBackground: loadBackground,
  loadCsModules: loadCsModules,
  getOnMessageListener: getOnMessageListener,
  getTool: getTool
};
