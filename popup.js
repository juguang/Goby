// Goby - AI 浏览器助手 | Popup 弹窗交互逻辑
// Plan 01-02: 多 Profile CRUD 交互 — 新增/切换/编辑/删除

(function () {
  'use strict';

  // i18n 翻译函数引用
  var t = window.GobyI18n ? window.GobyI18n.t : function (k, p) { return k; };

  var baseUrlInput = document.getElementById('baseUrl');
  var apiKeyInput = document.getElementById('apiKey');
  var modelInput = document.getElementById('model');
  var saveBtn = document.getElementById('saveBtn');
  var saveStatus = document.getElementById('saveStatus');
  var eyeToggle = document.getElementById('eyeToggle');
  var profileSelect = document.getElementById('profile-select');
  var btnAddProfile = document.getElementById('btn-add-profile');
  var btnEditProfile = document.getElementById('btn-edit-profile');
  var btnDeleteProfile = document.getElementById('btn-delete-profile');
  var emptyState = document.getElementById('emptyState');
  var formSection = document.getElementById('formSection');

  var currentProfiles = {};
  var currentActiveProfile = '';

  /**
   * 显示 Toast 消息（用于切换/删除反馈）
   * @param {string} message
   * @param {string} type - 'success' 或 'error'
   * @param {number} duration - 显示时长 ms
   */
  function showToast(message, type, duration) {
    duration = duration || 1500;
    saveStatus.textContent = message;
    saveStatus.className = 'visible ' + type;
    saveStatus.style.opacity = '1';

    setTimeout(function () {
      saveStatus.style.opacity = '0';
      setTimeout(function () {
        saveStatus.className = '';
        saveStatus.style.opacity = '';
      }, 300);
    }, duration);
  }

  /**
   * 渲染 Profile 下拉选择器
   */
  function renderProfileSelector() {
    var names = Object.keys(currentProfiles);
    profileSelect.innerHTML = '';

    if (names.length === 0) {
      var emptyOption = document.createElement('option');
      emptyOption.disabled = true;
      emptyOption.textContent = t('popup.select_empty');
      profileSelect.appendChild(emptyOption);
    } else {
      names.forEach(function (name) {
        var option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        profileSelect.appendChild(option);
      });
    }

    // 设置当前选中值
    if (currentActiveProfile && currentProfiles[currentActiveProfile]) {
      profileSelect.value = currentActiveProfile;
    }

    // 更新按钮状态
    var hasProfiles = names.length > 0;
    btnEditProfile.disabled = !hasProfiles;
    btnDeleteProfile.disabled = !hasProfiles;
  }

  /**
   * 将指定 Profile 的配置加载到表单
   * @param {string} name
   */
  function loadProfileForm(name) {
    var profile = currentProfiles[name];
    if (!profile) {
      baseUrlInput.value = '';
      apiKeyInput.value = '';
      modelInput.value = '';
      return;
    }
    baseUrlInput.value = profile.baseUrl || '';
    apiKeyInput.value = profile.apiKey || '';
    modelInput.value = profile.model || '';
  }

  /**
   * 更新空状态和表单区域的显示
   */
  function updateVisibility() {
    var hasProfiles = Object.keys(currentProfiles).length > 0;
    if (hasProfiles) {
      emptyState.classList.remove('visible');
      formSection.classList.remove('hidden');
    } else {
      emptyState.classList.add('visible');
      formSection.classList.add('hidden');
    }
  }

  /**
   * 刷新所有 UI 状态（选择器、表单、可见性）
   */
  function refreshUI() {
    renderProfileSelector();
    updateVisibility();

    if (Object.keys(currentProfiles).length > 0) {
      var active = currentActiveProfile && currentProfiles[currentActiveProfile]
        ? currentActiveProfile
        : Object.keys(currentProfiles)[0];
      loadProfileForm(active);
    }
  }

  /**
   * 翻译 popup.html 静态文本元素（在 JS 逻辑之前执行）
   */
  function translatePopupUI() {
    var titleEl = document.querySelector('.title');
    if (titleEl) titleEl.textContent = t('popup.title');
    var profileLabel = document.querySelector('.profile-header .profile-label');
    if (profileLabel) profileLabel.textContent = t('popup.profile_label');
    var emptyTitle = document.querySelector('.empty-title');
    if (emptyTitle) emptyTitle.textContent = t('popup.empty_title');
    var emptyBody = document.querySelector('.empty-body');
    if (emptyBody) emptyBody.textContent = t('popup.empty_body');
    var addBtn = document.getElementById('btn-add-profile');
    if (addBtn) addBtn.title = t('popup.add_btn_title');
    var editBtn = document.getElementById('btn-edit-profile');
    if (editBtn) editBtn.title = t('popup.edit_btn_title');
    var deleteBtn = document.getElementById('btn-delete-profile');
    if (deleteBtn) deleteBtn.title = t('popup.delete_btn_title');
    var saveBtnEl = document.getElementById('saveBtn');
    if (saveBtnEl) saveBtnEl.textContent = t('popup.save_btn');
    var toggleLabel = document.querySelector('.panel-toggle-label');
    if (toggleLabel) toggleLabel.textContent = t('modal.autostart_label');
    var eyeToggleEl = document.getElementById('eyeToggle');
    if (eyeToggleEl) eyeToggleEl.title = t('popup.eye_toggle_title');
    var baseUrlPlaceholder = document.getElementById('baseUrl');
    if (baseUrlPlaceholder) baseUrlPlaceholder.placeholder = t('popup.placeholder_base_url');
    var modelPlaceholder = document.getElementById('model');
    if (modelPlaceholder) modelPlaceholder.placeholder = t('popup.placeholder_model');
  }

  /**
   * 初始化 — 加载 profiles 并填充 UI
   */
  function initPopup() {
    // 先翻译静态 UI 文本
    translatePopupUI();

    // 当前不阻塞 UI 加载
    var profilesPromise = GobyStorage.getProfiles();
    var activePromise = GobyStorage.getActiveProfile();

    Promise.all([profilesPromise, activePromise]).then(function (results) {
      currentProfiles = results[0] || {};
      currentActiveProfile = results[1] || '';
      refreshUI();
    }).catch(function () {
      // 读取失败 — 保持空状态
      currentProfiles = {};
      currentActiveProfile = '';
      refreshUI();
    });
  }

  // DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopup);
  } else {
    initPopup();
  }

  // ---- Profile 切换（select onchange） ----
  profileSelect.addEventListener('change', function () {
    var selectedName = profileSelect.value;
    if (!selectedName || !currentProfiles[selectedName]) return;

    GobyStorage.setActiveProfile(selectedName).then(function () {
      currentActiveProfile = selectedName;
      loadProfileForm(selectedName);
      showToast(t('popup.toast_switch_success', { name: selectedName }), 'success', 1500);
    }).catch(function (err) {
      showToast(t('popup.toast_switch_fail', { msg: err.message || '未知错误' }), 'error', 2000);
    });
  });

  // ---- 添加 Profile ----
  btnAddProfile.addEventListener('click', function () {
    var name = prompt(t('popup.toast_add_prompt'));
    if (!name || name.trim() === '') return;

    name = name.trim();

    // 检查是否已存在
    if (currentProfiles[name]) {
      alert(t('modal.add_duplicate'));
      return;
    }

    GobyStorage.saveProfile(name, {
      baseUrl: '',
      apiKey: '',
      model: ''
    }).then(function () {
      currentProfiles[name] = { baseUrl: '', apiKey: '', model: '' };
      currentActiveProfile = name;
      refreshUI();
      // 聚焦 Base URL 以便用户立即填写
      baseUrlInput.focus();
    }).catch(function (err) {
      showToast(t('popup.toast_add_fail', { msg: err.message || '未知错误' }), 'error', 2000);
    });
  });

  // ---- 保存配置（保存当前 Profile 的编辑） ----
  saveBtn.addEventListener('click', function () {
    var selectedName = profileSelect.value;
    if (!selectedName || !currentProfiles[selectedName]) return;

    var config = GobyFormHelpers.buildProfileConfigFromForm(
      baseUrlInput.value,
      apiKeyInput.value,
      modelInput.value
    );

    var v = GobyFormHelpers.validateProfileConfig(config);
    if (!v.ok) {
      showToast(v.message, 'error', 3000);
      if (v.field === 'baseUrl') baseUrlInput.focus();
      else if (v.field === 'apiKey') apiKeyInput.focus();
      return;
    }

    GobyStorage.saveProfile(selectedName, config).then(function () {
      // 更新本地缓存
      currentProfiles[selectedName] = {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model
      };
      showToast(t('popup.toast_save_success'), 'success', 2000);
    }).catch(function (err) {
      showToast(t('popup.toast_save_fail', { msg: err.message || '未知错误' }), 'error', 2000);
    });
  });

  // ---- 编辑当前 Profile（Phase 01 测试 5：btnEditProfile 之前无 click handler） ----
  // 设计：当前 profile 的字段已显示在表单中，编辑按钮的作用是聚焦到表单顶部让用户开始修改
  btnEditProfile.addEventListener('click', function () {
    var selectedName = profileSelect.value;
    if (!selectedName || !currentProfiles[selectedName]) return;
    loadProfileForm(selectedName);
    baseUrlInput.focus();
    baseUrlInput.select();
    showToast(t('modal.edit_hint', { name: selectedName }), 'success', 1500);
  });

  // ---- 删除 Profile ----
  btnDeleteProfile.addEventListener('click', function () {
    var selectedName = profileSelect.value;
    if (!selectedName || !currentProfiles[selectedName]) return;

    if (!confirm(t('popup.toast_delete_confirm', { name: selectedName }))) {
      return;
    }

    GobyStorage.deleteProfile(selectedName).then(function (updatedProfiles) {
      var wasActive = currentActiveProfile === selectedName;

      // 更新本地缓存
      delete currentProfiles[selectedName];

      // 若删除的是 active，自动切换
      if (wasActive) {
        var remaining = Object.keys(currentProfiles);
        currentActiveProfile = remaining.length > 0 ? remaining[0] : '';
      }

      refreshUI();
      showToast(t('popup.toast_delete_success', { name: selectedName }), 'error', 1500);
    }).catch(function (err) {
      showToast(t('popup.toast_delete_fail', { msg: err.message || '未知错误' }), 'error', 2000);
    });
  });

  // ---- API Key 眼睛切换（保留 Plan 01-01） ----
  eyeToggle.addEventListener('click', function () {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      eyeToggle.innerHTML = '&#x1F648;'; // 🙈
    } else {
      apiKeyInput.type = 'password';
      eyeToggle.innerHTML = '&#x1F441;'; // 👁
    }
  });

  // ---- 启动时自动展开面板开关（与 modal 端 gobyPanelState.autoStart 同步） ----
  var panelToggle = document.getElementById('panelToggle');
  if (panelToggle) {
    // 初始化：从 storage 读取 autoStart
    chrome.storage.local.get(['gobyPanelState'], function (result) {
      var panelState = result.gobyPanelState || {};
      panelToggle.checked = panelState.autoStart === true;
    });

    // 切换时写入 storage（与 content-script.js:553-559 modal-autoStart 的写法对齐）
    panelToggle.addEventListener('change', function () {
      chrome.storage.local.get(['gobyPanelState'], function (result) {
        var panelState = result.gobyPanelState || {};
        panelState.autoStart = panelToggle.checked;
        chrome.storage.local.set({ gobyPanelState: panelState }, function () {
          showToast(panelToggle.checked ? t('popup.toast_auto_expand_on') : t('popup.toast_auto_expand_off'), 'success', 1500);
        });
      });
    });
  }

})();
