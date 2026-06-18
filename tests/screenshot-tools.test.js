/**
 * page_screenshot & PANEL-09 overlay tests
 *
 * Tests cover Plan 05-02:
 * - page_screenshot: panel hide/restore, data URL return, SW error handling
 * - Screenshot thumbnail rendering in chat messages
 * - PANEL-09 full-screen overlay: open, close, escape key
 *
 * RED Phase (Task 1): page_screenshot stub returns placeholder -> 5 tests fail
 *                     PANEL-09 overlay not yet implemented -> 3 tests fail
 * GREEN Phase (Task 2): page_screenshot implemented -> Tests 1-5 pass
 * GREEN Phase (Task 3): PANEL-09 overlay implemented -> Tests 6-8 pass
 */

// Polyfill TextEncoder/TextDecoder for jsdom
var { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Load chrome mock
require('./__mocks__/chrome.js');

// Preset storage for panel profile loading (needed for GobyPanel.init)
beforeAll(function () {
  return chrome.storage.local.set({
    agentConfig: {
      profiles: {
        'TestProfile': { baseUrl: 'http://test.com', apiKey: 'test-key', model: 'test-model' }
      },
      activeProfile: 'TestProfile'
    }
  });
});

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
 * Helper: get tool execute function by name from nativeTools
 */
function getTool(name) {
  return window.GobyAgent.nativeTools.find(function (t) {
    return t.function.name === name;
  });
}

// ================================================================
//  page_screenshot tests (Tests 1-5)
// ================================================================
describe('page_screenshot', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    // Clean up any Goby UI artifacts from previous module loads
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  });

  // ---------------------------------------------------------------
  //  Test 1: page_screenshot exists and returns non-placeholder
  //  RED: stub returns "工具将在后续版本可用" -> assertion fails
  //  GREEN: returns data URL or error -> assertion passes
  // ---------------------------------------------------------------
  test('Test 1: page_screenshot tool exists and returns non-placeholder response', async function () {
    loadModules();
    var tool = getTool('page_screenshot');
    expect(tool).toBeDefined();
    expect(tool.function.name).toBe('page_screenshot');
    expect(typeof tool.execute).toBe('function');

    // Mock sendMessage to return a data URL for page-screenshot action
    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'page-screenshot') {
        return Promise.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
      }
      return Promise.resolve({});
    });

    var result = await tool.execute({});
    // RED-phase assertion: fails because stub returns placeholder
    // GREEN-phase assertion: passes because execute returns real response
    expect(result).not.toBe('工具将在后续版本可用');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  //  Test 2: page_screenshot hides panel during capture
  //  RED: stub doesn't touch panel state -> assertion fails
  //  GREEN: execute temporarily hides panel -> assertion passes
  // ---------------------------------------------------------------
  test('Test 2: page_screenshot hides panel before capturing screenshot', async function () {
    loadModules();
    // Initialize and show panel
    await GobyPanel.init();
    await GobyPanel.show();

    var tool = getTool('page_screenshot');

    // Mock sendMessage to return a controlled Promise
    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'page-screenshot') {
        return Promise.resolve('data:image/png;base64,test');
      }
      return Promise.resolve({});
    });

    var host = document.getElementById('goby-panel-host');
    var sr = host.shadowRoot;
    var panel = sr.querySelector('.goby-panel');

    // Panel should be visible initially
    expect(panel.classList.contains('goby-panel-visible')).toBe(true);

    // Start execute - panel hides synchronously before any async work
    var execPromise = tool.execute({});

    // RED: stub doesn't hide panel -> assertion fails
    // GREEN: panel class changed to hidden -> assertion passes
    expect(panel.classList.contains('goby-panel-hidden')).toBe(true);

    // Wait for async completion
    await execPromise;
  });

  // ---------------------------------------------------------------
  //  Test 3: page_screenshot restores panel after capture
  //  RED: panel never hidden, but visible check passes -> may pass
  //  GREEN: panel restored to visible after capture -> passes
  // ---------------------------------------------------------------
  test('Test 3: page_screenshot restores panel visibility after capture', async function () {
    loadModules();
    await GobyPanel.init();
    await GobyPanel.show();

    var tool = getTool('page_screenshot');

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'page-screenshot') {
        return Promise.resolve('data:image/png;base64,test');
      }
      return Promise.resolve({});
    });

    var host = document.getElementById('goby-panel-host');
    var sr = host.shadowRoot;
    var panel = sr.querySelector('.goby-panel');

    await tool.execute({});

    // Panel should be visible after capture
    expect(panel.classList.contains('goby-panel-visible')).toBe(true);
    expect(panel.classList.contains('goby-panel-hidden')).toBe(false);
  });

  // ---------------------------------------------------------------
  //  Test 4: page_screenshot returns data URL from SW
  //  RED: stub returns "工具将在后续版本可用" -> assertion fails
  //  GREEN: execute returns the data URL -> assertion passes
  // ---------------------------------------------------------------
  test('Test 4: page_screenshot returns data URL from Service Worker', async function () {
    loadModules();
    var tool = getTool('page_screenshot');

    var testDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'page-screenshot') {
        return Promise.resolve(testDataUrl);
      }
      return Promise.resolve({});
    });

    var result = await tool.execute({});

    // RED: result is "工具将在后续版本可用" -> fails
    // GREEN: result is the testDataUrl -> passes
    expect(result).toBe(testDataUrl);
    expect(result.indexOf('data:image/')).toBe(0);
  });

  // ---------------------------------------------------------------
  //  Test 5: page_screenshot handles SW error gracefully
  //  RED: stub returns placeholder regardless -> assertion fails
  //  GREEN: returns "Error: 截图失败 - ..." string -> passes
  // ---------------------------------------------------------------
  test('Test 5: page_screenshot returns error when SW capture fails', async function () {
    loadModules();
    var tool = getTool('page_screenshot');

    chrome.runtime.sendMessage.mockImplementation(function (msg) {
      if (msg && msg.action === 'page-screenshot') {
        return Promise.reject(new Error('capture failed'));
      }
      return Promise.resolve({});
    });

    var result = await tool.execute({});

    // RED: result is "工具将在后续版本可用" -> assertion fails
    // GREEN: result is error string -> passes
    expect(result).not.toBe('工具将在后续版本可用');
    expect(typeof result).toBe('string');
    expect(result).toContain('Error');
  });
});

// ================================================================
//  Screenshot overlay tests (Tests 6-8, PANEL-09)
// ================================================================
describe('Screenshot Overlay (PANEL-09)', function () {
  beforeEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
    chrome.storage.local._reset();
    document.querySelectorAll('.goby-floating-ball, #goby-panel-host').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  });

  // ---------------------------------------------------------------
  //  Test 6: Screenshot thumbnail rendered as img element in chat
  //  RED: appendMessage uses textContent for tool messages -> no img
  //  GREEN: appendMessage detects data:image/ -> creates img element
  // ---------------------------------------------------------------
  test('Test 6: screenshot thumbnail renders as img element in chat bubble', async function () {
    loadModules();
    await GobyPanel.init();
    await GobyPanel.show();

    var dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    GobyPanel.appendMessage('tool', dataUrl);

    var host = document.getElementById('goby-panel-host');
    var sr = host.shadowRoot;
    var toolBubble = sr.querySelector('.goby-msg-tool');

    // Tool bubble should exist
    expect(toolBubble).not.toBeNull();

    // RED: tool bubble uses textContent -> no img element -> assertion fails
    // GREEN: tool bubble contains img element with proper styling
    var thumbImg = toolBubble.querySelector('img');
    expect(thumbImg).not.toBeNull();
    expect(thumbImg.src).toBe(dataUrl);
    expect(thumbImg.style.maxWidth).toBe('200px');
    expect(thumbImg.style.maxHeight).toBe('150px');
    expect(thumbImg.style.cursor).toBe('pointer');
  });

  // ---------------------------------------------------------------
  //  Test 7: Clicking thumbnail opens screenshot overlay
  //  RED: no img element to click / no overlay -> assertion fails
  //  GREEN: img click triggers overlay display -> assertion passes
  // ---------------------------------------------------------------
  test('Test 7: clicking screenshot thumbnail opens full-screen overlay', async function () {
    loadModules();
    await GobyPanel.init();
    await GobyPanel.show();

    var dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    GobyPanel.appendMessage('tool', dataUrl);

    var host = document.getElementById('goby-panel-host');
    var sr = host.shadowRoot;
    var thumbImg = sr.querySelector('.goby-msg-tool img');

    // RED: thumbImg is null -> assertion fails
    expect(thumbImg).not.toBeNull();

    // Click the thumbnail
    thumbImg.click();

    // Check overlay is visible
    var overlay = sr.querySelector('#goby-screenshot-overlay');

    // RED: no overlay element exists -> assertion fails
    // GREEN: overlay is displayed (flex) -> passes
    expect(overlay).not.toBeNull();
    expect(overlay.style.display).toBe('flex');
  });

  // ---------------------------------------------------------------
  //  Test 8: Overlay closes on background click or close button
  //  RED: no overlay element -> assertion fails
  //  GREEN: overlay display set to 'none' -> passes
  // ---------------------------------------------------------------
  test('Test 8: clicking overlay background closes the overlay', async function () {
    loadModules();
    await GobyPanel.init();
    await GobyPanel.show();

    var dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    GobyPanel.appendMessage('tool', dataUrl);

    var host = document.getElementById('goby-panel-host');
    var sr = host.shadowRoot;
    var thumbImg = sr.querySelector('.goby-msg-tool img');

    // RED: thumbImg is null -> assertion fails early
    expect(thumbImg).not.toBeNull();

    // Open overlay by clicking thumbnail
    thumbImg.click();

    var overlay = sr.querySelector('#goby-screenshot-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.style.display).toBe('flex');

    // Click overlay background to close
    overlay.click();

    // RED: no overlay -> fails
    // GREEN: overlay hidden (display: none) -> passes
    expect(overlay.style.display).toBe('none');
  });
});
