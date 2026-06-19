**中文** | [English](./README.md)

<p align="center">
  <img src="./icons/icon128.png" width="128" height="128" alt="Goby logo" />
</p>

<h1 align="center">Goby</h1>

<p align="center">
  通过自然语言对话操控任何网页的 AI 浏览器助手。基于 Manifest V3 的 Chrome 扩展 —— 无框架、纯 JS、Shadow DOM 隔离。
</p>

---

## ✨ 功能特性

- **自然语言操控网页** —— 填表单、点按钮、查内容、分析页面，全都靠聊天完成。
- **15 个内置工具** —— 页面查询/列表/等待/执行 JS、填写/点击/勾选/选择/提交、页面分析/截图、计算器、剪贴板读写、获取当前时间。
- **自带 LLM 接口** —— 兼容任何 OpenAI 协议的 API 端点（Qwen、DeepSeek、GLM、OpenAI 等）。支持多配置一键切换。
- **流式响应** + 工具调用循环（单轮最多 15 次工具调用、单工具 15 秒超时、单会话最多 50 次工具调用）。
- **Shadow DOM 隔离** —— 网页样式不会污染面板，面板样式也不会污染网页。
- **安全渲染** —— 所有 LLM/用户输入都过 DOMPurify 消毒；用户输入一律 `textContent`，绝不 `innerHTML`。
- **会话持久化** —— 对话保存到 `chrome.storage.local`，重开页面自动恢复。
- **轻量** —— content script 约 1500 行，service worker 约 100 行。零构建步骤。

## 🚀 安装

1. 克隆或下载本仓库。
2. 在 Chrome（或任何 Chromium 内核浏览器）打开 `chrome://extensions`。
3. 右上角打开 **开发者模式**。
4. 点击 **加载已解压的扩展程序** → 选择项目根目录。
5. 把 Goby 图标固定到工具栏。打开任意网页，点击右下角的悬浮球（或工具栏图标）即可展开面板。

## 🔧 配置 API

1. 点击工具栏图标 → **⚙ 设置**（或面板内的齿轮按钮）。
2. 新增一个 Profile：
   - **API Base URL** —— 例如 `https://api.openai.com/v1`，或服务商提供的 OpenAI 兼容端点。
   - **API Key** —— 仅存储在本地 `chrome.storage.local`，除你配置的 API 端点外不会外传。
   - **Model** —— 例如 `gpt-4o-mini`、`qwen-plus`、`deepseek-chat`。
3. 保存。下一条消息即用当前激活的 Profile。

## 💬 使用

打开面板，直接对话即可：

- *"在搜索框里填 'chrome extensions' 并提交"*
- *"列出本页所有按钮"*
- *"截个图（不要包含面板）"*
- *"23 × 17 + 4 等于多少？"*

Agent 会循环：LLM → 工具调用 → 工具结果 → LLM → …… 直到产出最终文字回复（或达到 15 轮上限）。

## 🧱 技术栈

| 层级 | 选型 |
| --- | --- |
| 扩展标准 | Manifest V3 |
| UI 框架 | 无（Vanilla JS） |
| UI 隔离 | Shadow DOM |
| Markdown | marked.js v15 |
| XSS 防护 | DOMPurify v3 |
| 存储 | `chrome.storage.local` |
| 流式 | Service Worker 内 SSE 解析 |

## 📁 项目结构

```
Goby/
├── manifest.json           # MV3 manifest
├── background.js           # Service Worker（约 100 行，无状态）
├── content-script.js       # 消息监听 + 面板注入
├── panel.js                # 面板 UI + Agent 循环 + 15 个工具（约 1500 行）
├── popup.{html,js}         # 工具栏弹窗 —— 快速 API 配置入口
├── storage.js              # Profile CRUD 封装
├── agent-panel.css         # 面板样式
├── lib/
│   ├── marked.min.js       # 第三方库
│   └── purify.min.js       # 第三方库
└── icons/                  # 16 / 48 / 128 px
```

## 🛣 路线图

当前是早期预览版（`v0.1.0`）。正在开发：

- Phase 04 —— 更多页面查询/操作工具
- Phase 05 —— 分析与辅助工具

`v1.0.0` 之前，稳定性、API 表面、工具 schema 可能变更。

## 🤝 贡献

欢迎 PR。请保持核心运行时轻量 —— 不引入构建步骤、不引入框架、不转译。匹配现有代码风格（偏 ES5 的 `var`、IIFE 模块、`textContent` 优先于 `innerHTML`）。

## 📄 许可证

MIT © Spark
