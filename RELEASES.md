# Release Notes | 版本变更

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
