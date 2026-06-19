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
    '  align-items: flex-end;',
    '  gap: 8px;',
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
    '  align-items: flex-end;',
    '  gap: 8px;',
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
    '  align-items: flex-end;',
    '  gap: 8px;',
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
    '  align-items: flex-end;',
    '  gap: 8px;',
    '  justify-content: flex-start;',
    '  padding: 0 4px;',
    '}',
    '.goby-msg-tool-error {',
    '  background: #fef2f2;',
    '  color: #111827;',
    '  border-left: 3px solid #ef4444;',
    '  border-radius: 4px 8px 8px 4px;',
    '}',
    /* 标题栏按钮行 */
    '.goby-header-buttons { display: flex; gap: 4px; align-items: center; }',
    '.goby-header-btn { width: 28px; height: 28px; background: transparent;',
    '  border: none; color: #ffffff; cursor: pointer; font-size: 16px;',
    '  display: flex; align-items: center; justify-content: center;',
    '  border-radius: 4px; transition: background 0.15s; padding: 0; }',
    '.goby-header-btn:hover { background: rgba(255,255,255,0.15); }',
    '',
    '/* 状态栏 */',
    '.goby-status-bar { min-height: 28px; padding: 4px 12px;',
    '  background: #f9fafb; border-top: 1px solid #e5e7eb;',
    '  display: flex; align-items: center; justify-content: space-between;',
    '  flex-shrink: 0; font-size: 11px; color: #6b7280;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }',
    '.goby-status-left { display: flex; align-items: center; gap: 8px; }',
    '.goby-status-model { font-weight: 500; color: #374151; max-width: 180px;',
    '  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.goby-status-dot { width: 8px; height: 8px; border-radius: 50%;',
    '  flex-shrink: 0; transition: background-color 0.3s ease; }',
    '.goby-status-dot.green { background-color: #22c55e; }',
    '.goby-status-dot.red { background-color: #ef4444; }',
    '.goby-status-dot.gray { background-color: #9ca3af; }',
    '.goby-status-round { font-size: 11px; color: #6b7280; white-space: nowrap; }',
    '',
    '/* 拖拽把手 */',
    '.goby-resize-handle { height: 4px; background: transparent;',
    '  cursor: ns-resize; flex-shrink: 0; transition: background 0.15s;',
    '  border-top: 1px solid #e5e7eb; }',
    '.goby-resize-handle:hover { background: rgba(102,126,234,0.1); }',
    '.goby-resize-handle:active { background: rgba(102,126,234,0.2); }',
    '',
    '/* 拖拽时防止文字选中 */',
    '.goby-panel.resizing { user-select: none; }',
    '',
    '@keyframes msgFadeIn {',
    '  from { opacity: 0; transform: translateY(8px); }',
    '  to { opacity: 1; transform: translateY(0); }',
    '}',
    /* Plan 03-01: 流式光标闪烁指示器 */
    '.goby-cursor {',
    '  display: inline;',
    '  color: #667eea;',
    '  font-weight: 700;',
    '  animation: gobyBlink 0.8s step-end infinite;',
    '}',
    '@keyframes gobyBlink {',
    '  0%, 100% { opacity: 1; }',
    '  50% { opacity: 0; }',
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
    '}',
    /* Plan 03-03: 会话侧栏 (300px 滑入式) */
    '.goby-session-sidebar {',
    '  position: absolute; top: 0; right: 0; bottom: 0;',
    '  width: 300px;',
    '  background: #ffffff;',
    '  box-shadow: -4px 0 20px rgba(0,0,0,0.1);',
    '  transform: translateX(100%);',
    '  transition: transform 250ms ease;',
    '  z-index: 10;',
    '  display: flex;',
    '  flex-direction: column;',
    '}',
    '.goby-session-sidebar.open {',
    '  transform: translateX(0);',
    '}',
    '.goby-sidebar-header {',
    '  min-height: 36px; padding: 8px 14px;',
    '  background: linear-gradient(135deg, #667eea, #764ba2);',
    '  color: #ffffff; display: flex;',
    '  align-items: center; justify-content: space-between;',
    '  font-size: 13px; font-weight: 600;',
    '  flex-shrink: 0;',
    '}',
    '.goby-sidebar-close-btn {',
    '  background: transparent; border: none; color: #ffffff;',
    '  cursor: pointer; font-size: 18px; padding: 0; width: 28px; height: 28px;',
    '  display: flex; align-items: center; justify-content: center;',
    '  border-radius: 4px;',
    '}',
    '.goby-sidebar-close-btn:hover { background: rgba(255,255,255,0.15); }',
    '.goby-sidebar-search { padding: 8px 12px; position: relative; flex-shrink: 0; }',
    '.goby-sidebar-search input {',
    '  width: 100%; padding: 6px 30px 6px 10px; border: 1px solid #e5e7eb;',
    '  border-radius: 8px; font-size: 12px; outline: none; box-sizing: border-box;',
    '}',
    '.goby-sidebar-search input:focus { border-color: #667eea; }',
    '.goby-search-icon { position: absolute; right: 20px; top: 50%; transform: translateY(-50%); font-size: 12px; }',
    '.goby-sidebar-list { flex: 1; overflow-y: auto; padding: 4px 8px; }',
    '.goby-session-item {',
    '  display: flex; align-items: center; padding: 10px 8px;',
    '  border-radius: 8px; cursor: pointer; transition: background 0.15s;',
    '  margin-bottom: 2px;',
    '}',
    '.goby-session-item:hover { background: #f3f4f6; }',
    '.goby-session-item.active { background: rgba(102,126,234,0.08); border-left: 3px solid #667eea; }',
    '.goby-session-info { flex: 1; min-width: 0; }',
    '.goby-session-origin { font-size: 13px; font-weight: 600; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.goby-session-preview { font-size: 11px; color: #6b7280; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.goby-session-meta { font-size: 10px; color: #9ca3af; margin-top: 2px; }',
    '.goby-session-delete-btn {',
    '  background: transparent; border: none; color: #9ca3af; cursor: pointer;',
    '  font-size: 14px; padding: 4px; flex-shrink: 0; border-radius: 4px;',
    '  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;',
    '}',
    '.goby-session-delete-btn:hover { color: #ef4444; background: rgba(239,68,68,0.08); }',
    '.goby-sidebar-footer { padding: 8px 12px; border-top: 1px solid #e5e7eb; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; }',
    '.goby-sidebar-new-btn, .goby-sidebar-clear-btn {',
    '  width: 100%; padding: 8px; border: none; border-radius: 8px;',
    '  font-size: 12px; cursor: pointer; transition: opacity 0.15s;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    '}',
    '.goby-sidebar-new-btn { background: #667eea; color: #ffffff; }',
    '.goby-sidebar-new-btn:hover { opacity: 0.85; }',
    '.goby-sidebar-clear-btn { background: transparent; color: #ef4444; border: 1px solid #e5e7eb; }',
    '.goby-sidebar-clear-btn:hover { background: #fef2f2; }',
    /* 工具调用状态指示器 — 颜色编码：黄=进行中, 绿=成功, 红=失败 */
    '.goby-tool-call-wrapper { display: flex; align-items: flex-end; gap: 8px;',
    '  justify-content: flex-start; padding: 2px 4px; }',
    '.goby-tool-call-badge { display: inline-flex; align-items: center; gap: 6px;',
    '  padding: 6px 12px; border-radius: 16px; font-size: 12px;',
    '  background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;',
    '  animation: toolCallPulse 1.2s ease-in-out infinite; }',
    '.goby-tool-call-badge .goby-tool-name { font-weight: 600; }',
    '.goby-tool-call-badge .goby-tool-status { font-size: 11px; opacity: 0.75; }',
    '.goby-tool-call-badge.done { animation: none; background: #f0fdf4;',
    '  border-color: #86efac; color: #166534; }',
    '.goby-tool-call-badge.error { animation: none; background: #fef2f2;',
    '  border-color: #fca5a5; color: #991b1b; }',
    '.goby-tool-expand-btn { font-size: 11px; padding: 2px 8px; margin-left: 4px;',
    '  border: none; border-radius: 10px; cursor: pointer;',
    '  background: rgba(255,255,255,0.6); color: inherit;',
    '  font-family: inherit; transition: background 0.15s; }',
    '.goby-tool-expand-btn:hover { background: rgba(255,255,255,0.9); }',
    '@keyframes toolCallPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }'
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
  var _settingsBtn = null;
  var _sessionBtn = null;
  var _closeBtn = null;

  // 状态栏 DOM 引用
  var _statusBar = null;
  var _statusModelEl = null;
  var _statusDotEl = null;
  var _statusRoundEl = null;

  // 拖拽把手 DOM 引用
  var _resizeHandle = null;

  // PANEL-09: 截图遮罩 DOM 引用
  var _overlayEl = null;
  var _overlayImg = null;
  var _overlayCloseBtn = null;
  var _overlayImgContainer = null;

  // Plan 03-03: 会话侧栏函数引用
  var _toggleSessionSidebar = null;
  var _renderSessionList = null;

  // ============================================================
  //  持久化面板状态到 chrome.storage.local
  //  键: gobyPanelState — { isVisible: boolean, autoStart: boolean }
  //  合并写入 — 保留 autoStart 等其他字段不被覆盖
  // ============================================================

  function persistState() {
    return chrome.storage.local.get(['gobyPanelState']).then(function (result) {
      var prev = (result && result.gobyPanelState) || {};
      prev.isVisible = state.isVisible;
      return chrome.storage.local.set({ gobyPanelState: prev });
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
    ball.innerHTML =
      '<svg viewBox="0 0 128 128" width="28" height="28" fill="none" ' +
      'stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M 20 64 C 40 42, 70 40, 86 56 Q 94 64, 86 72 C 70 88, 40 86, 20 64 Z"/>' +
      '<path d="M 20 64 L 6 50 L 10 64 L 6 78 Z"/>' +
      '<path d="M 42 46 Q 52 32, 64 44"/>' +
      '<circle cx="76" cy="60" r="4" fill="#ffffff" stroke="none"/>' +
      '</svg>';

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

  /**
   * 把容器变成可折叠文本：超长内容显示预览 + 展开按钮
   * 容器内容会被替换为 span(预览文本) + button(展开/收起)
   * @param {HTMLElement} container - 接收文本与按钮的元素
   * @param {string} fullText - 完整文本
   * @param {number} maxShow - 预览最大字符数
   */
  function attachExpandButton(container, fullText, maxShow) {
    if (typeof fullText !== 'string') fullText = '';
    while (container.firstChild) container.removeChild(container.firstChild);

    if (fullText.length <= maxShow) {
      container.textContent = fullText;
      return;
    }

    var shortText = fullText.substring(0, maxShow) + '...';
    var textSpan = document.createElement('span');
    textSpan.dataset.full = fullText;
    textSpan.dataset.short = shortText;
    textSpan.textContent = shortText;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'goby-tool-expand-btn';
    btn.textContent = '展开';
    btn.dataset.expanded = 'false';
    btn.addEventListener('click', function () {
      if (btn.dataset.expanded === 'false') {
        textSpan.textContent = textSpan.dataset.full;
        btn.textContent = '收起';
        btn.dataset.expanded = 'true';
      } else {
        textSpan.textContent = textSpan.dataset.short;
        btn.textContent = '展开';
        btn.dataset.expanded = 'false';
      }
    });

    container.appendChild(textSpan);
    container.appendChild(btn);
  }

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

    // 创建气泡
    // SEC-02: 用户消息使用 textContent，机器人消息使用 renderMarkdown → innerHTML
    var bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'goby-msg-bubble ' + bubbleClass;
    if (role === 'bot') {
      // Bot 消息: marked.parse → DOMPurify.sanitize → innerHTML (SEC-01)
      bubbleDiv.innerHTML = renderMarkdown(content);
    } else {
      // D-08: 工具消息若为 data:image/ URL 则渲染为截图缩略图
      if (role === 'tool' && typeof content === 'string' && content.indexOf('data:image/') === 0) {
        var thumbImg = document.createElement('img');
        thumbImg.src = content;
        thumbImg.style.cssText = 'max-width:200px;max-height:150px;cursor:pointer;border-radius:8px;border:1px solid #e5e7eb;';
        thumbImg.className = 'goby-screenshot-thumb';
        // PANEL-09: 点击缩略图打开全屏遮罩
        thumbImg.addEventListener('click', function (e) {
          e.stopPropagation();
          showScreenshotOverlay(this.src);
        });
        bubbleDiv.appendChild(thumbImg);
      } else if (role === 'tool' || role === 'tool-error') {
        // 工具文本结果：超长则折叠 + 展开按钮
        attachExpandButton(bubbleDiv, content, 60);
      } else {
        // 用户消息: textContent (SEC-02)
        bubbleDiv.textContent = content;
      }
    }
    // 内联动画确保 JSDOM 测试可检测（同时 CSS @keyframes 提供真实浏览器支持）
    bubbleDiv.style.animation = 'msgFadeIn 200ms ease-out';

    wrapperDiv.appendChild(bubbleDiv);
    _messagesContainer.appendChild(wrapperDiv);

    // 自动滚动到底部
    _messagesContainer.scrollTop = _messagesContainer.scrollHeight;
  }

  // ============================================================
  //  appendToolCall — 添加工具调用状态指示器
  //  在工具执行期间显示脉冲动画的 "🔧 正在调用: xxx"
  //  工具完成后调用 completeToolCall 更新状态
  // ============================================================

  /**
   * 显示工具调用状态指示器
   * @param {string} name - 工具名称
   * @returns {HTMLElement} 状态元素（用于后续 completeToolCall 更新）
   */
  function appendToolCall(name) {
    if (!_messagesContainer) return null;
    // 如果欢迎消息可见，隐藏它
    if (_welcomeEl && _welcomeEl.style.display !== 'none') {
      _welcomeEl.style.display = 'none';
    }

    var wrapperDiv = document.createElement('div');
    wrapperDiv.className = 'goby-tool-call-wrapper';

    var badge = document.createElement('div');
    badge.className = 'goby-tool-call-badge';
    badge.innerHTML = '<span class="goby-tool-name">' + name + '</span>'
      + '<span class="goby-tool-status">处理中...</span>';

    wrapperDiv.appendChild(badge);
    _messagesContainer.appendChild(wrapperDiv);
    _messagesContainer.scrollTop = _messagesContainer.scrollHeight;

    return badge;
  }

  /**
   * 更新工具调用状态指示器
   * 截断结果（>60 字符）通过 attachExpandButton 显示预览 + 展开按钮
   * @param {HTMLElement} badgeEl - appendToolCall 返回的元素
   * @param {string} result - 工具执行结果
   */
  function completeToolCall(badgeEl, result) {
    if (!badgeEl) return;
    var isError = typeof result === 'string' && result.startsWith('Error:');
    badgeEl.className = 'goby-tool-call-badge ' + (isError ? 'error' : 'done');

    var prevName = badgeEl.querySelector('.goby-tool-name');
    var nameText = prevName ? prevName.textContent : '';

    while (badgeEl.firstChild) badgeEl.removeChild(badgeEl.firstChild);

    var nameEl = document.createElement('span');
    nameEl.className = 'goby-tool-name';
    nameEl.textContent = nameText;
    badgeEl.appendChild(nameEl);

    var statusEl = document.createElement('span');
    statusEl.className = 'goby-tool-status';
    badgeEl.appendChild(statusEl);

    attachExpandButton(statusEl, result, 60);
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

    // Plan 03-01: 通过 GobyAgent 发送消息（流式 LLM 调用）
    if (window.GobyAgent && typeof window.GobyAgent.sendMessage === 'function') {
      // 流式处理期间禁用输入
      if (_inputEl) _inputEl.disabled = true;
      if (_sendBtn) _sendBtn.disabled = true;
      window.GobyAgent.sendMessage(text);
    }

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
    panel.style.position = 'relative'; // 会话侧栏依赖相对定位

    // ---- 标题栏 ----
    var header = document.createElement('div');
    header.className = 'goby-panel-header';

    var title = document.createElement('span');
    title.className = 'goby-title';
    title.textContent = 'Goby';

    // 标题栏按钮容器
    var headerBtns = document.createElement('div');
    headerBtns.className = 'goby-header-buttons';

    var sessionBtn = document.createElement('button');
    sessionBtn.id = 'goby-session-btn';
    sessionBtn.className = 'goby-header-btn';
    sessionBtn.textContent = '📋'; // 📋
    sessionBtn.title = '会话列表';
    // Plan 03-03: toggleSessionSidebar wired below

    var settingsBtn = document.createElement('button');
    settingsBtn.id = 'goby-settings-btn';
    settingsBtn.className = 'goby-header-btn';
    settingsBtn.textContent = '⚙'; // ⚙
    settingsBtn.title = '设置';
    settingsBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof window.openSettingsModal === 'function') {
        window.openSettingsModal();
      }
    });

    var closeBtn = document.createElement('button');
    closeBtn.id = 'goby-close-btn';
    closeBtn.className = 'goby-header-btn goby-close-btn';
    closeBtn.textContent = '—'; // —
    closeBtn.title = '关闭面板';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      GobyPanel.hide();
    });

    headerBtns.appendChild(sessionBtn);
    headerBtns.appendChild(settingsBtn);
    headerBtns.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(headerBtns);

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

    // ---- 状态栏 ----
    var statusBar = document.createElement('div');
    statusBar.className = 'goby-status-bar';

    var statusLeft = document.createElement('div');
    statusLeft.className = 'goby-status-left';

    var statusModelEl = document.createElement('span');
    statusModelEl.className = 'goby-status-model';
    statusModelEl.textContent = '加载中...';

    var statusDotEl = document.createElement('span');
    statusDotEl.className = 'goby-status-dot gray';

    statusLeft.appendChild(statusModelEl);
    statusLeft.appendChild(statusDotEl);

    var statusRoundEl = document.createElement('span');
    statusRoundEl.className = 'goby-status-round';
    statusRoundEl.textContent = '第 0 轮';

    statusBar.appendChild(statusLeft);
    statusBar.appendChild(statusRoundEl);

    // ---- 拖拽把手 ----
    var resizeHandle = document.createElement('div');
    resizeHandle.className = 'goby-resize-handle';
    // 内联样式确保 JSDOM 测试可读取（同时 CSS class 提供相同约束）
    resizeHandle.style.height = '4px';
    resizeHandle.style.cursor = 'ns-resize';

    // 组装面板
    panel.appendChild(header);
    panel.appendChild(chatArea);
    panel.appendChild(inputBar);
    panel.appendChild(statusBar);
    panel.appendChild(resizeHandle);

    // ---- Plan 03-03: 会话侧栏 (300px slide-in, 覆盖模式) ----
    var sidebar = document.createElement('div');
    sidebar.className = 'goby-session-sidebar';
    sidebar.id = 'goby-session-sidebar';

    var sidebarHeader = document.createElement('div');
    sidebarHeader.className = 'goby-sidebar-header';
    var sidebarTitle = document.createElement('span');
    sidebarTitle.textContent = '会话列表';
    var sidebarCloseBtn = document.createElement('button');
    sidebarCloseBtn.className = 'goby-sidebar-close-btn';
    sidebarCloseBtn.textContent = '×'; // ×
    sidebarHeader.appendChild(sidebarTitle);
    sidebarHeader.appendChild(sidebarCloseBtn);

    var sidebarSearch = document.createElement('div');
    sidebarSearch.className = 'goby-sidebar-search';
    var sidebarSearchInput = document.createElement('input');
    sidebarSearchInput.type = 'text';
    sidebarSearchInput.placeholder = '搜索会话...';
    var sidebarSearchIcon = document.createElement('span');
    sidebarSearchIcon.className = 'goby-search-icon';
    sidebarSearchIcon.textContent = '🔍'; // 🔍
    sidebarSearch.appendChild(sidebarSearchInput);
    sidebarSearch.appendChild(sidebarSearchIcon);

    var sidebarList = document.createElement('div');
    sidebarList.className = 'goby-sidebar-list';

    var sidebarFooter = document.createElement('div');
    sidebarFooter.className = 'goby-sidebar-footer';
    var sidebarNewBtn = document.createElement('button');
    sidebarNewBtn.className = 'goby-sidebar-new-btn';
    sidebarNewBtn.textContent = '+ 新建会话';
    var sidebarClearBtn = document.createElement('button');
    sidebarClearBtn.className = 'goby-sidebar-clear-btn';
    sidebarClearBtn.textContent = '清除所有会话';
    sidebarFooter.appendChild(sidebarNewBtn);
    sidebarFooter.appendChild(sidebarClearBtn);

    sidebar.appendChild(sidebarHeader);
    sidebar.appendChild(sidebarSearch);
    sidebar.appendChild(sidebarList);
    sidebar.appendChild(sidebarFooter);
    panel.appendChild(sidebar);

    // ---- PANEL-09: 截图放大遮罩 (D-09/D-10/D-11/D-12) ----
    var overlayEl = document.createElement('div');
    overlayEl.id = 'goby-screenshot-overlay';
    overlayEl.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'background:rgba(0,0,0,0.85);z-index:2147483647;' +
        'display:none;align-items:center;justify-content:center;' +
        'overflow:auto;';

    var overlayCloseBtn = document.createElement('button');
    overlayCloseBtn.textContent = '×'; // ×
    overlayCloseBtn.style.cssText = 'position:fixed;top:16px;right:24px;' +
        'color:white;background:rgba(255,255,255,0.2);border:none;' +
        'font-size:32px;cursor:pointer;width:44px;height:44px;' +
        'border-radius:50%;display:flex;align-items:center;justify-content:center;' +
        'z-index:1;transition:background 0.15s;';

    var overlayImgContainer = document.createElement('div');
    overlayImgContainer.style.cssText = 'padding:24px;';

    var overlayImg = document.createElement('img');
    overlayImg.style.cssText = 'max-width:none;max-height:none;';

    overlayEl.appendChild(overlayCloseBtn);
    overlayImgContainer.appendChild(overlayImg);
    overlayEl.appendChild(overlayImgContainer);
    panel.appendChild(overlayEl);

    // 存储遮罩 DOM 引用
    _overlayEl = overlayEl;
    _overlayImg = overlayImg;
    _overlayCloseBtn = overlayCloseBtn;
    _overlayImgContainer = overlayImgContainer;

    // 遮罩事件绑定
    overlayCloseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      hideScreenshotOverlay();
    });

    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl || e.target === overlayImgContainer) {
        hideScreenshotOverlay();
      }
    });

    overlayImg.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    // ESC 键关闭遮罩
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _overlayEl && _overlayEl.style.display === 'flex') {
        hideScreenshotOverlay();
      }
    });

    // ---- Plan 03-03: 侧栏事件绑定 ----
    var sidebarOpen = false;

    _toggleSessionSidebar = function () {
      sidebarOpen = !sidebarOpen;
      if (sidebarOpen) {
        sidebar.classList.add('open');
        _renderSessionList('');
      } else {
        sidebar.classList.remove('open');
      }
    };

    function formatTimeAgo(timestamp) {
      var now = Date.now();
      var diff = now - timestamp;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
      var days = Math.floor(diff / 86400000);
      if (days < 30) return days + ' 天前';
      var date = new Date(timestamp);
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }

    _renderSessionList = function (filterText) {
      var agent = window.GobyAgent;
      if (!agent || typeof agent.getAllSessions !== 'function') return;

      agent.getAllSessions().then(function (sessions) {
        sidebarList.innerHTML = '';
        var filtered = sessions;

        if (filterText && filterText.trim()) {
          var ft = filterText.trim().toLowerCase();
          var originMatch = function (s) {
            return (s.origin && s.origin.toLowerCase().indexOf(ft) !== -1) ||
                   (s.title && s.title.toLowerCase().indexOf(ft) !== -1) ||
                   (s.preview && s.preview.toLowerCase().indexOf(ft) !== -1);
          };
          // 低版本浏览器兼容，不使用箭头函数
          filtered = [];
          for (var fi = 0; fi < sessions.length; fi++) {
            if (originMatch(sessions[fi])) {
              filtered.push(sessions[fi]);
            }
          }
        }

        // 无会话空状态
        if (filtered.length === 0) {
          var emptyEl = document.createElement('div');
          emptyEl.style.cssText = 'text-align:center;padding:40px 16px;color:#9ca3af;font-size:13px;';
          emptyEl.textContent = '暂无会话';
          sidebarList.appendChild(emptyEl);
          return;
        }

        for (var si = 0; si < filtered.length; si++) {
          var session = filtered[si];
          var item = document.createElement('div');
          item.className = 'goby-session-item';
          if (session.sessionId === (agent.getState && agent.getState().sessionId)) {
            item.classList.add('active');
          }
          item.setAttribute('data-session-id', session.sessionId);
          item.setAttribute('data-origin', session.origin || '');

          var info = document.createElement('div');
          info.className = 'goby-session-info';

          var originEl = document.createElement('div');
          originEl.className = 'goby-session-origin';
          try {
            originEl.textContent = new URL(session.origin || '').hostname;
          } catch (e) {
            originEl.textContent = session.origin || '';
          }

          var previewEl = document.createElement('div');
          previewEl.className = 'goby-session-preview';
          previewEl.textContent = session.preview ? '"' + session.preview + '"' : '';

          var metaEl = document.createElement('div');
          metaEl.className = 'goby-session-meta';
          metaEl.textContent = (session.messageCount || 0) + ' 条消息 · ' + formatTimeAgo(session.updatedAt || Date.now());

          info.appendChild(originEl);
          info.appendChild(previewEl);
          info.appendChild(metaEl);

          var deleteBtn = document.createElement('button');
          deleteBtn.className = 'goby-session-delete-btn';
          deleteBtn.textContent = '✕'; // ✕
          deleteBtn.setAttribute('data-session-id', session.sessionId);

          item.appendChild(info);
          item.appendChild(deleteBtn);
          sidebarList.appendChild(item);

          // 会话项点击事件
          item.addEventListener('click', function (sid) {
            return function () {
              if (window.GobyAgent && typeof window.GobyAgent.switchToSession === 'function') {
                window.GobyAgent.switchToSession(sid).then(function () {
                  _toggleSessionSidebar(); // 自动关闭侧栏
                });
              }
            };
          }(session.sessionId));

          // 删除按钮点击事件
          deleteBtn.addEventListener('click', function (sid) {
            return function (e) {
              e.stopPropagation();
              if (window.confirm('确定删除此会话？')) {
                if (window.GobyAgent && typeof window.GobyAgent.deleteSession === 'function') {
                  window.GobyAgent.deleteSession(sid).then(function () {
                    _renderSessionList(sidebarSearchInput.value || '');
                  });
                }
              }
            };
          }(session.sessionId));
        }
      });
    }

    // 侧栏按钮事件
    sessionBtn.addEventListener('click', function () {
      _toggleSessionSidebar();
    });

    sidebarCloseBtn.addEventListener('click', function () {
      _toggleSessionSidebar();
    });

    // 搜索 debounce (100ms，兼容测试环境)
    var _searchTimer = null;
    sidebarSearchInput.addEventListener('input', function () {
      if (_searchTimer) clearTimeout(_searchTimer);
      _searchTimer = setTimeout(function () {
        _renderSessionList(sidebarSearchInput.value || '');
      }, 100);
    });

    // 新建会话按钮
    sidebarNewBtn.addEventListener('click', function () {
      var agent = window.GobyAgent;
      if (agent && typeof agent.createSession === 'function') {
        var origin = window.location.origin;
        agent.createSession(origin);
        _toggleSessionSidebar();
      }
    });

    // 清除全部按钮
    sidebarClearBtn.addEventListener('click', function () {
      if (window.confirm('确定清除所有会话？')) {
        var agent = window.GobyAgent;
        if (agent && typeof agent.deleteAllSessions === 'function') {
          agent.deleteAllSessions().then(function () {
            _toggleSessionSidebar();
          });
        }
      }
    });

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
    _settingsBtn = settingsBtn;
    _sessionBtn = sessionBtn;
    _closeBtn = closeBtn;
    _statusBar = statusBar;
    _statusModelEl = statusModelEl;
    _statusDotEl = statusDotEl;
    _statusRoundEl = statusRoundEl;
    _resizeHandle = resizeHandle;

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

    // ---- 拖拽 resize 逻辑 ----
    // D-04: 高度范围 300-700px | D-05: 宽度不变、位置不变
    var panelEl = panel;
    var isResizing = false;
    var startY = 0;
    var startHeight = 0;

    function onMouseMove(e) {
      if (!isResizing) return;
      e.preventDefault();

      var deltaY = e.clientY - startY;
      var newHeight = startHeight + deltaY;

      // D-04: 限制 300-700px
      newHeight = Math.min(700, Math.max(300, newHeight));

      // D-05: 仅设置高度，宽度和位置不变
      panelEl.style.height = newHeight + 'px';
    }

    function onMouseUp(e) {
      if (!isResizing) return;
      isResizing = false;
      panelEl.classList.remove('resizing');

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    resizeHandle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      isResizing = true;
      startY = e.clientY;
      // 优先使用 offsetHeight（真实浏览器），回退到 style.height（JSDOM 无布局时）
      startHeight = panelEl.offsetHeight || parseInt(panelEl.style.height, 10) || 480;
      panelEl.classList.add('resizing');

      // 在 document 上绑定 mousemove 和 mouseup（支持拖出面板）
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
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
  //  PANEL-09: 截图遮罩控制函数 (D-09/D-10/D-11)
  // ============================================================

  /**
   * 显示截图放大遮罩
   * @param {string} dataUrl - 截图 data URL
   */
  function showScreenshotOverlay(dataUrl) {
    if (!_overlayEl) return;
    _overlayImg.src = dataUrl;
    _overlayEl.style.display = 'flex';
  }

  /**
   * 隐藏截图放大遮罩
   */
  function hideScreenshotOverlay() {
    if (!_overlayEl) return;
    _overlayEl.style.display = 'none';
    _overlayImg.src = '';
  }

  // ============================================================
  //  loadModelName — 从 storage 加载模型名到状态栏
  //  返回 promise，保证调用方可链入异步流程
  // ============================================================

  function loadModelName() {
    if (typeof GobyStorage !== 'undefined' && GobyStorage.getActiveProfile) {
      return GobyStorage.getActiveProfile().then(function (activeName) {
        if (!activeName) {
          updateModelName('未配置');
          return;
        }
        return GobyStorage.getProfiles().then(function (profiles) {
          var profile = profiles[activeName];
          if (profile && profile.model) {
            updateModelName(profile.model);
          } else {
            updateModelName('未配置');
          }
        });
      }).catch(function () {
        updateModelName('未配置');
      });
    }
    return Promise.resolve();
  }

  // ============================================================
  //  状态栏更新函数
  // ============================================================

  /**
   * 统一更新状态栏
   * @param {{modelName?: string, connectionStatus?: string, roundCount?: number}} opts
   */
  function updateStatusBar(opts) {
    if (opts.modelName !== undefined && _statusModelEl) {
      _statusModelEl.textContent = opts.modelName;
    }
    if (opts.connectionStatus !== undefined && _statusDotEl) {
      _statusDotEl.className = 'goby-status-dot ' + opts.connectionStatus;
    }
    if (opts.roundCount !== undefined && _statusRoundEl) {
      _statusRoundEl.textContent = '第 ' + opts.roundCount + ' 轮';
    }
  }

  /**
   * 单独更新模型名
   * @param {string} name
   */
  function updateModelName(name) {
    if (_statusModelEl) {
      _statusModelEl.textContent = name;
    }
  }

  /**
   * 单独更新连接状态点
   * @param {string} status - 'green', 'red', 'gray'
   */
  function updateConnectionStatus(status) {
    if (_statusDotEl) {
      _statusDotEl.className = 'goby-status-dot ' + status;
    }
  }

  /**
   * 单独更新对话轮数
   * @param {number} count
   */
  function updateRoundCount(count) {
    if (_statusRoundEl) {
      _statusRoundEl.textContent = '第 ' + count + ' 轮';
    }
  }

  // ============================================================
  //  Plan 03-01: renderMarkdown & appendStreamingChunk
  //  SEC-01: marked.parse → DOMPurify.sanitize 安全管道
  // ============================================================

  /**
   * renderMarkdown — 安全渲染管道 (SEC-01, D-20/D-21/D-22)
   * @param {string} content - 原始 LLM 输出 / markdown
   * @returns {string} 消毒后的安全 HTML
   */
  function renderMarkdown(content) {
    if (!content) return '';
    var html;
    try {
      html = window.marked.parse(content);
    } catch (e) {
      var textNode = document.createTextNode(content);
      html = textNode.textContent;
    }
    // DOMPurify 可能未加载（测试环境），回退到 textContent 编码文本
    if (typeof window.DOMPurify !== 'undefined' && typeof window.DOMPurify.sanitize === 'function') {
      return window.DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre',
          'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'a', 'blockquote', 'hr',
          'table', 'thead', 'tbody', 'tr', 'th', 'td',
          'img', 'del'
        ],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class']
      });
    }
    // 没有 DOMPurify 时，使用 textContent 注入
    var textNode = document.createTextNode(html);
    return textNode.textContent;
  }

  /**
   * 流式气泡渲染 — 当前正在流式渲染的气泡引用
   */
  var _streamingBubble = null;

  /**
   * appendStreamingChunk — 流式追加内容到气泡
   * 首次调用创建 Bot 气泡 + 光标 span
   * 后续调用追加 textContent
   * isDone=true 时执行 renderMarkdown → innerHTML 最终渲染
   * @param {string} content - 文本片段
   * @param {boolean} isDone - 是否流结束
   */
  function appendStreamingChunk(content, isDone) {
    if (!_messagesContainer) return;

    // 如果欢迎消息可见，隐藏它
    if (_welcomeEl && _welcomeEl.style.display !== 'none') {
      _welcomeEl.style.display = 'none';
    }

    if (isDone) {
      // 流结束：移除光标 → 执行 renderMarkdown → innerHTML 最终渲染
      if (_streamingBubble) {
        var cursor = _streamingBubble.querySelector('.goby-cursor');
        if (cursor) cursor.remove();
        _streamingBubble.innerHTML = renderMarkdown(content || '');
        _streamingBubble = null;
      }
      // 自动滚动到底部
      _messagesContainer.scrollTop = _messagesContainer.scrollHeight;
      return;
    }

    // 流式 chunk
    if (!_streamingBubble) {
      // 创建新的 Bot 气泡（无头像）
      var wrapperDiv = document.createElement('div');
      wrapperDiv.className = 'goby-msg-bot-wrapper';

      var bubbleDiv = document.createElement('div');
      bubbleDiv.className = 'goby-msg-bubble goby-msg-bot';
      bubbleDiv.style.animation = 'msgFadeIn 200ms ease-out';

      // 文本内容 + 闪烁光标
      var textSpan = document.createElement('span');
      textSpan.textContent = content;

      var cursorSpan = document.createElement('span');
      cursorSpan.className = 'goby-cursor';
      cursorSpan.textContent = '|';

      bubbleDiv.appendChild(textSpan);
      bubbleDiv.appendChild(cursorSpan);
      wrapperDiv.appendChild(bubbleDiv);
      _messagesContainer.appendChild(wrapperDiv);
      _streamingBubble = bubbleDiv;
    } else {
      // 追加到现有气泡（在光标前插入）
      var cursor = _streamingBubble.querySelector('.goby-cursor');
      if (cursor) {
        cursor.insertAdjacentText('beforebegin', content);
      } else {
        _streamingBubble.appendChild(document.createTextNode(content));
      }
    }

    // 每 chunk 自动滚动到底部
    _messagesContainer.scrollTop = _messagesContainer.scrollHeight;
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
     * - 创建悬浮球（始终显示）
     * - 面板默认隐藏；要自动展开走 autoStart（content-script.js 检查并调用 show()）
     * - 不再跨页面恢复 isVisible — 避免一次展开后所有页面都被强制弹出
     * @returns {Promise<void>}
     */
    init: function () {
      return chrome.storage.local.get(['gobyPanelState']).then(function () {
        state.isVisible = false;
        createFloatingBall();
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
          // 面板显示时加载模型名
          if (_statusModelEl) {
            return loadModelName();
          }
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
      }).then(function () {
        // 面板创建后加载模型名（适用于 init 时面板未创建、show 首次创建的情况）
        if (_statusModelEl) {
          return loadModelName();
        }
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
     * @param {string} content - 用户消息通过 textContent 注入，Bot 消息通过 renderMarkdown → innerHTML
     */
    appendMessage: appendMessage,

    /**
     * 流式追加内容到气泡（Plan 03-01）
     * 首次调用创建 Bot 气泡 + 光标，后续追加 textContent，isDone=true 时执行 renderMarkdown 最终渲染
     * @param {string} content
     * @param {boolean} isDone
     */
    appendStreamingChunk: appendStreamingChunk,

    /**
     * 显示工具调用状态指示器
     * @param {string} name - 工具名称
     * @returns {HTMLElement} 状态元素
     */
    appendToolCall: appendToolCall,

    /**
     * 更新工具调用状态指示器
     * @param {HTMLElement} badgeEl - appendToolCall 返回的元素
     * @param {string} result - 工具执行结果
     */
    completeToolCall: completeToolCall,

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
     * 消息容器引用（Plan 03-01）
     */
    _messagesContainer: null,

    /**
     * 输入框引用
     */
    _inputEl: null,

    /**
     * 更新状态栏
     * @param {{modelName?: string, connectionStatus?: string, roundCount?: number}} opts
     */
    updateStatusBar: function (opts) {
      updateStatusBar(opts);
    },

    /**
     * 更新模型名
     * @param {string} name
     */
    updateModelName: function (name) {
      updateModelName(name);
    },

    /**
     * 更新连接状态点
     * @param {string} status - 'green', 'red', 'gray'
     */
    updateConnectionStatus: function (status) {
      updateConnectionStatus(status);
    },

    /**
     * 更新对话轮数
     * @param {number} count
     */
    updateRoundCount: function (count) {
      updateRoundCount(count);
    },

    // Plan 03-03: 会话侧栏 API

    /**
     * 切换会话侧栏显示
     */
    toggleSessionSidebar: function () {
      if (typeof _toggleSessionSidebar === 'function') {
        _toggleSessionSidebar();
      }
    },

    /**
     * 渲染会话列表（供侧栏搜索使用）
     * @param {string} text - 搜索过滤文本
     */
    renderSessionList: function (text) {
      if (typeof _renderSessionList === 'function') {
        _renderSessionList(text || '');
      }
    },

    // PANEL-09: 截图遮罩 API

    /**
     * 显示截图放大遮罩
     * @param {string} dataUrl - 截图 data URL
     */
    showScreenshotOverlay: showScreenshotOverlay,

    /**
     * 隐藏截图放大遮罩
     */
    hideScreenshotOverlay: hideScreenshotOverlay
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
      window.GobyPanel._messagesContainer = _messagesContainer;
    }
  };
})();
