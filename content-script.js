// Goby - AI 浏览器助手 | Content Script — 消息监听 + 面板注入 + 设置模态框
// Plan 01-03: 面板浮层注入、消息转发、设置模态框（PANEL-07）
// Plan 03-01: 流式 LLM 调用、安全渲染管道、回退机制（AGENT-02/03/04/06）
// Plan 03-02: Agent 主循环、工具执行引擎、限制保护（AGENT-01/05）
// 依赖: storage.js, panel.js（通过 manifest content_scripts 顺序注入）

(function () {
  'use strict';

  // i18n 翻译函数引用
  var t = window.GobyI18n ? window.GobyI18n.t : function (k, p) { return k; };

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

    // Plan 03-01: stream-chunk 事件 — 从 SW 接收 LLM 流式响应
    if (message.action === 'stream-chunk') {
      if (window.GobyAgent && typeof window.GobyAgent.handleStreamChunk === 'function') {
        window.GobyAgent.handleStreamChunk(message.data);
      }
      return false;
    }

    // Phase 8 / NAV-08 / D-10: workflow-init — SW 注入工作 Tab 角色 + inherited 上下文
    // 工作 Tab 是全新页面，没有 interrupted session 需要恢复；isWorkflowInit=true 等价
    // 新 session 的第一次 processAgentMessage 调用（不复用 resume 标记，避免误触发续跑）
    if (message.action === 'workflow-init') {
      window.__gobyWorkflowId = message.workflow_id;
      // Phase 8 fix (260621-gKz): 重置 messages 数组，避免同一 worker Tab 多次
      // workflow 启动（如用户连续 page_open_tab）时累积旧 messages 导致顺序错位
      // 触发 HTTP 400（tool message 在 assistant.tool_calls 之前）
      _agentState.messages = [];
      // push inherited messages（chat Tab 最后 5 条，让工作 Tab 有上下文）
      if (Array.isArray(message.inherited_messages)) {
        for (var ii = 0; ii < message.inherited_messages.length; ii++) {
          _agentState.messages.push(message.inherited_messages[ii]);
        }
      }
      // push initial user message（D-10：让 LLM 知道自己在工作 Tab 角色 + 任务目标）
      if (message.initial_user_message) {
        _agentState.messages.push({ role: 'user', content: message.initial_user_message });
      }
      // 自动启动 Agent 循环 — isWorkflowInit 路径不复用 resume（避免误触发 initSession resume）
      // processAgentMessage 内识别 isWorkflowInit=true 时 push 角色 user message 路径
      if (window.GobyAgent && typeof window.GobyAgent.processAgentMessage === 'function') {
        window.GobyAgent.processAgentMessage(null, { isWorkflowInit: true });
      }
      return false;
    }

    // Phase 8 / NAV-08 / D-11: workflow_progress — 工作 Tab Agent 增量转发回 chat Tab
    // Claude's Discretion 锁定：复用 GobyPanel.appendMessage('bot', ...) + badge 前缀
    // 不引入新 panel.js 方法（保持轻量）；workflow_id badge 通过文本前缀 [W-xxxx] 实现
    if (message.action === 'workflow_progress') {
      var wfShort = (message.workflow_id || 'wf').slice(0, 8);
      var progressContent = (message.data && message.data.content) || '';
      if (window.GobyPanel && typeof window.GobyPanel.appendMessage === 'function') {
        window.GobyPanel.appendMessage('bot', '[W-' + wfShort + '] ' + progressContent);
      }
      return false;
    }

    // Phase 8 / NAV-08 / D-15: workflow_complete — 工作 Tab 调 page_finish_workflow 后 SW 转发 summary
    // chat Tab 把 summary 作为 user message 追加 + 以 resume 模式调 processAgentMessage 续跑
    if (message.action === 'workflow_complete') {
      var wcWfId = message.workflow_id;
      var wcSummary = (message.data && message.data.summary) || '';
      var fromWorkflowText = '[From workflow ' + wcWfId + '] ' + wcSummary;
      _agentState.messages.push({ role: 'user', content: fromWorkflowText });
      if (window.GobyPanel && typeof window.GobyPanel.appendMessage === 'function') {
        window.GobyPanel.appendMessage('user', fromWorkflowText);
      }
      if (window.GobyAgent && typeof window.GobyAgent.processAgentMessage === 'function') {
        window.GobyAgent.processAgentMessage(null, { resume: true, fromWorkflow: wcWfId });
      }
      return false;
    }

    // Phase 8 / NAV-08: workflow_error — 工作 Tab 报错或被关闭
    // chat Tab push assistant 错误消息 + 恢复输入框（isProcessing=false）
    if (message.action === 'workflow_error') {
      var weWfId = message.workflow_id;
      var weReason = (message.data && message.data.reason) || '未知错误';
      var errMsg = '工作流 ' + weWfId + ' 失败: ' + weReason;
      _agentState.messages.push({ role: 'assistant', content: errMsg });
      if (window.GobyPanel && typeof window.GobyPanel.appendMessage === 'function') {
        window.GobyPanel.appendMessage('bot', errMsg);
      }
      _agentState.isProcessing = false;
      if (window.GobyPanel && typeof window.GobyPanel.setAgentRunning === 'function') {
        window.GobyPanel.setAgentRunning(false);
      }
      if (window.GobyPanel && window.GobyPanel._inputEl) window.GobyPanel._inputEl.disabled = false;
      if (window.GobyPanel && window.GobyPanel._sendBtn) window.GobyPanel._sendBtn.disabled = false;
      return false;
    }

    // Phase 8 fix: sessions-deleted — SW 广播，通知所有 tab 重置本地状态
    //   deleteAllSessions 委托 SW 执行后，SW 广播此消息给所有 tab。
    //   每个 content-script 重置 _agentState 并创建新 session，
    //   而不是只靠发起清除的 tab 自己做。
    if (message.action === 'sessions-deleted') {
      _agentState.messages = [];
      _agentState.isProcessing = false;
      _agentState.roundCount = 0;
      GobyPanel.updateRoundCount(0);
      if (window.GobyPanel && typeof window.GobyPanel.refreshSessionSidebar === 'function') {
        window.GobyPanel.refreshSessionSidebar();
      }
      return false;
    }

    return false;
  });

  // ---- Init — 面板默认隐藏，autoStart 控制自动展开 ----
  // Phase 03 UAT 测试 5：先 await GobyPanel.init()，再 initSession()，避免渲染时序竞争
  // （否则 loadSession 完成时面板未就绪，renderWelcome + appendMessage(历史) 被静默跳过）
  // Plan 09-03: 首次运行预装内置技能（gobySkills 为空时自动注入 5 个技能）
  GobyPanel.init().then(function () {
    // 先预装内置技能（异步），再初始化会话（确保 _autoRegisterSkills 可见）
    return _preloadBuiltinSkills().then(function () {
      // 面板就绪 + 技能就绪后再初始化会话
      initSession();
      return chrome.storage.local.get(['gobyPanelState']).then(function (result) {
        var panelState = result.gobyPanelState || {};
        if (panelState.autoStart) {
          return GobyPanel.show();
        }
      });
    });
  }).catch(function () {
    // 初始化失败 — 退化到立即初始化会话（无面板渲染）
    // 仍尝试预装技能
    _preloadBuiltinSkills().then(function () {
      initSession();
    });
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
   * 保存当前模态框表单到 Profile（由保存按钮触发）
   */
  function saveModalProfile() {
    if (!validateModalForm()) {
      return;
    }

    var select = document.getElementById('modal-profile-select');
    if (!select || !select.value) return;

    var name = select.value;
    var config = GobyFormHelpers.buildProfileConfigFromForm(
      document.getElementById('modal-baseUrl').value,
      document.getElementById('modal-apiKey').value,
      document.getElementById('modal-model').value
    );

    var v = GobyFormHelpers.validateProfileConfig(config);
    if (!v.ok) {
      showModalFeedback(v.message, 'error', 3000);
      if (v.field === 'baseUrl') {
        var bEl = document.getElementById('modal-baseUrl');
        if (bEl) bEl.focus();
      } else if (v.field === 'apiKey') {
        var kEl = document.getElementById('modal-apiKey');
        if (kEl) kEl.focus();
      }
      return;
    }

    GobyStorage.saveProfile(name, config).then(function () {
      showModalFeedback(t('modal.save_success'), 'success');
    }).catch(function (err) {
      showModalFeedback(t('modal.save_fail', { msg: err.message || '未知错误' }), 'error');
    });
  }

  /**
   * 编辑当前选中的 Profile（对标 popup.js btnEditProfile 行为）
   * 重新加载表单 + 聚焦 + 全选 Base URL + 显示编辑模式提示
   */
  function editModalProfile() {
    var select = document.getElementById('modal-profile-select');
    if (!select || !select.value) return;
    var name = select.value;
    loadModalProfileForm(name);
    var baseUrlInput = document.getElementById('modal-baseUrl');
    if (baseUrlInput) {
      baseUrlInput.focus();
      baseUrlInput.select();
    }
    showModalFeedback(t('modal.edit_hint', { name: name }), 'success', 1500);
  }

  /**
   * 添加新 Profile
   */
  function addModalProfile() {
    var name = prompt(t('modal.add_prompt'));
    if (!name || name.trim() === '') return;
    name = name.trim();

    // 检查名称是否已存在
    GobyStorage.getProfiles().then(function (profiles) {
      if (profiles[name]) {
        alert(t('modal.add_duplicate'));
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
        showModalFeedback(t('modal.add_fail', { msg: err.message || '未知错误' }), 'error');
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

    if (!confirm(t('modal.delete_confirm', { name: name }))) {
      return;
    }

    GobyStorage.deleteProfile(name).then(function () {
      loadModalProfiles();
      showModalFeedback(t('modal.delete_success', { name: name }), 'error', 1500);
    }).catch(function (err) {
      showModalFeedback(t('modal.delete_fail', { msg: err.message || '未知错误' }), 'error');
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
    title.textContent = t('modal.title');

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
    profileLabel.textContent = t('modal.api_config_label');

    var profileSelect = document.createElement('select');
    profileSelect.className = 'goby-modal-profile-select';
    profileSelect.id = 'modal-profile-select';

    var btnGroup = document.createElement('div');
    btnGroup.className = 'goby-modal-btn-group';

    var addBtn = document.createElement('button');
    addBtn.className = 'goby-modal-btn';
    addBtn.textContent = '＋'; // ＋
    addBtn.title = t('modal.add_btn_title');

    var editBtn = document.createElement('button');
    editBtn.className = 'goby-modal-btn';
    editBtn.textContent = '✎'; // ✎
    editBtn.title = t('modal.edit_btn_title');

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'goby-modal-btn delete-btn';
    deleteBtn.textContent = '✕'; // ✕
    deleteBtn.title = t('modal.delete_btn_title');

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

    // Auto-start toggle (与 popup 共享 lib/toggle.css 样式)
    var autoCheckRow = document.createElement('div');
    autoCheckRow.className = 'panel-toggle-row';
    var autoCheckLabel = document.createElement('span');
    autoCheckLabel.className = 'panel-toggle-label';
    autoCheckLabel.textContent = t('modal.autostart_label');
    var autoCheckSwitch = document.createElement('label');
    autoCheckSwitch.className = 'toggle-switch';
    var autoCheckInput = document.createElement('input');
    autoCheckInput.type = 'checkbox';
    autoCheckInput.id = 'modal-autoStart';
    var autoCheckSlider = document.createElement('span');
    autoCheckSlider.className = 'toggle-slider';
    autoCheckSwitch.appendChild(autoCheckInput);
    autoCheckSwitch.appendChild(autoCheckSlider);
    autoCheckRow.appendChild(autoCheckLabel);
    autoCheckRow.appendChild(autoCheckSwitch);
    body.appendChild(autoCheckRow);

    // HTTPS warning
    var httpsWarning = document.createElement('div');
    httpsWarning.className = 'goby-https-warning hidden';
    httpsWarning.id = 'modal-https-warning';
    httpsWarning.textContent = t('modal.https_warning');
    body.appendChild(httpsWarning);

    // ---- 语言选择行 ----
    var langRow = document.createElement('div');
    langRow.className = 'panel-toggle-row';
    var langLabel = document.createElement('span');
    langLabel.className = 'panel-toggle-label';
    langLabel.textContent = t('modal.language_label');
    var langSelect = document.createElement('select');
    langSelect.id = 'goby-lang-select';
    langSelect.style.cssText = 'padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;';
    var optZh = document.createElement('option');
    optZh.value = 'zh'; optZh.textContent = t('modal.lang_zh');
    var optEn = document.createElement('option');
    optEn.value = 'en'; optEn.textContent = t('modal.lang_en');
    optZh.selected = window.GobyI18n.getLocale() === 'zh';
    optEn.selected = window.GobyI18n.getLocale() === 'en';
    langSelect.appendChild(optZh);
    langSelect.appendChild(optEn);
    langRow.appendChild(langLabel);
    langRow.appendChild(langSelect);
    body.appendChild(langRow);
    // 切换事件
    langSelect.addEventListener('change', function () {
      window.GobyI18n.setLocale(this.value);
      showModalFeedback(t('modal.lang_switch_msg'), 'success', 3000);
    });

    // ---- Plan 09-04: 技能管理区域 ----
    var skillsSection = document.createElement('div');
    skillsSection.className = 'goby-skills-section';

    // 节标题 + 导入按钮
    var skillsTitleRow = document.createElement('div');
    skillsTitleRow.className = 'goby-skills-section-title';

    var skillsTitleText = document.createElement('span');
    skillsTitleText.textContent = t('modal.skills_title') || '技能管理';

    var skillsImportBtn = document.createElement('button');
    skillsImportBtn.className = 'goby-skills-import-btn';
    skillsImportBtn.id = 'goby-skills-import-btn';
    skillsImportBtn.textContent = t('modal.skills_import_btn') || '+ 导入技能';

    skillsTitleRow.appendChild(skillsTitleText);
    skillsTitleRow.appendChild(skillsImportBtn);
    skillsSection.appendChild(skillsTitleRow);

    // 导入行（默认隐藏）
    var importRow = document.createElement('div');
    importRow.className = 'goby-skill-import-row';
    importRow.id = 'goby-skill-import-row';
    importRow.style.display = 'none';

    var importInput = document.createElement('input');
    importInput.type = 'text';
    importInput.className = 'goby-skill-import-input';
    importInput.id = 'goby-skill-import-input';
    importInput.placeholder = 'https://raw.githubusercontent.com/.../SKILL.md';

    var importConfirm = document.createElement('button');
    importConfirm.className = 'goby-skill-import-confirm-btn';
    importConfirm.id = 'goby-skill-import-confirm-btn';
    importConfirm.textContent = t('modal.skills_import_confirm') || '确认导入';

    var importCancel = document.createElement('button');
    importCancel.className = 'goby-skill-import-cancel-btn';
    importCancel.id = 'goby-skill-import-cancel-btn';
    importCancel.textContent = t('modal.skills_cancel') || '取消';

    importRow.appendChild(importInput);
    importRow.appendChild(importConfirm);
    importRow.appendChild(importCancel);
    skillsSection.appendChild(importRow);

    // 反馈信息
    var skillFeedback = document.createElement('div');
    skillFeedback.className = 'goby-skill-feedback';
    skillFeedback.id = 'goby-skill-feedback';
    skillsSection.appendChild(skillFeedback);

    // 已安装技能列表
    var skillsListContainer = document.createElement('div');
    skillsListContainer.className = 'goby-skills-list';
    skillsListContainer.id = 'goby-skills-list';
    skillsSection.appendChild(skillsListContainer);

    // 推荐技能区域
    var recommendedSection = document.createElement('div');
    recommendedSection.className = 'goby-recommended-section';
    recommendedSection.id = 'goby-recommended-section';

    var recommendedTitle = document.createElement('div');
    recommendedTitle.className = 'goby-recommended-title';
    recommendedTitle.textContent = t('modal.skills_recommended') || '推荐安装';
    recommendedSection.appendChild(recommendedTitle);

    var recommendedList = document.createElement('div');
    recommendedList.id = 'goby-recommended-list';
    recommendedSection.appendChild(recommendedList);

    skillsSection.appendChild(recommendedSection);

    body.appendChild(skillsSection);

    // ---- 技能管理事件绑定 ----

    // 显示/隐藏导入 URL 输入行
    skillsImportBtn.addEventListener('click', function () {
      var row = document.getElementById('goby-skill-import-row');
      if (row) {
        var isVisible = row.style.display !== 'none';
        row.style.display = isVisible ? 'none' : 'flex';
        if (!isVisible && importInput) {
          importInput.value = '';
          importInput.focus();
        }
      }
    });

    // 取消导入
    importCancel.addEventListener('click', function () {
      importRow.style.display = 'none';
      importInput.value = '';
      hideSkillFeedback();
    });

    // 确认导入
    importConfirm.addEventListener('click', function () {
      var url = (importInput.value || '').trim();
      if (!url) {
        showSkillFeedback(t('modal.skills_url_required') || '请输入 URL', 'error');
        return;
      }
      if (url.indexOf('https://') !== 0) {
        // D-01: 只允许 https:// URLs，阻止 http:// 和 file://
        showSkillFeedback(t('modal.skills_https_only') || '仅支持 https:// URL', 'error');
        return;
      }

      importConfirm.disabled = true;
      importConfirm.textContent = t('modal.skills_importing') || '导入中...';

      window.GobyAgent.importSkill(url).then(function (result) {
        importConfirm.disabled = false;
        importConfirm.textContent = t('modal.skills_import_confirm') || '确认导入';
        if (result && result.ok) {
          showSkillFeedback(
            (t('modal.skills_import_success') || '技能已安装：') + (result.domain || ''),
            'success'
          );
          importRow.style.display = 'none';
          importInput.value = '';
          refreshSkillsList();
          refreshRecommendedList();
        } else {
          var errMsg = result && result.error ? result.error : (t('modal.skills_import_failed') || '导入失败');
          showSkillFeedback(errMsg, 'error');
        }
      }).catch(function (e) {
        importConfirm.disabled = false;
        importConfirm.textContent = t('modal.skills_import_confirm') || '确认导入';
        showSkillFeedback((t('modal.skills_import_failed') || '导入失败') + ': ' + (e.message || String(e)), 'error');
      });
    });

    // ---- 技能反馈辅助函数 ----
    var _skillFeedbackTimer = null;

    function showSkillFeedback(msg, type) {
      if (_skillFeedbackTimer) clearTimeout(_skillFeedbackTimer);
      var fb = document.getElementById('goby-skill-feedback');
      if (fb) {
        fb.textContent = msg;
        fb.className = 'goby-skill-feedback visible ' + type;
        _skillFeedbackTimer = setTimeout(function () {
          fb.className = 'goby-skill-feedback';
        }, 5000);
      }
    }

    function hideSkillFeedback() {
      if (_skillFeedbackTimer) clearTimeout(_skillFeedbackTimer);
      var fb = document.getElementById('goby-skill-feedback');
      if (fb) {
        fb.className = 'goby-skill-feedback';
      }
    }

    // ---- 技能列表渲染函数 ----

    /**
     * 渲染已安装技能列表
     */
    function refreshSkillsList() {
      var listEl = document.getElementById('goby-skills-list');
      if (!listEl) return;

      window.GobyAgent.listSkills().then(function (skills) {
        listEl.innerHTML = '';
        var domains = Object.keys(skills);
        if (domains.length === 0) {
          var emptyDiv = document.createElement('div');
          emptyDiv.className = 'goby-skills-empty';
          emptyDiv.textContent = t('modal.skills_empty') || '暂无已安装技能';
          listEl.appendChild(emptyDiv);
          return;
        }
        for (var i = 0; i < domains.length; i++) {
          var domain = domains[i];
          var skill = skills[domain];
          renderSkillItem(listEl, domain, skill);
        }
      }).catch(function () {
        // 静默降级
      });
    }

    /**
     * 渲染单个技能项
     */
    function renderSkillItem(container, domain, skill) {
      var item = document.createElement('div');
      item.className = 'goby-skill-item';
      item.id = 'goby-skill-' + domain.replace(/\./g, '-');
      if (skill.enabled === false) {
        item.classList.add('disabled');
      }

      // 技能信息
      var info = document.createElement('div');
      info.className = 'goby-skill-info';

      var nameEl = document.createElement('div');
      nameEl.className = 'goby-skill-name';
      nameEl.textContent = skill.name || domain;

      var meta = document.createElement('div');
      meta.className = 'goby-skill-meta';

      var domainEl = document.createElement('span');
      domainEl.className = 'goby-skill-domain';
      domainEl.textContent = domain;

      var actionCountEl = document.createElement('span');
      actionCountEl.className = 'goby-skill-action-count';
      actionCountEl.textContent = (skill.actions ? skill.actions.length : 0) + ' ' + (t('modal.skills_actions') || '个操作');

      var sourceEl = document.createElement('span');
      sourceEl.className = 'goby-skill-source ' + (skill.source === 'builtin' ? 'builtin' : 'imported');
      sourceEl.textContent = skill.source === 'builtin' ? (t('modal.skills_builtin') || '内置') : (t('modal.skills_imported') || '导入');

      meta.appendChild(domainEl);
      meta.appendChild(actionCountEl);
      meta.appendChild(sourceEl);

      info.appendChild(nameEl);
      info.appendChild(meta);

      // 启用/禁用 toggle
      var toggleRow = document.createElement('div');
      toggleRow.className = 'goby-skill-toggle-row';

      var toggleLabel = document.createElement('span');
      toggleLabel.style.cssText = 'font-size:11px;color:#6b7280;white-space:nowrap;';
      toggleLabel.textContent = (skill.enabled !== false) ? (t('modal.skills_enabled') || '启用') : (t('modal.skills_disabled') || '禁用');

      var toggleSwitch = document.createElement('label');
      toggleSwitch.className = 'toggle-switch';
      toggleSwitch.style.cssText = 'width:36px;height:20px;';

      var toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.checked = skill.enabled !== false;

      var toggleSlider = document.createElement('span');
      toggleSlider.className = 'toggle-slider';
      toggleSlider.style.cssText = 'border-radius:10px;';
      toggleSlider.style.cssText += 'width:36px;height:20px;';

      toggleSwitch.appendChild(toggleInput);
      toggleSwitch.appendChild(toggleSlider);

      toggleRow.appendChild(toggleLabel);
      toggleRow.appendChild(toggleSwitch);

      // 删除按钮
      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'goby-skill-delete-btn';
      deleteBtn.textContent = '✕'; // ✕
      deleteBtn.title = t('modal.skills_delete') || '删除技能';

      item.appendChild(info);
      item.appendChild(toggleRow);
      item.appendChild(deleteBtn);

      // Toggle 事件
      toggleInput.addEventListener('change', function () {
        var newEnabled = this.checked;
        GobyStorage.toggleSkill(domain, newEnabled).then(function () {
          toggleLabel.textContent = newEnabled ? (t('modal.skills_enabled') || '启用') : (t('modal.skills_disabled') || '禁用');
          if (newEnabled) {
            item.classList.remove('disabled');
          } else {
            item.classList.add('disabled');
          }
          // 刷新当前页面的技能工具注册
          var hostname = window.location.hostname;
          if (hostname === domain || hostname.indexOf('.' + domain) === hostname.length - domain.length - 1) {
            if (newEnabled) {
              window.GobyAgent.registerSkillTools(domain);
            } else {
              window.GobyAgent.unregisterSkillTools();
            }
          }
        }).catch(function () {
          // 恢复原状态
          toggleInput.checked = !newEnabled;
        });
      });

      // 删除事件
      deleteBtn.addEventListener('click', function () {
        var confirmMsg = t('modal.skills_delete_confirm') || '确定要删除技能';
        confirmMsg += ' "' + (skill.name || domain) + '"?';
        if (window.confirm(confirmMsg)) {
          window.GobyAgent.removeSkill(domain).then(function (removed) {
            if (removed) {
              // 如果当前页面匹配该 domain，注销技能工具
              var hostname = window.location.hostname;
              if (hostname === domain || hostname.indexOf('.' + domain) === hostname.length - domain.length - 1) {
                window.GobyAgent.unregisterSkillTools();
              }
              refreshSkillsList();
              refreshRecommendedList();
            }
          }).catch(function () {
            // 静默降级
          });
        }
      });

      container.appendChild(item);
    }

    /**
     * 渲染推荐技能（来自 browsing-skills 注册表）
     */
    var RECOMMENDED_SKILLS = [
      { name: 'LinkedIn', domain: 'linkedin.com', actions: 5, path: 'linkedin.com/SKILL.md' },
      { name: 'Airbnb', domain: 'airbnb.com', actions: 4, path: 'airbnb.com/SKILL.md' },
      { name: 'Glassdoor', domain: 'glassdoor.com', actions: 2, path: 'glassdoor.com/SKILL.md' },
      { name: 'Booking.com', domain: 'booking.com', actions: 4, path: 'booking.com/SKILL.md' },
      { name: 'Zillow', domain: 'zillow.com', actions: 2, path: 'zillow.com/SKILL.md' }
    ];

    function refreshRecommendedList() {
      var recList = document.getElementById('goby-recommended-list');
      if (!recList) return;

      window.GobyAgent.listSkills().then(function (installedSkills) {
        recList.innerHTML = '';
        for (var i = 0; i < RECOMMENDED_SKILLS.length; i++) {
          var rec = RECOMMENDED_SKILLS[i];
          var isInstalled = !!installedSkills[rec.domain];

          var recItem = document.createElement('div');
          recItem.className = 'goby-recommended-item';

          var recInfo = document.createElement('div');
          recInfo.className = 'goby-recommended-info';

          var recNameEl = document.createElement('span');
          recNameEl.className = 'goby-recommended-name';
          recNameEl.textContent = rec.name;

          var badge = document.createElement('span');
          badge.className = 'goby-recommended-badge';
          badge.textContent = (t('modal.skills_from_registry') || '来自 browsing-skills') + ' · ' + rec.actions + ' ' + (t('modal.skills_actions') || '个操作');

          recInfo.appendChild(recNameEl);
          recInfo.appendChild(badge);

          var installBtn = document.createElement('button');
          installBtn.className = 'goby-recommended-install-btn';
          if (isInstalled) {
            installBtn.classList.add('installed');
            installBtn.textContent = t('modal.skills_installed') || '已安装';
            installBtn.disabled = true;
          } else {
            installBtn.textContent = t('modal.skills_install') || '安装';
          }

          recItem.appendChild(recInfo);
          recItem.appendChild(installBtn);
          recList.appendChild(recItem);

          // 安装事件（闭包捕获 rec）
          if (!isInstalled) {
            (function (recommendation) {
              installBtn.addEventListener('click', function () {
                installBtn.disabled = true;
                installBtn.textContent = t('modal.skills_installing') || '安装中...';

                var rawUrl = 'https://raw.githubusercontent.com/browsing-skills/browsing-skills/main/skills/' + recommendation.path;
                window.GobyAgent.importSkill(rawUrl).then(function (result) {
                  if (result && result.ok) {
                    installBtn.classList.add('installed');
                    installBtn.textContent = t('modal.skills_installed') || '已安装';
                    showSkillFeedback(
                      (t('modal.skills_install_success') || '已安装技能：') + (recommendation.name),
                      'success'
                    );
                    refreshSkillsList();
                    refreshRecommendedList();
                  } else {
                    installBtn.disabled = false;
                    installBtn.textContent = t('modal.skills_install') || '安装';
                    var errMsg = result && result.error ? result.error : (t('modal.skills_install_failed') || '安装失败');
                    showSkillFeedback(errMsg, 'error');
                  }
                }).catch(function (e) {
                  installBtn.disabled = false;
                  installBtn.textContent = t('modal.skills_install') || '安装';
                  showSkillFeedback((t('modal.skills_install_failed') || '安装失败') + ': ' + (e.message || String(e)), 'error');
                });
              });
            })(rec);
          }
        }
      }).catch(function (err) {
        console.error('[skills] refreshRecommendedList 失败:', err);
        // 静默降级 — 至少显示灰掉的推荐项
        recList.innerHTML = '';
        for (var fi = 0; fi < RECOMMENDED_SKILLS.length; fi++) {
          var r = RECOMMENDED_SKILLS[fi];
          var ri = document.createElement('div');
          ri.className = 'goby-recommended-item';
          var s = document.createElement('span');
          s.textContent = r.name + ' · ' + r.actions + ' 个操作';
          s.style.opacity = '0.5';
          ri.appendChild(s);
          recList.appendChild(ri);
        }
      });
    }

    // Save button
    var saveBtn = document.createElement('button');
    saveBtn.className = 'goby-modal-save-btn';
    saveBtn.id = 'modal-save-btn';
    saveBtn.textContent = t('modal.save_btn');
    body.appendChild(saveBtn);

    // Save status
    var saveStatus = document.createElement('div');
    saveStatus.className = 'goby-modal-save-status';
    saveStatus.id = 'modal-save-status';
    body.appendChild(saveStatus);

    modal.appendChild(body);
    backdrop.appendChild(modal);
    document.documentElement.appendChild(backdrop);

    // Phase 9: 技能列表刷新必须在 modal 挂到 documentElement 之后
    // （getElementById 只能找到已挂载 DOM 中的元素）
    console.log('[skills] 加载技能列表');
    refreshSkillsList();
    refreshRecommendedList();

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

    // Edit current profile (载入表单 + 聚焦，对标 popup.js btnEditProfile)
    editBtn.addEventListener('click', editModalProfile);

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

  // ================================================================
  //  GobyAgent — Agent 消息模块 (Plan 03-01 + 03-02)
  //  LLM 流式/非流式调用、安全渲染管道、Agent 循环、工具执行、限制保护
  //  依赖: GobyStorage, GobyPanel, DOMPurify, marked
  // ================================================================

  // ---- 内部状态 ----
  var _agentState = {
    messages: [],
    isProcessing: false,
    connectionStatus: 'gray',
    activeOrigin: '',
    sessionId: '',           // 当前会话 ID (Plan 03-03)
    toolCallCounter: 0,     // 会话工具调用计数（AGENT-05 限制保护）
    roundCount: 0,          // 会话累计对话轮数（Phase 03 UAT 测试 4：跨消息累计，不在 processAgentMessage 末尾重置）
    stopRequested: false,   // 用户点击停止按钮 → agent loop 检查后退出
    _autoSkillCounter: 0    // 自动技能生成计数器（每 8 次工具调用触发检查）
  };

  // ---- Agent 循环内部状态 ----
  var _streamResolve = null;       // callLLMStream Promise resolve
  var _streamReject = null;        // callLLMStream Promise reject
  var _toolCallFailCounts = {};    // 工具失败计数（同会话内持久）

  // ---- 动态技能工具 (Plan 09-02) ----
  var _activeSkillTools = [];

  // ---- 常量定义（AGENT-05 限制参数） ----
  var MAX_LOOPS = 50;
  var MAX_TOOL_CALLS = 50;
  var MAX_MESSAGES = 20;           // 不含 system prompt
  var TOKEN_LIMIT = 180000;
  // Phase 8: MAX_LOOPS 提高到 50（chat Tab + worker Tab 统一）
  //   原 15 轮对 chat Tab 复杂任务（跨域导航后的多步搜索提取）和 worker Tab
  //   （SERP 提取、多步表单）都太紧。MAX_TOOL_CALLS=50 仍是硬兜底。
  var TOOL_TIMEOUT = 15000;

  // ---- SYSTEM_PROMPT (AGENT-04, D-07) ----
  // 静态前缀部分；工具列表在 nativeTools 声明后动态拼接（避免与 nativeTools 漂移）
  var SYSTEM_PROMPT = '你叫 Goby，是一个 AI 浏览器自动化助手。你可以使用工具来操作当前页面，用中文回答用户。\n' +
    '工具使用原则：\n' +
    '1. 先查后做 — 不确定页面结构时，先用 page_list_elements 或 page_query\n' +
    '2. 顺序执行 — 工具依次调用，每次一个，基于前一个结果决定下一步\n' +
    '3. 工具失败 — 尝试替代方案（不同选择器、不同方法），连续3次失败则跳过\n' +
    '4. 及时停止 — 获取足够信息回答用户后，立即停止调用工具，直接给出答案\n' +
    '5. 言出必行 — 提到要执行的动作时必须立即发出对应工具调用。禁止声称要做却不调用工具（例如：不要说"让我截个图看看"却不发 page_screenshot；不要说"我去打开 b.com"却不发 page_open_tab；不要说"我点一下搜索按钮"却不发 page_click）。要么直接调用工具，要么不提。调 page_open_tab 时必须填 task 参数（一句话写清新 Tab 要做什么，例如「搜索 web agent 并总结最重要的页面」），否则新 Tab 的 AI 不知道任务。如果你是 worker Tab（看到「[Workflow wf_xxx] 你是 worker Tab」的 user message），你的普通文本回复不会显示给用户——page_finish_workflow(summary) 是你唯一与用户通信的渠道，summary 写你想告诉用户的完整结果——不调会导致 chat Tab 永久卡死。\n' +
    '调用工具前可以用一句话简要说明意图（如"我需要先查看页面结构"），但这句话必须紧跟工具调用，不能只有话没有工具。任务完成后用一两句总结你做了什么。如果无法完成，说清楚原因和建议。\n\n';

  /**
   * getAttributes — 将元素的 NamedNodeMap 转换为纯对象
   * @param {Element} el
   * @returns {Object}
   */
  function getAttributes(el) {
    var attrs = {};
    for (var a = 0; a < el.attributes.length; a++) {
      attrs[el.attributes[a].name] = el.attributes[a].value;
    }
    return attrs;
  }

  /**
   * setNativeValue — 通过原型链上的原生 value setter 给 input/textarea 赋值
   * 用于绕过 React/Vue/Svelte 等 SPA 框架的受控组件 value descriptor 拦截。
   * 框架通过 Object.defineProperty 重写 element.value，直接赋值 el.value = x
   * 会让数据层与视图层不同步。本函数从 HTMLInputElement.prototype / HTMLTextAreaElement.prototype
   * 取出原生 setter，以 .call() 方式直接作用于内部 slot，框架无法感知。
   *
   * 仅负责赋值，不派发任何事件（事件由调用方按需 dispatch input/change）。
   * 对 select / 其他元素直接赋 el.value；contenteditable 元素应在外面单独处理。
   *
   * @param {Element} el
   * @param {string} value
   */
  function setNativeValue(el, value) {
    if (el instanceof HTMLInputElement) {
      var inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      inputSetter.call(el, value);
    } else if (el instanceof HTMLTextAreaElement) {
      var taSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      taSetter.call(el, value);
    } else if (el instanceof HTMLSelectElement) {
      el.value = value;
    } else {
      // 兜底：直接赋值。contenteditable 调用方应在外面用 textContent。
      el.value = value;
    }
  }

  // SW message helper with retry for Extension context invalidation
  function sendToSW(action, payload) {
    return new Promise(function (resolve) {
      function attempt(retries) {
        try {
          chrome.runtime.sendMessage(payload).then(resolve).catch(function (err) {
            var msg = String(err.message || err);
            if (retries > 0 && msg.indexOf('Extension context invalidated') !== -1) {
              setTimeout(function () { attempt(retries - 1); }, 300);
            } else {
              resolve('Error: ' + (msg || 'sendMessage failed'));
            }
          });
        } catch (e) {
          resolve('Error: sendMessage threw - ' + String(e.message || e));
        }
      }
      attempt(2);
    });
  }

  // ---- 15 个工具定义 (GOBY_DESIGN.md §四) ----
  var nativeTools = [
    // 页面查询工具
    {
      type: 'function',
      function: {
        name: 'page_query',
        description: '使用 CSS 选择器查询页面元素的内容（text/value/html/attributes/all）',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS 选择器' },
            property: { type: 'string', description: '要提取的属性: text/value/html/attributes/all', default: 'text' },
            index: { type: 'number', description: '匹配元素的索引', default: 0 }
          },
          required: ['selector']
        }
      },
      timeout: 15000,
      execute: function (args) {
        try {
          var selector = args.selector;
          var property = args.property || 'text';
          var index = args.index !== undefined ? args.index : 0;
          var elements = document.querySelectorAll(selector);

          if (elements.length === 0) {
            return 'No elements found matching: ' + selector;
          }

          if (index === -1) {
            var results = [];
            for (var i = 0; i < elements.length; i++) {
              var el = elements[i];
              var entry = {
                index: i,
                tag: el.tagName,
                id: el.id,
                className: el.className
              };
              var elText = (el.innerText || el.textContent || '').trim();
              if (property === 'text') entry.text = elText;
              else if (property === 'value') entry.value = el.value !== undefined ? el.value : '';
              else if (property === 'html') entry.html = el.innerHTML;
              else if (property === 'attributes') entry.attributes = getAttributes(el);
              else if (property === 'all') {
                entry.text = elText;
                entry.value = el.value !== undefined ? el.value : '';
                entry.html = el.innerHTML;
                entry.attributes = getAttributes(el);
              }
              results.push(entry);
            }
            return JSON.stringify(results, null, 2);
          }

          if (index >= elements.length) {
            return 'Index ' + index + ' out of range. Found ' + elements.length + ' elements.';
          }

          var el = elements[index];
          var result = {
            tag: el.tagName,
            id: el.id,
            className: el.className,
            selector: selector
          };

          var elText = (el.innerText || el.textContent || '').trim();
          if (property === 'text') result.text = elText;
          else if (property === 'value') result.value = el.value !== undefined ? el.value : '';
          else if (property === 'html') result.html = el.innerHTML;
          else if (property === 'attributes') result.attributes = getAttributes(el);
          else if (property === 'all') {
            result.text = elText;
            result.value = el.value !== undefined ? el.value : '';
            result.html = el.innerHTML;
            result.attributes = getAttributes(el);
          }

          return JSON.stringify(result, null, 2);
        } catch (e) {
          return 'Query failed: ' + e.message;
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_list_elements',
        description: '列出页面上所有交互元素（inputs/buttons/links/selects/checkboxes/radios）',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: '元素类型: all/inputs/buttons/links/selects/checkboxes/radios', default: 'all' }
          }
        }
      },
      timeout: 15000,
      execute: function (args) {
        try {
          var type = args.type || 'all';

          var selectors = [];
          if (type === 'all' || type === 'inputs') {
            selectors.push('input', 'textarea', 'select');
          }
          if (type === 'all' || type === 'buttons') {
            selectors.push('button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]');
          }
          if (type === 'all' || type === 'links') selectors.push('a[href]');
          if (type === 'all' || type === 'selects') selectors.push('select');
          if (type === 'all' || type === 'checkboxes') selectors.push('input[type="checkbox"]');
          if (type === 'all' || type === 'radios') selectors.push('input[type="radio"]');

          var elementSet = [];
          for (var s = 0; s < selectors.length; s++) {
            var nodes = document.querySelectorAll(selectors[s]);
            for (var n = 0; n < nodes.length; n++) {
              if (elementSet.indexOf(nodes[n]) === -1) {
                elementSet.push(nodes[n]);
              }
            }
          }

          if (elementSet.length === 0) {
            return 'No interactive elements found of type: ' + type;
          }

          var results = [];
          for (var i = 0; i < elementSet.length; i++) {
            var el = elementSet[i];
            var info = {
              index: i,
              tag: el.tagName.toLowerCase(),
              id: el.id || '',
              className: el.className || ''
            };

            // All fields that are available
            if (el.type) info.type = el.type;
            if (el.name) info.name = el.name;
            if (el.placeholder !== undefined && el.placeholder) info.placeholder = el.placeholder;
            if (el.href) info.href = el.href;
            if (el.options !== undefined) info.option_count = el.options.length;
            if (el.checked !== undefined) info.checked = el.checked;

            // Text for buttons and links
            var text = (el.tagName === 'BUTTON' || el.tagName === 'A') ? (el.innerText || el.textContent || '').trim() : '';
            if (text) info.text = text;

            results.push(info);
          }

          return JSON.stringify(results, null, 2);
        } catch (e) {
          return 'Error: 列出元素失败 - ' + e.message;
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_wait',
        description: '等待元素出现或等待指定时间',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS 选择器（可选，如果提供则等待元素出现）' },
            timeout: { type: 'number', description: '最长等待毫秒数', default: 5000 },
            time: { type: 'number', description: '直接等待的秒数（不提供 selector 时）' }
          }
        }
      },
      timeout: 30000,
      execute: function (args) {
        var selector = args.selector;
        var timeout = args.timeout || 10000;
        var time = args.time;

        if (selector) {
          // Selector mode: check if already exists, else use MutationObserver
          if (document.querySelector(selector)) {
            return 'Element already exists: ' + selector;
          }

          return new Promise(function (resolve) {
            var startTime = Date.now();
            var observer = new MutationObserver(function () {
              try {
                if (document.querySelector(selector)) {
                  observer.disconnect();
                  resolve('Element found: ' + selector + ' after ' + (Date.now() - startTime) + 'ms');
                }
              } catch (e) {
                // 忽略环境错误（如 JSDOM 上下文不一致）
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(function () {
              try {
                observer.disconnect();
              } catch (e) { /* ignore */ }
              resolve("Timeout: element '" + selector + "' not found after " + timeout + 'ms');
            }, timeout);
          });
        }

        if (time !== undefined) {
          // Time mode: wait specified ms
          return new Promise(function (resolve) {
            setTimeout(function () {
              resolve('Waited ' + time + 'ms');
            }, time);
          });
        }

        return 'Error: wait failed - selector or time is required';
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_evaluate',
        description: '在页面主世界中执行 JavaScript 表达式',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: '要执行的 JavaScript 代码' }
          },
          required: ['expression']
        }
      },
      timeout: 15000,
      execute: function (args) {
        if (!args.expression || typeof args.expression !== 'string') {
          return 'Error: expression is required';
        }

        // D-26 / T-04-01: expression 通过 args 序列化传递，不拼接 eval
        // 通过 Service Worker 在 MAIN world 执行
        return new Promise(function (resolve) {
          chrome.runtime.sendMessage(
            { action: 'page-evaluate', expression: args.expression },
            function (response) {
              if (chrome.runtime.lastError) {
                resolve('Error: page_evaluate failed - ' + chrome.runtime.lastError.message);
              } else {
                resolve(String(response));
              }
            }
          );
        });
      }
    },
    // 页面操作工具
    {
      type: 'function',
      function: {
        name: 'page_fill',
        description: '填写表单输入框的值',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS 选择器' },
            value: { type: 'string', description: '要填写的值' },
            index: { type: 'number', description: '匹配元素的索引', default: 0 }
          },
          required: ['selector', 'value']
        }
      },
      timeout: 15000,
      execute: function (args) {
        try {
          var selector = args.selector;
          var value = args.value;
          var index = args.index !== undefined ? args.index : 0;
          var elements = document.querySelectorAll(selector);

          if (elements.length === 0) {
            return 'No elements found matching: ' + selector;
          }

          if (index === -1) {
            for (var fi = 0; fi < elements.length; fi++) {
              var fel = elements[fi];
              if (fel.isContentEditable || fel.getAttribute('contenteditable') === 'true') {
                fel.textContent = value;
              } else {
                setNativeValue(fel, value);
              }
              fel.dispatchEvent(new Event('input', { bubbles: true }));
              fel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return 'Filled all ' + elements.length + ' elements with: ' + value;
          }

          if (index >= elements.length) {
            return 'Index ' + index + ' out of range. Found ' + elements.length + ' elements.';
          }

          var el = elements[index];
          if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
            el.textContent = value;
          } else {
            setNativeValue(el, value);
          }

          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));

          return "Filled '" + selector + "' with: " + value;
        } catch (e) {
          return 'Fill failed: ' + e.message;
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_click',
        description: '点击页面元素',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS 选择器' },
            index: { type: 'number', description: '匹配元素的索引', default: 0 }
          },
          required: ['selector']
        }
      },
      timeout: 15000,
      execute: async function (args) {
        try {
          var selector = args.selector;
          var index = args.index !== undefined ? args.index : 0;
          var elements = document.querySelectorAll(selector);

          if (elements.length === 0) {
            return 'No elements found matching: ' + selector;
          }

          if (index === -1) {
            for (var ci = 0; ci < elements.length; ci++) {
              var cel = elements[ci];
              cel.click();
              cel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              cel.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            }
            return 'Clicked all ' + elements.length + ' elements';
          }

          if (index >= elements.length) {
            return 'Index ' + index + ' out of range. Found ' + elements.length + ' elements.';
          }

          var el = elements[index];

          // Fix PCN: 监听整页 navigation（click 后浏览器异步启动，需等 200ms 检测）
          // 整页跳转时 LLM 看到 navigation 提示后不会立刻 analyze，避免拿到旧页面内容
          var navigated = false;
          var onNav = function () { navigated = true; };
          window.addEventListener('beforeunload', onNav);
          window.addEventListener('pagehide', onNav);

          el.click();
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

          // 给浏览器时间启动 navigation（200ms 经验值）
          await new Promise(function (resolve) { setTimeout(resolve, 200); });

          window.removeEventListener('beforeunload', onNav);
          window.removeEventListener('pagehide', onNav);

          if (navigated || document.readyState === 'loading') {
            return 'Clicked: ' + selector + ' (navigation started, agent loop will pause until new page loads)';
          }
          return 'Clicked: ' + selector;
        } catch (e) {
          return 'Click failed: ' + e.message;
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_check',
        description: '勾选或取消复选框',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS 选择器' },
            checked: { type: 'boolean', description: 'true=勾选, false=取消', default: true },
            index: { type: 'number', description: '匹配元素的索引', default: 0 }
          },
          required: ['selector', 'checked']
        }
      },
      timeout: 15000,
      execute: function (args) {
        try {
          var selector = args.selector;
          var checked = args.checked === true;
          var index = args.index !== undefined ? args.index : 0;
          var elements = document.querySelectorAll(selector);

          if (elements.length === 0) {
            return 'No elements found matching: ' + selector;
          }

          if (index === -1) {
            for (var ci = 0; ci < elements.length; ci++) {
              var cel = elements[ci];
              if (cel.tagName !== 'INPUT' || cel.type !== 'checkbox') {
                return 'Element is not a checkbox: ' + selector;
              }
              cel.checked = checked;
              cel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return (checked ? 'Checked' : 'Unchecked') + ' all ' + elements.length + ' elements';
          }

          if (index >= elements.length) {
            return 'Index ' + index + ' out of range. Found ' + elements.length + ' elements.';
          }

          var el = elements[index];
          if (el.tagName !== 'INPUT' || el.type !== 'checkbox') {
            return 'Element is not a checkbox: ' + selector;
          }

          el.checked = checked;
          el.dispatchEvent(new Event('change', { bubbles: true }));

          return (checked ? 'Checked' : 'Unchecked') + ': ' + selector;
        } catch (e) {
          return 'Check failed: ' + e.message;
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_select',
        description: '选择下拉选项',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS 选择器' },
            value: { type: 'string', description: '选择的值' },
            text: { type: 'string', description: '选项显示的文本' }
          },
          required: ['selector']
        }
      },
      timeout: 15000,
      execute: function (args) {
        try {
          var selector = args.selector;
          var value = args.value;
          var text = args.text;
          var index = args.index !== undefined ? args.index : 0;
          var elements = document.querySelectorAll(selector);

          if (elements.length === 0) {
            return 'No elements found matching: ' + selector;
          }

          if (index >= elements.length) {
            return 'Index ' + index + ' out of range. Found ' + elements.length + ' elements.';
          }

          var el = elements[index];
          if (el.tagName !== 'SELECT') {
            return 'Element is not a select: ' + selector;
          }

          if (value !== undefined) {
            // 按 value 匹配
            el.value = value;
            if (el.value === value) {
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return "Selected value='" + value + "' on: " + selector;
            }
            return "Option with value '" + value + "' not found";
          }

          if (text !== undefined) {
            // 按 text 匹配
            for (var oi = 0; oi < el.options.length; oi++) {
              if (el.options[oi].text === text) {
                el.options[oi].selected = true;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return "Selected text='" + text + "' on: " + selector;
              }
            }
            return "Option with text '" + text + "' not found";
          }

          return 'Error: value or text is required';
        } catch (e) {
          return 'Select failed: ' + e.message;
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_submit',
        description: '提交表单',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: '表单的 CSS 选择器' }
          },
          required: ['selector']
        }
      },
      timeout: 15000,
      execute: function (args) {
        try {
          var selector = args.selector;
          var elements = document.querySelectorAll(selector);

          if (elements.length === 0) {
            return 'No elements found matching: ' + selector;
          }

          var el = elements[0];
          if (el.tagName !== 'FORM') {
            return 'Element is not a form: ' + selector;
          }

          // 内联辅助：模拟完整点击事件链（mousedown → mouseup → click）
          function simulateClick(target) {
            ['mousedown', 'mouseup', 'click'].forEach(function (type) {
              target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            });
          }

          // 三级回退策略，让 onsubmit handler / SPA 客户端路由优先接管
          // 方案 A：找 form 内 submit 按钮，模拟点击（最贴近真实用户行为）
          var submitBtn = el.querySelector('input[type=submit], button[type=submit]');
          if (submitBtn) {
            simulateClick(submitBtn);
            return 'Submitted form via submit button click: ' + selector;
          }

          // 方案 B：派发 submit 事件，给 onsubmit handler 一次拦截机会
          var submitEvent = new SubmitEvent('submit', { bubbles: true, cancelable: true });
          el.dispatchEvent(submitEvent);

          // 若 onsubmit 没 preventDefault，回退到原生 submit()
          if (!submitEvent.defaultPrevented) {
            try {
              el.submit();
              return 'Submitted form via native submit() (no onsubmit handler): ' + selector;
            } catch (nativeErr) {
              return 'Submit failed during native fallback: ' + nativeErr.message;
            }
          }

          // onsubmit 已 preventDefault，认为 SPA handler 已接管提交
          return 'Submitted form via submit event dispatch: ' + selector;
        } catch (e) {
          return 'Submit failed: ' + e.message;
        }
      }
    },
    // 分析工具
    {
      type: 'function',
      function: {
        name: 'page_analyze',
        description: '分析当前页面的内容和主题（提取页面内容 + LLM 分析）',
        parameters: { type: 'object', properties: {} }
      },
      timeout: 30000,
      execute: function () {
        // D-01: 提取页面 body 的文本内容，限制最长 50000 字符
        // JSDOM 兼容: innerText || textContent 双模式
        var pageContent = (document.body.innerText || document.body.textContent || '').substring(0, 50000);

        // 空页面检查
        if (!pageContent.trim()) {
          return '页面内容为空，无法分析';
        }

        // D-03: 构建 messages
        var messages = [
          { role: 'system', content: '分析以下页面内容，总结页面的主题、主要内容和结构' },
          { role: 'user', content: pageContent }
        ];

        // D-02: 调用非流式 callLLM（同 IIFE 闭包局部函数）
        // D-04: 提取分析结果字符串
        return callLLM(messages).then(function (response) {
          if (response && response.choices && response.choices[0] && response.choices[0].message) {
            return response.choices[0].message.content || '';
          }
          return 'Error: page_analyze 分析失败 - LLM 响应格式异常';
        }).catch(function (err) {
          return 'Error: page_analyze 分析失败 - ' + (err.message || '未知错误');
        });
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_screenshot',
        description: '截取当前页面的截图',
        parameters: {
          type: 'object',
          properties: {
            includePanel: { type: 'boolean', description: '是否包含 Goby 面板', default: false }
          }
        }
      },
      timeout: 15000,
      execute: function () {
        // D-06/D-07: 截图前临时隐藏面板（仅 CSS class 切换，不持久化）
        var host = document.getElementById('goby-panel-host');
        var panel = null;
        if (host && host.shadowRoot) {
          panel = host.shadowRoot.querySelector('.goby-panel');
          if (panel) {
            panel.classList.add('goby-panel-hidden');
            panel.classList.remove('goby-panel-visible');
          }
        }

        // D-05: 通过 Service Worker 截图
        return new Promise(function (resolve) {
          setTimeout(function () {
            chrome.runtime.sendMessage({action: 'page-screenshot'}).then(function (dataUrl) {
              // 截图完成后恢复面板可见性
              if (panel) {
                panel.classList.remove('goby-panel-hidden');
                panel.classList.add('goby-panel-visible');
              }
              resolve(dataUrl);
            }).catch(function (err) {
              if (panel) {
                panel.classList.remove('goby-panel-hidden');
                panel.classList.add('goby-panel-visible');
              }
              resolve('Error: 截图失败 - ' + (err.message || '未知错误'));
            });
          }, 300); // 等待 200ms 隐藏动画完成 + 余量
        });
      }
    },
    // Phase 3 实现的辅助工具
    {
      type: 'function',
      function: {
        name: 'calculator',
        description: '执行数学计算（支持 + - * / % ( ) 和 Math 函数）',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: '数学表达式，如 "2+2" 或 "Math.sqrt(16)"' }
          },
          required: ['expression']
        }
      },
      timeout: 15000,
      execute: function (args) {
        // T-03-08: 安全验证后 eval — 仅允许数学表达式
        var expr = (args && args.expression) || '';
        expr = expr.trim();
        if (!expr) return 'Error: 表达式为空';

        // Phase 03 UAT 测试 3 修复：规范化中文/全角运算符为 ASCII
        // LLM 经常原样保留用户输入的 "23 × 17" 中文字符（× U+00D7），导致正则校验失败
        expr = expr
          .replace(/×/g, '*')        // U+00D7 multiplication sign
          .replace(/÷/g, '/')        // U+00F7 division sign
          .replace(/−/g, '-')        // U+2212 minus sign
          .replace(/–/g, '-')        // U+2013 en dash
          .replace(/—/g, '-')        // U+2014 em dash
          .replace(/，/g, ',')       // 全角逗号
          .replace(/（/g, '(')       // 全角左括号
          .replace(/）/g, ')')       // 全角右括号
          .replace(/．/g, '.');      // 全角句点

        // 正则验证：只允许数字、运算符、括号、小数点、空白、Math 函数
        // 拒绝任何字母（除 Math.xxx 函数调用）
        var sanitized = expr.replace(/\s/g, '');
        // 允许: 数字, +, -, *, /, %, (, ), ., `,`, Math.xxx (字母)
        // 检查是否有非法字符（除了数字、运算符、括号、小数点、逗号、Math 调用）
        if (!/^[\d+\-*/().,%]+$/.test(sanitized)) {
          // 检查是否是 Math.xxx 调用格式
          var mathPattern = /^(Math\.\w+\([\d+\-*/().,%]+\)[\d+\-*/().,%]*)+$/;
          if (!mathPattern.test(sanitized)) {
            return 'Error: 不支持的表达式格式';
          }
        }
        try {
          // eslint-disable-next-line no-eval
          var result = eval(expr);
          if (typeof result !== 'number' || !isFinite(result)) {
            return 'Error: 计算结果无效';
          }
          return '计算结果: ' + result;
        } catch (e) {
          return 'Error: 计算失败 - ' + e.message;
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'clipboard_read',
        description: '读取剪贴板内容',
        parameters: { type: 'object', properties: {} }
      },
      timeout: 5000,
      execute: function () {
        try {
          var textarea = document.createElement('textarea');
          document.body.appendChild(textarea);
          textarea.focus();
          document.execCommand('paste');
          var content = textarea.value;
          document.body.removeChild(textarea);
          return content || '（剪贴板为空）';
        } catch (e) {
          return 'Error: 读取剪贴板失败 - ' + e.message;
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'clipboard_write',
        description: '写入文本到剪贴板',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要写入的文本' }
          },
          required: ['text']
        }
      },
      timeout: 5000,
      execute: function (args) {
        // T-03-09: 仅写入 text/plain
        try {
          var textarea = document.createElement('textarea');
          textarea.value = (args && args.text) || '';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          return '已写入剪贴板（' + (args && args.text ? args.text.length : 0) + ' 字符）';
        } catch (e) {
          return 'Error: 写入剪贴板失败 - ' + e.message;
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_current_time',
        description: '获取当前日期和时间（北京时间）',
        parameters: { type: 'object', properties: {} }
      },
      timeout: 5000,
      execute: function () {
        var now = new Date();
        return '当前时间: ' + now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      }
    },

    // === Phase 7: Tab Navigation Tools ===
    {
      type: 'function',
      function: {
        name: 'page_navigate',
        description: 'Navigate the current tab to the specified URL (supports http/https only. Do NOT navigate to data: URLs — they cannot load Goby and the agent will stop permanently)',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '目标 URL，如 https://example.com' }
          },
          required: ['url']
        }
      },
      timeout: 15000,
      execute: function (args) {
        // data: URL 不支持 content script 注入 → 导航后 Goby 不存在 → 永远不 resume
        if (typeof args.url === 'string' && args.url.indexOf('data:') === 0) {
          return 'Error: 不能导航到 data: URL（data: 协议不支持 Goby 注入，导航后 agent 会丢失）。请用其他方式展示内容（如在当前页直接用 page_evaluate 创建展示区域、或打开新 https 页面）。';
        }
        // D-14: 复用 BR/PCN navigation 检测模式
        return new Promise(function (resolve) {
          var navigated = false;
          var onNav = function () { navigated = true; };
          window.addEventListener('beforeunload', onNav);
          window.addEventListener('pagehide', onNav);

          sendToSW('tab-navigate', {action: 'tab-navigate', url: args.url}).then(function (response) {
            window.removeEventListener('beforeunload', onNav);
            window.removeEventListener('pagehide', onNav);
            var result = String(response);
            if (navigated && result.indexOf('Error:') !== 0) {
              result += ' (navigation started, agent loop will pause until new page loads)';
            }
            resolve(result);
          });
        });
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_open_tab',
        description: 'Open a new tab and start a workflow to perform a task. The new tab gets focus and its AI will autonomously execute the task. MUST provide a clear task description.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '要打开的 URL' },
            task: { type: 'string', description: '在新 Tab 里要完成的具体任务（必填，用一句话描述，例如「搜索 web agent 并总结最重要的页面」）。新 Tab 的 AI 会以这条指令为目标自主工作，完成后将结果回传给当前 Tab。' }
          },
          required: ['url', 'task']
        }
      },
      timeout: 15000,
      execute: function (args) {
        return new Promise(function (resolve) {
          sendToSW('tab-open', {action: 'tab-open', url: args.url, task: args.task}).then(function (response) {
            var result = String(response);
            // Phase 8 / D-12 / BR-2 扩展：tab 打开成功（response 含 '(workflow:'）时
            // 追加 '(workflow_started' 字符串让 processAgentMessage 的 BR-2 break detection
            // 触发循环暂停 — 等 SW 转发的 workflow_complete/error 消息驱动新一次 processAgentMessage
            if (result.indexOf('Error:') !== 0 && result.indexOf('(workflow:') !== -1) {
              result += ' (workflow_started, agent loop will pause until workflow_complete)';
            }
            resolve(result);
          });
        });
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_close_tab',
        description: 'Close the tab with the specified tabId.',
        parameters: {
          type: 'object',
          properties: {
            tabId: { type: 'number', description: '要关闭的标签页 ID' }
          },
          required: ['tabId']
        }
      },
      timeout: 15000,
      execute: function (args) {
        return new Promise(function (resolve) {
          sendToSW('tab-close', {action: 'tab-close', tabId: args.tabId}).then(function (response) {
            resolve(String(response));
          });
        });
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_switch_tab',
        description: 'Switch to the tab with the specified tabId.',
        parameters: {
          type: 'object',
          properties: {
            tabId: { type: 'number', description: '要切换到的标签页 ID' }
          },
          required: ['tabId']
        }
      },
      timeout: 15000,
      execute: function (args) {
        return new Promise(function (resolve) {
          sendToSW('tab-switch', {action: 'tab-switch', tabId: args.tabId}).then(function (response) {
            resolve(String(response));
          });
        });
      }
    },
    {
      type: 'function',
      function: {
        name: 'page_list_tabs',
        description: 'List all tabs with their tabId, title, URL, and whether they are active.',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      timeout: 15000,
      execute: function () {
        return new Promise(function (resolve) {
          sendToSW('tab-list', {action: 'tab-list'}).then(function (response) {
            resolve(String(response));
          });
        });
      }
    },
    // Phase 8 / NAV-08 / D-13: page_finish_workflow — 工作 Tab Agent 完成任务时调用
    // Pitfall 8 防御：description 明示只能在 worker tab 调用，避免 LLM 在 chat Tab 误调
    {
      type: 'function',
      function: {
        name: 'page_finish_workflow',
        description: 'Only call this when running as a worker tab in a workflow. Call this when the workflow task is complete to send a summary back to the chat tab and end the workflow. Do NOT call this in the chat tab.',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'A concise summary of what was accomplished in this workflow, to be displayed in the chat tab.' }
          },
          required: ['summary']
        }
      },
      timeout: 15000,
      execute: function (args) {
        // Pitfall 8 防御：window.__gobyWorkflowId 缺失（chat Tab 或非工作流上下文）→ 直接返回 Error
        // 不发送 SW 消息，避免 SW 收到无效 workflow_id 后误处理
        if (!window.__gobyWorkflowId) {
          return Promise.resolve('Error: page_finish_workflow 只能在工作 Tab 调用（未找到 workflow_id）');
        }
        var summary = (args && typeof args.summary === 'string') ? args.summary : '';
        return new Promise(function (resolve) {
          sendToSW('page-finish-workflow', {
            action: 'page-finish-workflow',
            workflow_id: window.__gobyWorkflowId,
            summary: summary
          }).then(function (response) {
            // Phase 8 fix (260621-kKk): 解析 SW 响应而非粗暴 String()
            //   SW handler 可能返回：
            //   - 字符串（如 '已结束 workflow xxx'）→ 直传
            //   - {ok:true} → 给成功消息
            //   - {ok:false, error:'...'} → 给 'Error: <error>' 字符串
            //     让 executeWithTimeout (line 2685) 识别并触发重试或上报
            //   之前 String({ok:false,...}) = "[object Object]" 不以 Error: 开头，
            //   被误判为成功，worker AI 看不懂反复调，3 次后 "已跳过" × 2，chat Tab 永久卡死
            if (typeof response === 'string') {
              resolve(response);
            } else if (response && typeof response === 'object') {
              if (response.ok) {
                resolve('Workflow ' + window.__gobyWorkflowId + ' 已结束，summary 已发送给 chat Tab');
              } else {
                resolve('Error: ' + (response.error || 'SW 拒绝 finish_workflow（未知原因）'));
              }
            } else {
              resolve('Error: SW 响应格式异常 — ' + String(response));
            }
          }).catch(function (err) {
            // .catch 兜底 — sendToSW 设计上永不 reject，但保险（防 unhandled rejection 卡住 Promise）
            resolve('Error: sendToSW 失败 - ' + (err && err.message || err));
          });
        });
      }
    }
  ];

  // 动态拼接 SYSTEM_PROMPT 的可用工具列表 — 与 nativeTools 数组完全同步，避免漂移
  // 工具列表行（由 getSystemPrompt 动态追加，不污染常量）

  /**
   * _buildToolListLines — 构建当前所有可用工具的列表行（含已注册技能工具）
   * @returns {string}
   */
  function _buildToolListLines() {
    var allTools = nativeTools.concat(_activeSkillTools);
    return allTools.map(function (t) {
      return '- ' + t.function.name + ': ' + t.function.description;
    }).join('\n');
  }

  // 静态后备（getSystemPrompt 会动态重建，此缓存供外部直接引用使用）
  var toolListLines = _buildToolListLines();

  /**
   * getSystemPrompt — 返回完整系统提示词（当前语言的 base + 工具列表）
   * @returns {string}
   */
  function getSystemPrompt() {
    var basePrompt = (window.GobyI18n && window.GobyI18n.getSystemPrompt)
      ? window.GobyI18n.getSystemPrompt()
      : '';
    return basePrompt + _buildToolListLines() + '\n';
  }

  /**
   * renderMarkdown — 安全渲染管道 (SEC-01, D-20/D-21/D-22)
   * @param {string} content - 原始 LLM 输出
   * @returns {string} 消毒后的安全 HTML
   */
  function renderMarkdown(content) {
    if (!content) return '';
    var html;
    try {
      html = window.marked.parse(content);
    } catch (e) {
      // marked 解析失败时回退到 textContent 已转义的 HTML
      var textNode = document.createTextNode(content);
      html = textNode.textContent;
    }
    // DOMPurify 白名单消毒 — ALLOWED_TAGS (D-22)
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
    // 没有 DOMPurify 时，回退到 textContent
    var fallbackNode = document.createTextNode(html);
    return fallbackNode.textContent;
  }

  /**
   * getFallbackContent — 推理字段回退机制 (AGENT-06, D-10)
   * Qwen: reasoning, DeepSeek: reasoning_content
   * @param {{content?: string, reasoning?: string, reasoning_content?: string}} delta
   * @returns {string}
   */
  function getFallbackContent(delta) {
    if (delta && delta.content) return delta.content;
    if (delta && delta.reasoning) return delta.reasoning;
    if (delta && delta.reasoning_content) return delta.reasoning_content;
    return '';
  }

  /**
   * sanitizeMessages — 净化消息格式确保 API 兼容
   * content 始终为字符串，tool_calls 始终为数组
   * @param {Array} messages
   * @returns {Array}
   */
  function sanitizeMessages(messages) {
    var clean = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var c = { role: m.role || 'user' };
      c.content = (typeof m.content === 'string') ? m.content : '';
      if (m.tool_calls) {
        var tcSource;
        if (Array.isArray(m.tool_calls)) {
          tcSource = m.tool_calls;
        } else {
          var tcArr = [];
          var keys = Object.keys(m.tool_calls);
          for (var k = 0; k < keys.length; k++) {
            tcArr.push(m.tool_calls[keys[k]]);
          }
          tcSource = tcArr;
        }
        // 深拷贝并确保 function.arguments 为 JSON 字符串（API 要求）
        c.tool_calls = [];
        for (var ti = 0; ti < tcSource.length; ti++) {
          var src = tcSource[ti];
          var tc = { id: src.id, type: src.type || 'function' };
          tc.function = { name: src.function.name };
          var args = src.function.arguments;
          if (typeof args === 'string') {
            tc.function.arguments = args;
          } else if (args && typeof args === 'object') {
            tc.function.arguments = JSON.stringify(args);
          } else {
            tc.function.arguments = '{}';
          }
          c.tool_calls.push(tc);
        }
      }
      if (m.tool_call_id) c.tool_call_id = m.tool_call_id;
      if (m.name) c.name = m.name;
      clean.push(c);
    }
    // 移除末尾悬空的 assistant tool_calls（无匹配 tool 结果）
    // 防止页面跳转或异常中断导致的不完整状态被发送到 API
    while (clean.length > 0) {
      var lastMsg = clean[clean.length - 1];
      if (lastMsg.role === 'assistant' && lastMsg.tool_calls) {
        clean.pop();
      } else {
        break;
      }
    }

    // 260620-i08 Fix B: 全数组扫描移除孤立 tool（双保险）
    // enforceMessageLimit 在边界情况下可能漏过孤立 tool（如 tool_call_id 缺失、
    // tool 配对的 assistant.tool_calls 在 enforceMessageLimit 之外的路径被丢弃）。
    // 在 callLLM/callLLMStream 入口处做最终一致性检查兜底。
    //
    // 关键约束：循环变量必须用 si/sm/sTi/sTcs（第一遍）和 di/dm（第二遍），
    // 不能复用外层 i/m/ti（外层第 1489/1490/1507 行已用），否则污染现有循环状态。
    //
    // Phase 8 fix (260621-gKz): 顺序敏感检查。OpenAI API 要求 tool message 必须出现在
    // 对应的 assistant.tool_calls **之后**，仅查 knownToolCallIds 字典不够（字典只验存在性
    // 不验顺序）。改为扫描时维护 "已见 tool_call_ids" 集合，tool message 出现时检查其
    // tool_call_id 是否已见过（即前面已有对应的 assistant.tool_calls），否则移除。
    var deduped = [];
    var seenToolCallIds = {};
    for (var di = 0; di < clean.length; di++) {
      var dm = clean[di];
      if (dm.role === 'assistant' && dm.tool_calls) {
        // 登记 tool_call_id 到已见集合
        var dmTcs = Array.isArray(dm.tool_calls) ? dm.tool_calls : [];
        for (var dmTi = 0; dmTi < dmTcs.length; dmTi++) {
          if (dmTcs[dmTi].id) {
            seenToolCallIds[dmTcs[dmTi].id] = true;
          }
        }
        deduped.push(dm);
      } else if (dm.role === 'tool') {
        if (!dm.tool_call_id) {
          // 损坏数据：tool 没有 tool_call_id → 跳过
          continue;
        }
        if (!seenToolCallIds[dm.tool_call_id]) {
          // 顺序错位或孤立：tool 出现在对应 assistant.tool_calls 之前 → 跳过
          continue;
        }
        deduped.push(dm);
      } else {
        deduped.push(dm);
      }
    }
    clean = deduped;

    // Fix HTTP 400 — 补全缺失的 tool message
    // OpenAI 兼容 API 要求 assistant.tool_calls 后紧跟对应 tool messages（每个 tool_call_id 一条）
    // 中断/异常路径（如 navigation break、null result、resume 时序错位）可能留下
    // assistant.tool_calls=N 但 tool messages<M 的不一致状态，导致 API 报
    // "insufficient tool messages following tool_calls message"。
    // 此处扫描整个数组，为每个未配对的 tool_call_id 补一条占位 tool message。
    var final = [];
    var pendingIds = [];
    var pendingNames = {};
    function flushPending() {
      for (var pp = 0; pp < pendingIds.length; pp++) {
        var pid = pendingIds[pp];
        final.push({
          role: 'tool',
          tool_call_id: pid,
          name: pendingNames[pid] || 'interrupted',
          content: 'Tool execution was interrupted before this call could be completed.'
        });
      }
      pendingIds = [];
      pendingNames = {};
    }
    for (var fi = 0; fi < clean.length; fi++) {
      var fm = clean[fi];
      if (fm.role === 'assistant' && fm.tool_calls && fm.tool_calls.length > 0) {
        // 遇到新的 assistant.tool_calls — 先 flush 上一轮未配对的
        flushPending();
        // 登记本轮所有 tool_call_id
        var fmTcs = Array.isArray(fm.tool_calls) ? fm.tool_calls : [];
        for (var fti = 0; fti < fmTcs.length; fti++) {
          var tid = fmTcs[fti].id;
          if (tid) {
            pendingIds.push(tid);
            pendingNames[tid] = (fmTcs[fti].function && fmTcs[fti].function.name) || 'tool';
          }
        }
        final.push(fm);
      } else if (fm.role === 'tool' && fm.tool_call_id) {
        // 配对一个 pending id
        var matchIdx = pendingIds.indexOf(fm.tool_call_id);
        if (matchIdx !== -1) {
          pendingIds.splice(matchIdx, 1);
          final.push(fm);
        } else {
          // 重复 tool message 或孤立（pendingIds 已被前一个 tool 消费 / flushPending 清空）
          // — 必须丢弃。OpenAI API 严格要求 role='tool' 紧跟对应 tool_calls，
          //   保留会导致 HTTP 400 "Messages with role 'tool' must be a response to a
          //   preceding message with 'tool_calls'"。
          // Phase 8 fix (260621-jHk): 之前错误地保留，导致 worker Tab page_analyze
          //   后下一轮 callLLMStream HTTP 400。
        }
      } else {
        // user/无 tool_calls 的 assistant/system — 必须先 flush pending
        flushPending();
        final.push(fm);
      }
    }
    // 末尾 flush 兜底
    flushPending();
    clean = final;

    return clean;
  }

  /**
   * callLLMStream — 流式 LLM 调用 (AGENT-02, D-01/D-02/D-04)
   * 通过 Service Worker 转发 SSE 流，逐 chunk 回调
   * 返回 Promise，在流完成时 resolve {content, tool_calls}
   * @param {Array} messages - 对话消息数组
   * @param {function} onChunk - 逐 chunk 回调(text, done)
   * @returns {Promise<{content: string, tool_calls: object|null}>}
   */
  function callLLMStream(messages, onChunk) {
    // D-23: 直接从 storage 读取配置，不经过 postMessage
    return GobyStorage.getConfig().then(function (cfg) {
      _agentState.connectionStatus = 'green';
      GobyPanel.updateConnectionStatus('green');

      // ★ 净化消息格式 — 确保 API 兼容
      var cleanMessages = sanitizeMessages(messages);

      // 构造 tools 参数（nativeTools + 已注册技能工具）
      var allTools = nativeTools.concat(_activeSkillTools);
      var tools = allTools.map(function (t) {
        return { type: 'function', function: t.function };
      });

      // 返回 Promise，在流完成时通过 _streamResolve 回调 resolve
      return new Promise(function (resolve, reject) {
        _streamResolve = resolve;
        _streamReject = reject;

        // 发送 llm-stream 到 Service Worker（带 context invalidated 重试）
        var payload = { action: 'llm-stream', messages: cleanMessages, tools: tools };
        function sendStream(retries) {
          Promise.resolve(chrome.runtime.sendMessage(payload)).catch(function (err) {
            var msg = String(err.message || err);
            if (retries > 0 && msg.indexOf('Extension context invalidated') !== -1) {
              setTimeout(function () { sendStream(retries - 1); }, 300);
            } else {
              reject(err);
              _streamResolve = null;
              _streamReject = null;
            }
          });
        }
        sendStream(2);
      });
    });
  }

  /**
   * callLLM — 非流式 LLM 调用 (AGENT-03, D-03)
   * 用于对话压缩摘要、page_analyze 等后台任务
   * @param {Array} messages - 对话消息数组
   * @returns {Promise<Object>} 完整响应 JSON
   */
  function callLLM(messages) {
    // 同样净化消息格式（page_analyze 等非流式调用也走此路径）
    var cleanMessages = sanitizeMessages(messages);
    return GobyStorage.getConfig().then(function (cfg) {
      return sendToSW('llm-request', { action: 'llm-request', messages: cleanMessages });
    }).then(function (response) {
      return response;
    });
  }

  // ================================================================
  //  Token 估算 (GOBY_DESIGN.md §十三 13.1)
  // ================================================================

  /**
   * estimateTokens — Token 估算函数
   * 中文 ≈ 0.5 token/字（charCode > 127）
   * 英文 ≈ 0.25 token/字（charCode <= 127）
   * @param {string} text
   * @returns {number} 预估 token 数
   */
  function estimateTokens(text) {
    if (!text) return 0;
    var chinese = 0, ascii = 0;
    for (var i = 0; i < text.length; i++) {
      text.charCodeAt(i) > 127 ? chinese++ : ascii++;
    }
    return Math.ceil(chinese / 2) + Math.ceil(ascii / 4) + 5;
  }

  // ================================================================
  //  消息数量限制 (AGENT-05, D-14)
  // ================================================================

  /**
   * enforceMessageLimit — 消息历史保留最近 MAX_MESSAGES 条对话消息
   * 260620-i08 修复：分离 system prompt（不计入 20 条上限），保留区 tool↔assistant.tool_calls 配对保护，
   * 清理保留区开头孤立 tool 消息（防止 API 报 HTTP 400 'tool must follow tool_calls'）。
   *
   * 实现参照 compactConversationAsync 已验证的配对保护逻辑（splitIdx 向前扩展）。
   */
  function enforceMessageLimit() {
    var messages = _agentState.messages;
    if (!messages || messages.length === 0) return;

    // 1. 分离 system（仅 messages[0].role==='system' 进 systemMsgs）
    var systemMsgs = [];
    var convoMsgs = messages;
    if (messages[0].role === 'system') {
      systemMsgs = [messages[0]];
      convoMsgs = messages.slice(1);
    }

    // 2. 不超限直接返回
    if (convoMsgs.length <= MAX_MESSAGES) {
      return;
    }

    // 3. splitIdx = convoMsgs.length - MAX_MESSAGES
    var splitIdx = convoMsgs.length - MAX_MESSAGES;

    // 4. 向前扩展 splitIdx，保护保留区内每个 tool 消息对应的 assistant.tool_calls
    //    若 tool 配对的 assistant 落在删除区（ai < splitIdx），扩展 splitIdx 到 ai
    for (var si = splitIdx; si < convoMsgs.length; si++) {
      var msg = convoMsgs[si];
      if (msg.role === 'tool' && msg.tool_call_id) {
        for (var ai = si - 1; ai >= 0; ai--) {
          var prev = convoMsgs[ai];
          if (prev.role === 'assistant' && prev.tool_calls) {
            var tcs = Array.isArray(prev.tool_calls) ? prev.tool_calls : [];
            for (var tci = 0; tci < tcs.length; tci++) {
              if (tcs[tci].id === msg.tool_call_id && ai < splitIdx) {
                splitIdx = ai;
              }
            }
            break;
          }
        }
      }
    }

    // 5. 切片保留区
    convoMsgs = convoMsgs.slice(splitIdx);

    // 6. 清理保留区开头孤立 tool（配对的 assistant.tool_calls 已不在保留区，无法扩展保护）
    //    防御性兜底：连续从开头 shift 直到不再是孤立 tool
    while (convoMsgs.length > 0) {
      var first = convoMsgs[0];
      if (first.role === 'tool' && first.tool_call_id) {
        // 检查保留区内是否有匹配的 assistant.tool_calls
        var hasMatch = false;
        for (var mi = 0; mi < convoMsgs.length; mi++) {
          var cand = convoMsgs[mi];
          if (cand.role === 'assistant' && cand.tool_calls) {
            var ctcs = Array.isArray(cand.tool_calls) ? cand.tool_calls : [];
            for (var cti = 0; cti < ctcs.length; cti++) {
              if (ctcs[cti].id === first.tool_call_id) {
                hasMatch = true;
                break;
              }
            }
            if (hasMatch) break;
          }
        }
        if (!hasMatch) {
          convoMsgs.shift();
        } else {
          break;
        }
      } else {
        break;
      }
    }

    // 7. 重新组装
    _agentState.messages = systemMsgs.concat(convoMsgs);
  }

  // ================================================================
  //  对话压缩 (AGENT-05, D-15)
  // ================================================================

  /**
   * compactConversationAsync — 当 token 达到 180K 时触发 LLM 摘要压缩
   * 保留最近 N 条消息，并确保 tool 消息与其前面的 assistant tool_calls 配对完整
   */
  function compactConversationAsync() {
    if (_agentState.messages.length <= 3) {
      return Promise.resolve();
    }

    // 保留最近 N 条，向前扩展确保 tool↔assistant_tool_calls 配对不割裂
    var keepCount = 3;
    var splitIdx = _agentState.messages.length - keepCount;

    // 扫描保留区的 tool 消息，若其配对的 assistant tool_calls 在压缩区，则扩展分割点
    for (var si = splitIdx; si < _agentState.messages.length; si++) {
      var msg = _agentState.messages[si];
      if (msg.role === 'tool' && msg.tool_call_id) {
        for (var ai = si - 1; ai >= 0; ai--) {
          var prev = _agentState.messages[ai];
          if (prev.role === 'assistant' && prev.tool_calls) {
            var tcs = Array.isArray(prev.tool_calls) ? prev.tool_calls : [];
            for (var tci = 0; tci < tcs.length; tci++) {
              if (tcs[tci].id === msg.tool_call_id && ai < splitIdx) {
                splitIdx = ai;
              }
            }
            break;
          }
        }
      }
    }

    var compactMsgs = _agentState.messages.slice(0, splitIdx);
    var recentMsgs = _agentState.messages.slice(splitIdx);

    // 清理 compactMsgs 末尾悬空的 assistant tool_calls（其 tool 结果在 recentMsgs 中）
    compactMsgs = stripDanglingToolCalls(compactMsgs);

    // 如果 compactMsgs 为空则跳过压缩
    if (compactMsgs.length === 0) {
      return Promise.resolve();
    }

    var summaryPrompt = [
      { role: 'system', content: '请总结以下对话的关键信息，包括用户的需求、已完成的步骤和当前状态' }
    ].concat(compactMsgs);

    return Promise.resolve().then(function () {
      return callLLM(summaryPrompt);
    }).then(function (response) {
      var summary = '';
      if (response && response.choices && response.choices[0] && response.choices[0].message) {
        summary = response.choices[0].message.content || '';
      }

      // 将摘要替换为第一条消息
      var summaryMsg = { role: 'system', content: '【对话摘要】' + summary };
      _agentState.messages = [summaryMsg].concat(recentMsgs);

      // 渲染摘要消息到面板
      GobyPanel.appendMessage('bot', '【对话摘要】' + summary);
    }).catch(function () {
      // 压缩失败 — 不影响继续对话
    });
  }

  // ================================================================
  //  会话管理 (Plan 03-03, SESS-01/02/03/04)
  // ================================================================

  /**
   * sessionIdForOrigin — DJB2 hash 生成一致会话哈希 (SESS-02, D-17)
   * 标准 DJB2 算法：hash = ((hash << 5) - hash) + charCode; hash |= 0
   * @param {string} origin - 域名（如 https://example.com）
   * @returns {string} 'session_' + abs hash 的 base36 编码
   */
  function sessionIdForOrigin(origin) {
    var hash = 5381;
    var str = origin || '';
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0; // Convert to 32-bit integer
    }
    return 'session_' + Math.abs(hash).toString(36);
  }

  /**
   * createSession — 创建新会话 (SESS-01, D-17)
   * sessionId = sessionIdForOrigin(origin) + '_' + Date.now()
   * @param {string} origin
   * @returns {string} sessionId
   */
  function createSession(origin) {
    var sessionId = sessionIdForOrigin(origin) + '_' + Date.now();

    _agentState.messages = [{ role: 'system', content: getSystemPrompt() }];
    _agentState.sessionId = sessionId;
    _agentState.activeOrigin = origin;
    // 重置会话级计数器（新建会话=全新开始，不受旧会话限制）
    _agentState.toolCallCounter = 0;
    _agentState.roundCount = 0;
    _agentState.isProcessing = false;
    _agentState._autoSkillCounter = 0;

    // 重置 UI：先清空旧的聊天气泡（含遗留工具调用），再显示欢迎消息
    if (window.GobyPanel) {
      if (typeof window.GobyPanel.clearChat === 'function') {
        window.GobyPanel.clearChat();
      } else if (typeof window.GobyPanel.renderWelcome === 'function') {
        window.GobyPanel.renderWelcome();
      }
    }

    return sessionId;
  }

  /**
   * stripDanglingToolCalls — 移除消息数组末尾悬空的 assistant tool_calls
   * 防止页面跳转或异常中断导致的不完整状态
   * @param {Array} msgs
   * @returns {Array}
   */
  function stripDanglingToolCalls(msgs) {
    var result = msgs.slice();
    while (result.length > 0) {
      var last = result[result.length - 1];
      if (last.role === 'assistant' && last.tool_calls) {
        result.pop();
      } else {
        break;
      }
    }
    return result;
  }

  /**
   * saveSession — 将当前会话委托 SW 保存 (SESS-01, Fix C)
   *
   * Fix C 之前：直接调 chrome.storage.local.get/set，三次 IPC round trip
   * 在 navigation 前没写完 → page 卸载后 IPC 中断 → 新 page loadSession 找不到旧会话。
   *
   * Fix C 之后：构造 sessionData + chrome.runtime.sendMessage 转发到 SW，
   * SW 寿命长于 page，navigation 后仍能完成 storage.set + LRU 淘汰。
   *
   * @returns {Promise<void>}
   */
  function saveSession() {
    if (!_agentState.activeOrigin || !_agentState.sessionId) {
      return Promise.resolve();
    }

    // 计算 preview：第一条 role='user' 消息的前 30 字符
    var preview = '';
    for (var si = 0; si < _agentState.messages.length; si++) {
      if (_agentState.messages[si].role === 'user') {
        preview = (_agentState.messages[si].content || '').substring(0, 30);
        break;
      }
    }

    // messageCount：不含 system prompt 的消息数量
    var msgCount = 0;
    for (var mi = 0; mi < _agentState.messages.length; mi++) {
      if (_agentState.messages[mi].role !== 'system') {
        msgCount++;
      }
    }

    var hostname = '';
    try {
      hostname = new URL(_agentState.activeOrigin).hostname;
    } catch (e) {
      hostname = _agentState.activeOrigin;
    }

    var msgs = stripDanglingToolCalls(JSON.parse(JSON.stringify(_agentState.messages)));

    // Fix BR: 记录 Agent 循环是否在跑 — navigation 后新 page 据此判断是否续跑
    var isProcessing = _agentState.isProcessing === true;

    var sessionData = {
      origin: _agentState.activeOrigin,
      title: hostname,
      updatedAt: Date.now(),
      messageCount: msgCount,
      preview: preview,
      messages: msgs,
      interrupted: isProcessing,
      interruptedAt: isProcessing ? Date.now() : null
    };

    // 委托 SW 保存（SW 寿命长于 page，navigation 后仍能完成 storage.set）
    // Promise.resolve 包装以兼容 jest 测试环境（Plan 03-02 D-26 模式）
    return Promise.resolve(chrome.runtime.sendMessage({
      action: 'save-session',
      sessionId: _agentState.sessionId,
      sessionData: sessionData
    })).then(function (response) {
      if (!response || !response.ok) {
        // SW 保存失败 — 静默忽略（不阻塞 agent 循环）
        return;
      }
    }).catch(function () {
      // 测试环境可能没 chrome.runtime.sendMessage — 静默降级
    });
  }

  /**
   * loadSession — 加载指定域名的最新会话 (SESS-01)
   * 从 storage 读取该 origin 的所有会话，按 updatedAt 降序取最新
   * @param {string} origin - 域名
   * @returns {Promise<Object|null>} 会话数据或 null
   */
  function loadSession(origin) {
    return chrome.storage.local.get('gobySessions').then(function (result) {
      var sessions = result.gobySessions || {};
      var matching = [];

      var keys = Object.keys(sessions);
      for (var ki = 0; ki < keys.length; ki++) {
        if (sessions[keys[ki]].origin === origin) {
          matching.push({ sessionId: keys[ki], data: sessions[keys[ki]] });
        }
      }

      if (matching.length === 0) {
        return null;
      }

      // 按 updatedAt 降序排列，取最新
      matching.sort(function (a, b) {
        return b.data.updatedAt - a.data.updatedAt;
      });

      var latest = matching[0];

      // 恢复状态（清除可能因页面跳转残留的悬空 tool_calls）
      _agentState.messages = stripDanglingToolCalls(JSON.parse(JSON.stringify(latest.data.messages)));
      _agentState.sessionId = latest.sessionId;
      _agentState.activeOrigin = origin;

      // 渲染消息到面板（跳过 system prompt）
      if (window.GobyPanel) {
        window.GobyPanel.renderWelcome();
        for (var ri = 0; ri < _agentState.messages.length; ri++) {
          var msg = _agentState.messages[ri];
          if (msg.role === 'system') continue;

          var panelRole = msg.role;
          if (panelRole === 'assistant') panelRole = 'bot';
          if (panelRole === 'tool') {
            var isError = typeof msg.content === 'string' && msg.content.startsWith('Error:');
            panelRole = isError ? 'tool-error' : 'tool';
          }

          if (window.GobyPanel && typeof window.GobyPanel.appendMessage === 'function') {
            window.GobyPanel.appendMessage(panelRole, msg.content);
          }
        }
      }

      return latest.data;
    });
  }

  /**
   * loadSessionById — 按 sessionId 加载指定会话
   * @param {string} sessionId
   * @returns {Promise<Object|null>} 会话数据或 null
   */
  function loadSessionById(sessionId) {
    return chrome.storage.local.get('gobySessions').then(function (result) {
      var sessions = result.gobySessions || {};
      var session = sessions[sessionId];
      if (!session) return null;

      // 恢复状态（清除可能因页面跳转残留的悬空 tool_calls）
      _agentState.messages = stripDanglingToolCalls(JSON.parse(JSON.stringify(session.messages)));
      _agentState.sessionId = sessionId;
      _agentState.activeOrigin = session.origin;

      // 渲染消息
      if (window.GobyPanel) {
        window.GobyPanel.renderWelcome();
        for (var ri = 0; ri < _agentState.messages.length; ri++) {
          var msg = _agentState.messages[ri];
          if (msg.role === 'system') continue;

          var panelRole = msg.role;
          if (panelRole === 'assistant') panelRole = 'bot';
          if (panelRole === 'tool') {
            var isError = typeof msg.content === 'string' && msg.content.startsWith('Error:');
            panelRole = isError ? 'tool-error' : 'tool';
          }

          if (window.GobyPanel && typeof window.GobyPanel.appendMessage === 'function') {
            window.GobyPanel.appendMessage(panelRole, msg.content);
          }
        }
      }

      return session;
    });
  }

  /**
   * listSessionsForOrigin — 列出某域名所有会话（元数据，不含消息内容）
   * @param {string} origin
   * @returns {Promise<Array<{sessionId, title, preview, updatedAt, messageCount}>>}
   */
  function listSessionsForOrigin(origin) {
    return chrome.storage.local.get('gobySessions').then(function (result) {
      var sessions = result.gobySessions || {};
      var list = [];

      var keys = Object.keys(sessions);
      for (var ki = 0; ki < keys.length; ki++) {
        var s = sessions[keys[ki]];
        if (s.origin === origin) {
          list.push({
            sessionId: keys[ki],
            origin: s.origin,
            title: s.title,
            preview: s.preview,
            updatedAt: s.updatedAt,
            messageCount: s.messageCount
          });
        }
      }

      // 按 updatedAt 降序
      list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      return list;
    });
  }

  /**
   * getAllSessions — 获取所有会话列表（供侧栏使用）
   * @returns {Promise<Array<{sessionId, origin, title, preview, updatedAt, messageCount}>>}
   */
  function getAllSessions() {
    return chrome.storage.local.get('gobySessions').then(function (result) {
      var sessions = result.gobySessions || {};
      var list = [];

      var keys = Object.keys(sessions);
      for (var ki = 0; ki < keys.length; ki++) {
        var s = sessions[keys[ki]];
        list.push({
          sessionId: keys[ki],
          origin: s.origin,
          title: s.title,
          preview: s.preview,
          updatedAt: s.updatedAt,
          messageCount: s.messageCount
        });
      }

      // 按 updatedAt 降序
      list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      return list;
    });
  }

  /**
   * deleteSession — 删除单个会话 (SESS-04, D-18)
   * 若删除的是当前活动会话，切换到同域名最新会话或创建新会话
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  function deleteSession(sessionId) {
    return chrome.storage.local.get('gobySessions').then(function (result) {
      var sessions = result.gobySessions || {};
      var deletedOrigin = sessions[sessionId] ? sessions[sessionId].origin : null;

      delete sessions[sessionId];

      return chrome.storage.local.set({ gobySessions: sessions }).then(function () {
        // 若删除的是当前活动会话
        if (sessionId === _agentState.sessionId && deletedOrigin) {
          return listSessionsForOrigin(deletedOrigin).then(function (list) {
            if (list.length > 0) {
              return loadSessionById(list[0].sessionId);
            } else {
              createSession(deletedOrigin);
            }
          });
        }
      });
    });
  }

  /**
   * deleteAllSessions — 清除全部会话
   * 清除后创建新会话
   * @returns {Promise<void>}
   */
  function deleteAllSessions() {
    // Phase 8 fix: 委托 SW 执行删除 + 广播。直接 chrome.storage.local.remove
    //   只能清当前 tab 视角的 storage，其他 tab 的 saveSession（自动保存）会把
    //   各自内存里的 session 重新写回 storage，导致"活尸"复活、用户需多次清除。
    //   SW 单线程保证无竞态，广播保证所有 tab 同步重置本地状态。
    return sendToSW('delete-all-sessions', {
      action: 'delete-all-sessions'
    }).then(function () {
      var origin = _agentState.activeOrigin || window.location.origin;
      createSession(origin);
    });
  }

  /**
   * cleanupOldSessions — LRU 淘汰 (SESS-03, D-18)
   * 每次 saveSession 后调用。若会话超过 50 个，
   * 按 updatedAt 升序排序删除最旧的 N-50 个
   * @returns {Promise<void>}
   */
  function cleanupOldSessions() {
    return chrome.storage.local.get('gobySessions').then(function (result) {
      var sessions = result.gobySessions || {};
      var keys = Object.keys(sessions);

      if (keys.length <= 50) {
        return;
      }

      // 按 updatedAt 升序排列（最旧在前）
      keys.sort(function (a, b) {
        return (sessions[a].updatedAt || 0) - (sessions[b].updatedAt || 0);
      });

      // 删除最旧的 N-50 个
      var toRemove = keys.length - 50;
      for (var ri = 0; ri < toRemove; ri++) {
        delete sessions[keys[ri]];
      }

      return chrome.storage.local.set({ gobySessions: sessions });
    });
  }

  /**
   * switchToSession — 切换到指定会话
   * 先保存当前会话，再加载目标会话
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  function switchToSession(sessionId) {
    return saveSession().then(function () {
      return loadSessionById(sessionId);
    });
  }

  /**
   * handleUrlChange — URL 变化时自动保存当前 + 加载新域名会话
   * 由 popstate / hashchange 事件触发
   * 通过 window.GobyAgent 调用以确保测试 spy 可捕获（Plan 03-03）
   */
  function handleUrlChange() {
    var newOrigin = window.location.origin;

    // 域名未变则忽略（可能只是 hash/query 变化）
    if (newOrigin === _agentState.activeOrigin) return;

    var agent = window.GobyAgent;
    if (!agent || typeof agent.saveSession !== 'function') return;

    agent.saveSession().then(function () {
      return agent.loadSession(newOrigin);
    }).then(function (session) {
      if (!session) {
        agent.createSession(newOrigin);
      }
    });
  }

  // ================================================================
  //  Plan 09-01: Skills 系统 — CS 侧导入/列表/删除
  // ================================================================

  /**
   * importSkill — 从 URL 导入 SKILL.md 技能文件
   * 流程：URL → SW fetch → 解析 markdown → 验证 → SW 写入 storage
   *
   * @param {string} url - SKILL.md 文件的 https:// URL
   * @returns {Promise<{ok: boolean, domain?: string, error?: string}>}
   */
  function importSkill(url) {
    if (!url || typeof url !== 'string') {
      return Promise.resolve({ ok: false, error: '缺少 url 参数' });
    }

    return sendToSW('skill-import', { action: 'skill-import', url: url }).then(function (response) {
      // sendToSW 返回字符串（成功响应）或 Error: 开头的字符串（失败）
      if (typeof response === 'string' && response.startsWith('Error:')) {
        return { ok: false, error: response };
      }

      // 检查 response 是否已经是成功对象（有 ok 字段）
      // SW 可能返回 { ok: true, content: '...' } 或 { ok: false, error: '...' }
      if (response && typeof response === 'object') {
        if (!response.ok) {
          return { ok: false, error: response.error || '导入失败' };
        }
        // 成功获取 markdown 内容
        return parseAndStoreSkill(response.content, url);
      }

      return { ok: false, error: '未知响应格式: ' + JSON.stringify(response) };
    });
  }

  /**
   * parseAndStoreSkill — 解析 markdown → 验证 → 写入 storage
   * @param {string} markdownText - SKILL.md 原始内容
   * @returns {Promise<{ok: boolean, domain?: string, error?: string}>}
   */
  function parseAndStoreSkill(markdownText, sourceUrl) {
    if (typeof SkillLoader === 'undefined' || !SkillLoader.parseSkillMarkdown) {
      return Promise.resolve({ ok: false, error: 'SkillLoader 模块未加载' });
    }

    // 步骤 1: 解析 markdown
    var parseResult;
    try {
      parseResult = SkillLoader.parseSkillMarkdown(markdownText);
    } catch (e) {
      return Promise.resolve({ ok: false, error: '解析 SKILL.md 失败: ' + (e.message || String(e)) });
    }

    // 步骤 2: 验证
    var validation = SkillLoader.validateSkill(parseResult);
    if (!validation.valid) {
      return Promise.resolve({ ok: false, error: '验证失败: ' + validation.errors.join('; ') });
    }

    // 步骤 3: 写入 storage（委托 SW）
    return sendToSW('skill-store', {
      action: 'skill-store',
      skillManifest: {
        name: validation.skillManifest.name,
        description: validation.skillManifest.description,
        domain: validation.skillManifest.domain,
        actions: validation.skillManifest.actions,
        source: sourceUrl
      }
    }).then(function (storeResponse) {
      if (storeResponse && storeResponse.ok) {
        return { ok: true, domain: storeResponse.domain };
      }
      var errMsg = (storeResponse && storeResponse.error) || '写入 storage 失败';
      return { ok: false, error: errMsg };
    });
  }

  /**
   * listSkills — 获取所有已安装技能
   * @returns {Promise<Object>} { domain: skillManifest, ... }
   */
  function listSkills() {
    return sendToSW('skill-list', { action: 'skill-list' }).then(function (response) {
      if (response && response.ok) {
        return response.skills || {};
      }
      return {};
    });
  }

  /**
   * removeSkill — 按 domain 删除技能
   * @param {string} domain
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  function removeSkill(domain) {
    if (!domain || typeof domain !== 'string') {
      return Promise.resolve({ ok: false, error: '缺少 domain 参数' });
    }
    return sendToSW('skill-remove', { action: 'skill-remove', domain: domain }).then(function (response) {
      if (response && response.ok) {
        return { ok: true };
      }
      return { ok: false, error: (response && response.error) || '删除失败' };
    });
  }

  // ================================================================
  //  Plan 09-03: 内置技能首次启动预装
  // ================================================================

  /**
   * _preloadBuiltinSkills — 首次运行时将 5 个内置技能写入 gobySkills storage
   * 仅在 gobySkills 为空时执行（无已安装技能 = 新安装）。
   * 从扩展自带的 skills/builtin/*.SKILL.md 文件加载，无需网络请求。
   *
   * @returns {Promise<void>}
   */
  var _builtinPreloaded = false;

  function _preloadBuiltinSkills() {
    if (_builtinPreloaded) {
      return Promise.resolve();
    }

    return GobyStorage.getAllSkills().then(function (allSkills) {
      var installedDomains = Object.keys(allSkills);
      console.log('[preload] 现有技能:', installedDomains.length, installedDomains);
      if (installedDomains.length > 0) {
        // 已有已安装技能，跳过预装
        console.log('[preload] 跳过 — 已有技能');
        return;
      }

      var BUILTIN_SKILLS = [
        'skills/builtin/amazon.SKILL.md',
        'skills/builtin/github.SKILL.md',
        'skills/builtin/google.SKILL.md',
        'skills/builtin/baidu.SKILL.md',
        'skills/builtin/wikipedia.SKILL.md'
      ];

      if (typeof SkillLoader === 'undefined' || !SkillLoader.parseSkillMarkdown) {
        // SkillLoader 未加载 — 静默降级
        console.error('[preload] SkillLoader 不可用:', typeof SkillLoader);
        return;
      }

      // 逐个加载技能（顺序处理，避免 chrome.storage.local 竞态条件）
      var chain = Promise.resolve();
      for (var s = 0; s < BUILTIN_SKILLS.length; s++) {
        (function (path) {
          chain = chain.then(function () {
            console.log('[preload] 加载:', path);
            // 通过 SW 读取扩展自带的 SKILL.md 文件
            // CS 直接 fetch(chrome.runtime.getURL(...)) 在页面 origin 中运行
            // 可能因跨域返回非预期内容。SW 原生访问扩展资源，返回正确文本。
            return sendToSW('fetch-extension-file', { action: 'fetch-extension-file', path: path }).then(function (resp) {
              console.log('[preload] fetch-extension-file 返回:', path, resp && resp.ok, typeof resp === 'object' ? Object.keys(resp).join(',') : typeof resp);
              if (!resp || !resp.ok) { console.error('[preload] fetch-extension-file 失败', path, resp && resp.error); return undefined; }
              var markdown = resp.content;

              if (!markdown) { console.error('[preload] 空内容', path); return undefined; }
              var parseResult;
              try {
                parseResult = SkillLoader.parseSkillMarkdown(markdown);
              } catch (e) {
                console.error('[preload] 解析失败', path, e.message);
                return undefined;
              }
              var validation = SkillLoader.validateSkill(parseResult);
              if (!validation.valid) { console.error('[preload] 验证失败', path, validation.errors.join('; ')); return undefined; }
              console.log('[preload] 验证通过，准备安装:', path);
              return GobyStorage.saveSkill(validation.skillManifest.domain, {
                name: validation.skillManifest.name,
                description: validation.skillManifest.description,
                domain: validation.skillManifest.domain,
                actions: validation.skillManifest.actions,
                source: 'builtin'
              }).then(function () {
                console.log('[preload] 安装成功:', path);
              }).catch(function (e) {
                console.error('[preload] saveSkill 失败:', path, e.message);
              });
            }).catch(function (err) {
              console.error('[preload] 异常', path, err && err.message || err);
              return undefined;
            });
          });
        })(BUILTIN_SKILLS[s]);
      }
      return chain.then(function () {
        _builtinPreloaded = true;
      });
    });
  }

  // ================================================================
  //  Plan 09-02: 动态技能工具注册/注销
  // ================================================================

  /**
   * registerSkillTools — 为指定 domain 注册技能工具
   * 从 gobySkills storage 读取技能 manifest，将每个 action 包装为
   * nativeTools 兼容的工具定义，追加到 _activeSkillTools 数组
   *
   * @param {string} domain - 网站域名 (e.g., "amazon.com")
   * @returns {Promise<number>} 注册的工具数量
   */
  var _registeredSkillDomain = null;

  function registerSkillTools(domain) {
    if (!domain || typeof domain !== 'string') {
      return Promise.resolve(0);
    }
    // 幂等：同一域名不重复注册
    if (_registeredSkillDomain === domain && _activeSkillTools.length > 0) {
      return Promise.resolve(_activeSkillTools.length);
    }
    // 先清除旧技能工具
    unregisterSkillTools();

    return GobyStorage.getSkill(domain).then(function (skill) {
      if (!skill || !Array.isArray(skill.actions) || skill.actions.length === 0) {
        return 0;
      }

      // Plan 09-04: 跳过已禁用的技能
      if (skill.enabled === false) {
        return 0;
      }

      var registered = 0;
      for (var i = 0; i < skill.actions.length; i++) {
        var action = skill.actions[i];
        if (!action.name) continue;
        if (!action.rawCode && !action.execute) continue;

        // 优先用预编译 execute 函数，否则通过 page_evaluate SW 通道执行
        var actionName = action.name;
        var hasPrecompiled = action.execute && typeof action.execute === 'function';
        // 兼容 browsing-skills 的 inputSchema 格式（可能缺少顶层 type:"object"）
        var schema = action.inputSchema || {};
        if (!schema.type) {
          schema = { type: 'object', properties: schema };
        }
        var toolDef = {
          type: 'function',
          function: {
            name: actionName,
            description: action.description || '',
            parameters: schema
          },
          timeout: 30000,
          execute: function (params) {
            // 导航检测——skill 可能触发表单提交导致页面跳转
            var navigated = false;
            var onNav = function () { navigated = true; };
            window.addEventListener('beforeunload', onNav);
            window.addEventListener('pagehide', onNav);

            function formatResult(result, isError) {
              window.removeEventListener('beforeunload', onNav);
              window.removeEventListener('pagehide', onNav);
              var text;
              if (result && Array.isArray(result.content)) {
                var texts = [];
                for (var ci = 0; ci < result.content.length; ci++) {
                  if (result.content[ci] && typeof result.content[ci].text === 'string') texts.push(result.content[ci].text);
                }
                text = texts.length === 1 ? texts[0] : JSON.stringify(texts.length > 0 ? texts : result);
              } else if (typeof result === 'string') {
                text = result;
              } else {
                text = JSON.stringify(result);
              }
              if (isError) text = 'Error: ' + actionName + ' 失败 - ' + (isError.message || isError);
              if (navigated && text.indexOf('Error:') !== 0) {
                text += ' (navigation started, agent loop will pause until new page loads)';
              }
              return text;
            }

            // 预编译函数直接执行
            if (hasPrecompiled) {
              try {
                return formatResult(action.execute(params));
              } catch (e) {
                return formatResult(null, e);
              }
            }
            // rawCode 通过 page_evaluate SW 通道执行（绕过页面 CSP）
            return new Promise(function (resolve) {
              var expr = 'JSON.stringify((function(){' +
                'var _skillFn = ' + action.rawCode + ';' +
                'var _params = ' + JSON.stringify(params || {}) + ';' +
                'var _result = _skillFn(_params);' +
                'return _result;' +
              '})())';
              chrome.runtime.sendMessage({ action: 'page-evaluate', expression: expr }, function (response) {
                if (chrome.runtime.lastError) {
                  resolve(formatResult(null, chrome.runtime.lastError));
                  return;
                }
                try {
                  resolve(formatResult(JSON.parse(String(response))));
                } catch (e) {
                  resolve(formatResult(String(response)));
                }
              });
            });
          }
        };

        _activeSkillTools.push(toolDef);
        registered++;
      }

      console.log('[skill] registerSkillTools: ' + registered + ' actions for ' + domain + ', _activeSkillTools=' + _activeSkillTools.length);
      _registeredSkillDomain = domain;
      return registered;
    }).catch(function () {
      // storage 读取失败 — 静默降级
      unregisterSkillTools();
      return 0;
    });
  }

  /**
   * unregisterSkillTools — 清除所有已注册的技能工具
   */
  function unregisterSkillTools() {
    _activeSkillTools.length = 0;
    _registeredSkillDomain = null;
  }

  // ================================================================
  //  工具执行引擎 (GOBY_DESIGN.md §十六)
  // ================================================================

  /**
   * executeToolCall — 单工具执行
   * @param {{id: string, function: {name: string, arguments: object|string}}} toolCall
   * @returns {string|Promise<string>} 工具执行结果
   */
  function executeToolCall(toolCall) {
    // T-03-07: 安全解析 arguments
    var args = toolCall.function.arguments || {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch (e) {
        return t('tool.parse_error');
      }
    }

    // 在 nativeTools 和已注册技能工具中查找匹配的工具
    var toolDef = nativeTools.find(function (t) {
      return t.function.name === toolCall.function.name;
    }) || _activeSkillTools.find(function (t) {
      return t.function.name === toolCall.function.name;
    });

    if (!toolDef) {
      var availableTools = nativeTools.concat(_activeSkillTools).map(function (t) {
        return t.function.name;
      }).join(', ');
      // 使用 UnknownTool: 前缀（区别于 Error:），让 executeWithTimeout 能识别"未知工具"
      // 并跳过重试 — 重试永远是相同结果，留更多预算给真正的工具错误
      return t('tool.unknown_tool', { name: toolCall.function.name, tools: availableTools });
    }

    try {
      var result = toolDef.execute(args);
      return result;
    } catch (e) {
      return t('tool.execute_fail', { msg: e.message || t('tool.execute_fail_default') });
    }
  }

  /**
   * executeWithTimeout — 带超时和重试的工具执行 (AGENT-05, D-12/D-13)
   * 使用 Promise.race + setTimeout 实现超时
   * 单工具最多 3 次尝试，每次超时 15s
   * 连续 3 次失败返回跳过消息
   * @param {{id: string, type: string, function: {name: string, arguments: object|string}}} toolCall
   * @returns {Promise<string>}
   */
  function executeWithTimeout(toolCall) {
    var toolName = toolCall.function.name;
    var timeout = TOOL_TIMEOUT;

    // 在 nativeTools 和已注册技能工具中查找工具特定超时
    var toolDef = nativeTools.find(function (t) {
      return t.function.name === toolName;
    }) || _activeSkillTools.find(function (t) {
      return t.function.name === toolName;
    });
    if (toolDef && toolDef.timeout) {
      timeout = toolDef.timeout;
    }

    var maxRetries = 3;

    // 使用自调用 async 函数以支持循环中的 await
    return new Promise(function (resolve) {
      var attemptLoop = function (attempt) {
        if (attempt >= maxRetries) {
          // 所有重试均失败 — 返回跳过消息
          resolve(t('tool.skipped', { n: maxRetries }));
          return;
        }

        var timeoutId = null;

        Promise.race([
          Promise.resolve().then(function () {
            return executeToolCall(toolCall);
          }),
          new Promise(function (_, reject) {
            timeoutId = setTimeout(function () {
              reject(new Error(t('tool.timeout', { n: timeout / 1000 })));
            }, timeout);
          })
        ]).then(function (result) {
          if (timeoutId) clearTimeout(timeoutId);
          // UnknownTool — 未知工具调用，重试无意义（结果永远相同）
          // 立即 resolve，让 LLM 在下一轮基于"可用工具列表"消息纠正
          if (typeof result === 'string' && result.startsWith('UnknownTool:')) {
            resolve(result);
            return;
          }
          // 检查是否是错误结果
          if (typeof result === 'string' && result.startsWith('Error:')) {
            // 继续重试
            attemptLoop(attempt + 1);
          } else {
            // 执行成功 — 返回结果
            resolve(result);
          }
        }).catch(function () {
          if (timeoutId) clearTimeout(timeoutId);
          // 超时或异常 — 继续重试
          attemptLoop(attempt + 1);
        });
      };

      attemptLoop(0);
    });
  }

  // ================================================================
  //  工具结果管理 (D-06)
  // ================================================================

  /**
   * pushResultsToMessages — 将工具执行结果追加到消息历史和面板
   * @param {Array<{tool_call_id: string, name: string, content: string}>} results
   */
  function pushResultsToMessages(results) {
    // 自动技能生成计数器（每个工具调用 +1）
    _agentState._autoSkillCounter += (results && results.length) || 0;

    for (var i = 0; i < results.length; i++) {
      var r = results[i];

      // 截图结果特殊处理：dataUrl 渲染到 panel 但不进 messages 数组
      // 避免 base64 占用大量 token 触发 context 超限
      var isDataUrl = typeof r.content === 'string' &&
        r.content.indexOf('data:image/') === 0;
      var panelContent = r.content;
      var messageContent = isDataUrl
        ? 'Screenshot captured: image displayed as thumbnail in chat'
        : r.content;

      // 追加到消息历史（截图用简短文本替代 dataUrl）
      _agentState.messages.push({
        role: 'tool',
        tool_call_id: r.tool_call_id,
        name: r.name,
        content: messageContent
      });

      // 渲染到面板（用原始 content，dataUrl 时走缩略图渲染分支 panel.js:603）
      var isError = typeof panelContent === 'string' &&
        (panelContent.startsWith('Error:') || panelContent.startsWith('UnknownTool:'));
      GobyPanel.appendMessage(isError ? 'tool-error' : 'tool', panelContent);
    }

    // Phase 8 / NAV-08 / D-11: worker Tab 增量转发 — 每轮工具完成后自动发
    //   workflow-progress 经 SW 中转到 chat Tab。在 pushResultsToMessages 内
    //   做是通用 hook：任何调用者（agent loop / 外部工具）都自动获得转发能力，
    //   不硬编码在 agent loop 特定位置。
    if (window.__gobyWorkflowId && results.length > 0) {
      var progressParts = [];
      for (var pi = 0; pi < results.length; pi++) {
        var pr = results[pi];
        if (pr && pr.name) {
          var shortContent = typeof pr.content === 'string' ? pr.content.substring(0, 150) : '';
          progressParts.push(pr.name + ': ' + shortContent);
        }
      }
      if (progressParts.length > 0) {
        try {
          sendToSW('workflow-progress', {
            action: 'workflow-progress',
            workflow_id: window.__gobyWorkflowId,
            data: { content: progressParts.join('\n') }
          });
        } catch (e) { /* 静默降级 — 不阻塞 agent loop */ }
      }
    }
  }

  // ================================================================
  //  Agent 主循环 — processAgentMessage (AGENT-01, D-05)
  // ================================================================

  /**
   * processAgentMessage — Agent 主循环
   * 使用 while 迭代（非递归），最大 15 轮
   * 路由文本回复 vs 工具调用
   * @param {string} userText - 用户消息文本
   */
  async function processAgentMessage(userText, options) {
    if (_agentState.isProcessing) return;
    _agentState.isProcessing = true;
    _agentState.stopRequested = false;
    _agentState.connectionStatus = 'green';
    // Phase 8: 切换发送按钮为停止按钮（■）
    if (window.GobyPanel && typeof window.GobyPanel.setAgentRunning === 'function') {
      window.GobyPanel.setAgentRunning(true);
    }
    GobyPanel.updateConnectionStatus('green');

    // Fix BR: resume 模式跳过 user 消息 push + roundCount 自增
    // 用于跨 navigation 续跑（initSession 检测到 interrupted 后自动调起）
    var isResume = options && options.resume === true;

    // Phase 8 / NAV-08 / D-09: isWorkflowInit 模式 — 工作 Tab 首次启动 Agent 循环
    // workflow-init listener 已 push inherited + initial_user_message，本路径不再 push
    // 任何消息，等价新 session 的第一次调用（避免重复 push 角色 user message）
    var isWorkflowInit = options && options.isWorkflowInit === true;

    // 重置工具失败计数（跨轮次累计，但重置前需保留已有计数）
    // 注意：_toolCallFailCounts 保留，在 executeWithTimeout 中连续 3 次失败会跳过

    if (!isResume && !isWorkflowInit) {
      // 追加用户消息到消息历史（面板已由 panel.js 渲染）
      _agentState.messages.push({ role: 'user', content: userText });

      // Phase 03 UAT 测试 4：会话累计轮数（不在末尾重置）
      _agentState.roundCount++;
      GobyPanel.updateRoundCount(_agentState.roundCount);
    } else if (isWorkflowInit) {
      // Phase 8 fix (260621-mKk): worker Tab isWorkflowInit 启动时 initial_user_message
      //   等价于用户第一条消息，必须自增 roundCount + updateRoundCount，否则状态栏永远显示"第 0 轮"
      //   （workflow-init listener 已 push initial_user_message，此处只补 roundCount）
      _agentState.roundCount++;
      GobyPanel.updateRoundCount(_agentState.roundCount);
    }

    var loopCount = 0;
    var loopExitedByLimit = false;

    while (loopCount < MAX_LOOPS) {
      // Phase 8: 用户点击停止按钮 → 退出循环
      if (_agentState.stopRequested) {
        _agentState.messages.push({ role: 'assistant', content: '⏹ 已停止' });
        GobyPanel.appendMessage('bot', '⏹ 已停止');
        break;
      }

      // 消息数量限制
      enforceMessageLimit();

      // 构建完整消息数组（含 system prompt）
      var messages = [
        { role: 'system', content: getSystemPrompt() }
      ].concat(_agentState.messages);

      // 检查 token 限制
      var totalTokens = 0;
      for (var i = 0; i < messages.length; i++) {
        totalTokens += estimateTokens(messages[i].content || '');
      }
      if (totalTokens >= TOKEN_LIMIT) {
        await compactConversationAsync();
        // 压缩后重新构建消息
        messages = [
          { role: 'system', content: getSystemPrompt() }
        ].concat(_agentState.messages);
      }

      // 调用 LLM 流式接口
      var response;
      try {
        response = await callLLMStream(messages, function (text, done, error) {
          // 流式文本渲染由 handleStreamChunk 处理
        });
      } catch (err) {
        // LLM 调用失败 — 显示错误并退出
        _agentState.messages.push({
          role: 'assistant',
          content: '请求失败: ' + (err.message || '未知错误')
        });
        GobyPanel.appendMessage('bot', '请求失败: ' + (err.message || '未知错误'));
        break;
      }

      // 检查是否有工具调用
      if (response && response.tool_calls) {
        // ★ 将 tool_calls 从对象转为数组（API 要求数组格式）
        var tcArray = [];
        var tcKeys = Object.keys(response.tool_calls);
        for (var j = 0; j < tcKeys.length; j++) {
          tcArray.push(response.tool_calls[tcKeys[j]]);
        }

        // ★ 保存 assistant 的 tool_calls 消息到历史（D-06）
        // 否则后续 tool 结果没有对应的 tool_calls 前驱，API 会报错
        // content 必须为字符串（不能 null），部分 API 对此严格校验
        _agentState.messages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: tcArray
        });

        var results = [];

        for (var j = 0; j < tcArray.length; j++) {
          var tc = tcArray[j];

          // T-03-10: 检查会话总工具调用上限
          if (_agentState.toolCallCounter >= MAX_TOOL_CALLS) {
            results.push({
              tool_call_id: tc.id || '',
              name: tc.function.name || '',
              content: t('tool.max_calls', { n: MAX_TOOL_CALLS })
            });
            break;
          }
          _agentState.toolCallCounter++;

          // 显示工具调用状态指示器（脉冲动画，非干等）
          var toolBadge = null;
          if (window.GobyPanel && typeof window.GobyPanel.appendToolCall === 'function') {
            toolBadge = GobyPanel.appendToolCall(tc.function.name || tc.name || '');
          }

          // 执行工具（带超时和重试）
          var resultContent = await executeWithTimeout({
            id: tc.id,
            type: tc.type || 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          });

          // 更新工具调用状态（✅ 完成 / ❌ 错误）
          if (toolBadge && window.GobyPanel && typeof window.GobyPanel.completeToolCall === 'function') {
            GobyPanel.completeToolCall(toolBadge, resultContent);
          }

          results.push({
            tool_call_id: tc.id || '',
            name: tc.function.name || '',
            content: resultContent
          });
        }

        // 推送工具结果
        pushResultsToMessages(results);

        // Fix BR-2: 工具结果含 navigation started → 主动 break 循环
        // 避免在 navigation 期间继续调 LLM 导致 tool_calls 配对断裂
        // 约定式通用：任何工具结果含 "(navigation started" 都触发 break
        // saveSession 时 isProcessing=true → interrupted=true → 新 page 自动续跑
        var navStarted = false;
        // Phase 8 / D-12 / NAV-08: 扩展 BR-2 — 工具结果含 '(workflow_started' 也触发 break
        // 与 navigation break 不同：workflow break 后**不**自动 resume（不靠 initSession resume
        // 路径），而是等 SW 转发的 workflow_complete/error 消息触发新一次 processAgentMessage
        var workflowStarted = false;
        for (var ni = 0; ni < results.length; ni++) {
          if (typeof results[ni].content === 'string') {
            if (results[ni].content.indexOf('(navigation started') !== -1) {
              navStarted = true;
            }
            if (results[ni].content.indexOf('(workflow_started') !== -1) {
              workflowStarted = true;
            }
          }
          if (navStarted || workflowStarted) break;
        }

        // 同步保存到 storage（避免依赖 beforeunload 异步保存被截断）
        // 通过 window.GobyAgent.saveSession 调用 — 测试可 spy（Plan 03-03 既定模式）
        // 注意：workflow break 仍调 saveSession（持久化当前工具结果），但 workflow 模式
        // 不依赖 interrupted=true 续跑（chat Tab 等 onMessage workflow_complete 触发 resume）
        // Phase 8 fix: await saveSession() 确保 interrupted=true 写入 storage 后才 break。
        //   之前不 await，导航期间 CS 可能被杀，storage 写入来不及 → 新页面读不到
        //   interrupted → 不 resume。SW 侧也有标记（tab-navigate handler），双保险。
        await window.GobyAgent.saveSession();

        if (navStarted) {
          break;
        }
        if (workflowStarted) {
          // Phase 8 / D-12: workflow_started → break 循环，等 SW 转发 workflow_complete 续跑
          // 不自动 resume — workflow 模式靠 onMessage workflow_complete 触发新一次 processAgentMessage
          break;
        }

        loopCount++;

        // 检查是否达到最大轮数
        if (loopCount >= MAX_LOOPS) {
          var limitMsg = '无法完成请求：已达到最大对话轮数（' + MAX_LOOPS + '轮）。请尝试简化指令或分步执行。';
          _agentState.messages.push({ role: 'assistant', content: limitMsg });
          GobyPanel.appendMessage('bot', limitMsg);
          loopExitedByLimit = true;
          // Phase 8 fix (260621-lKk): worker Tab 模式下 MAX_LOOPS 触发必须主动
          //   sendToSW('page-finish-workflow') 把失败 summary 回传 chat Tab，否则
          //   chat Tab 永久卡死等 workflow_complete。worker AI 没机会调工具就
          //   被强制 break，所以 agent loop 必须兜底。
          //   注：summary 用 limitMsg 而非 AI 生成的总结（AI 已被截断）。
          if (window.__gobyWorkflowId) {
            try {
              sendToSW('page-finish-workflow', {
                action: 'page-finish-workflow',
                workflow_id: window.__gobyWorkflowId,
                summary: '⚠️ Worker Tab 达到 MAX_LOOPS=' + MAX_LOOPS + ' 轮被强制停止，任务未完成。建议简化任务或拆分多步。'
              });
            } catch (e) { /* 静默降级 — 不阻塞 break */ }
          }
          break;
        }
      } else {
        // 文本回复 — 已由 handleStreamChunk 完成流式渲染
        var assistantText = (response && response.content) || '';
        // Phase 8 fix: worker Tab 模式下 LLM 纯文本回复不会显示给用户（prompt 已声明），
        //   但某些场景 LLM 仍可能用文本回复而非调 page_finish_workflow。
        //   兜底：拦截文本回复，直接把文本作为 summary 调 page_finish_workflow，
        //   不 push 到 messages（chat Tab 看到的是 [From workflow] 而非本地文本）。
        if (window.__gobyWorkflowId && assistantText) {
          try {
            sendToSW('page-finish-workflow', {
              action: 'page-finish-workflow',
              workflow_id: window.__gobyWorkflowId,
              summary: assistantText
            });
          } catch (e) { /* 静默降级 */ }
          // 仍然 push 文本到 messages——worker AI 完成了一轮对话，保持消息数组一致
          _agentState.messages.push({ role: 'assistant', content: assistantText });
        } else {
          _agentState.messages.push({ role: 'assistant', content: assistantText });
        }
        // 同步保存到 storage（避免依赖 beforeunload 异步保存被截断）
        // 通过 window.GobyAgent.saveSession 调用 — 测试可 spy（Plan 03-03 既定模式）
        window.GobyAgent.saveSession();
        break;
      }
    }

    // Phase 9: 自动技能生成 — 每 8 次工具调用后检查是否有可提炼的操作模式
    if (_agentState._autoSkillCounter >= 8) {
      _agentState._autoSkillCounter = 0;
      _maybeAutoCreateSkill();
    }

    // 清理状态
    _agentState.isProcessing = false;
    _agentState.stopRequested = false;
    _agentState.connectionStatus = 'gray';
    GobyPanel.updateConnectionStatus('gray');
    // Phase 8: 恢复发送按钮（➤）
    if (window.GobyPanel && typeof window.GobyPanel.setAgentRunning === 'function') {
      window.GobyPanel.setAgentRunning(false);
    }
    // Phase 03 UAT 测试 4：保留会话累计轮数（_agentState.roundCount），不再重置为 0
    GobyPanel.updateRoundCount(_agentState.roundCount);

    // 恢复输入框
    if (GobyPanel._inputEl) GobyPanel._inputEl.disabled = false;
    if (GobyPanel._sendBtn) GobyPanel._sendBtn.disabled = false;
  }

  /**
   * sendMessage — 用户消息主入口
   * @param {string} userText
   */
  function sendMessage(userText) {
    if (_agentState.isProcessing) return;
    if (!userText || !userText.trim()) return;

    // Plan 03-02: 委托 processAgentMessage 执行 Agent 循环
    processAgentMessage(userText);
  }

  /**
   * handleStreamChunk — 接收 SW 转发的 stream-chunk 事件
   * @param {{type: string, content?: string, done?: boolean, error?: object, tool_calls?: Array}} data
   */
  function handleStreamChunk(data) {
    if (!data) return;

    // 错误处理
    if (data.type === 'error') {
      _agentState.connectionStatus = 'red';
      GobyPanel.updateConnectionStatus('red');
      GobyPanel.updateStatusBar({ connectionStatus: 'red' });

      var errMsg = data.error ? data.error.message : '未知错误';

      // Agent 循环模式：只 reject，由 processAgentMessage 的 catch 块统一 appendMessage
      // （否则会双重显示 — Phase 03 UAT 测试 11 子问题 3）
      if (_streamReject) {
        _streamReject(new Error(errMsg));
        _streamReject = null;
        _streamResolve = null;
      } else {
        // 简单流模式：没有上层 catch，这里负责显示
        GobyPanel.appendMessage('bot', '请求失败: ' + errMsg);
        _agentState.isProcessing = false;
        if (GobyPanel._inputEl) GobyPanel._inputEl.disabled = false;
      }
      return;
    }

    // 流完成
    if (data.done) {
      _agentState.connectionStatus = 'gray';
      GobyPanel.updateConnectionStatus('gray');

      if (window.GobyPanel && typeof window.GobyPanel.appendStreamingChunk === 'function') {
        window.GobyPanel.appendStreamingChunk(data.content || '', true);
      }

      // Agent 循环模式：resolve stream promise with response
      if (_streamResolve) {
        var message = data.message || {};
        _streamResolve({
          content: message.content || data.content || '',
          tool_calls: message.tool_calls || null
        });
        _streamResolve = null;
        _streamReject = null;
      } else {
        // 简单流模式（非 agent 循环）：直接更新消息历史
        _agentState.messages.push({ role: 'assistant', content: data.content || '' });

        // 恢复输入框
        if (GobyPanel._inputEl) {
          GobyPanel._inputEl.disabled = false;
        }
      }
      return;
    }

    // 文字 chunk — stream 到气泡
    if (data.type === 'text' && data.content) {
      if (window.GobyPanel && typeof window.GobyPanel.appendStreamingChunk === 'function') {
        window.GobyPanel.appendStreamingChunk(data.content, false);
      }
      return;
    }

    // 工具调用 chunk（流式 tool_calls 累加 — 由 SW 侧完成累加
    // 最终通过 done 消息的 message.tool_calls 传递完整数组）
    if (data.type === 'tool_calls') {
      // SW 已经完成了 tool_calls 累加，CS 侧只需等待 done 消息
      return;
    }
  }

  // ================================================================
  //  测试用内部状态访问（仅在测试环境使用）
  // ================================================================

  window.__gobyInternals = {
    _agentState: _agentState,
    _toolCallCounter: function () { return _agentState.toolCallCounter; },
    setToolCallCounter: function (n) { _agentState.toolCallCounter = n; },
    getToolCallFailCounts: function () { return _toolCallFailCounts; },
    setMaxLoops: function (n) { MAX_LOOPS = n; },
    sessionIdForOrigin: sessionIdForOrigin,
    saveSession: saveSession,
    cleanupOldSessions: cleanupOldSessions,
    getAllSessions: getAllSessions,
    // 260620-i08: 暴露内部消息状态机函数供 jest 测试访问
    enforceMessageLimit: enforceMessageLimit,
    sanitizeMessages: sanitizeMessages,
    // Plan 09-02: 技能工具注册
    _activeSkillTools: _activeSkillTools,
    registerSkillTools: registerSkillTools,
    unregisterSkillTools: unregisterSkillTools,
    _autoRegisterSkills: _autoRegisterSkills,
    _domainMatchesSkill: _domainMatchesSkill,
    // Plan 09-03: 内置技能预装
    _preloadBuiltinSkills: _preloadBuiltinSkills,
    // Auto-skill: 自动技能生成
    _pushResultsToMessages: pushResultsToMessages,
    _maybeAutoCreateSkill: _maybeAutoCreateSkill,
    _callLLM: callLLM
  };

  // 暴露 GobyAgent 到全局
  window.GobyAgent = {
    sendMessage: sendMessage,
    callLLMStream: callLLMStream,
    callLLM: callLLM,
    renderMarkdown: renderMarkdown,
    getFallbackContent: getFallbackContent,
    handleStreamChunk: handleStreamChunk,
    processAgentMessage: processAgentMessage,
    nativeTools: nativeTools,
    estimateTokens: estimateTokens,
    compactConversationAsync: compactConversationAsync,
    getSystemPrompt: getSystemPrompt,
    MAX_LOOPS: MAX_LOOPS,
    // Session management (Plan 03-03)
    sessionIdForOrigin: sessionIdForOrigin,
    createSession: createSession,
    saveSession: saveSession,
    loadSession: loadSession,
    loadSessionById: loadSessionById,
    listSessionsForOrigin: listSessionsForOrigin,
    getAllSessions: getAllSessions,
    deleteSession: deleteSession,
    deleteAllSessions: deleteAllSessions,
    cleanupOldSessions: cleanupOldSessions,
    switchToSession: switchToSession,
    // Fix BR: 暴露 initSession 供 jest 测试验证 resume 触发
    initSession: initSession,
    // Phase 8: 停止按钮 — 用户点击停止后 agent loop 检查此标志退出
    stopAgent: function () {
      _agentState.stopRequested = true;
    },
    isStopRequested: function () {
      return _agentState.stopRequested === true;
    },
    // Skills management (Plan 09-01 + 09-02 + 09-04)
    importSkill: importSkill,
    listSkills: listSkills,
    removeSkill: removeSkill,
    toggleSkill: function (domain, enabled) {
      return GobyStorage.toggleSkill(domain, enabled);
    },
    registerSkillTools: registerSkillTools,
    unregisterSkillTools: unregisterSkillTools,
    _activeSkillTools: _activeSkillTools,
    getState: function () {
      return {
        messages: _agentState.messages.slice(),
        isProcessing: _agentState.isProcessing,
        connectionStatus: _agentState.connectionStatus,
        activeOrigin: _agentState.activeOrigin,
        sessionId: _agentState.sessionId
      };
    }
  };

  // 向后兼容：SYSTEM_PROMPT 属性作为 getter 返回当前语言版本
  Object.defineProperty(window.GobyAgent, 'SYSTEM_PROMPT', {
    get: function () { return getSystemPrompt(); },
    configurable: true
  });

  // ---- Plan 03-03: 会话初始化 + URL 变化监听 ----
  // Phase 03 UAT 测试 5：initSession 由 GobyPanel.init().then() 触发（不再立即调用）
  // 这样 loadSession 完成时面板已就绪，能正确渲染历史消息
  // Fix BR: loadSession 完成后检查 session.interrupted —— 若 60s 内被打断的 Agent 循环
  // 自动以 resume 模式续跑（不 push 新 user 消息、不增 roundCount）
  function initSession() {
    var origin = window.location.origin;
    // 同步创建会话（Plan 要求：createSession 初始化首个会话）
    createSession(origin);
    // 异步尝试加载已保存会话（loadSession 会替换初始创建）
    loadSession(origin).then(function (session) {
      if (session) {
        // 优先检查：当前 session 自身的 interrupted 标记
        if (session.interrupted === true &&
            session.interruptedAt && Date.now() - session.interruptedAt < 60000) {
          // 先注册技能工具再 resume（否则 agent 第一轮看不到 skill 工具）
          _autoRegisterSkills();
          window.GobyAgent.processAgentMessage(null, { resume: true });
          return null;
        }
        // 检查是否从其他 origin 的 page_navigate 跳过来
        // （当前 session 存在但未被中断，可能是之前正常访问留下的旧 session）
        return chrome.storage.local.get('lastActiveSessions').then(function (lasResult) {
          var lasEntries = lasResult.lastActiveSessions || [];
          for (var lei = 0; lei < lasEntries.length; lei++) {
            if (lasEntries[lei].origin === origin) continue;
            // 找到最近一条非当前 origin 的记录
            return chrome.storage.local.get('gobySessions').then(function (gsResult) {
              var gsSessions = gsResult.gobySessions || {};
              var crossSession = gsSessions[lasEntries[lei].sessionId];
              if (crossSession && crossSession.navigatedByAgent === true &&
                  crossSession.interruptedAt && Date.now() - crossSession.interruptedAt < 60000) {
                _autoRegisterSkills();
                window.GobyAgent.processAgentMessage(null, { resume: true });
              }
              return null;
            });
          }
          return null;
        });
      }

      // D-01: 新 origin 无 session → 跨域继承最近他域 session 的最后 5 条 messages
      // 失败应静默降级，不影响 createSession 已建立的空 session
      // 注：不直接调 loadSessionById — 那会副作用式覆盖 _agentState（破坏当前 session）
      return chrome.storage.local.get('lastActiveSessions').then(function (result) {
        var entries = result.lastActiveSessions || [];
        // 找第一条非当前 origin 的记录（索引按 updatedAt desc 排序，最近在前）
        var crossEntry = null;
        for (var ei = 0; ei < entries.length; ei++) {
          if (entries[ei].origin !== origin) {
            crossEntry = entries[ei];
            break;
          }
        }
        if (!crossEntry) {
          return null;
        }
        // 只读拉取他域 session 数据（不污染当前 _agentState）
        return chrome.storage.local.get('gobySessions').then(function (sessResult) {
          var allSessions = sessResult.gobySessions || {};
          var loaded = allSessions[crossEntry.sessionId];
          if (!loaded || !Array.isArray(loaded.messages) || loaded.messages.length === 0) {
            return null;
          }
          // 只在源 session 被导航打断时（interrupted=true）才继承上下文。
          // 用户手动打开新页面时源 session 的 interrupted=false，不应导入其他对话信息。
          // 只在源 session 被 page_navigate 打断时才继承上下文。
          // navigatedByAgent 区分 page_navigate（agent 导航）和手工打开/停止 agent
          if (loaded.interrupted !== true || loaded.navigatedByAgent !== true) {
            return null;
          }
          // D-04: 取最后 5 条（slice(-5)），并在前面插入 user-role marker
          // marker 用 user-role 而非 system-role 避免污染 LLM
          var inherited = loaded.messages.slice(-5);
          _agentState.messages.push({
            role: 'user',
            content: '[Context inherited from ' + crossEntry.origin + ']'
          });
          for (var ii = 0; ii < inherited.length; ii++) {
            _agentState.messages.push(inherited[ii]);
          }
          // 渲染 marker 与 inherited 消息到面板（跳过 system prompt）
          if (window.GobyPanel && typeof window.GobyPanel.appendMessage === 'function') {
            for (var ri = 0; ri < _agentState.messages.length; ri++) {
              var msg = _agentState.messages[ri];
              if (msg.role === 'system') continue;
              var panelRole = msg.role;
              if (panelRole === 'assistant') panelRole = 'bot';
              if (panelRole === 'tool') {
                var isError = typeof msg.content === 'string' && msg.content.startsWith('Error:');
                panelRole = isError ? 'tool-error' : 'tool';
              }
              window.GobyPanel.appendMessage(panelRole, msg.content);
            }
          }
          // Phase 8 fix: 跨域 resume — 仅当源 session 的最后一次中断是从
          //   page_navigate 来的（非 page_open_tab workflow break）。
          //   区分方式：找源 session **最后一条** tool message，看它的内容。
          //   '(workflow:' / '(workflow_started' → workflow break，不 resume。
          //   '(navigation started' → navigation break，要 resume。
          if (loaded.interrupted === true &&
              loaded.interruptedAt && Date.now() - loaded.interruptedAt < 60000) {
            var isWorkflowInterrupted = false;
            for (var wj = loaded.messages.length - 1; wj >= 0; wj--) {
              var wm = loaded.messages[wj];
              if (wm && wm.role === 'tool' && typeof wm.content === 'string') {
                if (wm.content.indexOf('(workflow:') !== -1 || wm.content.indexOf('(workflow_started') !== -1) {
                  isWorkflowInterrupted = true;
                }
                break; // 只看最后一条 tool message
              }
            }
            if (!isWorkflowInterrupted) {
              _autoRegisterSkills();
              window.GobyAgent.processAgentMessage(null, { resume: true });
            }
          }
          // 持久化（让 SW 把当前 session 加入 lastActiveSessions 索引）
          saveSession();
          return inherited;
        });
      });
    }).catch(function () {
      // 跨域拉取失败（storage 错误等）— 静默降级，保留 createSession 的空 session
    }).then(function () {
      // Plan 09-02: 自动注册当前域名的技能工具
      _autoRegisterSkills();
    });
  }

  /**
   * _autoRegisterSkills — 为当前 hostname 自动注册匹配的技能工具
   * 支持子域名通配：amazon.com 自动匹配 www.amazon.com
   */
  function _autoRegisterSkills() {
    var hostname = window.location.hostname;
    console.log('[skill] _autoRegisterSkills hostname:', hostname);
    if (!hostname) return;

    // 先尝试精确匹配
    GobyStorage.getSkill(hostname).then(function (skill) {
      console.log('[skill] getSkill(' + hostname + '):', skill ? 'found' : 'not found');
      if (skill && Array.isArray(skill.actions) && skill.actions.length > 0) {
        return registerSkillTools(hostname);
      }
      // 尝试子域名通配匹配
      return GobyStorage.getAllSkills().then(function (allSkills) {
        var domains = Object.keys(allSkills);
        for (var i = 0; i < domains.length; i++) {
          if (_domainMatchesSkill(hostname, domains[i])) {
            // 使用 skill 存储的 domain 作为 key 注册
            return registerSkillTools(domains[i]);
          }
        }
        return 0;
      });
    }).catch(function () {
      // storage 读取失败 — 静默降级
    });
  }

  /**
   * _domainMatchesSkill — 检查 hostname 是否匹配 skill domain
   * 支持子域名通配：amazon.com 匹配 www.amazon.com，但不匹配 notamazon.com
   * @param {string} host - 当前 hostname (e.g., "www.amazon.com")
   * @param {string} skillDomain - skill 声明的 domain (e.g., "amazon.com")
   * @returns {boolean}
   */
  function _domainMatchesSkill(host, skillDomain) {
    if (!host || !skillDomain) return false;
    return host === skillDomain || host.indexOf('.' + skillDomain, host.length - skillDomain.length - 1) !== -1;
  }

  /**
   * _maybeAutoCreateSkill — 检查是否可以从当前会话提炼可复用的网站技能
   * 筛选最近 20 条消息中的 tool call 模式 → LLM 生成 SKILL.md → 保存
   */
  function _maybeAutoCreateSkill() {
    var domain = window.location.hostname;
    if (!domain) return Promise.resolve();

    // 检查该 domain 是否已有技能（避免重复创建）
    return GobyStorage.getSkill(domain).then(function (existing) {
      if (existing) { return; } // 已有技能，跳过

      // 收集最近 20 条非 system 消息
      var recentMsgs = _agentState.messages.slice(-20);
      var toolCalls = [];
      for (var i = 0; i < recentMsgs.length; i++) {
        var m = recentMsgs[i];
        if (m.role === 'assistant' && m.tool_calls) {
          var tcs = Array.isArray(m.tool_calls) ? m.tool_calls : [];
          for (var t = 0; t < tcs.length; t++) {
            toolCalls.push(tcs[t].function ? tcs[t].function.name : '');
          }
        }
      }
      var uniqueTools = [];
      for (var u = 0; u < toolCalls.length; u++) {
        if (uniqueTools.indexOf(toolCalls[u]) === -1) uniqueTools.push(toolCalls[u]);
      }

      // 只对有明显页面操作模式的 domain 生成技能（至少用到 DOM 操作工具）
      var domTools = ['page_fill', 'page_click', 'page_submit', 'page_query', 'page_list_elements', 'page_evaluate', 'page_wait'];
      var hasDomOps = false;
      for (var d = 0; d < uniqueTools.length; d++) {
        if (domTools.indexOf(uniqueTools[d]) !== -1) { hasDomOps = true; break; }
      }
      if (!hasDomOps) return;

      // 构建 LLM 提示：从工具调用历史提取操作模式，生成 SKILL.md
      var historyLines = [];
      for (var h = 0; h < recentMsgs.length; h++) {
        var hm = recentMsgs[h];
        var role = hm.role;
        var content = '';
        if (hm.tool_calls) {
          var tcnames = [];
          var atcs = Array.isArray(hm.tool_calls) ? hm.tool_calls : [];
          for (var tc = 0; tc < atcs.length; tc++) {
            tcnames.push(atcs[tc].function ? atcs[tc].function.name : '?');
          }
          content = '[调用工具: ' + tcnames.join(', ') + ']';
        } else if (hm.content) {
          content = (typeof hm.content === 'string' ? hm.content : '').substring(0, 200);
        }
        if (content) historyLines.push(role + ': ' + content);
      }

      var prompt = [
        { role: 'system', content: '你是一个技能生成器。根据用户在网站上的操作历史，生成一个 browsing-skills 格式的 SKILL.md 文件。只输出 SKILL.md 内容，不要解释。' },
        { role: 'user', content: '网域: ' + domain + '\n\n操作历史：\n' + historyLines.join('\n') + '\n\n请基于这些操作生成一个可复用的技能。格式要求：\n---\nname: <技能名>\ndescription: <描述>\ndomain: ' + domain + '\n---\n\n## <action名>\nDescription: <描述>\nInput: <JSON schema>\n```javascript\nfunction(params) { ... return { content: [{ type: "text", text: result }] }; }\n```\n\n要求：\n1. 提取 1-3 个核心操作模式\n2. JavaScript 用 var 不用 let/const\n3. 使用通用的 DOM 选择器（避免过于具体的 class/id）\n4. Input schema 用标准 JSON Schema 格式' }
      ];

      return callLLM(prompt);
    }).then(function (response) {
      if (!response || !response.choices) return;
      var content = response.choices[0].message.content;
      if (!content) return;

      // 提取 SKILL.md 内容（去除可能的 markdown 代码块包裹）
      var md = content.replace(/^```(?:markdown)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
      if (md.indexOf('---') !== 0) return; // 不是有效的 SKILL.md

      try {
        var parsed = SkillLoader.parseSkillMarkdown(md);
        var validation = SkillLoader.validateSkill(parsed);
        if (validation.valid) {
          return GobyStorage.saveSkill(validation.skillManifest.domain, {
            name: validation.skillManifest.name,
            description: validation.skillManifest.description,
            domain: validation.skillManifest.domain,
            actions: validation.skillManifest.actions,
            source: 'auto'
          }).then(function () {
            GobyPanel.appendMessage('bot', '🤖 已为 ' + domain + ' 自动创建技能（' + validation.skillManifest.actions.length + ' 个操作）。下次访问自动加载。');
          });
        }
      } catch (e) {
        // 生成失败 — 静默降级
      }
    }).catch(function () {
      // 静默降级
    });
  }

  // URL 变化监听 (SESS-01, D-16)
  window.addEventListener('popstate', handleUrlChange);
  window.addEventListener('hashchange', handleUrlChange);
  window.addEventListener('beforeunload', function () {
    saveSession();
  });

})();
