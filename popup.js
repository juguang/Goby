// Goby - AI 浏览器助手 | Popup 弹窗交互逻辑
// Plan 01-02: 多 Profile CRUD 交互 — 新增/切换/编辑/删除

(function () {
  'use strict';

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
   * 校验 API Base URL 必须是合法的 http(s):// URL
   * @param {string} str
   * @returns {boolean}
   */
  function isValidHttpUrl(str) {
    if (!str) return false;
    if (!/^https?:\/\//i.test(str)) return false;
    try {
      var u = new URL(str);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  /**
   * 校验 API Key 必须是纯 ASCII（防止 fetch headers 抛 ISO-8859-1 异常）
   * @param {string} str
   * @returns {boolean}
   */
  function isPureAscii(str) {
    return /^[\x00-\x7F]*$/.test(str);
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
      emptyOption.textContent = '暂无配置';
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
   * 初始化 — 加载 profiles 并填充 UI
   */
  function initPopup() {
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
      showToast('已切换到 ' + selectedName, 'success', 1500);
    }).catch(function (err) {
      showToast('切换失败: ' + (err.message || '未知错误'), 'error', 2000);
    });
  });

  // ---- 添加 Profile ----
  btnAddProfile.addEventListener('click', function () {
    var name = prompt('请输入新的 API 配置名称：');
    if (!name || name.trim() === '') return;

    name = name.trim();

    // 检查是否已存在
    if (currentProfiles[name]) {
      alert('配置名称已存在');
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
      showToast('添加失败: ' + (err.message || '未知错误'), 'error', 2000);
    });
  });

  // ---- 保存配置（保存当前 Profile 的编辑） ----
  saveBtn.addEventListener('click', function () {
    console.log('[Goby popup] saveBtn clicked');
    var selectedName = profileSelect.value;
    if (!selectedName || !currentProfiles[selectedName]) return;

    var config = {
      baseUrl: baseUrlInput.value.trim(),
      apiKey: apiKeyInput.value,
      model: modelInput.value.trim()
    };

    // Phase 01 测试 7：URL 必须是 http(s):// 协议
    if (!isValidHttpUrl(config.baseUrl)) {
      showToast('API Base URL 必须以 http:// 或 https:// 开头且为合法 URL', 'error', 3000);
      baseUrlInput.focus();
      return;
    }

    // Phase 03 测试 11-4 follow_up：API Key 必须纯 ASCII（防御）
    if (!isPureAscii(config.apiKey)) {
      showToast('API Key 包含非法字符（仅允许英文/数字/符号，不可含中文或全角字符）', 'error', 3000);
      apiKeyInput.focus();
      return;
    }

    GobyStorage.saveProfile(selectedName, config).then(function () {
      // 更新本地缓存
      currentProfiles[selectedName] = {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model
      };
      showToast('已保存', 'success', 2000);
    }).catch(function (err) {
      showToast('保存失败: ' + (err.message || '未知错误'), 'error', 2000);
    });
  });

  // ---- 编辑当前 Profile（Phase 01 测试 5：btnEditProfile 之前无 click handler） ----
  // 设计：当前 profile 的字段已显示在表单中，编辑按钮的作用是聚焦到表单顶部让用户开始修改
  btnEditProfile.addEventListener('click', function () {
    console.log('[Goby popup] btnEditProfile clicked, disabled=', btnEditProfile.disabled);
    var selectedName = profileSelect.value;
    console.log('[Goby popup] edit: selectedName=', selectedName, 'profile=', currentProfiles[selectedName]);
    if (!selectedName || !currentProfiles[selectedName]) return;
    loadProfileForm(selectedName);
    baseUrlInput.focus();
    baseUrlInput.select();
    showToast('编辑「' + selectedName + '」', 'success', 1500);
  });

  // ---- 删除 Profile ----
  btnDeleteProfile.addEventListener('click', function () {
    var selectedName = profileSelect.value;
    if (!selectedName || !currentProfiles[selectedName]) return;

    if (!confirm('确定删除「' + selectedName + '」吗？此操作不可撤销。')) {
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
      showToast('已删除 ' + selectedName, 'error', 1500);
    }).catch(function (err) {
      showToast('删除失败: ' + (err.message || '未知错误'), 'error', 2000);
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

  // ---- 面板开关（POPUP-03） ----
  var panelToggle = document.getElementById('panelToggle');
  if (panelToggle) {
    // 初始化时检查当前页面面板状态
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || tabs.length === 0) return;
      try {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'get-panel-state' }, function (response) {
          if (chrome.runtime.lastError) {
            // 内容脚本尚未注入（如新页面或 chrome:// 页面）
            panelToggle.checked = false;
            return;
          }
          if (response && typeof response.isVisible === 'boolean') {
            panelToggle.checked = response.isVisible;
          }
        });
      } catch (e) {
        panelToggle.checked = false;
      }
    });

    panelToggle.addEventListener('change', function () {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs || tabs.length === 0) return;
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'toggle-panel',
          visible: panelToggle.checked
        }, function () {
          if (chrome.runtime.lastError) {
            showToast('请刷新页面后重试', 'error', 2000);
            // 回滚开关状态
            panelToggle.checked = !panelToggle.checked;
          }
        });
      });
    });
  }

})();
