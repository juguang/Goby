// Goby - AI 浏览器助手 | Content Script — 消息监听 + 面板注入 + 设置模态框
// Plan 01-03: 面板浮层注入、消息转发、设置模态框（PANEL-07）
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

  // ==================================================================
  //  设置模态框（PANEL-07） — 复用 GobyStorage API 进行 Profile CRUD
  //  可被 Phase 2 复用
  // ==================================================================

  /**
   * 创建模态框表单组（不含眼睛切换）
   */
  function createFormGroup(labelText, inputId, inputType, placeholder) {
    var group = document.createElement('div');
    group.className = 'form-group';

    var label = document.createElement('label');
    label.htmlFor = inputId;
    label.textContent = labelText;

    var wrapper = document.createElement('div');
    wrapper.className = 'input-wrapper';

    var input = document.createElement('input');
    input.type = inputType;
    input.id = inputId;
    input.placeholder = placeholder;
    input.autocomplete = 'off';

    wrapper.appendChild(input);
    group.appendChild(label);
    group.appendChild(wrapper);

    return group;
  }

  /**
   * 创建模态框 API Key 表单组（带眼睛切换）
   * T-01-09: API Key 默认 password 类型，仅用户主动操作显示明文
   */
  function createFormGroupWithEye(labelText, inputId, placeholder) {
    var group = document.createElement('div');
    group.className = 'form-group';

    var label = document.createElement('label');
    label.htmlFor = inputId;
    label.textContent = labelText;

    var wrapper = document.createElement('div');
    wrapper.className = 'input-wrapper';

    var input = document.createElement('input');
    input.type = 'password';
    input.id = inputId;
    input.placeholder = placeholder;
    input.autocomplete = 'off';

    var eyeBtn = document.createElement('button');
    eyeBtn.className = 'eye-toggle';
    eyeBtn.type = 'button';
    eyeBtn.id = 'modal-eyeToggle';
    eyeBtn.textContent = '\u{1F441}'; // 👁
    eyeBtn.title = '显示/隐藏 API Key';
    eyeBtn.addEventListener('click', function () {
      if (input.type === 'password') {
        input.type = 'text';
        eyeBtn.textContent = '\u{1F648}'; // 🙈
      } else {
        input.type = 'password';
        eyeBtn.textContent = '\u{1F441}'; // 👁
      }
    });

    wrapper.appendChild(input);
    wrapper.appendChild(eyeBtn);
    group.appendChild(label);
    group.appendChild(wrapper);

    return group;
  }

  /**
   * 加载 profiles 并填充模态框下拉框
   */
  function loadModalProfiles() {
    GobyStorage.getProfiles().then(function (profiles) {
      GobyStorage.getActiveProfile().then(function (active) {
        var select = document.getElementById('modal-profile-select');
        if (!select) return;
        select.innerHTML = '';

        var names = Object.keys(profiles);
        names.forEach(function (name) {
          var opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          select.appendChild(opt);
        });

        var target = active && profiles[active] ? active : (names.length > 0 ? names[0] : '');
        if (target) {
          select.value = target;
        }

        loadModalProfileForm(target, profiles);
      });
    }).catch(function () {
      // 读取失败 — 保持空状态
    });
  }

  /**
   * 将指定 Profile 加载到模态框表单
   */
  function loadModalProfileForm(name, profiles) {
    if (!name) return;

    var baseUrlInput = document.getElementById('modal-baseUrl');
    var apiKeyInput = document.getElementById('modal-apiKey');
    var modelInput = document.getElementById('modal-model');

    if (!baseUrlInput) return;

    if (!profiles) {
      GobyStorage.getProfiles().then(function (p) {
        var profile = p[name] || {};
        baseUrlInput.value = profile.baseUrl || '';
        apiKeyInput.value = profile.apiKey || '';
        modelInput.value = profile.model || '';
        updateHttpsWarning();
      });
      return;
    }

    var profile = profiles[name] || {};
    baseUrlInput.value = profile.baseUrl || '';
    apiKeyInput.value = profile.apiKey || '';
    modelInput.value = profile.model || '';
    updateHttpsWarning();

    // 加载 autoStart 状态
    chrome.storage.local.get(['gobyPanelState'], function (result) {
      var panelState = result.gobyPanelState || {};
      var autoCheck = document.getElementById('modal-autoStart');
      if (autoCheck) {
        autoCheck.checked = panelState.autoStart === true;
      }
    });
  }

  /**
   * 更新 HTTPS 警告显示 — 仅 baseUrl 不以 https 开头时显示
   */
  function updateHttpsWarning() {
    var baseUrl = document.getElementById('modal-baseUrl');
    var warning = document.getElementById('modal-https-warning');
    if (!baseUrl || !warning) return;

    var value = baseUrl.value.trim();
    if (value && !value.startsWith('https://')) {
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }
  }

  /**
   * 表单验证 — 检查所有字段非空
   * @returns {boolean} 验证是否通过
   */
  function validateModalForm() {
    var fields = [
      { id: 'modal-baseUrl', name: 'API Base URL' },
      { id: 'modal-apiKey', name: 'API Key' },
      { id: 'modal-model', name: 'Model Name' }
    ];

    // 清除旧错误提示
    document.querySelectorAll('.goby-field-error').forEach(function (el) {
      el.remove();
    });

    var valid = true;

    fields.forEach(function (field) {
      var input = document.getElementById(field.id);
      if (!input) return;

      // 清除输入框的错误样式
      var wrapper = input.parentElement;
      if (wrapper) {
        wrapper.style.border = '';
      }

      if (!input.value.trim()) {
        valid = false;
        var error = document.createElement('span');
        error.className = 'goby-field-error';
        error.textContent = '此项为必填';
        var wrapper2 = input.parentElement;
        if (wrapper2 && wrapper2.parentElement) {
          wrapper2.parentElement.appendChild(error);
        }
      }
    });

    return valid;
  }

  /**
   * 保存当前模态框表单到 Profile（由保存按钮和编辑按钮触发）
   */
  function saveModalProfile() {
    if (!validateModalForm()) {
      return;
    }

    var select = document.getElementById('modal-profile-select');
    if (!select || !select.value) return;

    var name = select.value;
    var config = {
      baseUrl: document.getElementById('modal-baseUrl').value.trim(),
      apiKey: document.getElementById('modal-apiKey').value,
      model: document.getElementById('modal-model').value.trim()
    };

    GobyStorage.saveProfile(name, config).then(function () {
      showModalFeedback('已保存', 'success');
    }).catch(function (err) {
      showModalFeedback('保存失败: ' + (err.message || '未知错误'), 'error');
    });
  }

  /**
   * 添加新 Profile
   */
  function addModalProfile() {
    var name = prompt('请输入新的 API 配置名称：');
    if (!name || name.trim() === '') return;
    name = name.trim();

    // 检查名称是否已存在
    GobyStorage.getProfiles().then(function (profiles) {
      if (profiles[name]) {
        alert('配置名称已存在');
        return;
      }
      GobyStorage.saveProfile(name, { baseUrl: '', apiKey: '', model: '' }).then(function () {
        loadModalProfiles();
        // 选中新创建的 profile
        var select = document.getElementById('modal-profile-select');
        if (select) {
          select.value = name;
        }
        // 聚焦 Base URL
        var baseUrlInput = document.getElementById('modal-baseUrl');
        if (baseUrlInput) baseUrlInput.focus();
      }).catch(function (err) {
        showModalFeedback('添加失败: ' + (err.message || '未知错误'), 'error');
      });
    });
  }

  /**
   * 删除选中的 Profile
   */
  function deleteModalProfile() {
    var select = document.getElementById('modal-profile-select');
    if (!select || !select.value) return;

    var name = select.value;

    if (!confirm('确定删除「' + name + '」吗？此操作不可撤销。')) {
      return;
    }

    GobyStorage.deleteProfile(name).then(function () {
      loadModalProfiles();
      showModalFeedback('已删除 ' + name, 'error', 1500);
    }).catch(function (err) {
      showModalFeedback('删除失败: ' + (err.message || '未知错误'), 'error');
    });
  }

  /**
   * 在模态框内显示反馈消息
   */
  function showModalFeedback(message, type, duration) {
    duration = duration || 2000;

    var statusEl = document.getElementById('modal-save-status');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = 'goby-modal-save-status visible ' + type;
    statusEl.style.opacity = '1';

    // 清除之前的定时器
    if (statusEl._feedbackTimer) {
      clearTimeout(statusEl._feedbackTimer);
    }

    statusEl._feedbackTimer = setTimeout(function () {
      statusEl.style.opacity = '0';
      setTimeout(function () {
        statusEl.className = 'goby-modal-save-status';
        statusEl.style.opacity = '';
      }, 300);
    }, duration);
  }

  /**
   * 打开设置模态框 — 构建 DOM 并挂载到页面
   */
  function openSettingsModal() {
    // T-01-11: 防止重复打开
    if (document.querySelector('.goby-modal-backdrop')) return;

    // ---- Backdrop ----
    var backdrop = document.createElement('div');
    backdrop.className = 'goby-modal-backdrop';
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) {
        closeSettingsModal();
      }
    });

    // ---- Modal Container ----
    var modal = document.createElement('div');
    modal.className = 'goby-modal';

    // ---- Header ----
    var header = document.createElement('div');
    header.className = 'goby-modal-header';

    var title = document.createElement('span');
    title.className = 'goby-modal-header-title';
    title.textContent = '⚙ 设置';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'goby-modal-close-btn';
    closeBtn.textContent = '×'; // ×
    closeBtn.addEventListener('click', closeSettingsModal);

    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // ---- Body ----
    var body = document.createElement('div');
    body.className = 'goby-modal-body';

    // Profile selector row
    var profileRow = document.createElement('div');
    profileRow.className = 'goby-modal-profile-row';

    var profileLabel = document.createElement('span');
    profileLabel.className = 'profile-label';
    profileLabel.textContent = 'API 配置';

    var profileSelect = document.createElement('select');
    profileSelect.className = 'goby-modal-profile-select';
    profileSelect.id = 'modal-profile-select';

    var btnGroup = document.createElement('div');
    btnGroup.className = 'goby-modal-btn-group';

    var addBtn = document.createElement('button');
    addBtn.className = 'goby-modal-btn';
    addBtn.textContent = '＋'; // ＋
    addBtn.title = '添加配置';

    var editBtn = document.createElement('button');
    editBtn.className = 'goby-modal-btn';
    editBtn.textContent = '✎'; // ✎
    editBtn.title = '编辑配置';

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'goby-modal-btn delete-btn';
    deleteBtn.textContent = '✕'; // ✕
    deleteBtn.title = '删除配置';

    btnGroup.appendChild(addBtn);
    btnGroup.appendChild(editBtn);
    btnGroup.appendChild(deleteBtn);

    profileRow.appendChild(profileLabel);
    profileRow.appendChild(profileSelect);
    profileRow.appendChild(btnGroup);
    body.appendChild(profileRow);

    // Form fields
    body.appendChild(createFormGroup('API Base URL', 'modal-baseUrl', 'text', 'http://127.0.0.1:8765/v1'));
    body.appendChild(createFormGroupWithEye('API Key', 'modal-apiKey', ''));
    body.appendChild(createFormGroup('Model Name', 'modal-model', 'text', '例如: Qwen3.6-35B-A3B'));

    // Auto-start checkbox
    var autoCheckLabel = document.createElement('label');
    autoCheckLabel.className = 'goby-auto-checkbox';

    var autoCheckInput = document.createElement('input');
    autoCheckInput.type = 'checkbox';
    autoCheckInput.id = 'modal-autoStart';

    var autoCheckText = document.createTextNode(' 启动时自动展开面板');
    autoCheckLabel.appendChild(autoCheckInput);
    autoCheckLabel.appendChild(autoCheckText);
    body.appendChild(autoCheckLabel);

    // HTTPS warning
    var httpsWarning = document.createElement('div');
    httpsWarning.className = 'goby-https-warning hidden';
    httpsWarning.id = 'modal-https-warning';
    httpsWarning.textContent = '您的 API Key 将通过非加密连接传输，建议使用 HTTPS 地址';
    body.appendChild(httpsWarning);

    // Save button
    var saveBtn = document.createElement('button');
    saveBtn.className = 'goby-modal-save-btn';
    saveBtn.id = 'modal-save-btn';
    saveBtn.textContent = '保存配置';
    body.appendChild(saveBtn);

    // Save status
    var saveStatus = document.createElement('div');
    saveStatus.className = 'goby-modal-save-status';
    saveStatus.id = 'modal-save-status';
    body.appendChild(saveStatus);

    modal.appendChild(body);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // ---- Event Wiring ----

    // Profile switch
    profileSelect.addEventListener('change', function () {
      var selected = this.value;
      if (!selected) return;
      GobyStorage.setActiveProfile(selected).then(function () {
        loadModalProfileForm(selected);
      }).catch(function () {
        // 切换失败 — 保持当前
      });
    });

    // Add profile
    addBtn.addEventListener('click', addModalProfile);

    // Edit/save profile (same as save button)
    editBtn.addEventListener('click', saveModalProfile);

    // Delete profile
    deleteBtn.addEventListener('click', deleteModalProfile);

    // Save button
    saveBtn.addEventListener('click', saveModalProfile);

    // Base URL input → real-time HTTPS warning update
    var baseUrlInput = document.getElementById('modal-baseUrl');
    if (baseUrlInput) {
      baseUrlInput.addEventListener('input', updateHttpsWarning);
    }

    // Auto-start checkbox → immediate write to storage
    if (autoCheckInput) {
      autoCheckInput.addEventListener('change', function () {
        chrome.storage.local.get(['gobyPanelState'], function (result) {
          var panelState = result.gobyPanelState || {};
          panelState.autoStart = autoCheckInput.checked;
          chrome.storage.local.set({ gobyPanelState: panelState });
        });
      });
    }

    // ---- Load data ----
    loadModalProfiles();
  }

  /**
   * 关闭设置模态框 — 从 DOM 移除
   */
  function closeSettingsModal() {
    var backdrop = document.querySelector('.goby-modal-backdrop');
    if (backdrop) {
      backdrop.remove();
    }
  }

  // ---- 暴露外部接口（供 panel.js 使用） ----
  window.openSettingsModal = openSettingsModal;
  window.closeSettingsModal = closeSettingsModal;

})();
