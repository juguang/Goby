/**
 * Page Query & Action Tools tests — page_query, page_list_elements, page_wait, page_evaluate
 *
 * Tests cover Phase 4 requirements from GOBY_DESIGN.md §四:
 * - page_query: CSS selector queries with property modes (text/value/html/attributes/all)
 * - page_list_elements: interactive element listing by type filter
 * - page_wait: MutationObserver-based element waiting and time-based waiting
 * - page_evaluate: Service Worker MAIN world JavaScript execution
 *
 * RED Phase (Task 1): page_query + page_list_elements tests fail (stubs return placeholder)
 * GREEN Phase (Task 1): page_query + page_list_elements pass after implementation
 * RED Phase (Task 2): page_wait + page_evaluate tests fail (stubs return placeholder)
 * GREEN Phase (Task 2): all tests pass after implementation
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
function loadQueryModules() {
  var purifyFactory = require('../lib/purify.min.js');
  window.DOMPurify = purifyFactory(window);
  window.marked = require('../lib/marked.min.js');
  require('../storage.js');
  require('../panel.js');
  require('../content-script.js');
}

/**
 * Standard test fixture with common page elements
 */
var FIXTURE_HTML =
  '<div class="btn" id="btn1">Hello</div>' +
  '<div class="btn" id="btn2">World</div>' +
  '<input name="email" id="email-input" type="email" placeholder="Enter email" value="test@test.com"/>' +
  '<input name="search" id="search-input" type="text" placeholder="Search..." value=""/>' +
  '<button id="submit-btn" class="primary">Submit</button>' +
  '<button id="cancel-btn">Cancel</button>' +
  '<a href="/page1" id="link1">Link One</a>' +
  '<a href="/page2" id="link2">Link Two</a>' +
  '<select id="country-select"><option>US</option><option>CN</option><option>JP</option></select>' +
  '<input type="checkbox" id="agree-check" checked/>' +
  '<input type="checkbox" id="newsletter-check"/>' +
  '<input type="radio" name="gender" id="male-radio" value="male"/>' +
  '<input type="radio" name="gender" id="female-radio" value="female"/>' +
  '<textarea id="bio-textarea" placeholder="Tell us about yourself"></textarea>';

describe('page_query', function () {
  /**
   * Helper: get tool execute function by name
   */
  function getTool(name) {
    return window.GobyAgent.nativeTools.find(function (t) {
      return t.function.name === name;
    });
  }

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    // Remove Goby UI elements to keep DOM clean on reload
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    document.body.innerHTML = FIXTURE_HTML;
  });

  // ---------------------------------------------------------------
  //  property: text (default)
  // ---------------------------------------------------------------
  test('returns text property with index=0 by default', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '.btn' });
    var parsed = JSON.parse(result);
    expect(parsed.tag).toBe('DIV');
    expect(parsed.id).toBe('btn1');
    expect(parsed.text).toBe('Hello');
  });

  // ---------------------------------------------------------------
  //  property: value
  // ---------------------------------------------------------------
  test('returns value property for input elements', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '#email-input', property: 'value' });
    var parsed = JSON.parse(result);
    expect(parsed.value).toBe('test@test.com');
  });

  // ---------------------------------------------------------------
  //  property: html
  // ---------------------------------------------------------------
  test('returns html property', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '#btn1', property: 'html' });
    var parsed = JSON.parse(result);
    expect(parsed.html).toBe('Hello');
  });

  // ---------------------------------------------------------------
  //  property: attributes
  // ---------------------------------------------------------------
  test('returns attributes object', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '#email-input', property: 'attributes' });
    var parsed = JSON.parse(result);
    expect(parsed.attributes).toBeDefined();
    expect(parsed.attributes.name).toBe('email');
    expect(parsed.attributes.type).toBe('email');
    expect(parsed.attributes.placeholder).toBe('Enter email');
  });

  // ---------------------------------------------------------------
  //  property: all
  // ---------------------------------------------------------------
  test('returns all properties with property=all', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '#btn1', property: 'all' });
    var parsed = JSON.parse(result);
    expect(parsed.tag).toBe('DIV');
    expect(parsed.id).toBe('btn1');
    expect(parsed.text).toBe('Hello');
    expect(parsed.value).toBeDefined();
    expect(parsed.html).toBe('Hello');
    expect(parsed.attributes).toBeDefined();
  });

  // ---------------------------------------------------------------
  //  property default (when not specified)
  // ---------------------------------------------------------------
  test('defaults property to text when not specified', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '.btn' });
    var parsed = JSON.parse(result);
    expect(parsed.text).toBe('Hello');
  });

  // ---------------------------------------------------------------
  //  index default (when not specified)
  // ---------------------------------------------------------------
  test('defaults index to 0 when not specified', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '.btn' });
    var parsed = JSON.parse(result);
    expect(parsed.id).toBe('btn1');
  });

  // ---------------------------------------------------------------
  //  index = -1 (return all)
  // ---------------------------------------------------------------
  test('returns array of all matching elements when index=-1', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '.btn', property: 'text', index: -1 });
    var parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].text).toBe('Hello');
    expect(parsed[1].text).toBe('World');
  });

  // ---------------------------------------------------------------
  //  index=-1 with property=all
  // ---------------------------------------------------------------
  test('returns array with all properties when index=-1 and property=all', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '.btn', property: 'all', index: -1 });
    var parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].tag).toBe('DIV');
    expect(parsed[0].text).toBe('Hello');
    expect(parsed[0].html).toBe('Hello');
    expect(parsed[0].attributes).toBeDefined();
    expect(parsed[1].text).toBe('World');
  });

  // ---------------------------------------------------------------
  //  No matching elements
  // ---------------------------------------------------------------
  test('returns no-matches message when selector finds nothing', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '.nonexistent' });
    expect(result).toBe('No elements found matching: .nonexistent');
  });

  // ---------------------------------------------------------------
  //  Index out of range
  // ---------------------------------------------------------------
  test('returns index out of range error', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '.btn', index: 99 });
    expect(result).toBe('Index 99 out of range. Found 2 elements.');
  });

  // ---------------------------------------------------------------
  //  Invalid CSS selector
  // ---------------------------------------------------------------
  test('returns Query failed for invalid CSS selector', function () {
    loadQueryModules();
    var tool = getTool('page_query');
    var result = tool.execute({ selector: '!!!invalid' });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^Query failed: /);
  });
});

describe('page_list_elements', function () {
  function getTool(name) {
    return window.GobyAgent.nativeTools.find(function (t) {
      return t.function.name === name;
    });
  }

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    document.body.innerHTML = FIXTURE_HTML;
  });

  // ---------------------------------------------------------------
  //  type: all
  // ---------------------------------------------------------------
  test('returns all interactive elements with type=all', function () {
    loadQueryModules();
    var tool = getTool('page_list_elements');
    var result = tool.execute({ type: 'all' });
    var parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    // Should have elements from multiple categories
    expect(parsed.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  //  type: inputs
  // ---------------------------------------------------------------
  test('returns input/textarea/select elements with type=inputs', function () {
    loadQueryModules();
    var tool = getTool('page_list_elements');
    var result = tool.execute({ type: 'inputs' });
    var parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    // Should find email-input, search-input, country-select, bio-textarea
    var tags = parsed.map(function (e) { return e.tag; });
    expect(tags).toContain('input');
    expect(tags).toContain('select');
    expect(tags).toContain('textarea');
    // Check fields on first element
    var firstInput = parsed.find(function (e) { return e.id === 'email-input'; });
    expect(firstInput).toBeDefined();
    expect(firstInput.type).toBe('email');
    expect(firstInput.name).toBe('email');
    expect(firstInput.placeholder).toBe('Enter email');
  });

  // ---------------------------------------------------------------
  //  type: buttons
  // ---------------------------------------------------------------
  test('returns button elements with type=buttons', function () {
    loadQueryModules();
    var tool = getTool('page_list_elements');
    var result = tool.execute({ type: 'buttons' });
    var parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    var ids = parsed.map(function (e) { return e.id; });
    expect(ids).toContain('submit-btn');
    expect(ids).toContain('cancel-btn');
    var submitBtn = parsed.find(function (e) { return e.id === 'submit-btn'; });
    expect(submitBtn.text).toBe('Submit');
  });

  // ---------------------------------------------------------------
  //  type: links
  // ---------------------------------------------------------------
  test('returns link elements with type=links', function () {
    loadQueryModules();
    var tool = getTool('page_list_elements');
    var result = tool.execute({ type: 'links' });
    var parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].href).toMatch(/\/page1$/);
    expect(parsed[0].text).toBe('Link One');
  });

  // ---------------------------------------------------------------
  //  type: selects
  // ---------------------------------------------------------------
  test('returns select elements with type=selects', function () {
    loadQueryModules();
    var tool = getTool('page_list_elements');
    var result = tool.execute({ type: 'selects' });
    var parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe('country-select');
    expect(parsed[0].option_count).toBeDefined();
  });

  // ---------------------------------------------------------------
  //  type: checkboxes
  // ---------------------------------------------------------------
  test('returns checkbox elements with type=checkboxes', function () {
    loadQueryModules();
    var tool = getTool('page_list_elements');
    var result = tool.execute({ type: 'checkboxes' });
    var parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].id).toBe('agree-check');
    expect(parsed[0].checked).toBe(true);
    expect(parsed[1].id).toBe('newsletter-check');
    expect(parsed[1].checked).toBe(false);
  });

  // ---------------------------------------------------------------
  //  type: radios
  // ---------------------------------------------------------------
  test('returns radio elements with type=radios', function () {
    loadQueryModules();
    var tool = getTool('page_list_elements');
    var result = tool.execute({ type: 'radios' });
    var parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    var ids = parsed.map(function (e) { return e.id; });
    expect(ids).toContain('male-radio');
    expect(ids).toContain('female-radio');
  });

  // ---------------------------------------------------------------
  //  type default (all)
  // ---------------------------------------------------------------
  test('defaults type to all when not specified', function () {
    loadQueryModules();
    var tool = getTool('page_list_elements');
    var result = tool.execute({});
    var parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  //  No matching elements
  // ---------------------------------------------------------------
  test('returns no-matches message when no elements found', function () {
    loadQueryModules();
    document.body.innerHTML = '';
    var tool = getTool('page_list_elements');
    var result = tool.execute({ type: 'inputs' });
    expect(result).toBe('No interactive elements found of type: inputs');
  });

  // ---------------------------------------------------------------
  //  Exception handling
  // ---------------------------------------------------------------
  test('handles exceptions gracefully', function () {
    loadQueryModules();
    var tool = getTool('page_list_elements');
    // Passing a truthy but invalid value should be caught
    var result = tool.execute({});
    // Should not throw
    expect(typeof result).toBe('string');
  });
});

describe('page_wait', function () {
  function getTool(name) {
    return window.GobyAgent.nativeTools.find(function (t) {
      return t.function.name === name;
    });
  }

  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    document.body.innerHTML = '<div id="existing">I exist</div>';
  });

  // ---------------------------------------------------------------
  //  Element already exists
  // ---------------------------------------------------------------
  test('returns already-exists message when element is present', function () {
    loadQueryModules();
    var tool = getTool('page_wait');
    var result = tool.execute({ selector: '#existing' });
    expect(result).toBe('Element already exists: #existing');
  });

  // ---------------------------------------------------------------
  //  Selector mode: element appears after a delay
  // ---------------------------------------------------------------
  test('returns found message when element appears via MutationObserver', function () {
    loadQueryModules();
    var tool = getTool('page_wait');
    // Start waiting
    var promise = tool.execute({ selector: '.dynamic', timeout: 5000 });
    // Add element after a tick
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        var el = document.createElement('div');
        el.className = 'dynamic';
        el.id = 'new-el';
        document.body.appendChild(el);
      }, 10);
      promise.then(function (result) {
        expect(result).toMatch(/^Element found: \.dynamic after \d+ms$/);
        resolve();
      }).catch(reject);
    });
  });

  // ---------------------------------------------------------------
  //  timeout: element does not appear
  // ---------------------------------------------------------------
  test('returns timeout message when element does not appear', function () {
    loadQueryModules();
    var tool = getTool('page_wait');
    var promise = tool.execute({ selector: '.never-appears', timeout: 100 });
    return promise.then(function (result) {
      expect(result).toBe("Timeout: element '.never-appears' not found after 100ms");
    });
  });

  // ---------------------------------------------------------------
  //  time mode: wait specified ms
  // ---------------------------------------------------------------
  test('returns waited message for time mode', function () {
    loadQueryModules();
    var tool = getTool('page_wait');
    var start = Date.now();
    var promise = tool.execute({ time: 20 });
    return promise.then(function (result) {
      expect(result).toMatch(/^Waited \d+ms$/);
      expect(Date.now() - start).toBeGreaterThanOrEqual(18);
    });
  });

  // ---------------------------------------------------------------
  //  selector mode: timeout default (verify returns promise)
  // ---------------------------------------------------------------
  test('returns Promise when no explicit timeout given (default 10000ms)', function () {
    loadQueryModules();
    var tool = getTool('page_wait');
    var result = tool.execute({ selector: '.never-appears' });
    expect(typeof result).toBe('object');
    expect(typeof result.then).toBe('function');
  });

  // ---------------------------------------------------------------
  //  Exception handling
  // ---------------------------------------------------------------
  test('handles exceptions gracefully', function () {
    loadQueryModules();
    var tool = getTool('page_wait');
    // Invalid selector
    var result = tool.execute({ selector: null });
    expect(typeof result).toBe('string');
  });
});

describe('page_evaluate', function () {
  function getTool(name) {
    return window.GobyAgent.nativeTools.find(function (t) {
      return t.function.name === name;
    });
  }

  // 模拟 SW page-evaluate 通道：SW 用 chrome.scripting.executeScript 在 MAIN world
  // 执行 eval(expression)。测试中直接 mock chrome.runtime.sendMessage，
  // 模拟 SW 行为：执行 expression 并返回字符串结果。
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    document.body.innerHTML = '<div class="btn">Hello</div>';

    chrome.runtime.sendMessage.mockImplementation(function (msg, callback) {
      if (msg && msg.action === 'page-evaluate') {
        var result;
        try {
          result = eval(msg.expression);
        } catch (e) {
          result = 'Error: ' + e.message;
        }
        if (typeof callback === 'function') {
          callback(String(result !== undefined ? result : ''));
        }
        return undefined;
      }
      if (typeof callback === 'function') callback(null);
      return undefined;
    });
  });

  // ---------------------------------------------------------------
  //  Simple expression
  // ---------------------------------------------------------------
  test('evaluates simple expression like document.title', function () {
    loadQueryModules();
    var tool = getTool('page_evaluate');
    return tool.execute({ expression: 'document.title' }).then(function (result) {
      expect(typeof result).toBe('string');
    });
  });

  // ---------------------------------------------------------------
  //  Arithmetic expression
  // ---------------------------------------------------------------
  test('evaluates arithmetic expression', function () {
    loadQueryModules();
    var tool = getTool('page_evaluate');
    return tool.execute({ expression: '1+1' }).then(function (result) {
      expect(result).toBe('2');
    });
  });

  // ---------------------------------------------------------------
  //  DOM query expression
  // ---------------------------------------------------------------
  test('evaluates DOM query expression', function () {
    loadQueryModules();
    var tool = getTool('page_evaluate');
    return tool.execute({ expression: 'document.querySelector(".btn").textContent' }).then(function (result) {
      expect(result).toBe('Hello');
    });
  });

  // ---------------------------------------------------------------
  //  Empty expression
  // ---------------------------------------------------------------
  test('returns error for empty expression', function () {
    loadQueryModules();
    var tool = getTool('page_evaluate');
    var result = tool.execute({ expression: '' });
    expect(result).toBe('Error: expression is required');
  });

  // ---------------------------------------------------------------
  //  Null/undefined expression
  // ---------------------------------------------------------------
  test('returns error for missing expression', function () {
    loadQueryModules();
    var tool = getTool('page_evaluate');
    var result = tool.execute({});
    expect(result).toBe('Error: expression is required');
  });

  // ---------------------------------------------------------------
  //  ISOLATED world execution error handling
  // ---------------------------------------------------------------
  test('returns non-Error-prefixed failure message when expression throws (avoid retry loop)', function () {
    // 失败时不带 "Error:" 前缀——避免 executeWithTimeout 误判重试 3 次
    // 让 LLM 看到失败信息后换工具
    loadQueryModules();
    var tool = getTool('page_evaluate');
    return tool.execute({ expression: 'undefinedProperty.nonExistent' }).then(function (result) {
      expect(result).toMatch(/^page_evaluate 执行失败/);
      expect(result).not.toMatch(/^Error:/);
    });
  });
});
