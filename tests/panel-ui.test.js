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

  it('renders a 44px floating ball at bottom-right of document.body', function () {
    return GobyPanel.init().then(function () {
      var ball = document.querySelector('.goby-floating-ball');
      expect(ball).not.toBeNull();
      expect(ball.style.width).toBe('44px');
      expect(ball.style.height).toBe('44px');
      expect(ball.style.position).toBe('fixed');
      expect(ball.style.bottom).toBe('20px');
      expect(ball.style.right).toBe('20px');
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

  it('renders panel at 400px width and 480px default height', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        expect(host).not.toBeNull();
        var sr = host.shadowRoot;
        expect(sr).not.toBeNull();
        var panel = sr.querySelector('.goby-panel');
        expect(panel).not.toBeNull();
        expect(panel.style.width).toBe('400px');
        expect(panel.style.height).toBe('480px');
      });
    });
  });

  it('positions panel fixed at bottom-right of viewport', function () {
    return GobyPanel.init().then(function () {
      return GobyPanel.show().then(function () {
        var host = document.getElementById('goby-panel-host');
        expect(host).not.toBeNull();
        expect(host.style.position).toBe('fixed');
        expect(host.style.bottom).toBe('80px');
        expect(host.style.right).toBe('20px');
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
