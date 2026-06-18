// Goby - AI 浏览器助手 | 面板状态管理和 DOM 操作
// Plan 02-01: Shadow DOM 面板壳 + 悬浮球交互
// 依赖: storage.js（manifest content_scripts 顺序注入）

(function () {
  'use strict';

  // ============================================================
  //  PANEL_CSS — Shadow DOM 内联样式
  //  宿主页面样式无法穿透 Shadow DOM 影响面板内部
  // ============================================================

  var PANEL_CSS = [
    '.goby-panel {',
    '  width: 400px;',
    '  height: 480px;',
    '  background: #ffffff;',
    '  border-radius: 12px;',
    '  box-shadow: 0 20px 60px rgba(0,0,0,0.3);',
    '  overflow: hidden;',
    '  display: flex;',
    '  flex-direction: column;',
    '  transition: transform 200ms ease, opacity 200ms ease;',
    '}',
    '.goby-panel-hidden {',
    '  opacity: 0;',
    '  transform: scale(0.95);',
    '  pointer-events: none;',
    '}',
    '.goby-panel-visible {',
    '  opacity: 1;',
    '  transform: scale(1);',
    '  pointer-events: auto;',
    '}',
    '.goby-panel-header {',
    '  min-height: 36px;',
    '  padding: 8px 14px;',
    '  background: linear-gradient(135deg, #667eea, #764ba2);',
    '  color: #ffffff;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  flex-shrink: 0;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
    '}',
    '.goby-panel-header .goby-title {',
    '  font-size: 15px;',
    '  font-weight: 600;',
    '}',
    '.goby-close-btn {',
    '  width: 28px;',
    '  height: 28px;',
    '  background: transparent;',
    '  border: none;',
    '  color: #ffffff;',
    '  cursor: pointer;',
    '  font-size: 18px;',
    '  border-radius: 4px;',
    '  transition: background 0.15s;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  padding: 0;',
    '  line-height: 1;',
    '}',
    '.goby-close-btn:hover {',
    '  background: rgba(255,255,255,0.15);',
    '}',
    '#goby-chat-area {',
    '  flex: 1;',
    '  overflow-y: auto;',
    '  background: #f9fafb;',
    '}'
  ].join('\n');

  // ============================================================
  //  私有状态
  // ============================================================

  var state = {
    isVisible: false
  };

  var _ball = null;
  var _host = null;

  // ============================================================
  //  持久化面板状态到 chrome.storage.local
  //  键: gobyPanelState — { isVisible: boolean }
  // ============================================================

  function persistState() {
    return chrome.storage.local.set({
      gobyPanelState: { isVisible: state.isVisible }
    });
  }

  // ============================================================
  //  创建悬浮球（外部 DOM，非 Shadow DOM）
  //  右下角 44px 紫色圆形，始终显示，与面板状态无关
  // ============================================================

  function createFloatingBall() {
    // 检查是否已存在（防重复注入）
    if (document.querySelector('.goby-floating-ball')) return;

    var ball = document.createElement('div');
    ball.className = 'goby-floating-ball';
    ball.title = 'Goby AI 助手';

    // 基本尺寸和定位（内联样式，确保 agent-panel.css 加载前可用）
    ball.style.width = '44px';
    ball.style.height = '44px';
    ball.style.borderRadius = '50%';
    ball.style.background = 'linear-gradient(135deg, #667eea, #764ba2)';
    ball.style.position = 'fixed';
    ball.style.bottom = '20px';
    ball.style.right = '20px';
    ball.style.zIndex = '2147483647';
    ball.style.cursor = 'pointer';
    ball.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    ball.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
    ball.style.border = '2px solid rgba(255,255,255,0.3)';
    ball.style.display = 'flex';
    ball.style.alignItems = 'center';
    ball.style.justifyContent = 'center';
    ball.style.fontSize = '18px';
    ball.style.fontWeight = '700';
    ball.style.color = '#ffffff';
    ball.textContent = 'G';

    // 点击切换面板
    ball.addEventListener('click', function (e) {
      e.stopPropagation();
      GobyPanel.toggle();
    });

    document.body.appendChild(ball);
    _ball = ball;
  }

  // ============================================================
  //  创建 Shadow DOM 面板壳
  //  替换 Phase 1 的常规 DOM 面板
  // ============================================================

  function createPanelShell() {
    // 检查面板是否已存在（防重复创建）
    if (document.getElementById('goby-panel-host')) return;

    var host = document.createElement('div');
    host.id = 'goby-panel-host';
    host.style.position = 'fixed';
    host.style.bottom = '80px';
    host.style.right = '20px';
    host.style.zIndex = '2147483646';

    // 创建 Shadow DOM
    var shadow = host.attachShadow({ mode: 'open' });

    // 注入样式
    var styleEl = document.createElement('style');
    styleEl.textContent = PANEL_CSS;

    // 创建面板容器
    var panel = document.createElement('div');
    panel.className = 'goby-panel ' + (state.isVisible ? 'goby-panel-visible' : 'goby-panel-hidden');
    // 内联样式确保测试和早期渲染可用（CSS PANEL_CSS 也设置相同值）
    panel.style.width = '400px';
    panel.style.height = '480px';
    panel.style.transition = 'transform 200ms ease, opacity 200ms ease';

    // 标题栏
    var header = document.createElement('div');
    header.className = 'goby-panel-header';

    var title = document.createElement('span');
    title.className = 'goby-title';
    title.textContent = 'Goby';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'goby-close-btn';
    closeBtn.textContent = '—'; // 破折号 —
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      GobyPanel.hide();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    // 内容预留区（供 Plan 02-02 聊天区域使用）
    var chatArea = document.createElement('div');
    chatArea.id = 'goby-chat-area';

    panel.appendChild(header);
    panel.appendChild(chatArea);

    // 组装 Shadow DOM
    shadow.appendChild(styleEl);
    shadow.appendChild(panel);

    document.body.appendChild(host);
    _host = host;
  }

  // ============================================================
  //  动画控制
  // ============================================================

  /**
   * 显示面板（创建面板壳 + 应用展开动画）
   */
  function animateShow() {
    if (!_host || !document.body.contains(_host)) {
      _host = null;
      createPanelShell();
    }
    if (_host) {
      var panel = _host.shadowRoot.querySelector('.goby-panel');
      if (panel) {
        panel.className = 'goby-panel goby-panel-visible';
      }
    }
  }

  /**
   * 隐藏面板（应用收起动画，保持 DOM 以支持反向动画）
   */
  function animateHide() {
    if (_host) {
      if (!document.body.contains(_host)) {
        // Host 已被从 DOM 移除（如测试清理），重置引用
        _host = null;
        return;
      }
      var panel = _host.shadowRoot.querySelector('.goby-panel');
      if (panel) {
        panel.className = 'goby-panel goby-panel-hidden';
      }
    }
  }

  // ============================================================
  //  公共 API — GobyPanel
  //  保持向后兼容（Phase 1 接口签名不变）
  // ============================================================

  window.GobyPanel = {

    /**
     * 初始化面板
     * - 从 chrome.storage.local 读取 gobyPanelState
     * - 创建悬浮球（始终显示）
     * - 如果之前可见，创建面板并显示
     * @returns {Promise<void>}
     */
    init: function () {
      return chrome.storage.local.get(['gobyPanelState']).then(function (result) {
        var panelState = result.gobyPanelState || {};
        state.isVisible = panelState.isVisible === true;

        // 始终创建悬浮球
        createFloatingBall();

        // 如果之前可见，创建面板
        if (state.isVisible) {
          createPanelShell();
        }
      });
    },

    /**
     * 切换面板可见性
     * @returns {Promise<void>}
     */
    toggle: function () {
      state.isVisible = !state.isVisible;
      return persistState().then(function () {
        if (state.isVisible) {
          animateShow();
        } else {
          animateHide();
        }
      });
    },

    /**
     * 显示面板
     * @returns {Promise<void>}
     */
    show: function () {
      state.isVisible = true;
      return persistState().then(function () {
        animateShow();
      });
    },

    /**
     * 隐藏面板
     * @returns {Promise<void>}
     */
    hide: function () {
      state.isVisible = false;
      return persistState().then(function () {
        animateHide();
      });
    },

    /**
     * 渲染面板（根据当前状态创建或隐藏）
     */
    render: function () {
      if (state.isVisible) {
        animateShow();
      } else {
        animateHide();
      }
    },

    /**
     * 获取当前面板状态
     * @returns {{isVisible: boolean}}
     */
    getState: function () {
      return { isVisible: state.isVisible };
    },

    /**
     * Shadow DOM 引用（供下游 plan 访问面板内部结构）
     */
    _shadowRoot: null,

    /**
     * 面板容器元素引用
     */
    _panelContainer: null
  };

  // ---- 初始化完成后设置公共引用 ----
  // _shadowRoot 和 _panelContainer 在第一次创建面板后设置
  // 可以通过 GobyPanel.show() 或 init() 触发
  var originalCreate = createPanelShell;
  createPanelShell = function () {
    originalCreate();
    if (_host) {
      window.GobyPanel._shadowRoot = _host.shadowRoot;
      window.GobyPanel._panelContainer = _host;
    }
  };
})();
