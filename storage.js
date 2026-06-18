// Goby - AI 浏览器助手 | chrome.storage.local 读写封装
// API Key 仅通过此模块访问 chrome.storage.local，不经过 postMessage（SEC-03）

(function () {
  var GobyStorage = {
    /**
     * 保存 API 配置到 chrome.storage.local
     * @param {{baseUrl: string, apiKey: string, model: string}} config
     * @returns {Promise<void>}
     */
    saveConfig: function (config) {
      return chrome.storage.local.set({ agentConfig: config });
    },

    /**
     * 从 chrome.storage.local 读取 API 配置
     * @returns {Promise<{baseUrl: string, apiKey: string, model: string}>}
     */
    getConfig: function () {
      return chrome.storage.local.get(['agentConfig']).then(function (result) {
        var config = result.agentConfig;
        if (config && typeof config.baseUrl === 'string' && typeof config.apiKey === 'string' && typeof config.model === 'string') {
          return {
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model
          };
        }
        return {
          baseUrl: '',
          apiKey: '',
          model: ''
        };
      });
    }
  };

  // 暴露到全局（浏览器扩展弹窗和 Jest 测试）
  if (typeof window !== 'undefined') {
    window.GobyStorage = GobyStorage;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.GobyStorage = GobyStorage;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GobyStorage;
  }
})();
