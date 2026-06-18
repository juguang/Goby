// Goby - AI 浏览器助手 | 面板状态管理和 DOM 操作
// Plan 01-03: 面板注入骨架 — 状态管理、创建/移除面板 DOM
// Task 2 将在此基础上升级标题栏和设置按钮

(function () {
  'use strict';

  // ---- 私有状态 ----
  var state = {
    isVisible: false
  };

  /**
   * 持久化面板状态到 chrome.storage.local
   * 键: gobyPanelState — { isVisible: boolean }
   */
  function persistState() {
    return chrome.storage.local.set({
      gobyPanelState: { isVisible: state.isVisible }
    });
  }

  /**
   * 创建面板 DOM 元素（Phase 2 将替换为完整 Shadow DOM 面板）
   * T-01-11: 检查容器是否已存在，防止重复注入
   */
  function createPanelShell() {
    if (document.querySelector('.goby-panel-container')) return;

    var container = document.createElement('div');
    container.className = 'goby-panel-container';

    var shell = document.createElement('div');
    shell.className = 'goby-panel-shell';

    // 标题栏
    var header = document.createElement('div');
    header.className = 'goby-panel-header';

    var title = document.createElement('span');
    title.className = 'goby-panel-title';
    title.textContent = 'Goby';

    // 设置按钮 — 点击打开模态框
    var settingsBtn = document.createElement('button');
    settingsBtn.className = 'goby-panel-settings-btn';
    settingsBtn.textContent = '⚙';
    settingsBtn.title = '设置';
    settingsBtn.addEventListener('click', function () {
      if (typeof window.openSettingsModal === 'function') {
        window.openSettingsModal();
      }
    });

    header.appendChild(title);
    header.appendChild(settingsBtn);
    shell.appendChild(header);

    // 占位区域 — Phase 2 将替换为聊天区域+输入框+状态栏
    var placeholder = document.createElement('div');
    placeholder.className = 'goby-panel-placeholder';
    placeholder.textContent = 'Goby 面板 — Phase 2 将在此构建完整 UI';

    shell.appendChild(placeholder);
    container.appendChild(shell);
    document.body.appendChild(container);
  }

  /**
   * 从 DOM 移除面板容器
   */
  function removePanelShell() {
    var container = document.querySelector('.goby-panel-container');
    if (container) {
      container.remove();
    }
  }

  // ---- 公共 API ----

  window.GobyPanel = {

    /**
     * 初始化面板状态（读取 storage）
     * @returns {Promise<void>}
     */
    init: function () {
      return chrome.storage.local.get(['gobyPanelState']).then(function (result) {
        var panelState = result.gobyPanelState || {};
        state.isVisible = panelState.isVisible === true;
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
          createPanelShell();
        } else {
          removePanelShell();
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
        createPanelShell();
      });
    },

    /**
     * 隐藏面板
     * @returns {Promise<void>}
     */
    hide: function () {
      state.isVisible = false;
      return persistState().then(function () {
        removePanelShell();
      });
    },

    /**
     * 渲染面板（根据当前状态创建或移除）
     */
    render: function () {
      if (state.isVisible) {
        createPanelShell();
      } else {
        removePanelShell();
      }
    },

    /**
     * 获取当前面板状态
     * @returns {{isVisible: boolean}}
     */
    getState: function () {
      return { isVisible: state.isVisible };
    }
  };
})();
