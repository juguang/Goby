/**
 * Page Action Tools tests — page_fill, page_click, page_check, page_select, page_submit
 *
 * Tests cover Phase 4 action tools from GOBY_DESIGN.md §四:
 * - page_fill: Fill form fields (input/textarea/contenteditable), trigger input+change events
 * - page_click: Click page elements, trigger click+mousedown+mouseup events
 * - page_check: Check/uncheck checkboxes via checked property, trigger change event
 * - page_select: Select dropdown options by value or text
 * - page_submit: Submit forms via form.submit() method
 *
 * RED Phase (Task 1): page_fill + page_click tests fail (stubs return placeholder)
 * GREEN Phase (Task 1): page_fill + page_click pass after implementation
 * RED Phase (Task 2): page_check + page_select + page_submit tests fail (stubs return placeholder)
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
function loadModules() {
  var purifyFactory = require('../lib/purify.min.js');
  window.DOMPurify = purifyFactory(window);
  window.marked = require('../lib/marked.min.js');
  require('../storage.js');
  require('../panel.js');
  require('../content-script.js');
}

/**
 * Standard test fixture with action tool elements
 * Covers input, textarea, contenteditable, button, link, checkbox, select, form
 */
var FIXTURE_HTML =
  // page_fill targets
  '<input id="fill-input" type="text" />' +
  '<textarea id="fill-textarea"></textarea>' +
  '<div id="fill-editor" contenteditable="true"></div>' +
  '<input class="fill-multi" type="text" />' +
  '<input class="fill-multi" type="text" />' +
  // page_click targets
  '<button id="click-btn" type="button">Click Me</button>' +
  '<a href="/page" class="click-link">Go</a>' +
  '<a href="/other" class="click-link">Other</a>' +
  // page_check targets (Task 2)
  '<input type="checkbox" id="check-agree" />' +
  '<input type="checkbox" id="check-news" checked />' +
  // page_select targets (Task 2)
  '<select id="select-city">' +
    '<option value="bj">北京</option>' +
    '<option value="sh">上海</option>' +
    '<option value="gz">广州</option>' +
  '</select>' +
  '<select id="select-language">' +
    '<option value="en">English</option>' +
    '<option value="zh">中文</option>' +
  '</select>' +
  // page_submit target (Task 2)
  '<form id="submit-form" action="/login">' +
    '<input name="username" />' +
  '</form>';

/**
 * Helper: get tool execute function by name
 */
function getTool(name) {
  return window.GobyAgent.nativeTools.find(function (t) {
    return t.function.name === name;
  });
}

// ================================================================
//  page_fill
// ================================================================
describe('page_fill', function () {
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
  //  Fills input element
  // ---------------------------------------------------------------
  test('fills input element value correctly', function () {
    loadModules();
    var tool = getTool('page_fill');
    var inputEl = document.querySelector('#fill-input');
    var result = tool.execute({ selector: '#fill-input', value: 'test@x.com' });
    expect(inputEl.value).toBe('test@x.com');
    expect(result).toBe("Filled '#fill-input' with: test@x.com");
  });

  // ---------------------------------------------------------------
  //  Fills textarea element
  // ---------------------------------------------------------------
  test('fills textarea element value correctly', function () {
    loadModules();
    var tool = getTool('page_fill');
    var textareaEl = document.querySelector('#fill-textarea');
    var result = tool.execute({ selector: '#fill-textarea', value: 'Hello World' });
    expect(textareaEl.value).toBe('Hello World');
    expect(result).toBe("Filled '#fill-textarea' with: Hello World");
  });

  // ---------------------------------------------------------------
  //  Handles contenteditable element
  // ---------------------------------------------------------------
  test('fills contenteditable element correctly', function () {
    loadModules();
    var tool = getTool('page_fill');
    var editorEl = document.querySelector('#fill-editor');
    // Verify element is contenteditable
    expect(editorEl.getAttribute('contenteditable')).toBe('true');
    // Set initial HTML content
    editorEl.innerHTML = '<p>Old content</p>';
    var result = tool.execute({ selector: '#fill-editor', value: 'New content' });
    // textContent replaces all child nodes (including HTML) with text
    expect(editorEl.textContent).toBe('New content');
    expect(result).toBe("Filled '#fill-editor' with: New content");
  });

  // ---------------------------------------------------------------
  //  Dispatches input event
  // ---------------------------------------------------------------
  test('dispatches input event', function () {
    loadModules();
    var tool = getTool('page_fill');
    var inputEl = document.querySelector('#fill-input');
    var inputSpy = jest.fn();
    inputEl.addEventListener('input', inputSpy);
    tool.execute({ selector: '#fill-input', value: 'test' });
    expect(inputSpy).toHaveBeenCalledTimes(1);
    // Verify event bubbles
    var event = inputSpy.mock.calls[0][0];
    expect(event.bubbles).toBe(true);
  });

  // ---------------------------------------------------------------
  //  Dispatches change event
  // ---------------------------------------------------------------
  test('dispatches change event', function () {
    loadModules();
    var tool = getTool('page_fill');
    var inputEl = document.querySelector('#fill-input');
    var changeSpy = jest.fn();
    inputEl.addEventListener('change', changeSpy);
    tool.execute({ selector: '#fill-input', value: 'test' });
    expect(changeSpy).toHaveBeenCalledTimes(1);
    var event = changeSpy.mock.calls[0][0];
    expect(event.bubbles).toBe(true);
  });

  // ---------------------------------------------------------------
  //  index=-1 fills all matching elements
  // ---------------------------------------------------------------
  test('fills all matching elements when index=-1', function () {
    loadModules();
    var tool = getTool('page_fill');
    var elements = document.querySelectorAll('.fill-multi');
    expect(elements.length).toBe(2);
    var result = tool.execute({ selector: '.fill-multi', value: 'all value', index: -1 });
    expect(elements[0].value).toBe('all value');
    expect(elements[1].value).toBe('all value');
    expect(result).toBe('Filled all 2 elements with: all value');
  });

  // ---------------------------------------------------------------
  //  No matching elements
  // ---------------------------------------------------------------
  test('returns no-match message when selector finds nothing', function () {
    loadModules();
    var tool = getTool('page_fill');
    var result = tool.execute({ selector: '.nonexistent', value: 'test' });
    expect(result).toBe('No elements found matching: .nonexistent');
  });

  // ---------------------------------------------------------------
  //  Index out of range
  // ---------------------------------------------------------------
  test('returns index-out-of-range error', function () {
    loadModules();
    var tool = getTool('page_fill');
    var result = tool.execute({ selector: '#fill-input', value: 'test', index: 99 });
    expect(result).toBe('Index 99 out of range. Found 1 elements.');
  });

  // ---------------------------------------------------------------
  //  Catches exceptions gracefully
  // ---------------------------------------------------------------
  test('catches exceptions and returns error message', function () {
    loadModules();
    var tool = getTool('page_fill');
    // Invalid selector type causes querySelectorAll to throw
    var result = tool.execute({ selector: '!!!invalid', value: 'test' });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^Fill failed: /);
  });
});

// ================================================================
//  page_click
// ================================================================
describe('page_click', function () {
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
  //  Clicks button element
  // ---------------------------------------------------------------
  test('clicks button element correctly', async function () {
    loadModules();
    var tool = getTool('page_click');
    var btnEl = document.querySelector('#click-btn');
    var clickSpy = jest.fn();
    btnEl.addEventListener('click', clickSpy);
    var result = await tool.execute({ selector: '#click-btn' });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(result).toBe('Clicked: #click-btn');
  });

  // ---------------------------------------------------------------
  //  Dispatches mousedown event
  // ---------------------------------------------------------------
  test('dispatches mousedown event', async function () {
    loadModules();
    var tool = getTool('page_click');
    var btnEl = document.querySelector('#click-btn');
    var spy = jest.fn();
    btnEl.addEventListener('mousedown', spy);
    await tool.execute({ selector: '#click-btn' });
    expect(spy).toHaveBeenCalledTimes(1);
    var event = spy.mock.calls[0][0];
    expect(event.type).toBe('mousedown');
    expect(event.bubbles).toBe(true);
  });

  // ---------------------------------------------------------------
  //  Dispatches mouseup event
  // ---------------------------------------------------------------
  test('dispatches mouseup event', async function () {
    loadModules();
    var tool = getTool('page_click');
    var btnEl = document.querySelector('#click-btn');
    var spy = jest.fn();
    btnEl.addEventListener('mouseup', spy);
    await tool.execute({ selector: '#click-btn' });
    expect(spy).toHaveBeenCalledTimes(1);
    var event = spy.mock.calls[0][0];
    expect(event.type).toBe('mouseup');
    expect(event.bubbles).toBe(true);
  });

  // ---------------------------------------------------------------
  //  index=-1 clicks all matching elements
  // ---------------------------------------------------------------
  test('clicks all matching elements when index=-1', async function () {
    loadModules();
    var tool = getTool('page_click');
    var links = document.querySelectorAll('.click-link');
    expect(links.length).toBe(2);
    var clickSpy1 = jest.fn();
    var clickSpy2 = jest.fn();
    links[0].addEventListener('click', clickSpy1);
    links[1].addEventListener('click', clickSpy2);
    var result = await tool.execute({ selector: '.click-link', index: -1 });
    expect(clickSpy1).toHaveBeenCalledTimes(1);
    expect(clickSpy2).toHaveBeenCalledTimes(1);
    expect(result).toBe('Clicked all 2 elements');
  });

  // ---------------------------------------------------------------
  //  No matching elements
  // ---------------------------------------------------------------
  test('returns no-match message when selector finds nothing', async function () {
    loadModules();
    var tool = getTool('page_click');
    var result = await tool.execute({ selector: '.nonexistent' });
    expect(result).toBe('No elements found matching: .nonexistent');
  });

  // ---------------------------------------------------------------
  //  Index out of range
  // ---------------------------------------------------------------
  test('returns index-out-of-range error', async function () {
    loadModules();
    var tool = getTool('page_click');
    var result = await tool.execute({ selector: '#click-btn', index: 99 });
    expect(result).toBe('Index 99 out of range. Found 1 elements.');
  });

  // ---------------------------------------------------------------
  //  Catches exceptions gracefully
  // ---------------------------------------------------------------
  test('catches exceptions and returns error message', async function () {
    loadModules();
    var tool = getTool('page_click');
    var result = await tool.execute({ selector: '!!!invalid' });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^Click failed: /);
  });

  // ---------------------------------------------------------------
  //  Clicks element by index
  // ---------------------------------------------------------------
  test('clicks specific element when index is provided', async function () {
    loadModules();
    var tool = getTool('page_click');
    var links = document.querySelectorAll('.click-link');
    var clickSpy = jest.fn();
    links[1].addEventListener('click', clickSpy);
    var result = await tool.execute({ selector: '.click-link', index: 1 });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(result).toBe('Clicked: .click-link');
  });
});

// ================================================================
//  page_click navigation detection (Fix PCN)
//  - 单元素点击后 200ms 内检测 beforeunload/pagehide/readyState='loading'
//  - 触发时返回值带 "(navigation started, agent loop will pause until new page loads)"
//  - 未触发时保持原 'Clicked: <selector>' 行为
// ================================================================
describe('page_click navigation detection', function () {
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
  //  Test 1: SPA click（无 navigation 事件，readyState 保持 complete）→ 原返回值
  // ---------------------------------------------------------------
  test('Test 1: SPA click without navigation returns plain Clicked message', async function () {
    loadModules();
    var tool = getTool('page_click');
    var result = await tool.execute({ selector: '#click-btn' });
    expect(result).toBe('Clicked: #click-btn');
    expect(result).not.toContain('navigation started');
  });

  // ---------------------------------------------------------------
  //  Test 2: click 后触发 beforeunload → 返回 navigation 提示
  // ---------------------------------------------------------------
  test('Test 2: beforeunload event triggers navigation hint', async function () {
    loadModules();
    var tool = getTool('page_click');

    // 在 page_click 内部 200ms 等待窗口中触发 beforeunload
    setTimeout(function () {
      window.dispatchEvent(new Event('beforeunload'));
    }, 50);

    var result = await tool.execute({ selector: '#click-btn' });
    expect(result).toBe('Clicked: #click-btn (navigation started, agent loop will pause until new page loads)');
  });

  // ---------------------------------------------------------------
  //  Test 3: click 后触发 pagehide → 返回 navigation 提示
  // ---------------------------------------------------------------
  test('Test 3: pagehide event triggers navigation hint', async function () {
    loadModules();
    var tool = getTool('page_click');

    setTimeout(function () {
      window.dispatchEvent(new Event('pagehide'));
    }, 50);

    var result = await tool.execute({ selector: '#click-btn' });
    expect(result).toBe('Clicked: #click-btn (navigation started, agent loop will pause until new page loads)');
  });

  // ---------------------------------------------------------------
  //  Test 4: click 后 document.readyState === 'loading' → 返回 navigation 提示
  // ---------------------------------------------------------------
  test('Test 4: readyState=loading triggers navigation hint', async function () {
    loadModules();
    var tool = getTool('page_click');

    // jsdom 默认 readyState='complete'，需在等待窗口中临时改成 'loading'
    var origDescriptor = Object.getOwnPropertyDescriptor(document, 'readyState');
    setTimeout(function () {
      try {
        Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
      } catch (e) { /* ignore */ }
    }, 50);

    var result = await tool.execute({ selector: '#click-btn' });

    // 恢复（避免污染后续测试）
    if (origDescriptor) {
      try {
        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
      } catch (e) { /* ignore */ }
    }

    expect(result).toBe('Clicked: #click-btn (navigation started, agent loop will pause until new page loads)');
  });

  // ---------------------------------------------------------------
  //  Test 5: index=-1 click all 不进入 navigation 检测
  // ---------------------------------------------------------------
  test('Test 5: click all (index=-1) skips navigation detection', async function () {
    loadModules();
    var tool = getTool('page_click');

    // 即使有 navigation 事件，click all 也应保持同步返回 'Clicked all N elements'
    setTimeout(function () {
      window.dispatchEvent(new Event('beforeunload'));
    }, 50);

    var result = await tool.execute({ selector: '.click-link', index: -1 });
    expect(result).toBe('Clicked all 2 elements');
    expect(result).not.toContain('navigation started');
  });

  // ---------------------------------------------------------------
  //  Test 6: 元素未找到走同步分支，不进入 async 等待
  // ---------------------------------------------------------------
  test('Test 6: no elements found skips navigation detection', async function () {
    loadModules();
    var tool = getTool('page_click');

    var startTime = Date.now();
    var result = await tool.execute({ selector: '.nonexistent' });
    var elapsed = Date.now() - startTime;

    expect(result).toBe('No elements found matching: .nonexistent');
    // 元素未找到应快速返回，不应等 200ms
    expect(elapsed).toBeLessThan(150);
  });
});

// ================================================================
//  page_check (RED Phase - Task 2: tests will fail on stub)
// ================================================================
describe('page_check', function () {
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
  //  Checks a checkbox
  // ---------------------------------------------------------------
  test('checks a checkbox when checked=true', function () {
    loadModules();
    var tool = getTool('page_check');
    var checkbox = document.querySelector('#check-agree');
    expect(checkbox.checked).toBe(false);
    var result = tool.execute({ selector: '#check-agree', checked: true });
    expect(checkbox.checked).toBe(true);
    expect(result).toBe('Checked: #check-agree');
  });

  // ---------------------------------------------------------------
  //  Unchecks a checkbox
  // ---------------------------------------------------------------
  test('unchecks a checkbox when checked=false', function () {
    loadModules();
    var tool = getTool('page_check');
    var checkbox = document.querySelector('#check-news');
    expect(checkbox.checked).toBe(true);
    var result = tool.execute({ selector: '#check-news', checked: false });
    expect(checkbox.checked).toBe(false);
    expect(result).toBe('Unchecked: #check-news');
  });

  // ---------------------------------------------------------------
  //  Dispatches change event
  // ---------------------------------------------------------------
  test('dispatches change event after check/uncheck', function () {
    loadModules();
    var tool = getTool('page_check');
    var checkbox = document.querySelector('#check-agree');
    var spy = jest.fn();
    checkbox.addEventListener('change', spy);
    tool.execute({ selector: '#check-agree', checked: true });
    expect(spy).toHaveBeenCalledTimes(1);
    var event = spy.mock.calls[0][0];
    expect(event.bubbles).toBe(true);
  });

  // ---------------------------------------------------------------
  //  index=-1 checks all matching
  // ---------------------------------------------------------------
  test('checks all matching checkboxes when index=-1', function () {
    loadModules();
    var tool = getTool('page_check');
    var result = tool.execute({ selector: 'input[type=checkbox]', checked: true, index: -1 });
    var checkboxes = document.querySelectorAll('input[type=checkbox]');
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(true);
    expect(result).toBe('Checked all 2 elements');
  });

  // ---------------------------------------------------------------
  //  Rejects non-checkbox element
  // ---------------------------------------------------------------
  test('returns error for non-checkbox element', function () {
    loadModules();
    var tool = getTool('page_check');
    var result = tool.execute({ selector: '#click-btn', checked: true });
    expect(result).toBe('Element is not a checkbox: #click-btn');
  });

  // ---------------------------------------------------------------
  //  No matching elements
  // ---------------------------------------------------------------
  test('returns no-match message when selector finds nothing', function () {
    loadModules();
    var tool = getTool('page_check');
    var result = tool.execute({ selector: '.nonexistent', checked: true });
    expect(result).toBe('No elements found matching: .nonexistent');
  });

  // ---------------------------------------------------------------
  //  Catches exceptions gracefully
  // ---------------------------------------------------------------
  test('catches exceptions and returns error message', function () {
    loadModules();
    var tool = getTool('page_check');
    var result = tool.execute({ selector: '!!!invalid', checked: true });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^Check failed: /);
  });
});

// ================================================================
//  page_select (RED Phase - Task 2: tests will fail on stub)
// ================================================================
describe('page_select', function () {
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
  //  Selects option by value
  // ---------------------------------------------------------------
  test('selects option by value', function () {
    loadModules();
    var tool = getTool('page_select');
    var selectEl = document.querySelector('#select-city');
    expect(selectEl.value).toBe('bj'); // first option default
    var result = tool.execute({ selector: '#select-city', value: 'sh' });
    expect(selectEl.value).toBe('sh');
    expect(result).toBe("Selected value='sh' on: #select-city");
  });

  // ---------------------------------------------------------------
  //  Selects option by text
  // ---------------------------------------------------------------
  test('selects option by text', function () {
    loadModules();
    var tool = getTool('page_select');
    var selectEl = document.querySelector('#select-city');
    var result = tool.execute({ selector: '#select-city', text: '广州' });
    expect(selectEl.value).toBe('gz');
    expect(result).toBe("Selected text='广州' on: #select-city");
  });

  // ---------------------------------------------------------------
  //  Value takes priority over text
  // ---------------------------------------------------------------
  test('value takes priority when both value and text provided', function () {
    loadModules();
    var tool = getTool('page_select');
    var selectEl = document.querySelector('#select-city');
    var result = tool.execute({ selector: '#select-city', value: 'sh', text: '广州' });
    expect(selectEl.value).toBe('sh');
    expect(result).toBe("Selected value='sh' on: #select-city");
  });

  // ---------------------------------------------------------------
  //  Dispatches change event
  // ---------------------------------------------------------------
  test('dispatches change event after selection', function () {
    loadModules();
    var tool = getTool('page_select');
    var selectEl = document.querySelector('#select-city');
    var spy = jest.fn();
    selectEl.addEventListener('change', spy);
    tool.execute({ selector: '#select-city', value: 'sh' });
    expect(spy).toHaveBeenCalledTimes(1);
    var event = spy.mock.calls[0][0];
    expect(event.bubbles).toBe(true);
  });

  // ---------------------------------------------------------------
  //  Value not found error
  // ---------------------------------------------------------------
  test('returns error when option value not found', function () {
    loadModules();
    var tool = getTool('page_select');
    var result = tool.execute({ selector: '#select-city', value: 'nonexistent' });
    expect(result).toBe("Option with value 'nonexistent' not found");
  });

  // ---------------------------------------------------------------
  //  Text not found error
  // ---------------------------------------------------------------
  test('returns error when option text not found', function () {
    loadModules();
    var tool = getTool('page_select');
    var result = tool.execute({ selector: '#select-city', text: '不存在' });
    expect(result).toBe("Option with text '不存在' not found");
  });

  // ---------------------------------------------------------------
  //  Rejects non-select element
  // ---------------------------------------------------------------
  test('returns error for non-select element', function () {
    loadModules();
    var tool = getTool('page_select');
    var result = tool.execute({ selector: '#click-btn', value: 'test' });
    expect(result).toBe('Element is not a select: #click-btn');
  });

  // ---------------------------------------------------------------
  //  No matching elements
  // ---------------------------------------------------------------
  test('returns no-match message when selector finds nothing', function () {
    loadModules();
    var tool = getTool('page_select');
    var result = tool.execute({ selector: '.nonexistent', value: 'test' });
    expect(result).toBe('No elements found matching: .nonexistent');
  });

  // ---------------------------------------------------------------
  //  Catches exceptions gracefully
  // ---------------------------------------------------------------
  test('catches exceptions and returns error message', function () {
    loadModules();
    var tool = getTool('page_select');
    var result = tool.execute({ selector: '!!!invalid', value: 'test' });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^Select failed: /);
  });
});

// ================================================================
//  page_submit (RED Phase - Task 2: tests will fail on stub)
// ================================================================
describe('page_submit', function () {
  var originalSubmit;

  beforeAll(function () {
    // JSDOM doesn't implement HTMLFormElement.prototype.submit (throws "Not implemented")
    // Save original and mock it
    originalSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = jest.fn();
  });

  afterAll(function () {
    HTMLFormElement.prototype.submit = originalSubmit;
  });

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
  //  Submits a form
  // ---------------------------------------------------------------
  test('submits form element correctly', function () {
    loadModules();
    var tool = getTool('page_submit');
    var formEl = document.querySelector('#submit-form');
    var submitSpy = jest.fn();
    formEl.addEventListener('submit', submitSpy);
    var result = tool.execute({ selector: '#submit-form' });
    expect(result).toBe('Submitted form: #submit-form');
  });

  // ---------------------------------------------------------------
  //  Rejects non-form element
  // ---------------------------------------------------------------
  test('returns error for non-form element', function () {
    loadModules();
    var tool = getTool('page_submit');
    var result = tool.execute({ selector: '#click-btn' });
    expect(result).toBe('Element is not a form: #click-btn');
  });

  // ---------------------------------------------------------------
  //  No matching elements
  // ---------------------------------------------------------------
  test('returns no-match message when selector finds nothing', function () {
    loadModules();
    var tool = getTool('page_submit');
    var result = tool.execute({ selector: '.nonexistent' });
    expect(result).toBe('No elements found matching: .nonexistent');
  });

  // ---------------------------------------------------------------
  //  Catches exceptions gracefully
  // ---------------------------------------------------------------
  test('catches exceptions and returns error message', function () {
    loadModules();
    var tool = getTool('page_submit');
    var result = tool.execute({ selector: '!!!invalid' });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^Submit failed: /);
  });
});
