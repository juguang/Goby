# Release Notes | 版本变更

---

## v0.3.2 — 2026-06-27

### 🇺🇸 English

**CSP-resilient tooling — page_evaluate and uploaded skills now work on strict-CSP sites (HN, GitHub, Twitter, etc.).**

- **`page_evaluate` runs in the page's MAIN world via Service Worker** — uses `chrome.scripting.executeScript({world:'MAIN'})`, which is a Chrome extension privilege and bypasses page CSP entirely. v0.3.1 used ISOLATED-world `eval()`, which strict CSPs reject.
- **Uploaded skills compile via `new Function` in ISOLATED world** — rawCode is passed as a string (not a Function object) so structured clone doesn't strip it. On strict-CSP sites where `new Function` fails, the new SYSTEM_PROMPT rule (below) tells the LLM to fall back to built-in tools.
- **SYSTEM_PROMPT rule #6 — "switch paths on tool failure"** — when a tool returns `CSP` / `执行失败` / `timeout`, the LLM immediately switches to built-in DOM tools (`page_query` / `page_list_elements` / `page_click` / `page_fill`) instead of retrying the same call 3 times.
- **Better `page_evaluate` result serialization** — DOM elements → `outerHTML` (truncated to 2000 chars); objects → `JSON.stringify`. Previously returned useless `[object HTMLDivElement]`.
- **Imported skills take effect immediately** — no page refresh needed.
- **`page_query` description nudges LLM toward `index=-1` batch queries** — saves tool calls and tokens when extracting lists (e.g. HN front page titles).

---

### 🇨🇳 中文

**工具链 CSP 兼容性修复 —— page_evaluate 和用户上传技能在严格 CSP 站点（HN、GitHub、Twitter 等）上可用了。**

- **`page_evaluate` 改走 Service Worker 在页面 MAIN world 执行** — 使用 `chrome.scripting.executeScript({world:'MAIN'})`，是 Chrome 扩展特权，绕过页面 CSP。v0.3.1 用的是 ISOLATED world `eval()`，会被严格 CSP 拒绝。
- **用户上传技能改用 ISOLATED world 的 `new Function` 编译** — rawCode 以字符串传递（不会被结构化克隆剥离）。严格 CSP 站点上 `new Function` 仍会失败，但配合下面的 SYSTEM_PROMPT 规则，LLM 会自动 fallback 到内置工具。
- **SYSTEM_PROMPT 新增第 6 条「工具失败立即换路径」** — 工具返回 `CSP` / `执行失败` / `timeout` 时，LLM 立即改用内置 DOM 工具（`page_query` / `page_list_elements` / `page_click` / `page_fill`），不再重试 3 次浪费时间。
- **`page_evaluate` 返回值序列化改进** — DOM 元素 → `outerHTML`（截断 2000 字符）；对象 → `JSON.stringify`。原版返回无意义的 `[object HTMLDivElement]`。
- **导入技能即时生效** — 不再需要刷新页面。
- **`page_query` 工具描述引导使用 `index=-1` 批量查询** — 提取列表（如 HN 首页标题）时省工具调用、省 token。

---

## v0.3.1 — 2026-06-27

### 🇺🇸 English

**UI: Draggable ball & resizable panel.**

- **Floating ball is now draggable.** Move it anywhere on the screen — position persists across sessions and page reloads. A 5px threshold cleanly separates clicks (toggle panel) from drags (relocate ball).
- **Panel is now resizable from any edge or corner.** Eight handles (n / s / e / w / ne / nw / se / sw) with appropriate cursor hints. Minimum size 320×360. Width, height, and position all persist.
- Both ball and panel snap back into the viewport if you resize the window underneath them.

Under the hood: pointer events (mouse + touch), `gobyBallPosition` and `gobyPanelGeometry` storage keys, removed the legacy single-handle bottom resize bar.

---

### 🇨🇳 中文

**UI：悬浮球任意拖拽 + 对话框四边/四角调整大小。**

- **悬浮球可任意拖拽。** 屏幕上任何位置都能放，位置跨会话和刷新保留。5px 阈值精准区分 click（切换面板）和 drag（移动球）。
- **对话框四边和四角可拖拉调整尺寸。** 8 个 handle（n / s / e / w / ne / nw / se / sw），各自对应光标提示。最小尺寸 320×360。宽度、高度、位置全部持久化。
- 窗口缩小时，球和面板会自动拉回视口内，避免丢失。

实现要点：pointer events（同时覆盖鼠标和触摸），新增 `gobyBallPosition` 和 `gobyPanelGeometry` 两个 storage key，删除了旧版底部 4px 单 handle。

---

## v0.3.0 — 2026-06-21

### 🇺🇸 English

**Skills system + cross-page navigation tools.**

- **Skill system** — Upload / import / auto-generate SKILL.md files. Built-in skills for Amazon, Baidu, GitHub, Google, Wikipedia. Settings panel UI for skill management. Skills execute via SW page_evaluate channel to bypass strict page CSP.
- **5 navigation tools** — `page_navigate`, `page_open_tab`, `page_close_tab`, `page_switch_tab`, `page_list_tabs`. Cross-origin session inheritance with `interrupted=true` semantics.
- **Worker Tab workflow** — Cross-page autonomous navigation with real-time progress streaming back to the chat tab. `sendToSW` retry helper for "Extension context invalidated" errors.
- **Goby fish logo** — New SVG source + PNG 16/48/128.
- **Bilingual i18n** — Full English/Chinese UI translation.

---

### 🇨🇳 中文

**技能系统 + 跨页面导航工具。**

- **技能系统** —— 上传 / 导入 / 自动生成 SKILL.md 文件。内置 Amazon、Baidu、GitHub、Google、Wikipedia 5 个技能。设置面板提供技能管理 UI。技能执行走 SW page_evaluate 通道绕过页面 CSP。
- **5 个导航工具** —— `page_navigate`、`page_open_tab`、`page_close_tab`、`page_switch_tab`、`page_list_tabs`。跨域会话继承仅限 `interrupted=true` 的 session。
- **Worker Tab 工作流** —— 跨页面自主导航，进度实时流回 Chat Tab 显示。`sendToSW` 重试助手处理 "Extension context invalidated" 错误。
- **Goby 鱼 logo** —— 新 SVG 源文件 + PNG 16/48/128。
- **双语 i18n** —— 完整中英文 UI 翻译。

---

## v0.2.0 — 2026-06-20

### 🇺🇸 English

**Full AI browser assistant — 15 page tools, agent loop, streaming LLM, session management, security pipeline.**

- Complete Chrome extension framework (Manifest V3 + Service Worker + Content Script + Popup)
- Agent loop system (streaming SSE + 15 tool execution engine + DOMPurify security pipeline)
- Per-domain session management (DJB2 hash + 50 sessions LRU + sidebar UI)
- 9 page tools (query / list / wait / evaluate + fill / click / check / select / submit)
- Page analysis & screenshot (page_analyze + page_screenshot + PANEL-09 overlay)

---

### 🇨🇳 中文

**完整的 AI 浏览器助手 —— 15 个页面工具、Agent 循环系统、流式 LLM 调用、会话管理、安全管道。**

- Chrome 扩展完整框架 (Manifest V3 + SW + Content Script + Popup)
- Agent 循环系统（流式 SSE + 15 工具执行引擎 + DOMPurify 安全管道）
- 按域名会话管理（DJB2 hash + 50 会话 LRU + 侧栏 UI）
- 9 个页面工具（query / list / wait / evaluate + fill / click / check / select / submit）
- 页面分析 & 截图（page_analyze + page_screenshot + PANEL-09 overlay）

---

## v0.1.0 — 2026-06-19

### 🇺🇸 English

**Initial scaffold.**

- Manifest V3 extension skeleton (Service Worker + Content Script + Popup)
- Basic panel injection with floating ball toggle
- Bilingual README

---

### 🇨🇳 中文

**初始脚手架。**

- Manifest V3 扩展骨架（Service Worker + Content Script + Popup）
- 基础面板注入 + 悬浮球切换
- 双语 README
