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
