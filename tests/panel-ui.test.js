/**
 * Panel UI tests — Floating ball and Shadow DOM panel shell
 *
 * Tests cover PANEL-01, PANEL-04, PANEL-10 requirements:
 * - Floating ball (44px, fixed bottom-right, tooltip, click toggle)
 * - Shadow DOM panel (isolation, 400x480, fixed, title bar, animations)
 * - State persistence to chrome.storage.local
 *
 * RED phase: all tests expect features not yet implemented in panel.js,
 * resulting in FAIL during Task 1.
 * GREEN phase (Task 2): panel.js rewritten to implement these features,
 * all tests become PASS.
 */

require('./__mocks__/chrome.js');
require('../storage.js');
require('../panel.js');

// Polyfill PointerEvent for jsdom（生产代码用 pointer events 统一鼠标和触摸）
if (typeof PointerEvent === 'undefined') {
  function PolyfillPointerEvent(type, params) {
    var ev = new MouseEvent(type, params || {});
    ev.pointerId = (params && params.pointerId) !== undefined ? params.pointerId : 0;
    ev.pointerType = (params && params.pointerType) || 'mouse';
    return ev;
  }
  PolyfillPointerEvent.prototype = MouseEvent.prototype;
  global.PointerEvent = PolyfillPointerEvent;
  window.PointerEvent = PolyfillPointerEvent;
}

// ============================================================
//  Describe: Floating Ball
//  D-01, D-02, PANEL-10
// ============================================================

describe('Floating Ball', function () {
  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
    // Clean up any leftover elements from previous tests
    ['.goby-floating-ball', '.goby-panel-container', '#goby-panel-host']
      .forEach(function (sel) {
        var list = document.querySelectorAll(sel);
        list.forEach(function (el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
      });
  });

  it('renders a 44px floating ball positioned within viewport (default bottom-right)', function () {
    return GobyPanel.init().then(function () {
      var ball = document.querySelector('.goby-floating-ball');
      expect(ball).not.toBeNull();
      expect(ball.style.width).toBe('44px');
      expect(ball.style.height).toBe('44px');
      expect(ball.style.position).toBe('fixed');
      // 新行为：拖拽用 left/top（替代 bottom/right）
      expect(ball.style.left).toMatch(/^\d+px$/);
      expect(ball.style.top).toMatch(/^\d+px$/);
      // 默认位置：贴近视口右下角
      var left = parseInt(ball.style.left, 10);
      var top = parseInt(ball.style.top, 10);
      expect(left).toBe(window.innerWidth - 44 - 20);
      expect(top).toBe(window.innerHeight - 44 - 20);
    });
  });

  it('shows tooltip "Goby AI 助手" on hover', function () {
    return GobyPanel.init().then(function () {
      var ball = document.querySelector('.goby-floating-ball');
      expect(ball).not.toBeNull();
      expect(ball.title).toBe('Goby AI 助手');
    });
  });

  it('toggles panel visibility on click', function () {
    return GobyPanel.init().then(function () {
      var ball = document.querySelector('.goby-floating-ball');
      expect(ball).not.toBeNull();

      // First click: show panel
      ball.click();
      expect(GobyPanel.getState().isVisible).toBe(true);

      // Second click: hide panel
      ball.click();
      expect(GobyPanel.getState().isVisible).toBe(false);
    });
  });
});

// ============================================================
//  Describe: Shadow DOM Panel Shell
//  D-03, D-04, D-05, D-08, PANEL-01, PANEL-04
// ============================================================

describe('Shadow DOM Panel Shell', function () {
  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
    ['.goby-floating-ball', '.goby-panel-container', '#goby-panel-host']
      .forEach(function (sel) {
        var list = document.querySelectorAll(sel);
        list.forEach(function (el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
      });
  });

  it('uses Shadow DOM for panel isolation', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        expect(host).not.toBeNull();
        expect(host.shadowRoot).not.toBeNull();
      });
    });
  });

  it('renders panel host with 400x480 default geometry, panel fills host', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        expect(host).not.toBeNull();
        // 默认几何在 host 上（panel 是 100% 占满）
        expect(host.style.width).toBe('400px');
        expect(host.style.height).toBe('480px');
        var sr = host.shadowRoot;
        expect(sr).not.toBeNull();
        var panel = sr.querySelector('.goby-panel');
        expect(panel).not.toBeNull();
        expect(panel.style.width).toBe('100%');
        expect(panel.style.height).toBe('100%');
      });
    });
  });

  it('positions panel fixed at bottom-right of viewport (via left/top)', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        expect(host).not.toBeNull();
        expect(host.style.position).toBe('fixed');
        // 新行为：用 left/top 替代 bottom/right（便于 resize 时绝对定位）
        expect(parseInt(host.style.left, 10)).toBe(window.innerWidth - 400 - 20);
        expect(parseInt(host.style.top, 10)).toBe(window.innerHeight - 480 - 80);
      });
    });
  });

  it('has a title bar with "Goby" text and close button "—"', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        expect(host).not.toBeNull();
        var sr = host.shadowRoot;
        expect(sr).not.toBeNull();
        var header = sr.querySelector('.goby-panel-header');
        expect(header).not.toBeNull();
        expect(header.textContent).toContain('Goby');

        var closeBtn = sr.querySelector('.goby-close-btn');
        expect(closeBtn).not.toBeNull();
        expect(closeBtn.textContent).toContain('—');
      });
    });
  });

  it('applies scale+opacity transition on show (200ms ease)', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        expect(host).not.toBeNull();
        var sr = host.shadowRoot;
        expect(sr).not.toBeNull();
        var panel = sr.querySelector('.goby-panel');
        expect(panel).not.toBeNull();
        expect(panel.style.transition).toContain('transform 200ms ease');
        expect(panel.style.transition).toContain('opacity 200ms ease');
      });
    });
  });
});

// ============================================================
//  Describe: State Persistence
//  D-01
// ============================================================

describe('State Persistence', function () {
  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
  });

  it('persists panel visibility state to chrome.storage.local', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.toggle().then(function () {
        expect(chrome.storage.local.set).toHaveBeenCalled();
        var args = chrome.storage.local.set.mock.calls[0][0];
        expect(args.gobyPanelState).toBeDefined();
        expect(args.gobyPanelState.isVisible).toBeDefined();
        expect(args.gobyPanelState.isVisible).toBe(true);
      });
    });
  });
});

// ============================================================
//  Describe: Chat Area and Welcome Message
//  D-11, D-12
// ============================================================

describe('Chat Area and Welcome Message', function () {
  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
    ['.goby-floating-ball', '.goby-panel-container', '#goby-panel-host']
      .forEach(function (sel) {
        var list = document.querySelectorAll(sel);
        list.forEach(function (el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
      });
  });

  it('shows welcome message when chat area is empty', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        expect(host).not.toBeNull();
        var sr = host.shadowRoot;
        expect(sr).not.toBeNull();
        var welcomeEl = sr.querySelector('.goby-welcome');
        expect(welcomeEl).not.toBeNull();
        expect(welcomeEl.textContent).toContain('你好！我是 Goby');
        expect(welcomeEl.textContent).toContain('AI 浏览器助手');
      });
    });
  });

  it('welcome message lists available tool categories', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var welcomeEl = sr.querySelector('.goby-welcome');
        expect(welcomeEl).not.toBeNull();
        var toolTags = ['填写表单', '点击按钮', '查询内容', '分析页面',
          '截图', '剪贴板', '计算', '时间'];
        var foundCount = 0;
        toolTags.forEach(function (tag) {
          if (welcomeEl.textContent.indexOf(tag) !== -1) foundCount++;
        });
        expect(foundCount).toBeGreaterThanOrEqual(3);
      });
    });
  });

  it('hides welcome message after first message is sent', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var textarea = sr.querySelector('.goby-input-textarea');
        if (textarea) {
          textarea.value = '测试消息';
          var event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false });
          textarea.dispatchEvent(event);
        } else {
          // If textarea doesn't exist yet, try sendMessage
          GobyPanel.sendMessage();
        }
        var welcomeEl = sr.querySelector('.goby-welcome');
        if (welcomeEl) {
          expect(welcomeEl.style.display).toBe('none');
        }
      });
    });
  });
});

// ============================================================
//  Describe: Input Bar and Send Behavior
//  D-06, D-07, PANEL-03
// ============================================================

describe('Input Bar and Send Behavior', function () {
  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
    ['.goby-floating-ball', '.goby-panel-container', '#goby-panel-host']
      .forEach(function (sel) {
        var list = document.querySelectorAll(sel);
        list.forEach(function (el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
      });
  });

  it('has a textarea input with auto-resize between 40px and 100px', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var textarea = sr.querySelector('.goby-input-textarea');
        expect(textarea).not.toBeNull();
        expect(textarea.tagName).toBe('TEXTAREA');
        // Check min-height and max-height constraints
        expect(textarea.style.minHeight).toBe('40px');
        expect(textarea.style.maxHeight).toBe('100px');
      });
    });
  });

  it('has a send button with purple gradient and ➤ icon', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var btn = sr.querySelector('.goby-send-btn');
        expect(btn).not.toBeNull();
        expect(btn.textContent).toContain('➤');
        expect(btn.style.background).toBeTruthy();
      });
    });
  });

  it('sends message on Enter key (without Shift)', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var textarea = sr.querySelector('.goby-input-textarea');
        expect(textarea).not.toBeNull();
        textarea.value = '测试消息';
        var event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false });
        textarea.dispatchEvent(event);
        // New user message bubble should appear
        var userBubble = sr.querySelector('.goby-msg-user');
        expect(userBubble).not.toBeNull();
        expect(userBubble.textContent).toContain('测试消息');
        // Input should be cleared after send
        expect(textarea.value).toBe('');
      });
    });
  });

  it('inserts newline on Shift+Enter', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var textarea = sr.querySelector('.goby-input-textarea');
        expect(textarea).not.toBeNull();
        textarea.value = '第一行';
        var event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true });
        textarea.dispatchEvent(event);
        // After Shift+Enter, textarea should contain newline
        expect(textarea.value.indexOf('\n')).toBeGreaterThanOrEqual(0);
        // No new message bubbles should appear
        var userBubbles = sr.querySelectorAll('.goby-msg-user');
        expect(userBubbles.length).toBe(0);
      });
    });
  });

  it('sends message on send button click', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var textarea = sr.querySelector('.goby-input-textarea');
        var sendBtn = sr.querySelector('.goby-send-btn');
        expect(textarea).not.toBeNull();
        expect(sendBtn).not.toBeNull();
        textarea.value = '按钮发送';
        sendBtn.click();
        var userBubble = sr.querySelector('.goby-msg-user');
        expect(userBubble).not.toBeNull();
        expect(userBubble.textContent).toContain('按钮发送');
      });
    });
  });

  it('does not send empty or whitespace-only messages', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var textarea = sr.querySelector('.goby-input-textarea');
        expect(textarea).not.toBeNull();
        // Try sending whitespace-only
        textarea.value = '   ';
        var event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false });
        textarea.dispatchEvent(event);
        var userBubbles = sr.querySelectorAll('.goby-msg-user');
        expect(userBubbles.length).toBe(0);
      });
    });
  });
});

// ============================================================
//  Describe: Title Bar Icons
//  PANEL-04 — settings, session, close buttons
// ============================================================

describe('Title Bar Icons', function () {
  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
    ['.goby-floating-ball', '.goby-panel-container', '#goby-panel-host']
      .forEach(function (sel) {
        var list = document.querySelectorAll(sel);
        list.forEach(function (el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
      });
    // Mock openSettingsModal
    window.openSettingsModal = jest.fn();
  });

  it('has settings button (⚙) in the title bar', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var settingsBtn = sr.querySelector('#goby-settings-btn');
        expect(settingsBtn).not.toBeNull();
        expect(settingsBtn.textContent).toContain('⚙');
        expect(settingsBtn.title).toBe('设置');
      });
    });
  });

  it('settings button opens the settings modal when clicked', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var settingsBtn = sr.querySelector('#goby-settings-btn');
        expect(settingsBtn).not.toBeNull();
        settingsBtn.click();
        expect(window.openSettingsModal).toHaveBeenCalledTimes(1);
      });
    });
  });

  it('has session list button (📋) in the title bar', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var sessionBtn = sr.querySelector('#goby-session-btn');
        expect(sessionBtn).not.toBeNull();
        expect(sessionBtn.textContent).toContain('📋');
        expect(sessionBtn.title).toContain('会话');
      });
    });
  });

  it('has close button (—) in the title bar that hides the panel', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var closeBtn = sr.querySelector('#goby-close-btn');
        expect(closeBtn).not.toBeNull();
        expect(closeBtn.textContent).toContain('—');
        closeBtn.click();
        expect(GobyPanel.getState().isVisible).toBe(false);
      });
    });
  });
});

// ============================================================
//  Describe: Status Bar
//  PANEL-05 — model name, connection status dot, round counter
// ============================================================

describe('Status Bar', function () {
  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
    ['.goby-floating-ball', '.goby-panel-container', '#goby-panel-host']
      .forEach(function (sel) {
        var list = document.querySelectorAll(sel);
        list.forEach(function (el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
      });
    // Preset storage config with a test profile
    chrome.storage.local.get('agentConfig').then(function () {
      chrome.storage.local.set({
        agentConfig: {
          profiles: {
            'TestProfile': { baseUrl: 'http://test.com', apiKey: 'test-key', model: 'gpt-4' }
          },
          activeProfile: 'TestProfile'
        }
      });
    });
  });

  it('displays the current model name from chrome.storage.local config', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var statusBar = sr.querySelector('.goby-status-bar');
        expect(statusBar).not.toBeNull();
        expect(statusBar.textContent).toContain('gpt-4');
      });
    });
  });

  it('shows a connection status dot (gray by default)', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var statusDot = sr.querySelector('.goby-status-dot');
        expect(statusDot).not.toBeNull();
        // Default should be gray class
        expect(statusDot.className).toContain('gray');
      });
    });
  });

  it('displays round count starting at "第 0 轮"', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var statusBar = sr.querySelector('.goby-status-bar');
        expect(statusBar).not.toBeNull();
        expect(statusBar.textContent).toMatch(/0.*轮|第.*0.*轮/);
      });
    });
  });

  it('accepts status updates via updateStatusBar()', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        GobyPanel.updateStatusBar({ modelName: 'qwen', connectionStatus: 'green', roundCount: 3 });
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var statusBar = sr.querySelector('.goby-status-bar');
        expect(statusBar).not.toBeNull();
        expect(statusBar.textContent).toContain('qwen');
        expect(statusBar.textContent).toContain('3');
        var statusDot = sr.querySelector('.goby-status-dot');
        expect(statusDot).not.toBeNull();
        expect(statusDot.className).toContain('green');
      });
    });
  });
});

// ============================================================
//  Describe: Drag Resize Handles
//  Quick 260627-hae — 8 个 handle (n/s/e/w/ne/nw/se/sw)，pointer events，
//  支持四边和四角调整大小，最小 320x360，位置/尺寸持久化
// ============================================================

describe('Drag Resize Handle', function () {
  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
    ['.goby-floating-ball', '.goby-panel-container', '#goby-panel-host']
      .forEach(function (sel) {
        var list = document.querySelectorAll(sel);
        list.forEach(function (el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
      });
  });

  // jsdom 在新版本支持 PointerEvent；老版本回退到 MouseEvent
  function makeEvent(type, props) {
    var EvCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
    try {
      return new EvCtor(type, Object.assign({ bubbles: true }, props));
    } catch (e) {
      return new MouseEvent(type, Object.assign({ bubbles: true }, props));
    }
  }

  it('has 8 resize handles (n/s/e/w/ne/nw/se/sw) on the panel edges', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var handles = sr.querySelectorAll('.goby-resize-handle');
        expect(handles.length).toBe(8);
        var dirs = Array.prototype.map.call(handles, function (h) { return h.dataset.dir; });
        ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(function (d) {
          expect(dirs).toContain(d);
        });
      });
    });
  });

  it('south handle increases panel height on pointer drag down', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var handle = sr.querySelector('.goby-resize-handle[data-dir="s"]');
        expect(handle).not.toBeNull();

        var initialHeight = parseInt(host.style.height, 10);

        handle.dispatchEvent(makeEvent('pointerdown', { clientY: 100, pointerId: 1 }));
        handle.dispatchEvent(makeEvent('pointermove', { clientY: 150, pointerId: 1 }));
        handle.dispatchEvent(makeEvent('pointerup', { pointerId: 1 }));

        var newHeight = parseInt(host.style.height, 10);
        expect(newHeight).toBe(initialHeight + 50);
      });
    });
  });

  it('clamps minimum panel size to 320x360', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var seHandle = sr.querySelector('.goby-resize-handle[data-dir="nw"]');
        expect(seHandle).not.toBeNull();

        // 极限拖动 nw 角向右下，企图把面板缩小到极小
        seHandle.dispatchEvent(makeEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
        seHandle.dispatchEvent(makeEvent('pointermove', { clientX: 2000, clientY: 2000, pointerId: 1 }));
        seHandle.dispatchEvent(makeEvent('pointerup', { pointerId: 1 }));

        expect(parseInt(host.style.width, 10)).toBeGreaterThanOrEqual(320);
        expect(parseInt(host.style.height, 10)).toBeGreaterThanOrEqual(360);
      });
    });
  });

  it('east handle decreases panel width (drag left) without moving left/top', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var handle = sr.querySelector('.goby-resize-handle[data-dir="e"]');
        expect(handle).not.toBeNull();

        var initialLeft = parseInt(host.style.left, 10);
        var initialTop = parseInt(host.style.top, 10);
        var initialWidth = parseInt(host.style.width, 10);

        // 向左拖 50px：width 缩小，left/top 不变
        handle.dispatchEvent(makeEvent('pointerdown', { clientX: 200, pointerId: 1 }));
        handle.dispatchEvent(makeEvent('pointermove', { clientX: 150, pointerId: 1 }));
        handle.dispatchEvent(makeEvent('pointerup', { pointerId: 1 }));

        expect(parseInt(host.style.width, 10)).toBe(initialWidth - 50);
        expect(parseInt(host.style.left, 10)).toBe(initialLeft);
        expect(parseInt(host.style.top, 10)).toBe(initialTop);
      });
    });
  });

  it('west handle moves left edge: width decreases, left position changes', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var handle = sr.querySelector('.goby-resize-handle[data-dir="w"]');
        expect(handle).not.toBeNull();

        var initialLeft = parseInt(host.style.left, 10);
        var initialWidth = parseInt(host.style.width, 10);

        // 向右拖 50px：left+50，width-50
        handle.dispatchEvent(makeEvent('pointerdown', { clientX: 500, pointerId: 1 }));
        handle.dispatchEvent(makeEvent('pointermove', { clientX: 550, pointerId: 1 }));
        handle.dispatchEvent(makeEvent('pointerup', { pointerId: 1 }));

        expect(parseInt(host.style.left, 10)).toBe(initialLeft + 50);
        expect(parseInt(host.style.width, 10)).toBe(initialWidth - 50);
      });
    });
  });

  it('persists geometry to chrome.storage.local after resize', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var handle = sr.querySelector('.goby-resize-handle[data-dir="s"]');

        handle.dispatchEvent(makeEvent('pointerdown', { clientY: 100, pointerId: 1 }));
        handle.dispatchEvent(makeEvent('pointermove', { clientY: 200, pointerId: 1 }));
        handle.dispatchEvent(makeEvent('pointerup', { pointerId: 1 }));

        return chrome.storage.local.get(['gobyPanelGeometry']).then(function (result) {
          var g = result && result.gobyPanelGeometry;
          expect(g).toBeDefined();
          expect(typeof g.left).toBe('number');
          expect(typeof g.top).toBe('number');
          expect(typeof g.w).toBe('number');
          expect(typeof g.h).toBe('number');
          expect(g.h).toBeGreaterThanOrEqual(580); // 480 + 100
        });
      });
    });
  });
});

// ============================================================
//  Describe: Floating Ball Drag
//  Quick 260627-hae — 悬浮球任意拖拽，5px 阈值区分 click/drag
// ============================================================

describe('Floating Ball Drag', function () {
  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
    ['.goby-floating-ball', '.goby-panel-container', '#goby-panel-host']
      .forEach(function (sel) {
        var list = document.querySelectorAll(sel);
        list.forEach(function (el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
      });
  });

  function makeEvent(type, props) {
    var EvCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
    try {
      return new EvCtor(type, Object.assign({ bubbles: true }, props));
    } catch (e) {
      return new MouseEvent(type, Object.assign({ bubbles: true }, props));
    }
  }

  it('ball can be dragged to a new position; position persists', function () {
    return GobyPanel.init().then(function () {
      var ball = document.querySelector('.goby-floating-ball');
      var initialLeft = parseInt(ball.style.left, 10);
      var initialTop = parseInt(ball.style.top, 10);

      // 往左上拖 50/30，避免触发视口边界 clamp
      ball.dispatchEvent(makeEvent('pointerdown', { clientX: initialLeft + 22, clientY: initialTop + 22, pointerId: 1 }));
      ball.dispatchEvent(makeEvent('pointermove', { clientX: initialLeft + 22 - 50, clientY: initialTop + 22 - 30, pointerId: 1 }));
      ball.dispatchEvent(makeEvent('pointerup', { pointerId: 1 }));

      expect(parseInt(ball.style.left, 10)).toBe(initialLeft - 50);
      expect(parseInt(ball.style.top, 10)).toBe(initialTop - 30);

      return chrome.storage.local.get(['gobyBallPosition']).then(function (result) {
        var pos = result && result.gobyBallPosition;
        expect(pos).toBeDefined();
        expect(pos.x).toBe(initialLeft - 50);
        expect(pos.y).toBe(initialTop - 30);
      });
    });
  });

  it('sub-threshold movement (<5px) does not suppress click toggle', function () {
    return GobyPanel.init().then(function () {
      var ball = document.querySelector('.goby-floating-ball');
      var initialLeft = parseInt(ball.style.left, 10);
      var initialTop = parseInt(ball.style.top, 10);

      // 微小移动 < 5px 阈值，仍视为 click
      ball.dispatchEvent(makeEvent('pointerdown', { clientX: 0, clientY: 0, pointerId: 1 }));
      ball.dispatchEvent(makeEvent('pointermove', { clientX: 2, clientY: 3, pointerId: 1 }));
      ball.dispatchEvent(makeEvent('pointerup', { pointerId: 1 }));

      // 位置不变
      expect(parseInt(ball.style.left, 10)).toBe(initialLeft);
      expect(parseInt(ball.style.top, 10)).toBe(initialTop);

      // click 应该 toggle 面板
      ball.click();
      expect(GobyPanel.getState().isVisible).toBe(true);
    });
  });
});

// ============================================================
//  Describe: Message Bubble Rendering
//  PANEL-02, SEC-02
// ============================================================

describe('Message Bubble Rendering', function () {
  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
    ['.goby-floating-ball', '.goby-panel-container', '#goby-panel-host']
      .forEach(function (sel) {
        var list = document.querySelectorAll(sel);
        list.forEach(function (el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
      });
  });

  it('renders user messages as right-aligned purple bubbles', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        GobyPanel.appendMessage('user', '用户消息内容');
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var userBubble = sr.querySelector('.goby-msg-user');
        expect(userBubble).not.toBeNull();
        expect(userBubble.textContent).toBe('用户消息内容');
      });
    });
  });

  it('renders bot messages as left-aligned gray bubbles', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        GobyPanel.appendMessage('bot', 'Bot 回复内容');
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var botBubble = sr.querySelector('.goby-msg-bot');
        expect(botBubble).not.toBeNull();
        expect(botBubble.textContent).toBe('Bot 回复内容');
      });
    });
  });

  it('uses textContent for user messages (no HTML rendering per SEC-02)', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        GobyPanel.appendMessage('user', '<img src=x onerror=alert(1)>');
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var userBubble = sr.querySelector('.goby-msg-user');
        expect(userBubble).not.toBeNull();
        // textContent should include the literal string
        expect(userBubble.textContent).toContain('<img src=x onerror=alert(1)>');
        // innerHTML should not contain <img> tag
        expect(userBubble.innerHTML.indexOf('<img')).toBe(-1);
      });
    });
  });

  it('applies fade-in animation to new message bubbles', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        GobyPanel.appendMessage('user', '淡入动画测试');
        var host = document.getElementById('goby-panel-host');
        var sr = host.shadowRoot;
        var userBubble = sr.querySelector('.goby-msg-user');
        expect(userBubble).not.toBeNull();
        // Check for animation style or fade-in class
        var hasAnimation = userBubble.style.animationName === 'msgFadeIn' ||
          userBubble.style.animation !== '' ||
          (userBubble.className && userBubble.className.indexOf('fade') !== -1);
        expect(hasAnimation).toBe(true);
      });
    });
  });
});

// ============================================================
//  Describe: Panel init isVisible restore (quick-260620-ii7 Fix A)
//  整页跳转后从 chrome.storage.local.gobyPanelState.isVisible 恢复
// ============================================================

describe('Panel init isVisible restore', function () {
  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
    ['.goby-floating-ball', '.goby-panel-container', '#goby-panel-host']
      .forEach(function (sel) {
        var list = document.querySelectorAll(sel);
        list.forEach(function (el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
      });
  });

  it('restores isVisible=true from chrome.storage.local on init', function () {
    chrome.storage.local._raw.gobyPanelState = { isVisible: true };
    return GobyPanel.init().then(function () {
      expect(GobyPanel.getState().isVisible).toBe(true);
    });
  });

  it('restores isVisible=false from chrome.storage.local on init', function () {
    chrome.storage.local._raw.gobyPanelState = { isVisible: false };
    return GobyPanel.init().then(function () {
      expect(GobyPanel.getState().isVisible).toBe(false);
    });
  });

  it('defaults isVisible=false on first install (empty storage)', function () {
    return GobyPanel.init().then(function () {
      expect(GobyPanel.getState().isVisible).toBe(false);
    });
  });

  it('calls animateShow when restoring isVisible=true (panel className has goby-panel-visible)', function () {
    chrome.storage.local._raw.gobyPanelState = { isVisible: true };
    return GobyPanel.init().then(function () {
      expect(GobyPanel.getState().isVisible).toBe(true);
      var host = document.getElementById('goby-panel-host');
      // init 在 isVisible=true 时应通过 animateShow 创建 panel shell 并应用 visible class
      expect(host).not.toBeNull();
      var sr = host.shadowRoot;
      expect(sr).not.toBeNull();
      var panel = sr.querySelector('.goby-panel');
      expect(panel).not.toBeNull();
      expect(panel.className).toContain('goby-panel-visible');
    });
  });
});
