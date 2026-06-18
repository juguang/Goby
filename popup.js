// Goby - AI 浏览器助手 | Popup 弹窗交互逻辑

(function () {
  'use strict';

  var baseUrlInput = document.getElementById('baseUrl');
  var apiKeyInput = document.getElementById('apiKey');
  var modelInput = document.getElementById('model');
  var saveBtn = document.getElementById('saveBtn');
  var saveStatus = document.getElementById('saveStatus');
  var eyeToggle = document.getElementById('eyeToggle');

  /**
   * 显示保存反馈
   * @param {string} message
   * @param {string} type - 'success' 或 'error'
   */
  function showStatus(message, type) {
    saveStatus.textContent = message;
    saveStatus.className = 'visible ' + type;
    saveStatus.style.opacity = '1';

    if (type === 'success') {
      // 2 秒后淡出
      setTimeout(function () {
        saveStatus.style.opacity = '0';
        setTimeout(function () {
          saveStatus.className = '';
          saveStatus.style.opacity = '';
        }, 300);
      }, 2000);
    }
  }

  // DOM 加载完成后，从 storage 恢复配置
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadConfig);
  } else {
    loadConfig();
  }

  function loadConfig() {
    GobyStorage.getConfig().then(function (config) {
      baseUrlInput.value = config.baseUrl || '';
      apiKeyInput.value = config.apiKey || '';
      modelInput.value = config.model || '';
    }).catch(function () {
      // storage 读取失败 — 留空即可
    });
  }

  // 保存按钮点击
  saveBtn.addEventListener('click', function () {
    var config = {
      baseUrl: baseUrlInput.value.trim(),
      apiKey: apiKeyInput.value,
      model: modelInput.value.trim()
    };

    GobyStorage.saveConfig(config).then(function () {
      showStatus('已保存', 'success');
    }).catch(function (err) {
      showStatus('保存失败: ' + (err.message || '未知错误'), 'error');
    });
  });

  // API Key 眼睛切换
  eyeToggle.addEventListener('click', function () {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      eyeToggle.innerHTML = '&#x1F648;'; // 🙈
    } else {
      apiKeyInput.type = 'password';
      eyeToggle.innerHTML = '&#x1F441;'; // 👁
    }
  });

})();
