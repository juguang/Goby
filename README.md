[中文](./README.zh-CN.md) | **English**

<p align="center">
  <img src="./icons/icon128.png" width="128" height="128" alt="Goby logo" />
</p>

<h1 align="center">Goby</h1>

<p align="center">
  An AI browser assistant that operates any web page through natural-language conversation. Built as a Manifest V3 Chrome extension — no framework, vanilla JS, Shadow DOM isolation.
</p>

---

## ✨ Features

- **Natural-language web automation** — fill forms, click buttons, query content, analyze pages, all by chatting.
- **15 built-in tools** — page query/list/wait/evaluate, fill/click/check/select/submit, page analyze/screenshot, calculator, clipboard read/write, get current time.
- **Bring-your-own LLM** — any OpenAI-compatible API endpoint (Qwen, DeepSeek, GLM, OpenAI, …). Multiple profiles, switch on the fly.
- **Streaming responses** with tool-call loop (max 15 rounds, 15 s per-tool timeout, 50 calls per session).
- **Isolated UI** via Shadow DOM — site styles never leak in, panel styles never leak out.
- **Safe rendering** — every LLM/user payload passes through DOMPurify; user input uses `textContent`, never `innerHTML`.
- **Session persistence** — conversations saved to `chrome.storage.local`, restored on reopen.
- **Lightweight** — content script ~1500 lines, service worker ~100 lines. No build step.

## 🚀 Installation

1. Clone or download this repo.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** → select the project root directory.
5. Pin the Goby icon to your toolbar. Click any web page, then click the floating ball at the bottom-right (or the toolbar icon) to open the panel.

## 🔧 Configuration

1. Click the toolbar icon → **⚙ Settings** (or the gear icon inside the panel).
2. Add a profile:
   - **API Base URL** — e.g. `https://api.openai.com/v1` or your provider's OpenAI-compatible endpoint.
   - **API Key** — stored locally in `chrome.storage.local`, never transmitted except to the endpoint you configure.
   - **Model** — e.g. `gpt-4o-mini`, `qwen-plus`, `deepseek-chat`.
3. Save. The active profile is used for the next message.

## 💬 Usage

Open the panel and just talk to it:

- *"Fill the search box with 'chrome extensions' and submit"*
- *"List all buttons on this page"*
- *"Take a screenshot of the page (excluding the panel)"*
- *"What's 23 × 17 + 4?"*

The agent loops: LLM → tool calls → tool results → LLM → … until it has a final text reply (or hits the 15-round cap).

## 🧱 Tech Stack

| Layer | Choice |
| --- | --- |
| Extension standard | Manifest V3 |
| UI framework | None (vanilla JS) |
| UI isolation | Shadow DOM |
| Markdown | marked.js v15 |
| XSS protection | DOMPurify v3 |
| Storage | `chrome.storage.local` |
| Streaming | SSE parsing in the service worker |

## 📁 Project Structure

```
Goby/
├── manifest.json           # MV3 manifest
├── background.js           # Service worker (~100 lines, stateless)
├── content-script.js       # Message listener + panel injection
├── panel.js                # Panel UI + agent loop + 15 tools (~1500 lines)
├── popup.{html,js}         # Toolbar popup — quick API config entry
├── storage.js              # Profile CRUD wrapper
├── agent-panel.css         # Panel styles
├── lib/
│   ├── marked.min.js       # vendored
│   └── purify.min.js       # vendored
└── icons/                  # 16 / 48 / 128 px
```

## 🛣 Roadmap

This is an early preview (`v0.1.0`). Active work:

- Phase 04 — additional page query/action tools
- Phase 05 — analysis & utility tools

Stability, API surface, and tool schemas may change before `v1.0.0`.

## 🤝 Contributing

PRs welcome. Keep the core runtime lightweight — no build step, no framework, no transpile. Match the existing code style (ES5-ish `var`, IIFE modules, `textContent` over `innerHTML`).

## 📄 License

MIT © Spark
