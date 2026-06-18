// Goby - AI 浏览器助手 | 面板状态管理和 DOM 操作
// Plan 02-02: 聊天区域 + 输入框 + 消息气泡渲染
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
    /* 聊天区域容器 — flex:1 填充剩余空间 */
    '#goby-chat-area {',
    '  flex: 1;',
    '  display: flex;',
    '  flex-direction: column;',
    '  overflow: hidden;',
    '}',
    '.goby-messages-container {',
    '  flex: 1;',
    '  overflow-y: auto;',
    '  padding: 12px 8px;',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 8px;',
    '  background: #f9fafb;',
    '}',
    /* 欢迎消息 */
    '.goby-welcome {',
    '  display: flex;',
    '  flex-direction: column;',
    '  align-items: center;',
    '  justify-content: center;',
    '  padding: 32px 24px;',
    '  text-align: center;',
    '  height: 100%;',
    '}',
    '.goby-welcome-icon {',
    '  font-size: 48px;',
    '  margin-bottom: 16px;',
    '  opacity: 0.6;',
    '}',
    '.goby-welcome-heading {',
    '  font-size: 15px;',
    '  font-weight: 600;',
    '  color: #111827;',
    '  margin-bottom: 8px;',
    '}',
    '.goby-welcome-body {',
    '  font-size: 13px;',
    '  color: #6b7280;',
    '  line-height: 1.6;',
    '  max-width: 320px;',
    '}',
    '.goby-welcome-tools {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 6px;',
    '  justify-content: center;',
    '  margin-top: 16px;',
    '  max-width: 320px;',
    '}',
    '.goby-welcome-tag {',
    '  font-size: 11px;',
    '  color: #667eea;',
    '  background: rgba(102,126,234,0.08);',
    '  padding: 4px 10px;',
    '  border-radius: 12px;',
    '  white-space: nowrap;',
    '}',
    /* 输入栏 */
    '.goby-input-bar {',
    '  display: flex;',
    '  align-items: flex-end;',
    '  gap: 8px;',
    '  padding: 8px 12px;',
    '  background: #ffffff;',
    '  border-top: 1px solid #e5e7eb;',
    '  flex-shrink: 0;',
    '}',
    '.goby-input-textarea {',
    '  flex: 1;',
    '  min-height: 40px;',
    '  max-height: 100px;',
    '  padding: 8px 12px;',
    '  border: 1px solid #e5e7eb;',
    '  border-radius: 8px;',
    '  font-size: 13px;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
    '  color: #111827;',
    '  background: #ffffff;',
    '  outline: none;',
    '  resize: none;',
    '  overflow-y: auto;',
    '  line-height: 1.5;',
    '  box-sizing: border-box;',
    '  transition: border-color 0.15s, height 0.1s ease;',
    '}',
    '.goby-input-textarea:focus {',
    '  border-color: #667eea;',
    '  outline: 2px solid rgba(102,126,234,0.4);',
    '  outline-offset: -1px;',
    '}',
    '.goby-input-textarea::placeholder {',
    '  color: #6b7280;',
    '}',
    '.goby-send-btn {',
    '  width: 36px;',
    '  height: 36px;',
    '  min-width: 36px;',
    '  border: none;',
    '  border-radius: 8px;',
    '  cursor: pointer;',
    '  background: linear-gradient(135deg, #667eea, #764ba2);',
    '  color: #ffffff;',
    '  font-size: 18px;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  transition: opacity 0.15s, transform 0.15s;',
    '  flex-shrink: 0;',
    '  padding: 0;',
    '}',
    '.goby-send-btn:hover {',
    '  opacity: 0.85;',
    '}',
    '.goby-send-btn:active {',
    '  transform: scale(0.95);',
    '}',
    '.goby-send-btn:disabled {',
    '  opacity: 0.4;',
    '  cursor: not-allowed;',
    '}',
    /* 消息气泡基础 */
    '.goby-msg-bubble {',
    '  max-width: 90%;',
    '  padding: 10px 14px;',
    '  border-radius: 12px;',
    '  font-size: 13px;',
    '  line-height: 1.5;',
    '  word-break: break-word;',
    '  animation: msgFadeIn 200ms ease-out;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
    '}',
    /* 用户气泡: 右对齐 紫色底 白字 */
    '.goby-msg-user-wrapper {',
    '  display: flex;',
    '  justify-content: flex-end;',
    '  padding: 0 4px;',
    '}',
    '.goby-msg-user {',
    '  background: #667eea;',
    '  color: #ffffff;',
    '  border-bottom-right-radius: 4px;',
    '}',
    /* Bot 气泡: 左对齐 灰色底 深灰字 */
    '.goby-msg-bot-wrapper {',
    '  display: flex;',
    '  justify-content: flex-start;',
    '  padding: 0 4px;',
    '}',
    '.goby-msg-bot {',
    '  background: #f3f4f6;',
    '  color: #111827;',
    '  border-bottom-left-radius: 4px;',
    '}',
    /* 工具结果成功: 绿底 */
    '.goby-msg-tool-wrapper {',
    '  display: flex;',
    '  justify-content: flex-start;',
    '  padding: 0 4px;',
    '}',
    '.goby-msg-tool {',
    '  background: #f0fdf4;',
    '  color: #111827;',
    '  border-left: 3px solid #22c55e;',
    '  border-radius: 4px 8px 8px 4px;',
    '}',
    /* 工具结果错误: 红底 */
    '.goby-msg-tool-error-wrapper {',
    '  display: flex;',
    '  justify-content: flex-start;',
    '  padding: 0 4px;',
    '}',
    '.goby-msg-tool-error {',
    '  background: #fef2f2;',
    '  color: #111827;',
    '  border-left: 3px solid #ef4444;',
    '  border-radius: 4px 8px 8px 4px;',
    '}',
    '@keyframes msgFadeIn {',
    '  from { opacity: 0; transform: translateY(8px); }',
    '  to { opacity: 1; transform: translateY(0); }',
    '}',
    /* 消息时间戳（简约） */
    '.goby-msg-time {',
    '  font-size: 10px;',
    '  opacity: 0.5;',
    '  margin-top: 2px;',
    '}',
    /* 消息滚动条 */
    '.goby-messages-container::-webkit-scrollbar {',
    '  width: 5px;',
    '}',
    '.goby-messages-container::-webkit-scrollbar-track {',
    '  background: transparent;',
    '}',
    '.goby-messages-container::-webkit-scrollbar-thumb {',
    '  background: #d1d5db;',
    '  border-radius: 4px;',
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

  // 聊天区域 DOM 引用（供 appendMessage/sendMessage 使用）
  var _chatArea = null;
  var _messagesContainer = null;
  var _welcomeEl = null;
  var _inputEl = null;
  var _sendBtn = null;

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
  //  appendMessage — 添加消息气泡到聊天区域
  //  所有用户输入通过 textContent 赋值，绝不使用 innerHTML（SEC-02）
  // ============================================================

  function appendMessage(role, content) {
    if (!_messagesContainer) return;

    // 如果欢迎消息可见，隐藏它
    if (_welcomeEl && _welcomeEl.style.display !== 'none') {
      _welcomeEl.style.display = 'none';
    }

    // 根据 role 选择样式类
    var wrapperClass, bubbleClass;
    switch (role) {
      case 'user':
        wrapperClass = 'goby-msg-user-wrapper';
        bubbleClass = 'goby-msg-user';
        break;
      case 'bot':
        wrapperClass = 'goby-msg-bot-wrapper';
        bubbleClass = 'goby-msg-bot';
        break;
      case 'tool':
        wrapperClass = 'goby-msg-tool-wrapper';
        bubbleClass = 'goby-msg-tool';
        break;
      case 'tool-error':
        wrapperClass = 'goby-msg-tool-error-wrapper';
        bubbleClass = 'goby-msg-tool-error';
        break;
      default:
        wrapperClass = 'goby-msg-bot-wrapper';
        bubbleClass = 'goby-msg-bot';
    }

    // 创建 wrapper
    var wrapperDiv = document.createElement('div');
    wrapperDiv.className = wrapperClass;

    // 创建气泡 — SEC-02: 使用 textContent，绝不使用 innerHTML
    var bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'goby-msg-bubble ' + bubbleClass;
    bubbleDiv.textContent = content;
    // 内联动画确保 JSDOM 测试可检测（同时 CSS @keyframes 提供真实浏览器支持）
    bubbleDiv.style.animation = 'msgFadeIn 200ms ease-out';

    wrapperDiv.appendChild(bubbleDiv);
    _messagesContainer.appendChild(wrapperDiv);

    // 自动滚动到底部
    _messagesContainer.scrollTop = _messagesContainer.scrollHeight;
  }

  // ============================================================
  //  sendMessage — 发送当前输入内容
  // ============================================================

  function sendMessage() {
    if (!_inputEl) return;

    var text = _inputEl.value.trim();
    if (text === '') return;

    appendMessage('user', text);

    // 清空输入框并重置高度
    _inputEl.value = '';
    _inputEl.style.height = '40px';
    _inputEl.focus();
  }

  // ============================================================
  //  renderWelcome — 渲染欢迎消息（清空聊天区域后调用）
  // ============================================================

  function renderWelcome() {
    if (!_messagesContainer) return;

    // 清空消息气泡，保留欢迎元素
    var messages = _messagesContainer.querySelectorAll('.goby-msg-bubble');
    messages.forEach(function (msg) {
      var wrapper = msg.parentNode;
      if (wrapper) wrapper.parentNode.removeChild(wrapper);
    });

    if (_welcomeEl) {
      _welcomeEl.style.display = 'flex';
    }
  }

  // ============================================================
  //  clearChat — 清空所有消息并重新显示欢迎消息
  // ============================================================

  function clearChat() {
    if (!_messagesContainer) return;

    // 移除所有消息气泡
    var items = _messagesContainer.querySelectorAll('.goby-msg-user-wrapper, .goby-msg-bot-wrapper, .goby-msg-tool-wrapper, .goby-msg-tool-error-wrapper');
    items.forEach(function (item) {
      item.parentNode.removeChild(item);
    });

    if (_welcomeEl) {
      _welcomeEl.style.display = 'flex';
    }
  }

  // ============================================================
  //  autoResize — 输入框自动扩展高度（40px ~ 100px）
  // ============================================================

  function autoResize() {
    if (!_inputEl) return;
    _inputEl.style.height = '40px';
    var scrollHeight = _inputEl.scrollHeight;
    var newHeight = Math.min(Math.max(scrollHeight, 40), 100);
    _inputEl.style.height = newHeight + 'px';
  }

  // ============================================================
  //  创建 Shadow DOM 面板壳
  //  包含聊天区域 + 输入栏
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
    panel.style.width = '400px';
    panel.style.height = '480px';
    panel.style.transition = 'transform 200ms ease, opacity 200ms ease';

    // ---- 标题栏 ----
    var header = document.createElement('div');
    header.className = 'goby-panel-header';

    var title = document.createElement('span');
    title.className = 'goby-title';
    title.textContent = 'Goby';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'goby-close-btn';
    closeBtn.textContent = '—';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      GobyPanel.hide();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    // ---- 聊天区域 ----
    var chatArea = document.createElement('div');
    chatArea.id = 'goby-chat-area';

    var messagesContainer = document.createElement('div');
    messagesContainer.className = 'goby-messages-container';

    // 欢迎消息
    var welcomeEl = document.createElement('div');
    welcomeEl.className = 'goby-welcome';

    var welcomeIcon = document.createElement('div');
    welcomeIcon.className = 'goby-welcome-icon';
    welcomeIcon.textContent = '🤖';

    var welcomeHeading = document.createElement('div');
    welcomeHeading.className = 'goby-welcome-heading';
    welcomeHeading.textContent = '你好！我是 Goby';

    var welcomeBody = document.createElement('div');
    welcomeBody.className = 'goby-welcome-body';
    welcomeBody.textContent = '你的 AI 浏览器助手。我可以帮你填写表单、点击按钮、查询内容、分析页面...';

    var welcomeTools = document.createElement('div');
    welcomeTools.className = 'goby-welcome-tools';

    var toolLabels = ['填写表单', '点击按钮', '查询内容', '分析页面', '截取截图', '读写剪贴板', '数学计算', '获取时间'];
    toolLabels.forEach(function (label) {
      var tag = document.createElement('div');
      tag.className = 'goby-welcome-tag';
      tag.textContent = label;
      welcomeTools.appendChild(tag);
    });

    welcomeEl.appendChild(welcomeIcon);
    welcomeEl.appendChild(welcomeHeading);
    welcomeEl.appendChild(welcomeBody);
    welcomeEl.appendChild(welcomeTools);

    messagesContainer.appendChild(welcomeEl);
    chatArea.appendChild(messagesContainer);

    // ---- 输入栏 ----
    var inputBar = document.createElement('div');
    inputBar.className = 'goby-input-bar';

    var inputEl = document.createElement('textarea');
    inputEl.className = 'goby-input-textarea';
    inputEl.placeholder = '输入消息... (Enter 发送, Shift+Enter 换行)';
    inputEl.rows = 1;
    // 内联样式确保 JSDOM 测试可以读取（同时 CSS class 提供相同约束）
    inputEl.style.minHeight = '40px';
    inputEl.style.maxHeight = '100px';
    inputEl.style.height = '40px';

    var sendBtn = document.createElement('button');
    sendBtn.className = 'goby-send-btn';
    sendBtn.textContent = '➤';
    sendBtn.title = '发送消息';
    // 内联样式确保 JSDOM 测试可读取
    sendBtn.style.background = 'linear-gradient(135deg, #667eea, #764ba2)';

    inputBar.appendChild(inputEl);
    inputBar.appendChild(sendBtn);

    // 组装面板
    panel.appendChild(header);
    panel.appendChild(chatArea);
    panel.appendChild(inputBar);

    // 组装 Shadow DOM
    shadow.appendChild(styleEl);
    shadow.appendChild(panel);

    document.body.appendChild(host);
    _host = host;

    // 存储 DOM 引用
    _chatArea = chatArea;
    _messagesContainer = messagesContainer;
    _welcomeEl = welcomeEl;
    _inputEl = inputEl;
    _sendBtn = sendBtn;

    // ---- 事件绑定 ----

    // 输入框 keydown: Enter 发送，Shift+Enter 换行
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        // 手动在光标位置插入换行（兼容 JSDOM 和真实浏览器）
        var start = inputEl.selectionStart;
        var end = inputEl.selectionEnd;
        var val = inputEl.value;
        inputEl.value = val.substring(0, start) + '\n' + val.substring(end);
        // 更新光标位置
        inputEl.selectionStart = inputEl.selectionEnd = start + 1;
        // 触发 auto-resize
        autoResize();
      }
    });

    // 输入框 input: auto-resize
    inputEl.addEventListener('input', autoResize);

    // 发送按钮 click
    sendBtn.addEventListener('click', function () {
      sendMessage();
    });
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
  //  新增: appendMessage, sendMessage, renderWelcome, clearChat,
  //        getInputValue, focusInput, _chatArea, _inputEl
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
     * 添加消息气泡到聊天区域
     * @param {string} role - 'user', 'bot', 'tool', 'tool-error'
     * @param {string} content - 消息内容（通过 textContent 注入，SEC-02）
     */
    appendMessage: appendMessage,

    /**
     * 发送当前输入内容
     */
    sendMessage: sendMessage,

    /**
     * 渲染欢迎消息（清空聊天区域后调用）
     */
    renderWelcome: renderWelcome,

    /**
     * 清空所有消息并重新显示欢迎消息
     */
    clearChat: clearChat,

    /**
     * 获取输入框文本
     * @returns {string}
     */
    getInputValue: function () {
      return _inputEl ? _inputEl.value : '';
    },

    /**
     * 聚焦输入框
     */
    focusInput: function () {
      if (_inputEl) _inputEl.focus();
    },

    /**
     * Shadow DOM 引用
     */
    _shadowRoot: null,

    /**
     * 面板容器元素引用
     */
    _panelContainer: null,

    /**
     * 聊天区域容器引用
     */
    _chatArea: null,

    /**
     * 输入框引用
     */
    _inputEl: null
  };

  // ---- 初始化完成后设置公共引用 ----
  var originalCreate = createPanelShell;
  createPanelShell = function () {
    originalCreate();
    if (_host) {
      window.GobyPanel._shadowRoot = _host.shadowRoot;
      window.GobyPanel._panelContainer = _host;
      window.GobyPanel._chatArea = _chatArea;
      window.GobyPanel._inputEl = _inputEl;
    }
  };
})();
