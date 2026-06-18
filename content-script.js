// Goby - AI 浏览器助手 | Content Script — 消息监听 + 面板注入
// Plan 01-03: 面板浮层注入、消息转发、设置模态框
// 依赖: storage.js, panel.js（通过 manifest content_scripts 顺序注入）

(function () {
  'use strict';

  console.log('Goby content script loaded on:', window.location.hostname);

  // ---- Message Listener ----
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    // T-01-07: 验证消息来源为扩展自身
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    if (message.action === 'toggle-panel') {
      if (message.visible) {
        GobyPanel.show();
      } else {
        GobyPanel.hide();
      }
      return false;
    }

    if (message.action === 'get-panel-state') {
      sendResponse(GobyPanel.getState());
      return true; // 异步响应
    }

    return false;
  });

  // ---- Init — 面板默认隐藏 ----
  GobyPanel.init().catch(function () {
    // 初始化失败 — 不影响 content-script 其他功能
  });

})();
