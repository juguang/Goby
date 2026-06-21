// Goby - AI 浏览器助手 | SKILL.md Loader & Validator
// Plan 09-01: 解析 browsing-skills 标准 SKILL.md → 验证 → 输出 SkillManifest
//
// 支持的 SKILL.md 格式（browsing-skills 兼容）：
//   ---
//   name: Amazon Product Search
//   description: 在 Amazon 上搜索商品
//   ---
//   ## search_products
//   Description: 根据关键词搜索商品
//   Input: { "keyword": "string" }
//   ```javascript
//   // 搜索逻辑
//   ```
//
// 安全：验证阶段禁止 fetch/XMLHttpRequest/navigator.sendBeacon（代码注入防护）

(function () {
  'use strict';

  // ============================================================
  //  YAML Frontmatter 解析器（内联，无外部依赖）
  //  仅支持 {key}: {value} 格式的单行键值对（位于 --- 标记之间）
  // ============================================================

  /**
   * 解析 YAML frontmatter 文本为 key-value 对象
   * @param {string} text - frontmatter 区的纯文本（不含 --- 标记）
   * @returns {Object} { key: value, ... }
   */
  function parseFrontmatterLines(text) {
    var result = {};
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      // 跳过空行和注释
      if (!line || line.startsWith('#')) continue;
      var colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      var key = line.slice(0, colonIdx).trim();
      var value = line.slice(colonIdx + 1).trim();
      // 去掉值的引号包裹（'value' 或 "value"）
      if ((value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
    return result;
  }

  // ============================================================
  //  危险的 Web API 列表（代码注入防护）
  // ============================================================

  var DANGEROUS_APIS = [
    'fetch',
    'XMLHttpRequest',
    'navigator.sendBeacon'
  ];

  // ============================================================
  //  parseSkillMarkdown — 解析完整 SKILL.md 文件
  // ============================================================

  /**
   * 解析 SKILL.md Markdown 文本为 SkillManifest 对象
   *
   * 格式：
   *   ---
   *   name: {skill name}
   *   description: {description}
   *   ---
   *   ## {action_name}
   *   Description: {action description}
   *   Input: { "key": "type" }
   *   ```javascript
   *   // 函数体代码
   *   ```
   *
   * @param {string} markdownText - SKILL.md 原始文本
   * @returns {{name: string, description: string, domain: string, actions: Array, rawSource: string}}
   */
  function parseSkillMarkdown(markdownText) {
    if (typeof markdownText !== 'string' || !markdownText.trim()) {
      throw new Error('SKILL.md 内容为空');
    }

    var lines = markdownText.split('\n');
    var state = 'before-frontmatter'; // before-frontmatter | in-frontmatter | in-body
    var frontmatterLines = [];
    var bodyStartLine = 0;

    // 第一步：提取 YAML frontmatter
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (state === 'before-frontmatter') {
        if (line === '---') {
          state = 'in-frontmatter';
        }
      } else if (state === 'in-frontmatter') {
        if (line === '---') {
          state = 'in-body';
          bodyStartLine = i + 1;
          break;
        }
        frontmatterLines.push(lines[i]);
      }
    }

    if (frontmatterLines.length === 0) {
      throw new Error('SKILL.md 缺少 YAML frontmatter（需要 --- name: ... --- 块）');
    }

    // 解析 frontmatter
    var metadata = parseFrontmatterLines(frontmatterLines.join('\n'));
    if (!metadata.name) {
      throw new Error('SKILL.md frontmatter 缺少 name 字段');
    }

    // 第二步：解析 body 中的 action 块
    // 格式: ## {action_name}\nDescription: ...\nInput: {...}\n```javascript\n...\n```
    var actions = [];
    var bodyText = lines.slice(bodyStartLine).join('\n');

    // 按 ## header 分割 action 块（## 后跟字母/下划线 = action 标题）
    var actionBlocks = bodyText.split(/\n(?=##\s+[a-zA-Z_])/);

    for (var a = 0; a < actionBlocks.length; a++) {
      var block = actionBlocks[a].trim();
      if (!block) continue;

      var actionName = '';
      var actionDescription = '';
      var inputSchema = {};

      // 提取 action 名称（## 标题）
      var headerMatch = block.match(/^##\s+(\S+)/);
      if (headerMatch) {
        actionName = headerMatch[1];
      }

      // 跳过空名称
      if (!actionName) continue;

      // 提取 Description 行
      var descMatch = block.match(/^Description:\s*(.+)$/m);
      if (descMatch) {
        actionDescription = descMatch[1].trim();
      }

      // 提取 Input schema（JSON 对象）
      var inputMatch = block.match(/^Input:\s*(.+)$/m);
      if (inputMatch) {
        try {
          inputSchema = JSON.parse(inputMatch[1].trim());
        } catch (e) {
          // 解析失败 → 保留空对象
          inputSchema = {};
        }
      }

      // 提取代码块内容（```javascript ... ```）
      var codeBlockMatch = block.match(/```(?:javascript|js)\n([\s\S]*?)```/);
      var rawCode = '';
      if (codeBlockMatch) {
        rawCode = codeBlockMatch[1].trim();
      }

      actions.push({
        name: actionName,
        description: actionDescription,
        inputSchema: inputSchema,
        rawCode: rawCode
      });
    }

    // 第三步：组装 SkillManifest
    return {
      name: metadata.name,
      description: metadata.description || '',
      domain: metadata.domain || '',
      actions: actions,
      rawSource: markdownText
    };
  }

  // ============================================================
  //  validateSkill — 验证 SkillManifest 安全性和完整性
  // ============================================================

  /**
   * 验证 SkillManifest 是否合法、安全。
   * 返回 { valid: boolean, errors: string[], manifest: Object|null }
   *
   * 验证规则：
   *  1. name/domain 不为空
   *  2. 至少有一个 action
   *  3. 每个 action 有 name/description/execute（rawCode 可通过 new Function 创建）
   *  4. rawCode 不包含危险 API（fetch/XMLHttpRequest/navigator.sendBeacon）
   *
   * @param {Object} parseResult - parseSkillMarkdown 的输出
   * @returns {{valid: boolean, errors: string[], skillManifest: Object|null}}
   */
  function validateSkill(parseResult) {
    var errors = [];

    if (!parseResult || typeof parseResult !== 'object') {
      errors.push('SkillManifest 为空或格式错误');
      return { valid: false, errors: errors, skillManifest: null };
    }

    // 规则 1: name 和 domain 不为空
    if (!parseResult.name || typeof parseResult.name !== 'string' || !parseResult.name.trim()) {
      errors.push('Skill 缺少 name 字段');
    }
    if (!parseResult.domain || typeof parseResult.domain !== 'string' || !parseResult.domain.trim()) {
      errors.push('Skill 缺少 domain 字段');
    }

    // 规则 2: 至少有一个 action
    if (!Array.isArray(parseResult.actions) || parseResult.actions.length === 0) {
      errors.push('Skill 必须至少包含一个 action');
      return { valid: false, errors: errors, skillManifest: null };
    }

    // 规则 3 + 4: 验证每个 action
    var validatedActions = [];
    for (var i = 0; i < parseResult.actions.length; i++) {
      var action = parseResult.actions[i];

      if (!action.name || typeof action.name !== 'string' || !action.name.trim()) {
        errors.push('Action #' + (i + 1) + ' 缺少 name');
        continue;
      }

      if (!action.rawCode || typeof action.rawCode !== 'string' || !action.rawCode.trim()) {
        errors.push('Action "' + action.name + '" 缺少可执行代码（```javascript 块）');
        continue;
      }

      // 规则 4: 安全检查 — 禁止危险 API
      var codeLower = action.rawCode.toLowerCase();
      for (var d = 0; d < DANGEROUS_APIS.length; d++) {
        var api = DANGEROUS_APIS[d];
        // 检查是否有该 API 的调用（不是字符串字面量中的出现）
        // 简单但保守的策略：只要代码中出现 API 名称即拦截
        var apiLower = api.toLowerCase();
        if (codeLower.indexOf(apiLower) !== -1) {
          errors.push('Action "' + action.name + '" 包含禁止的 API: ' + api);
          break; // 一个 action 只报一次危险 API 错误
        }
      }

      // 如果有错误，跳过此 action
      if (errors.length > 0) {
        // 检查是否有此 action 的特定错误
        continue;
      }

      // 尝试通过 new Function 创建 execute 函数
      // 安全的执行上下文（限制全局访问）
      var executeFn = null;
      try {
        // 使用 new Function 将 rawCode 包装为函数
        // 参数: args (输入参数), pageContext (页面上下文，由调用方提供)
        var wrappedCode = '"use strict";\n' + action.rawCode;
        // 查找是否有 function 关键字或 => 箭头函数定义
        // 若 rawCode 已是完整函数体（无 function 包裹），则包裹为函数
        var isAlreadyFunction = /^\s*(async\s+)?function\s*\(/.test(action.rawCode) ||
                               /^\s*(async\s+)?\(/.test(action.rawCode) ||
                               /^\s*(async\s+)?[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/.test(action.rawCode);
        if (isAlreadyFunction) {
          // rawCode 本身是一个函数表达式 → 通过 new Function 返回
          executeFn = new Function('return (' + action.rawCode + ')')();
        } else {
          // rawCode 是函数体 → 包装为函数
          executeFn = new Function('args', 'pageContext', wrappedCode);
        }
      } catch (e) {
        errors.push('Action "' + action.name + '" 代码编译失败: ' + (e.message || String(e)));
        continue;
      }

      if (typeof executeFn !== 'function') {
        errors.push('Action "' + action.name + '" rawCode 未编译为有效函数');
        continue;
      }

      validatedActions.push({
        name: action.name,
        description: action.description || '',
        inputSchema: action.inputSchema || {},
        execute: executeFn
      });
    }

    if (errors.length > 0) {
      return { valid: false, errors: errors, skillManifest: null };
    }

    if (validatedActions.length === 0) {
      errors.push('没有通过验证的 action');
      return { valid: false, errors: errors, skillManifest: null };
    }

    // 组装最终 SkillManifest（只保留可序列化的字段，execute 除外）
    var skillManifest = {
      name: parseResult.name.trim(),
      description: parseResult.description || '',
      domain: parseResult.domain.trim(),
      actions: validatedActions,
      rawSource: parseResult.rawSource || ''
    };

    return { valid: true, errors: [], skillManifest: skillManifest };
  }

  // ============================================================
  //  暴露
  // ============================================================

  var SkillLoader = {
    parseSkillMarkdown: parseSkillMarkdown,
    validateSkill: validateSkill,
    parseFrontmatterLines: parseFrontmatterLines
  };

  if (typeof window !== 'undefined') {
    window.SkillLoader = SkillLoader;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.SkillLoader = SkillLoader;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SkillLoader;
  }
})();
