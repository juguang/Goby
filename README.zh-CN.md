**中文** | [English](./README.md)

<p align="center">
  <img src="./icons/icon128.png" width="128" height="128" alt="Goby logo" />
</p>

<h1 align="center">Goby</h1>

<p align="center">
  <strong>面向 Web 的开源 Agent 运行时。</strong>
</p>

<p align="center">
  Goby 给任何 LLM 一组操控网页的工具 —— 查询、填写、点击、截图、执行脚本。自带模型，自然语言对话。完全运行在你的浏览器里，没有后端服务器。
</p>

<p align="center">
  <img src="./docs/screenshots/multi-tool-workflow.png" width="700" alt="Goby 在博客页面上链式调用 page_analyze 和 page_evaluate" />
</p>

---

## 核心能力

| | |
| --- | --- |
| **针对实时网页的工具集** | 15 个内置工具 —— 查询、列出、填写、点击、勾选、选择、提交、等待、执行 JS、截图、分析。页面就是 agent 的工作台。 |
| **自带模型** | 任何 OpenAI 兼容端点 —— OpenAI、DeepSeek、Qwen、GLM，或你自己的服务。多 Profile，一键切换。 |
| **真正的工具调用循环** | 流式响应，跨工具链式调用的多步推理。单轮最多 15 次工具调用、单会话最多 50 次、单工具 15 秒超时。 |
| **永远没有后端** | 全部运行在浏览器内。你的 API Key 和对话永远不会触碰任何 Goby 控制的服务器。 |
| **天生隔离** | Shadow DOM 让面板不污染网页，网页也不污染面板。所有 LLM 输出过 DOMPurify 消毒；用户输入一律 `textContent`，绝不 `innerHTML`。 |
| **一下午就能读完** | 约 4700 行 Vanilla JS，无框架、无构建步骤、无转译。整个运行时一套就能装进脑子。 |

## 预览

<table>
  <tr>
    <td width="50%" align="center"><img src="./docs/screenshots/welcome.png" alt="欢迎界面" /></td>
    <td width="50%" align="center"><img src="./docs/screenshots/tool-page-analyze.png" alt="page_analyze 工具调用" /></td>
  </tr>
  <tr>
    <td align="center"><em>首次打开 —— Goby 用能力清单跟你打招呼</em></td>
    <td align="center"><em>工具调用进行中 —— <code>page_analyze</code> 返回页面摘要</em></td>
  </tr>
</table>

## 安装

1. 克隆或下载本仓库。
2. 在 Chrome（或任何 Chromium 内核浏览器）打开 `chrome://extensions`。
3. 右上角打开 **开发者模式**。
4. 点击 **加载已解压的扩展程序** → 选择项目根目录。
5. 把 Goby 图标固定到工具栏。打开任意网页，点击右下角的悬浮球（或工具栏图标）即可展开面板。

## 配置 API

1. 点击工具栏图标 → **⚙ 设置**（或面板内的齿轮按钮）。
2. 新增一个 Profile：

   <p>
     <img src="./docs/screenshots/settings.png" width="320" alt="多 Profile 设置面板" />
   </p>
   - **API Base URL** —— 例如 `https://api.openai.com/v1`，或服务商提供的 OpenAI 兼容端点。
   - **API Key** —— 仅存储在本地 `chrome.storage.local`，除你配置的 API 端点外不会外传。
   - **Model** —— 例如 `gpt-4o-mini`、`qwen-plus`、`deepseek-chat`。
3. 保存。下一条消息即用当前激活的 Profile。

## 使用

打开面板，直接对话即可：

- *"在搜索框里填 'chrome extensions' 并提交"*
- *"列出本页所有按钮"*
- *"截个图（不要包含面板）"*
- *"23 × 17 + 4 等于多少？"*

Agent 会循环：LLM → 工具调用 → 工具结果 → LLM → …… 直到产出最终文字回复（或达到 15 轮上限）。

## 隐私

Goby 的设计原则：你的数据只发往一个地方，就是你配置的 LLM 端点。

- **API Key** 仅存于本机的 `chrome.storage.local`，只发送给你填写的 API Base URL —— 不会发往任何其他地方。
- **页面内容与对话历史** 只作为 chat completion 请求的一部分，发往你配置的 LLM 端点。
- **无遥测、无统计、无"回传作者服务器"**。Goby 自身不控制任何后端服务器，所有网络请求都来自 LLM API 调用。可以打开 DevTools 的 Network 面板自行核验；或阅读 `background.js`（唯一发起网络请求的代码）。
- **第三方库本地内置**（`lib/marked.min.js`、`lib/purify.min.js`），无 CDN、无运行时拉取。

## 已知限制

- **浏览器内部页面**（`chrome://`、`chrome-extension://`、`about:`）无法操作 —— Chrome 在这些页面禁止 content script。Chrome 网上应用店和大部分设置页同样受限。
- **`file://` 本地文件页面** 需要在扩展详情页打开"允许访问文件网址"开关。
- **强 CSP 网站** 可能拦截 `page_evaluate` 注入的脚本。其他工具（DOM 查询、填写、点击）走 Chrome 自身 API，不受影响。
- **只能操作当前标签的当前页面** —— Goby 没有 `navigate` / `open_tab` 工具，不能主动跳转到某个 URL、不能打开新标签、不能切换标签页。（如果 `page_click` 恰好点到链接，那是页面自身的导航，Goby 不会跟着跳。）
- **无后台自动化** —— 只有面板打开且标签页处于前台时，Goby 才会工作。

## 许可证

[MIT](./LICENSE) © Spark
