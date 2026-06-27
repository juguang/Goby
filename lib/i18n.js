// Goby - AI 浏览器助手 | 国际化模块
// 中英双语翻译，通过 chrome.storage.local 持久化语言设置
// 以 IIFE 形式挂载 window.GobyI18n，暴露 t(key) / setLocale(locale) / getLocale() / getSystemPrompt()

(function () {
  'use strict';

  // ================================================================
  //  翻译表 — zh: 中文, en: 英文
  //  模板语法: {paramName} 会被 t(key, { paramName: value }) 替换
  // ================================================================

  var TRANSLATIONS = {
    zh: {
      // ---- Panel UI (panel.js) ----
      'panel.goby_title': 'Goby',
      'panel.session_btn_title': '会话列表',
      'panel.settings_btn_title': '设置',
      'panel.close_btn_title': '关闭面板',
      'panel.welcome_heading': '你好！我是 Goby',
      'panel.welcome_body': '你的 AI 浏览器助手。我可以帮你填写表单、点击按钮、查询内容、分析页面...',
      'panel.tool_fill_form': '填写表单',
      'panel.tool_click_button': '点击按钮',
      'panel.tool_query_content': '查询内容',
      'panel.tool_analyze_page': '分析页面',
      'panel.tool_take_screenshot': '截取截图',
      'panel.tool_read_write_clipboard': '读写剪贴板',
      'panel.tool_math_calc': '数学计算',
      'panel.tool_get_time': '获取时间',
      'panel.input_placeholder': '输入消息... (Enter 发送, Shift+Enter 换行)',
      'panel.send_btn_title': '发送消息',
      'panel.status_loading': '加载中...',
      'panel.sidebar_title': '会话列表',
      'panel.sidebar_search_placeholder': '搜索会话...',
      'panel.sidebar_new_btn': '+ 新建会话',
      'panel.sidebar_clear_btn': '清除所有会话',
      'panel.delete_session_confirm': '确定删除此会话？',
      'panel.clear_all_confirm': '确定清除所有会话？',
      'panel.messages_count': '{n} 条消息',
      'panel.ball_tooltip': 'Goby AI 助手',
      'panel.tool_processing': '处理中...',
      'panel.time_just_now': '刚刚',
      'panel.time_minutes_ago': '{n} 分钟前',
      'panel.time_hours_ago': '{n} 小时前',
      'panel.time_days_ago': '{n} 天前',
      'panel.round_text': '第 {n} 轮',

      // ---- Modal (content-script.js, 设置面板) ----
      'modal.title': '⚙ 设置',
      'modal.api_config_label': 'API 配置',
      'modal.add_btn_title': '添加配置',
      'modal.edit_btn_title': '编辑配置',
      'modal.delete_btn_title': '删除配置',
      'modal.autostart_label': '启动时自动展开面板',
      'modal.https_warning': '您的 API Key 将通过非加密连接传输，建议使用 HTTPS 地址',
      'modal.save_btn': '保存配置',
      'modal.save_success': '已保存',
      'modal.save_fail': '保存失败: {msg}',
      'modal.edit_hint': '编辑「{name}」',
      'modal.add_prompt': '请输入新的 API 配置名称：',
      'modal.add_duplicate': '配置名称已存在',
      'modal.add_fail': '添加失败: {msg}',
      'modal.delete_confirm': '确定删除「{name}」吗？此操作不可撤销。',
      'modal.delete_success': '已删除 {name}',
      'modal.delete_fail': '删除失败: {msg}',
      'modal.switch_fail': '切换失败: {msg}',
      'modal.language_label': '界面语言',
      'modal.lang_zh': '中文',
      'modal.lang_en': 'English',
      'modal.lang_switch_msg': '已切换语言。请关闭重开面板。',

      // ---- Phase 9: Skills System ----
      'modal.skills_title': '技能管理',
      'modal.skills_import_btn': '+ 导入技能',
      'modal.skills_upload': '📁 上传文件',
      'modal.skills_import_confirm': '确认导入',
      'modal.skills_cancel': '取消',
      'modal.skills_url_required': '请输入 URL',
      'modal.skills_https_only': '仅支持 https:// URL',
      'modal.skills_importing': '导入中...',
      'modal.skills_import_success': '技能已安装：',
      'modal.skills_import_failed': '导入失败',
      'modal.skills_empty': '暂无已安装技能',
      'modal.skills_recommended': '推荐安装',
      'modal.skills_delete_confirm': '确定删除此技能吗？',
      'modal.skills_builtin': '内置',
      'modal.skills_imported': '已导入',
      'modal.skills_enable_failed': '切换失败: {msg}',
      'modal.skills_from_registry': '来自 browsing-skills',
      'modal.skills_actions': '个操作',
      'modal.skills_install': '安装',
      'modal.skills_installed': '已安装',
      'modal.skills_installing': '安装中...',
      'modal.skills_install_success': '已安装技能：',
      'modal.skills_install_failed': '安装失败',
      'modal.skills_delete': '删除',
      'modal.skills_enabled': '启用',
      'modal.skills_disabled': '禁用',

      // ---- Phase 10: MCP Servers ----
      'modal.mcp_title': 'MCP Servers',
      'modal.mcp_add_btn': '+ 添加 Server',
      'modal.mcp_name_label': '名称',
      'modal.mcp_name_placeholder': '例: Cloudflare Docs',
      'modal.mcp_endpoint_label': 'Endpoint URL',
      'modal.mcp_endpoint_placeholder': 'https://example.com/mcp',
      'modal.mcp_token_label': 'Bearer Token（可选）',
      'modal.mcp_token_placeholder': '留空表示无认证',
      'modal.mcp_enabled_label': '启用',
      'modal.mcp_save_btn': '保存 Server',
      'modal.mcp_save_success': '已保存',
      'modal.mcp_save_fail': '保存失败: {msg}',
      'modal.mcp_delete_confirm': '确定删除「{name}」？删除后其工具将不再可用。',
      'modal.mcp_delete_success': '已删除 {name}',
      'modal.mcp_verifying': '验证连接...',
      'modal.mcp_status_connected': '已连接',
      'modal.mcp_status_failed': '连接失败',
      'modal.mcp_status_untested': '未尝试验证',
      'modal.mcp_status_verifying': '验证中...',
      'modal.mcp_status_disabled': '已禁用',
      'modal.mcp_tool_count': '{n} 个工具',
      'modal.mcp_no_servers': '尚未配置 MCP Server。点击「+ 添加 Server」开始。',
      'modal.mcp_edit_title': '编辑 {name}',
      'modal.mcp_add_title': '添加 MCP Server',

      // ---- Phase 7: Tab Navigation Tools ----
      'tool.page_navigate': 'page_navigate',
      'tool.page_navigate_desc': '导航当前标签页到指定 URL，支持同域和跨域',
      'tool.page_open_tab': 'page_open_tab',
      'tool.page_open_tab_desc': '打开新标签页并加载指定 URL，新标签页获得焦点',
      'tool.page_close_tab': 'page_close_tab',
      'tool.page_close_tab_desc': '关闭指定 tabId 的标签页',
      'tool.page_switch_tab': 'page_switch_tab',
      'tool.page_switch_tab_desc': '切换到指定 tabId 的标签页',
      'tool.page_list_tabs': 'page_list_tabs',
      'tool.page_list_tabs_desc': '列出所有标签页的 tabId、标题、URL 和激活状态',

      // ---- Tool execution (content-script.js) ----
      'tool.parse_error': 'Error: 工具参数解析失败',
      'tool.unknown_tool': 'UnknownTool: 未知工具 "{name}"。可用工具: {tools}',
      'tool.execute_fail': 'Error: {msg}',
      'tool.execute_fail_default': '执行失败',
      'tool.timeout': '工具执行超时（{n}秒）',
      'tool.skipped': '已跳过（连续失败{n}次）',
      'tool.max_calls': '会话工具调用次数已达上限（{n}次），请新建会话继续操作',

      // ---- Popup (popup.js + popup.html) ----
      'popup.title': 'Goby — AI 浏览器助手',
      'popup.add_btn_title': '添加配置',
      'popup.edit_btn_title': '编辑配置',
      'popup.delete_btn_title': '删除配置',
      'popup.empty_title': '暂无 API 配置',
      'popup.empty_body': '点击右上角 + 按钮添加你的第一个 API 配置',
      'popup.field_base_url': 'API Base URL',
      'popup.field_api_key': 'API Key',
      'popup.field_model': 'Model Name',
      'popup.placeholder_base_url': 'http://127.0.0.1:8765/v1',
      'popup.placeholder_model': '例如: Qwen3.6-35B-A3B',
      'popup.eye_toggle_title': '显示/隐藏 API Key',
      'popup.save_btn': '保存配置',
      'popup.toast_switch_fail': '切换失败: {msg}',
      'popup.toast_add_prompt': '请输入新的 API 配置名称：',
      'popup.toast_add_fail': '添加失败: {msg}',
      'popup.toast_save_success': '已保存',
      'popup.toast_save_fail': '保存失败: {msg}',
      'popup.toast_delete_confirm': '确定删除「{name}」吗？此操作不可撤销。',
      'popup.toast_delete_success': '已删除 {name}',
      'popup.toast_delete_fail': '删除失败: {msg}',
      'popup.toast_auto_expand_on': '已启用自动展开',
      'popup.toast_auto_expand_off': '已关闭自动展开',
      'popup.profile_label': 'API 配置',
      'popup.select_empty': '暂无配置',
      'popup.toast_switch_success': '已切换到 {name}'
    },

    en: {
      // ---- Panel UI ----
      'panel.goby_title': 'Goby',
      'panel.session_btn_title': 'Sessions',
      'panel.settings_btn_title': 'Settings',
      'panel.close_btn_title': 'Close panel',
      'panel.welcome_heading': "Hello! I'm Goby",
      'panel.welcome_body': 'Your AI browser assistant. I can help you fill forms, click buttons, query content, analyze pages...',
      'panel.tool_fill_form': 'Fill Form',
      'panel.tool_click_button': 'Click Button',
      'panel.tool_query_content': 'Query Content',
      'panel.tool_analyze_page': 'Analyze Page',
      'panel.tool_take_screenshot': 'Screenshot',
      'panel.tool_read_write_clipboard': 'Clipboard',
      'panel.tool_math_calc': 'Math',
      'panel.tool_get_time': 'Get Time',
      'panel.input_placeholder': 'Type a message... (Enter to send, Shift+Enter for new line)',
      'panel.send_btn_title': 'Send message',
      'panel.status_loading': 'Loading...',
      'panel.sidebar_title': 'Sessions',
      'panel.sidebar_search_placeholder': 'Search sessions...',
      'panel.sidebar_new_btn': '+ New Session',
      'panel.sidebar_clear_btn': 'Clear All Sessions',
      'panel.delete_session_confirm': 'Delete this session?',
      'panel.clear_all_confirm': 'Clear all sessions?',
      'panel.messages_count': '{n} messages',
      'panel.ball_tooltip': 'Goby AI Assistant',
      'panel.tool_processing': 'Processing...',
      'panel.time_just_now': 'just now',
      'panel.time_minutes_ago': '{n}m ago',
      'panel.time_hours_ago': '{n}h ago',
      'panel.time_days_ago': '{n}d ago',
      'panel.round_text': 'Round {n}',

      // ---- Modal ----
      'modal.title': '⚙ Settings',
      'modal.api_config_label': 'API Config',
      'modal.add_btn_title': 'Add config',
      'modal.edit_btn_title': 'Edit config',
      'modal.delete_btn_title': 'Delete config',
      'modal.autostart_label': 'Auto-expand panel on start',
      'modal.https_warning': 'Your API Key will be transmitted over an unencrypted connection. HTTPS is recommended',
      'modal.save_btn': 'Save Config',
      'modal.save_success': 'Saved',
      'modal.save_fail': 'Save failed: {msg}',
      'modal.edit_hint': 'Editing "{name}"',
      'modal.add_prompt': 'Enter a new API config name:',
      'modal.add_duplicate': 'Config name already exists',
      'modal.add_fail': 'Add failed: {msg}',
      'modal.delete_confirm': 'Delete "{name}"? This cannot be undone.',
      'modal.delete_success': 'Deleted {name}',
      'modal.delete_fail': 'Delete failed: {msg}',
      'modal.switch_fail': 'Switch failed: {msg}',
      'modal.language_label': 'Language',
      'modal.lang_zh': 'Chinese',
      'modal.lang_en': 'English',
      'modal.lang_switch_msg': 'Language switched. Please close and reopen the panel.',

      // ---- Phase 9: Skills System ----
      'modal.skills_title': 'Skills',
      'modal.skills_import_btn': '+ Import',
      'modal.skills_upload': '📁 Upload File',
      'modal.skills_import_confirm': 'Import',
      'modal.skills_cancel': 'Cancel',
      'modal.skills_url_required': 'URL is required',
      'modal.skills_https_only': 'Only https:// URLs allowed',
      'modal.skills_importing': 'Importing...',
      'modal.skills_import_success': 'Skill installed: ',
      'modal.skills_import_failed': 'Import failed',
      'modal.skills_empty': 'No skills installed',
      'modal.skills_recommended': 'Recommended',
      'modal.skills_delete_confirm': 'Delete this skill?',
      'modal.skills_builtin': 'Built-in',
      'modal.skills_imported': 'Imported',
      'modal.skills_enable_failed': 'Toggle failed: {msg}',
      'modal.skills_from_registry': 'from browsing-skills',
      'modal.skills_actions': 'actions',
      'modal.skills_install': 'Install',
      'modal.skills_installed': 'Installed',
      'modal.skills_installing': 'Installing...',
      'modal.skills_install_success': 'Installed: ',
      'modal.skills_install_failed': 'Install failed',
      'modal.skills_delete': 'Delete',
      'modal.skills_enabled': 'Enabled',
      'modal.skills_disabled': 'Disabled',

      // ---- Phase 10: MCP Servers ----
      'modal.mcp_title': 'MCP Servers',
      'modal.mcp_add_btn': '+ Add Server',
      'modal.mcp_name_label': 'Name',
      'modal.mcp_name_placeholder': 'e.g. Cloudflare Docs',
      'modal.mcp_endpoint_label': 'Endpoint URL',
      'modal.mcp_endpoint_placeholder': 'https://example.com/mcp',
      'modal.mcp_token_label': 'Bearer Token (optional)',
      'modal.mcp_token_placeholder': 'Leave empty for no auth',
      'modal.mcp_enabled_label': 'Enabled',
      'modal.mcp_save_btn': 'Save Server',
      'modal.mcp_save_success': 'Saved',
      'modal.mcp_save_fail': 'Save failed: {msg}',
      'modal.mcp_delete_confirm': 'Delete "{name}"? Tools will no longer be available.',
      'modal.mcp_delete_success': 'Deleted {name}',
      'modal.mcp_verifying': 'Verifying connection...',
      'modal.mcp_status_connected': 'Connected',
      'modal.mcp_status_failed': 'Connection failed',
      'modal.mcp_status_untested': 'Not verified',
      'modal.mcp_status_verifying': 'Verifying...',
      'modal.mcp_status_disabled': 'Disabled',
      'modal.mcp_tool_count': '{n} tools',
      'modal.mcp_no_servers': 'No MCP Servers configured. Click "+ Add Server" to start.',
      'modal.mcp_edit_title': 'Edit {name}',
      'modal.mcp_add_title': 'Add MCP Server',

      // ---- Phase 7: Tab Navigation Tools ----
      'tool.page_navigate': 'page_navigate',
      'tool.page_navigate_desc': 'Navigate the current tab to the specified URL',
      'tool.page_open_tab': 'page_open_tab',
      'tool.page_open_tab_desc': 'Open a new tab with the specified URL',
      'tool.page_close_tab': 'page_close_tab',
      'tool.page_close_tab_desc': 'Close the tab with the specified tabId',
      'tool.page_switch_tab': 'page_switch_tab',
      'tool.page_switch_tab_desc': 'Switch to the tab with the specified tabId',
      'tool.page_list_tabs': 'page_list_tabs',
      'tool.page_list_tabs_desc': 'List all tabs with their tabId, title, URL, and active status',

      // ---- Tool execution ----
      'tool.parse_error': 'Error: Failed to parse tool arguments',
      'tool.unknown_tool': 'UnknownTool: Unknown tool "{name}". Available: {tools}',
      'tool.execute_fail': 'Error: {msg}',
      'tool.execute_fail_default': 'Execution failed',
      'tool.timeout': 'Tool execution timeout ({n}s)',
      'tool.skipped': 'Skipped ({n} consecutive failures)',
      'tool.max_calls': 'Tool call limit reached ({n} calls). Please start a new session.',

      // ---- Popup ----
      'popup.title': 'Goby — AI Browser Assistant',
      'popup.add_btn_title': 'Add config',
      'popup.edit_btn_title': 'Edit config',
      'popup.delete_btn_title': 'Delete config',
      'popup.empty_title': 'No API configs',
      'popup.empty_body': "Click + to add your first API config",
      'popup.field_base_url': 'API Base URL',
      'popup.field_api_key': 'API Key',
      'popup.field_model': 'Model Name',
      'popup.placeholder_base_url': 'http://127.0.0.1:8765/v1',
      'popup.placeholder_model': 'e.g. Qwen3.6-35B-A3B',
      'popup.eye_toggle_title': 'Show/Hide API Key',
      'popup.save_btn': 'Save Config',
      'popup.toast_switch_fail': 'Switch failed: {msg}',
      'popup.toast_add_prompt': 'Enter a new API config name:',
      'popup.toast_add_fail': 'Add failed: {msg}',
      'popup.toast_save_success': 'Saved',
      'popup.toast_save_fail': 'Save failed: {msg}',
      'popup.toast_delete_confirm': 'Delete "{name}"? This cannot be undone.',
      'popup.toast_delete_success': 'Deleted {name}',
      'popup.toast_delete_fail': 'Delete failed: {msg}',
      'popup.toast_auto_expand_on': 'Auto-expand enabled',
      'popup.toast_auto_expand_off': 'Auto-expand disabled',
      'popup.profile_label': 'API Config',
      'popup.select_empty': 'No configs',
      'popup.toast_switch_success': 'Switched to {name}'
    }
  };

  // ================================================================
  //  私有状态
  // ================================================================

  var _locale = 'zh';

  // ================================================================
  //  t(key, params) — 翻译函数，支持模板插值 {paramName}
  //  当前语言无匹配时回退到中文
  //  中文也无匹配时返回 key 本身
  // ================================================================

  function t(key, params) {
    var translations = TRANSLATIONS[_locale];
    var text = translations && translations[key];
    if (text === undefined) {
      // 回退到中文
      text = TRANSLATIONS.zh[key];
    }
    if (text === undefined) {
      text = key;
    }
    if (params) {
      text = replaceParams(text, params);
    }
    return text;
  }

  /**
   * replaceParams — 模板插值替换
   * 将文本中的 {paramName} 替换为 params[paramName]
   * @param {string} text
   * @param {Object} params
   * @returns {string}
   */
  function replaceParams(text, params) {
    var result = text;
    for (var p in params) {
      if (params.hasOwnProperty(p)) {
        var val = params[p];
        if (val === undefined || val === null) val = '';
        // 只匹配 {paramName} 模式的占位符
        result = result.split('{' + p + '}').join(String(val));
      }
    }
    return result;
  }

  // ================================================================
  //  setLocale — 切换语言并持久化
  // ================================================================

  function setLocale(locale) {
    if (locale !== 'zh' && locale !== 'en') return;
    _locale = locale;
    chrome.storage.local.set({ goby_language: locale });
  }

  // ================================================================
  //  getLocale — 获取当前语言
  // ================================================================

  function getLocale() {
    return _locale;
  }

  // ================================================================
  //  getSystemPrompt — 返回当前语言的系统提示词基础文本
  //  包含 Agent 介绍、工具使用四条原则、结尾说明及可用工具列表标题
  //  注意：实际工具列表（名称+描述）由 content-script.js 动态追加
  // ================================================================

  function getSystemPrompt() {
    var prompts = {};
    prompts.zh = [
      '你叫 Goby，是一个 AI 浏览器自动化助手。你可以使用工具来操作当前页面，用中文回答用户。',
      '工具使用原则：',
      '【最高优先·目标锚定】每一步工具调用前，先在内心默念用户的原始目标。如果发现当前动作（如换页面、搜索、找替代内容）不再服务于原始目标——立即停下，用一句话告诉用户："原始任务是 X，我现在在做 Y，似乎偏离了，要继续吗？" 绝不因为中途遇到障碍（404、搜索失败、元素找不到）就自作主张换一个新方向一路跑下去。这是最常见的失败模式，务必守住。',
      '1. 先查后做·不臆测 — 不确定页面结构时，先用 page_list_elements 或 page_query 查证。绝不脑补选择器、URL、元素属性或参数值——不确定就查，宁可多一次工具调用也不要猜。',
      '2. 顺序执行 — 工具依次调用，每次一个，基于前一个结果决定下一步',
      '3. 工具失败 — 尝试替代方案（不同选择器、不同方法），连续3次失败则跳过',
      '4. 及时停止 — 获取足够信息回答用户后，立即停止调用工具，直接给出答案',
      '5. 内容提取 — 用户要求「阅读」「提取」「总结」页面时：首选 page_analyze 获取摘要；需纯文本用 page_query body 或 page_evaluate 取 document.body.innerText。内容较长的可分段提取。',
      '6. 点击元素 — 有明确稳定选择器（id / 语义化 class，如 #submit-btn、.login）用 page_click；选择器难写（动态 class、随机 id、AI 生成 DOM）或 page_list_elements 已列出元素时，用 page_click_by_index 按 index 点击（element_type 必须与 list 时一致）。不要两个都试，选定一个坚持用。',
      '7. 精准执行·不越界 — 只做用户明确要求的动作。不要顺带修改用户没提到的表单字段、主动刷新页面、滚动到视口外、或处理页面上其他可见元素。用户让点一个按钮就只点那一个，别"顺手"清理周边。',
      '',
      '可用工具：'
    ].join('\n');
    prompts.en = [
      'Your name is Goby, an AI browser automation assistant. You can use tools to operate the current page. Respond to the user in English.',
      'Tool usage principles:',
      '[HIGHEST PRIORITY · Goal Anchoring] Before EVERY tool call, silently restate the user\'s original goal. If you notice the current action (switching pages, searching, hunting for alternative content) no longer serves that original goal — STOP immediately and tell the user in one sentence: "The original task was X; I\'m now doing Y, which seems off — should I continue?" NEVER pivot to a brand-new direction and run down it just because you hit an obstacle (404, search failure, element not found) mid-way. This is the single most common failure mode — guard against it.',
      '1. Look before you act · no assumptions — When unsure about the page structure, first use page_list_elements or page_query to verify. NEVER fabricate selectors, URLs, element attributes, or parameter values — when in doubt, query rather than guess.',
      '2. Execute sequentially — Call tools one at a time, each based on the result of the previous one',
      '3. Fallback on failure — Try alternative approaches (different selectors, different methods), skip after 3 consecutive failures',
      '4. Stop in time — Once you have enough information to answer the user, stop calling tools and give the answer directly',
      '5. Content extraction — When user says "read", "extract", "summarize": use page_analyze for summary; use page_query body or page_evaluate document.body.innerText for raw text. Split long content into sections.',
      '6. Clicking elements — Use page_click when you have a stable selector (id / semantic class, e.g. #submit-btn, .login). Use page_click_by_index when selectors are hard to write (dynamic class, random id, AI-generated DOM) or when page_list_elements has already listed the elements (element_type must match the list). Do not try both — pick one and stick with it.',
      '7. Surgical precision · no overreach — Do only what the user explicitly asked. Do not opportunistically modify form fields the user didn\'t mention, refresh the page, scroll out of viewport, or touch other visible elements. If the user asked to click one button, click exactly that one — don\'t "tidy up" surrounding things.',
      '',
      'Available tools:'
    ].join('\n');
    return prompts[_locale] || prompts.zh;
  }

  // ================================================================
  //  getSystemPromptHeader — 返回系统提示词的工具列表标题行（当前语言）
  //  供 content-script.js 在拼接完整 prompt 时使用
  // ================================================================

  function getSystemPromptHeader() {
    return _locale === 'en' ? 'Available tools:' : '可用工具：';
  }

  // ================================================================
  //  初始化：从 storage 读取持久化的语言设置
  // ================================================================

  chrome.storage.local.get('goby_language', function (result) {
    if (result && result.goby_language) {
      _locale = result.goby_language;
    }
  });

  // ================================================================
  //  导出到 window.GobyI18n
  // ================================================================

  window.GobyI18n = {
    t: t,
    setLocale: setLocale,
    getLocale: getLocale,
    getSystemPrompt: getSystemPrompt,
    getSystemPromptHeader: getSystemPromptHeader
  };
})();
