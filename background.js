// Goby - AI 浏览器助手 | Service Worker

// 扩展安装/更新时记录版本号
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`Goby v${chrome.runtime?.manifest?.version || '1.0.0'} installed (reason: ${details.reason})`);
});

// 点击扩展图标 — 由 action.default_popup 接管，此处理逻辑保留备用
chrome.action.onClicked.addListener((tab) => {
  console.log('Goby: action clicked, tab:', tab.id);
});
