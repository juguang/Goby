// Goby - AI 浏览器助手 | Shared Form Helpers
// Quick task 260620-tgw: 抽取 popup.js 与 content-script.js settings modal 共用的表单校验/构造逻辑
//
// 本模块为 popup 上下文（通过 popup.html 加载）与 content script 上下文（通过 manifest
// content_scripts.js 加载）共享。所有错误文案在此中央化定义，确保两套 UI 行为完全一致。
// 未来调整校验规则或文案时，只需修改这一处即可。

(function () {
  'use strict';

  /**
   * 校验字符串是否为合法的 http(s):// URL
   * 防御 file:///、javascript:、data: 等协议被注入到 SW fetch 调用 (T-tgw-03)
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
   * 校验字符串是否为纯 ASCII
   * 防御 fetch headers 抛 ISO-8859-1 异常导致 API Key 泄漏到错误日志 (T-tgw-02)
   * @param {string} str
   * @returns {boolean}
   */
  function isPureAscii(str) {
    return /^[\x00-\x7F]*$/.test(str);
  }

  /**
   * 统一 Profile 配置校验入口
   * 顺序敏感：baseUrl 先于 apiKey（与 popup.js 现有顺序保持一致）
   * @param {{baseUrl: string, apiKey: string, model: string}} config - 已 trim 过的配置对象
   * @returns {{ok: boolean, field: 'baseUrl'|'apiKey'|null, message: string|null}}
   */
  function validateProfileConfig(config) {
    if (!isValidHttpUrl(config.baseUrl)) {
      return {
        ok: false,
        field: 'baseUrl',
        message: 'API Base URL 必须以 http:// 或 https:// 开头且为合法 URL'
      };
    }
    if (!isPureAscii(config.apiKey)) {
      return {
        ok: false,
        field: 'apiKey',
        message: 'API Key 包含非法字符（仅允许英文/数字/符号，不可含中文或全角字符）'
      };
    }
    return { ok: true, field: null, message: null };
  }

  /**
   * 从表单原始输入值构造 Profile 配置对象
   * baseUrl/model 调 trim()；apiKey 不 trim（保留含前后空格的合法 token 边界，
   * 避免破坏现有用户数据；与 popup.js / content-script.js 现有 trim 策略保持一致）
   * @param {string} baseUrl
   * @param {string} apiKey
   * @param {string} model
   * @returns {{baseUrl: string, apiKey: string, model: string}}
   */
  function buildProfileConfigFromForm(baseUrl, apiKey, model) {
    return {
      baseUrl: (baseUrl || '').trim(),
      apiKey: apiKey || '',
      model: (model || '').trim()
    };
  }

  // 暴露公共 API 到全局命名空间
  window.GobyFormHelpers = {
    isValidHttpUrl: isValidHttpUrl,
    isPureAscii: isPureAscii,
    validateProfileConfig: validateProfileConfig,
    buildProfileConfigFromForm: buildProfileConfigFromForm
  };
})();
