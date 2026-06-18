// Goby - AI 浏览器助手 | Content Script (placeholder)

console.log('Goby content script loaded on:', window.location.hostname);

// 消息监听器骨架 — 后续阶段实现具体逻辑
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Goby: received message', message);
  sendResponse({ received: true });
  return true; // 保持通道开放（异步响应）
});
