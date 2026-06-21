// Goby - AI 浏览器助手 | Service Worker LLM 代理
// Plan 03-01: LLM 流式/非流式调用中转 (AGENT-02, AGENT-03)
//
// 职责:
//   llm-stream  — 流式调用: fetch SSE → 解析 chunk → tabs.sendMessage 转发
//   llm-request — 非流式调用: fetch → sendResponse 返回完整 JSON
//
// 安全:
//   T-03-01: 验证 response.ok + Content-Type 检查
//   T-03-02: 验证 sender.id === chrome.runtime.id
//   T-03-05: API Key 从 chrome.storage.local 读取，不硬编码

(function () {
  'use strict';

  // ============================================================
  //  HTTP 错误格式化（Phase 03 UAT 测试 11 子问题 1/2）
  //  - 尝试解析 JSON 提取 LLM 服务商的 .error.message 字段
  //  - 按 status 映射友好文案
  //  - 脱敏：移除错误消息里被回显的 API Key 片段
  // ============================================================

  /**
   * 按 HTTP 状态码返回中文友好提示
   * @param {number} status
   * @returns {string}
   */
  function httpStatusHint(status) {
    if (status === 401) return 'API Key 无效或已过期，请在设置中检查';
    if (status === 403) return 'API 拒绝访问（可能权限不足或被风控）';
    if (status === 404) return 'API 地址不存在，请检查 Base URL 是否正确';
    if (status === 429) return '请求过于频繁或额度耗尽，请稍后再试';
    if (status >= 500) return 'LLM 服务端异常（' + status + '），请稍后再试';
    return 'HTTP ' + status;
  }

  /**
   * 从 LLM 服务商的 errorBody 中提取可读消息
   * 支持的格式：{"error":{"message":"..."}} 或 OpenAI 风格 {"error":{"message":"...","type":"..."}}
   * @param {string} errorBody
   * @returns {string|null}
   */
  function extractApiMessage(errorBody) {
    if (!errorBody) return null;
    try {
      var parsed = JSON.parse(errorBody);
      if (parsed && parsed.error && typeof parsed.error.message === 'string') {
        return parsed.error.message;
      }
      if (typeof parsed.message === 'string') {
        return parsed.message;
      }
    } catch (e) {
      // 非 JSON — 返回原文（截断）
      return errorBody.length > 200 ? errorBody.substring(0, 200) + '...' : errorBody;
    }
    return null;
  }

  /**
   * 脱敏：移除错误消息里被服务端回显的 API Key 片段
   * 匹配形如 "api key: sk-xxx" / "key: sk-xxx" / "api_key: sk-xxx" 的子串
   * @param {string} msg
   * @returns {string}
   */
  function redactApiKey(msg) {
    if (typeof msg !== 'string') return msg;
    return msg
      .replace(/(api[_\s-]?key\s*[:：]\s*)([^\s,}"']+)/gi, '$1***')
      .replace(/(bearer\s+)([a-z0-9_\-]{8,})/gi, '$1***');
  }

  /**
   * 格式化 HTTP 错误为用户可读消息
   * @param {number} status
   * @param {string} errorBody
   * @returns {string}
   */
  function formatHttpError(status, errorBody) {
    var hint = httpStatusHint(status);
    var apiMsg = extractApiMessage(errorBody);
    if (apiMsg) {
      return hint + ' — ' + redactApiKey(apiMsg);
    }
    return hint;
  }

  // ============================================================
  //  配置读取
  // ============================================================

  /**
   * 从 chrome.storage.local 读取 active profile 的 API 配置
   * @returns {Promise<{baseUrl: string, apiKey: string, model: string}>}
   */
  function getActiveConfig() {
    return chrome.storage.local.get(['agentConfig']).then(function (result) {
      var config = result.agentConfig || {};
      var activeName = config.activeProfile;
      if (activeName && config.profiles && config.profiles[activeName]) {
        return {
          baseUrl: config.profiles[activeName].baseUrl || '',
          apiKey: config.profiles[activeName].apiKey || '',
          model: config.profiles[activeName].model || ''
        };
      }
      // 降级: 尝试旧格式
      if (typeof config.baseUrl === 'string') {
        return {
          baseUrl: config.baseUrl || '',
          apiKey: config.apiKey || '',
          model: config.model || ''
        };
      }
      return { baseUrl: '', apiKey: '', model: '' };
    });
  }

  // ============================================================
  //  SSE 流解析器
  //  参考 GOBY_DESIGN.md §十五
  // ============================================================

  /**
   * 解析 SSE 流并逐块回调
   * @param {Response} response - fetch Response
   * @param {function} onDelta - 每解析到 delta 时调用 (delta, isDone)
   * @returns {Promise<{content: string, toolCalls: object|null}>}
   */
  function parseSSEStream(response, onDelta) {
    if (!response.ok) {
      return Promise.reject(new Error('HTTP ' + response.status + ': ' + response.statusText));
    }

    // T-03-01: Content-Type 检查
    var contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('text/event-stream') && !contentType.includes('application/json')) {
      // 某些 LLM API 不返回正确的 Content-Type，不阻断但记录
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullContent = '';
    var streamToolCalls = {};
    var hasToolCalls = false;

    function processLine(line) {
      if (!line.startsWith('data: ')) return;
      var data = line.slice(6).trim();
      if (!data || data === '[DONE]') return;

      var parsed;
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        // 跳过无法解析的 chunk
        return;
      }

      var choice = parsed.choices && parsed.choices[0];
      if (!choice) return;

      var delta = choice.delta || {};

      // 收集文本内容
      if (delta.content) {
        fullContent += delta.content;
      }

      // 收集工具调用（按 index 累加，留到 Plan 03-02 在 CS 侧处理）
      if (delta.tool_calls) {
        hasToolCalls = true;
        for (var i = 0; i < delta.tool_calls.length; i++) {
          var tc = delta.tool_calls[i];
          if (!streamToolCalls[tc.index]) {
            streamToolCalls[tc.index] = { id: '', function: { name: '', arguments: '' } };
          }
          if (tc.id) streamToolCalls[tc.index].id = tc.id;
          if (tc.function && tc.function.name) {
            streamToolCalls[tc.index].function.name += tc.function.name;
          }
          if (tc.function && tc.function.arguments) {
            streamToolCalls[tc.index].function.arguments += tc.function.arguments;
          }
        }
      }

      // 回调通知
      onDelta({
        content: delta.content || '',
        reasoning: delta.reasoning || null,
        reasoning_content: delta.reasoning_content || null,
        tool_calls: delta.tool_calls || null,
        done: false,
        fullContent: fullContent
      });
    }

    function readStream() {
      return reader.read().then(function (result) {
        if (result.done) return;

        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (var i = 0; i < lines.length; i++) {
          processLine(lines[i]);
        }

        return readStream();
      });
    }

    return readStream().then(function () {
      // 处理 buffer 中可能残留的行
      if (buffer.trim()) {
        processLine(buffer);
      }

      var finalToolCalls = null;
      if (hasToolCalls) {
        finalToolCalls = {};
        Object.keys(streamToolCalls).forEach(function (index) {
          var tc = streamToolCalls[index];
          // 保持 arguments 为 JSON 字符串，不解析为对象
          // API 要求 function.arguments 为字符串格式
          finalToolCalls[index] = tc;
        });
      }

      return {
        content: fullContent,
        toolCalls: finalToolCalls
      };
    });
  }

  // ============================================================
  //  流式 LLM 调用 (llm-stream)
  // ============================================================

  /**
   * 处理 llm-stream 消息: fetch SSE → 解析 → tabs.sendMessage 转发
   * @param {object} message - { messages, tools, config }
   * @param {number} tabId - 发送者 tab ID
   */
  function handleLLMStream(message, tabId) {
    // D-23: API Key 通过 storage 读取，不经过 postMessage
    var configPromise = getActiveConfig();

    return configPromise.then(function (cfg) {
      var baseUrl = cfg.baseUrl.replace(/\/+$/, '');
      var apiKey = cfg.apiKey;
      var model = cfg.model;

      if (!baseUrl || !apiKey || !model) {
        sendError(tabId, 'API 配置不完整，请在设置中填写 API Base URL、API Key 和 Model Name');
        return;
      }

      var url = baseUrl + '/chat/completions';
      var body = JSON.stringify({
        model: model,
        messages: message.messages || [],
        stream: true
      });

      // 添加 tools 参数（如果提供）
      if (message.tools && message.tools.length > 0) {
        body = JSON.stringify({
          model: model,
          messages: message.messages || [],
          tools: message.tools,
          stream: true
        });
      }

      var fetchOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: body
      };

      globalThis.fetch(url, fetchOptions).then(function (response) {
        if (!response.ok) {
          // 尝试读取错误 body
          return response.text().then(function (errorBody) {
            sendError(tabId, formatHttpError(response.status, errorBody || response.statusText));
            return null;
          });
        }

        return parseSSEStream(response, function (delta) {
          // 转发文本 chunk 到 Content Script
          if (delta.content) {
            chrome.tabs.sendMessage(tabId, {
              action: 'stream-chunk',
              data: {
                type: 'text',
                content: delta.content,
                done: false
              }
            });
          }

          // 转发 reasoning 字段（由 CS 侧处理回退）
          if (delta.reasoning) {
            chrome.tabs.sendMessage(tabId, {
              action: 'stream-chunk',
              data: {
                type: 'text',
                content: delta.reasoning,
                reasoning: true,
                done: false
              }
            });
          }

          if (delta.reasoning_content) {
            chrome.tabs.sendMessage(tabId, {
              action: 'stream-chunk',
              data: {
                type: 'text',
                content: delta.reasoning_content,
                reasoning_content: true,
                done: false
              }
            });
          }

          // 转发 tool_calls 分片（由 CS 侧累加处理）
          if (delta.tool_calls) {
            chrome.tabs.sendMessage(tabId, {
              action: 'stream-chunk',
              data: {
                type: 'tool_calls',
                tool_calls: delta.tool_calls,
                done: false
              }
            });
          }
        });
      }).then(function (result) {
        if (!result) return; // 错误已处理

        // 流结束 — 发送 done 消息（含 tool_calls）
        chrome.tabs.sendMessage(tabId, {
          action: 'stream-chunk',
          data: {
            type: 'done',
            content: result.content,
            done: true,
            message: {
              role: 'assistant',
              content: result.content,
              tool_calls: result.toolCalls || null
            }
          }
        });
      }).catch(function (err) {
        sendError(tabId, '流式请求失败: ' + (err.message || '未知错误'));
      });
    });
  }

  // ============================================================
  //  非流式 LLM 调用 (llm-request)
  // ============================================================

  /**
   * 处理 llm-request 消息: fetch → sendResponse 返回完整 JSON
   * @param {object} message - { messages, tools, config }
   * @param {function} sendResponse - chrome.runtime.sendMessage 回调
   */
  function handleLLMRequest(message, sendResponse) {
    var configPromise = message.config
      ? Promise.resolve(message.config)
      : getActiveConfig();

    configPromise.then(function (cfg) {
      var baseUrl = cfg.baseUrl.replace(/\/+$/, '');
      var apiKey = cfg.apiKey;
      var model = cfg.model;

      if (!baseUrl || !apiKey || !model) {
        sendResponse({ error: { message: 'API 配置不完整，请在设置中填写 API Base URL、API Key 和 Model Name' } });
        return;
      }

      var url = baseUrl + '/chat/completions';
      var body = JSON.stringify({
        model: model,
        messages: message.messages || [],
        stream: false
      });

      if (message.tools && message.tools.length > 0) {
        body = JSON.stringify({
          model: model,
          messages: message.messages || [],
          tools: message.tools,
          stream: false
        });
      }

      globalThis.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: body
      }).then(function (response) {
        if (!response.ok) {
          return response.text().then(function (errorBody) {
            sendResponse({ error: { message: formatHttpError(response.status, errorBody || response.statusText) } });
          });
        }
        return response.json().then(function (data) {
          sendResponse(data);
        });
      }).catch(function (err) {
        sendResponse({ error: { message: '请求失败: ' + (err.message || '未知错误') } });
      });
    }).catch(function (err) {
      sendResponse({ error: { message: '配置读取失败: ' + (err.message || '未知错误') } });
    });

    return true; // 异步响应 — 保持 sendResponse 通道
  }

  // ============================================================
  //  辅助函数
  // ============================================================

  /**
   * 发送错误消息到 Content Script
   * @param {number} tabId
   * @param {string} errorMessage
   */
  function sendError(tabId, errorMessage) {
    chrome.tabs.sendMessage(tabId, {
      action: 'stream-chunk',
      data: {
        type: 'error',
        error: { message: errorMessage },
        done: true
      }
    });
  }

  // ============================================================
  //  Phase 8 / NAV-07 / D-06: active_workflows 注册机制（必须在 onMessage
  //  listener 之前声明，让 listener 内的 handler 能通过函数 hoisting 访问）
  //
  //  _activeWorkflows 内存映射（workflowId → 完整 entry），所有 SW handler
  //  通过闭包访问。MV3 SW idle kill 后内存丢失，必须从 storage 同步恢复
  //  （应对 RESEARCH.md Pitfall 1）。
  //
  //  存储串行化：所有 read-modify-write 通过 updateActiveWorkflows(mutator)
  //  排队执行（_workflowStorageLock Promise 链），避免并发覆盖（T-08-01）。
  // ============================================================

  // 内存映射 — workflowId → { workflowId, chatTabId, workerTabId, chatOrigin, workerOrigin, startedAt, status }
  var _activeWorkflows = {};

  // 写入串行化锁 — 所有 mutator 在此 Promise 链上排队
  var _workflowStorageLock = Promise.resolve();

  // SW 启动时从 storage 恢复内存映射（同步触发的 top-level 代码）
  // 失败时（测试环境 / storage 异常）静默降级，_activeWorkflows 保持空对象
  chrome.storage.local.get('active_workflows').then(function (result) {
    if (result && result.active_workflows && typeof result.active_workflows === 'object') {
      _activeWorkflows = result.active_workflows;
    } else {
      _activeWorkflows = {};
    }
  }).catch(function () {
    // storage 读取失败 — 静默降级，保持空映射（不影响后续 handler）
    _activeWorkflows = {};
  });

  /**
   * 串行化更新 _activeWorkflows 并写回 storage。
   * 所有 read-modify-write 操作必须经此 helper，避免并发覆盖（T-08-01 mitigation）。
   *
   * @param {function(object)} mutator - 操作 _activeWorkflows（如 set/delete key）
   * @returns {Promise<void>}
   */
  function updateActiveWorkflows(mutator) {
    _workflowStorageLock = _workflowStorageLock.then(function () {
      try {
        if (typeof mutator === 'function') {
          mutator(_activeWorkflows);
        }
      } catch (e) {
        // mutator 抛错不影响后续排队
      }
      return chrome.storage.local.set({ active_workflows: _activeWorkflows });
    }).catch(function () {
      // 写入失败 — 静默降级，保持锁链不中断
    });
    return _workflowStorageLock;
  }

  /**
   * 向 worker Tab 发消息，遇到 'Receiving end does not exist' 时重试
   * （CS 未就绪场景，Pitfall 4 防御）。maxRetries 默认 3 次，间隔 200ms。
   *
   * @param {number} tabId
   * @param {object} message
   * @param {number} [maxRetries=3]
   * @returns {Promise<void>}
   */
  function sendToTabWithRetry(tabId, message, maxRetries) {
    if (typeof maxRetries !== 'number' || maxRetries < 0) maxRetries = 3;
    return new Promise(function (resolve) {
      function attempt(retriesLeft) {
        try {
          chrome.tabs.sendMessage(tabId, message, function () {
            var lastError = chrome.runtime.lastError;
            if (lastError && lastError.message &&
                lastError.message.indexOf('Receiving end does not exist') >= 0 &&
                retriesLeft > 0) {
              // CS 尚未就绪 — 延迟 200ms 重试
              setTimeout(function () { attempt(retriesLeft - 1); }, 200);
            } else {
              // 成功或重试耗尽 — 静默 resolve
              resolve();
            }
          });
        } catch (e) {
          // sendMessage 抛错（极端情况）— 重试或放弃
          if (retriesLeft > 0) {
            setTimeout(function () { attempt(retriesLeft - 1); }, 200);
          } else {
            resolve();
          }
        }
      }
      attempt(maxRetries);
    });
  }

  // ============================================================
  //  消息路由
  // ============================================================

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    // T-03-02: 验证消息来源为扩展自身
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    if (message.action === 'llm-stream') {
      var tabId = sender.tab ? sender.tab.id : null;
      if (tabId) {
        handleLLMStream(message, tabId);
      }
      return false; // 不返回 sendResponse（使用 tabs.sendMessage 推送）
    }

    if (message.action === 'llm-request') {
      return handleLLMRequest(message, sendResponse);
    }

    // T-05-03: page-screenshot — 通过 captureVisibleTab 截图
    // Phase 8 fix (260621-eyj): captureVisibleTab 截窗口活动 tab，不是 sender tab。
    //   worker Tab 调 page_screenshot 时焦点可能已切回 chat Tab（panel 自动展开），
    //   导致截到 chat Tab 内容。修复：先 chrome.tabs.update active:true 切到 sender
    //   tab 再截图。不切回——worker Tab 执行 workflow 时本应在前台。
    if (message.action === 'page-screenshot') {
      if (!sender.tab) {
        sendResponse('Error: 无法获取 tabId');
        return true;
      }
      chrome.tabs.update(sender.tab.id, { active: true }, function () {
        chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: 'png'}, function (dataUrl) {
          if (chrome.runtime.lastError) {
            sendResponse('Error: 截图失败 - ' + chrome.runtime.lastError.message);
          } else {
            sendResponse(dataUrl);
          }
        });
      });
      return true; // 异步响应 — 保持 sendResponse 通道
    }

    // Fix C: save-session — 把 saveSession 委托给 SW（SW 寿命长于 page，navigation 后仍能完成写入）
    if (message.action === 'save-session') {
      var sessionId = message.sessionId;
      var sessionData = message.sessionData;
      if (!sessionId || !sessionData) {
        sendResponse({ ok: false, error: 'missing sessionId or sessionData' });
        return false;
      }
      chrome.storage.local.get('gobySessions').then(function (result) {
        var sessions = result.gobySessions || {};
        sessions[sessionId] = sessionData;
        return chrome.storage.local.set({ gobySessions: sessions });
      }).then(function () {
        // LRU 淘汰（保留最近 50 条）
        return chrome.storage.local.get('gobySessions');
      }).then(function (result) {
        var sessions = result.gobySessions || {};
        var keys = Object.keys(sessions);
        if (keys.length <= 50) {
          return;
        }
        // 按 updatedAt 升序排序，删除最旧的
        keys.sort(function (a, b) {
          return (sessions[a].updatedAt || 0) - (sessions[b].updatedAt || 0);
        });
        var toRemove = keys.length - 50;
        for (var i = 0; i < toRemove; i++) {
          delete sessions[keys[i]];
        }
        return chrome.storage.local.set({ gobySessions: sessions });
      }).then(function () {
        // Phase 8 / NAV-06 / D-03: 同步维护 lastActiveSessions 全局索引
        // CS 永不直接写该 key（避免并发覆盖）；SW 单点维护，LRU 淘汰 10 条
        // 索引更新失败不阻断 sendResponse 主流程（独立 catch 静默降级）
        return chrome.storage.local.get('lastActiveSessions').then(function (idxResult) {
          var index = idxResult.lastActiveSessions || [];
          // 去重：剔除同 sessionId 旧记录
          var filtered = index.filter(function (entry) {
            return entry.sessionId !== sessionId;
          });
          // push 新记录
          var newEntry = {
            sessionId: sessionId,
            origin: (sessionData && sessionData.origin) || '',
            updatedAt: (sessionData && sessionData.updatedAt) || Date.now()
          };
          filtered.push(newEntry);
          // 按 updatedAt desc 排序（最新在前）— 保证乱序写入时索引仍有序
          filtered.sort(function (a, b) {
            return (b.updatedAt || 0) - (a.updatedAt || 0);
          });
          // LRU 截断：保留最多 10 条
          var capped = filtered.slice(0, 10);
          return chrome.storage.local.set({ lastActiveSessions: capped });
        }).catch(function () {
          // 索引更新失败 — 静默降级，不阻断 sendResponse 主流程
        });
      }).then(function () {
        sendResponse({ ok: true });
      }).catch(function (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      });
      return true; // 异步响应
    }

    // T-04-04: page-evaluate — 通过 MAIN world 执行 JS (D-07)
    if (message.action === 'page-evaluate') {
      if (!sender.tab) {
        sendResponse('Error: 无法获取 tabId');
        return true;
      }
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: function (expr) {
          try {
            return eval(expr);
          } catch (e) {
            return 'Error: ' + e.message;
          }
        },
        args: [message.expression]
      }).then(function (results) {
        var result = results && results[0] && results[0].result;
        sendResponse(String(result !== undefined ? result : ''));
      }).catch(function (err) {
        sendResponse('Error: ' + (err.message || '执行失败'));
      });
      return true; // 保持 sendResponse 异步通道开启
    }

    // ============================================================
    //  Phase 7: Tab Navigation Tools
    // ============================================================

    // NAV-01, D-04: tab-navigate — chrome.tabs.update 当前标签页
    // Phase 8 fix: 导航前 SW 先把 sender origin 的 session 标记为 interrupted=true。
    //   之前依赖 CS 的 saveSession()（异步，导航期间 CS 可能已被 kill，interrupted
    //   没来得及写入 storage）→ 新页面 loadSession 读不到 interrupted → 不 resume。
    //   SW 单线程执行：标记 interrupted → tabs.update → 新页面一定能读到 interrupted。
    if (message.action === 'tab-navigate') {
      if (!sender.tab) {
        sendResponse('Error: 无法获取 tabId');
        return true;
      }
      // 解析 sender origin
      var navigateOrigin;
      try { navigateOrigin = new URL(sender.tab.url).origin; } catch (e) { navigateOrigin = ''; }
      // 标记当前 session 为 interrupted
      var markPromise = navigateOrigin
        ? chrome.storage.local.get('gobySessions').then(function (result) {
            var sessions = result.gobySessions || {};
            var keys = Object.keys(sessions);
            // 找该 origin 的**最新** session（按 updatedAt 降序）
            var matchedKey = null;
            var matchedUpdatedAt = 0;
            for (var ki = 0; ki < keys.length; ki++) {
              var s = sessions[keys[ki]];
              if (s.origin === navigateOrigin && (s.updatedAt || 0) >= matchedUpdatedAt) {
                matchedKey = keys[ki];
                matchedUpdatedAt = s.updatedAt || 0;
              }
            }
            if (matchedKey) {
              sessions[matchedKey].interrupted = true;
              sessions[matchedKey].interruptedAt = Date.now();
              return chrome.storage.local.set({ gobySessions: sessions });
            }
          }).catch(function () { /* 静默降级 */ })
        : Promise.resolve();
      // 标记完成后才导航
      markPromise.then(function () {
        chrome.tabs.update(sender.tab.id, { url: message.url }, function () {
          if (chrome.runtime.lastError) {
            sendResponse('Error: 导航失败 - ' + chrome.runtime.lastError.message);
          } else {
            sendResponse('已导航到: ' + message.url);
          }
        });
      });
      return true; // 异步响应
    }

    // NAV-02, D-05, NAV-10, Phase 8/NAV-07/D-06: tab-open — chrome.tabs.create
    //   + onUpdated 等待 + 15s 超时 + workflow 注册（UUID + active_workflows + workflow-init 注入）
    if (message.action === 'tab-open') {
      // Phase 8 / NAV-07 / D-05: 生成 workflow UUID（8 hex 字符，wf_ 前缀）
      // SW secure context 始终可用 crypto.randomUUID；HTTP 页面（Pitfall 6）fallback 到
      // Date.now + Math.random — fallback 路径仍保证 wf_ 前缀
      var workflowId = 'wf_';
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          workflowId += crypto.randomUUID().slice(0, 8);
        } else {
          workflowId += Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        }
      } catch (e) {
        // crypto 抛错（极端情况）— fallback 路径
        workflowId = 'wf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      }

      chrome.tabs.create({ url: message.url, active: true }, function (tab) {
        // 15s 超时保护
        var timeoutId = setTimeout(function () {
          sendResponse('Error: 标签页加载超时 - ' + message.url);
        }, 15000);

        // 注册 onUpdated 监听，等待 status === 'complete'
        function onUpdated(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            clearTimeout(timeoutId);

            // Phase 8 / NAV-07 / D-06: 注册 active_workflows 映射
            // sender.tab.id = chat Tab，tab.id = 新创建的 worker Tab
            var chatTabId = (sender.tab && typeof sender.tab.id === 'number') ? sender.tab.id : null;
            var chatOrigin = (sender.tab && sender.tab.url) || '';
            updateActiveWorkflows(function (workflows) {
              workflows[workflowId] = {
                workflowId: workflowId,
                chatTabId: chatTabId,
                workerTabId: tab.id,
                // Phase 8 / NAV-09 / D-16: 记录 worker Tab 所在 windowId，供
                // chrome.windows.onRemoved 兜底清理（Pitfall 3：窗口关闭时
                // tabs.onRemoved 可能不触发，必须有 windows.onRemoved 兜底）
                workerWindowId: (typeof tab.windowId === 'number') ? tab.windowId : null,
                chatOrigin: chatOrigin,
                workerOrigin: message.url,
                startedAt: Date.now(),
                status: 'active'
              };
            });

            // Phase 8 / NAV-07 / D-10 缺口补全: 向 worker Tab 注入 workflow_id +
            //   inherited_messages（chat Tab 最后 5 条 messages）+ initial_user_message
            //   （D-10：让工作 Tab 有 chat Tab 上下文 + 角色定位）
            // CS 未就绪时 retry 3 次 200ms — 全部失败也不阻塞 sendResponse
            // storage 拉取失败时降级 inherited_messages=[]，仍发基础 workflow-init
            // Phase 8 fix (260621-f4z): page_open_tab 增加 task 参数；优先用 chat Tab
            //   传来的 message.task 作为 initial_user_message（让 worker Tab 知道做什么）
            //   fallback：LLM 忘传 task 时降级到原占位符
            var workerOrigin = message.url;
            // Phase 8 fix (260621-f4z): page_open_tab 增加 task 参数；优先用 chat Tab
            //   传来的 message.task 作为 initial_user_message（让 worker Tab 知道做什么）
            //   fallback：LLM 忘传 task 时降级到原占位符
            // Phase 8 fix (260621-hKk): task 存在时增强引导「完成后必须调 page_finish_workflow」，
            //   避免 worker Tab 完整执行任务却不调 finish_workflow 导致 chat Tab 永久卡死。
            //   fallback 路径保持原格式（向后兼容 08-workflow-init-payload.test.js test 4）
            var initialUserMessage;
            if (message.task && typeof message.task === 'string' && message.task.trim()) {
              initialUserMessage = '[Workflow ' + workflowId + '] 你是 worker Tab，已经在目标页面上（URL: ' + workerOrigin + '）。任务：' + message.task.trim() +
                '\n\n执行约束：' +
                '\n1. **禁止调 page_navigate** —— 你已经在目标页面，跳走会导致 session 丢失、workflow 卡死。如需去其他页面，告知 chat Tab 后由它启动新 workflow。' +
                '\n2. 直接用 page_query / page_evaluate / page_analyze / page_screenshot 等工具操作当前页面。' +
                '\n3. **你的普通文本回复不会显示给用户**。完成任务后，**唯一**与用户通信的方式是调用 page_finish_workflow(summary) 工具，summary 参数写你想告诉用户的完整结果和总结。' +
                '\n4. 禁止使用普通文本回复代替 page_finish_workflow 调用——那等于什么都没发出去，chat Tab 会永久卡死。';
            } else {
              initialUserMessage = 'Working in workflow ' + workflowId + ', origin: ' + workerOrigin;
            }
            // 异步拉 chat Tab 最后 5 条 messages — 失败降级到 []
            chrome.storage.local.get('gobySessions').then(function (gsResult) {
              var sessions = (gsResult && gsResult.gobySessions) || {};
              var chatOrigin = (sender.tab && sender.tab.url) ? sender.tab.url : '';
              // 解析 sender.tab.url 的 origin
              try {
                if (sender.tab && sender.tab.url) {
                  chatOrigin = new URL(sender.tab.url).origin;
                }
              } catch (e) { /* URL 解析失败 — 用原值降级 */ }
              // 找到 origin 匹配的最新 session（按 updatedAt 倒序）
              var matched = null;
              try {
                var entries = Object.keys(sessions)
                  .map(function (k) { return sessions[k]; })
                  .filter(function (s) { return s && s.origin === chatOrigin; })
                  .sort(function (a, b) {
                    return (b.updatedAt || 0) - (a.updatedAt || 0);
                  });
                if (entries.length > 0) matched = entries[0];
              } catch (e) { /* 排序/过滤失败 — 降级 */ }
              var inheritedMessages = [];
              if (matched && Array.isArray(matched.messages)) {
                inheritedMessages = matched.messages.slice(-5);
              }
              return inheritedMessages;
            }).catch(function () {
              // storage 异常 — 降级到空数组
              return [];
            }).then(function (inheritedMessages) {
              try {
                sendToTabWithRetry(tab.id, {
                  action: 'workflow-init',
                  workflow_id: workflowId,
                  inherited_messages: inheritedMessages,
                  initial_user_message: initialUserMessage
                }, 3);
              } catch (e) {
                // 静默降级 — 不阻塞 sendResponse
              }
            });

            // sendResponse 字符串末尾追加 (workflow: <id>) — 让 chat Tab 知道启动了哪个 workflow
            sendResponse('已打开标签页: [' + tab.id + '] ' + (changeInfo.title || tab.title || '新标签页') + ' (workflow: ' + workflowId + ')');
          }
        }
        chrome.tabs.onUpdated.addListener(onUpdated);
      });
      return true; // 异步响应
    }

    // NAV-03, D-06: tab-close — chrome.tabs.remove
    if (message.action === 'tab-close') {
      chrome.tabs.remove(message.tabId, function () {
        if (chrome.runtime.lastError) {
          sendResponse('Error: 关闭失败 - ' + chrome.runtime.lastError.message);
        } else {
          sendResponse('已关闭标签页: ' + message.tabId);
        }
      });
      return true; // 异步响应
    }

    // NAV-04, D-07: tab-switch — chrome.tabs.update active:true
    if (message.action === 'tab-switch') {
      chrome.tabs.update(message.tabId, { active: true }, function (tab) {
        if (chrome.runtime.lastError) {
          sendResponse('Error: 切换失败 - ' + chrome.runtime.lastError.message);
        } else {
          sendResponse('已切换到标签页: ' + (tab.title || tab.id) + ' (tabId=' + tab.id + ')');
        }
      });
      return true; // 异步响应
    }

    // NAV-05, D-08: tab-list — chrome.tabs.query current window only
    if (message.action === 'tab-list') {
      chrome.tabs.query({ currentWindow: true }, function (tabs) {
        var lines = tabs.map(function (t, i) {
          return (i + 1) + '. ' + (t.active ? '[active] ' : '') + (t.title || '无标题') + ' (' + (t.url || '') + ') tabId=' + t.id;
        });
        sendResponse('当前有 ' + tabs.length + ' 个标签页:\n' + lines.join('\n'));
      });
      return true; // 异步响应
    }

    // ============================================================
    //  Phase 8 / NAV-07 / NAV-08: 跨 Tab 工作流消息中继
    //  D-08: 三种消息类型 workflow_progress / workflow_complete / workflow_error
    //        由工作 Tab Agent 经 SW 转发回 chat Tab
    // ============================================================

    // workflow-progress: 工作 Tab → SW → chat Tab 转发
    // T-08-08: 防 spoofing — sender.tab.id 必须匹配 _activeWorkflows[wfId].workerTabId
    // SW 查 _activeWorkflows 找到 chatTabId 后经 sendToTabWithRetry 转发
    // （Pitfall 4 防御：CS 未就绪时 200ms × maxRetries 重试）
    if (message.action === 'workflow-progress') {
      var wfId = message.workflow_id;
      var wfEntry = (wfId && _activeWorkflows[wfId]) || null;
      if (!wfEntry) {
        // 静默降级 — workflowId 不在映射（可能是 SW restart race 或测试环境）
        sendResponse({ ok: true });
        return false;
      }
      // 防伪造：sender.tab.id 必须是 workerTabId
      if (!sender.tab || sender.tab.id !== wfEntry.workerTabId) {
        sendResponse({ ok: false, error: 'sender 不匹配 workflow workerTabId' });
        return false;
      }
      // 经 sendToTabWithRetry 转发 — 重试 3 次（CS 未就绪场景）
      sendToTabWithRetry(wfEntry.chatTabId, {
        action: 'workflow_progress',
        workflow_id: wfId,
        data: message.data
      }, 3).then(function () {
        sendResponse({ ok: true });
      }).catch(function () {
        sendResponse({ ok: false, error: '转发失败' });
      });
      return true; // 异步响应 — 保持 sendResponse 通道
    }

    // page-finish-workflow: 工作 Tab Agent 调 page_finish_workflow 工具 → SW 中转
    // T-08-09: 防 spoofing — sender.tab.id 必须匹配 workerTabId
    // D-14/D-15: SW 转发 summary 给 chat Tab + 同步 delete _activeWorkflows[wfId]
    // Claude's Discretion 锁定：complete 时同步清 active_workflows（不留垃圾）
    if (message.action === 'page-finish-workflow') {
      var pfWfId = message.workflow_id;
      var pfEntry = (pfWfId && _activeWorkflows[pfWfId]) || null;
      if (!pfEntry) {
        sendResponse({ ok: false, error: '未找到 workflow ' + pfWfId });
        return false;
      }
      // 防伪造：sender.tab.id 必须是 workerTabId
      if (!sender.tab || sender.tab.id !== pfEntry.workerTabId) {
        sendResponse({ ok: false, error: 'sender 不匹配 workflow workerTabId' });
        return false;
      }
      var chatTabId = pfEntry.chatTabId;
      // 同步清理 active_workflows — Claude's Discretion 锁定 complete 时同步清
      updateActiveWorkflows(function (workflows) {
        delete workflows[pfWfId];
      }).then(function () {
        return sendToTabWithRetry(chatTabId, {
          action: 'workflow_complete',
          workflow_id: pfWfId,
          data: {
            summary: message.summary,
            finalTabId: sender.tab.id
          }
        }, 3);
      }).then(function () {
        sendResponse('已结束 workflow ' + pfWfId);
      }).catch(function (err) {
        sendResponse('Error: 结束 workflow 失败 - ' + (err && err.message || err));
      });
      return true; // 异步响应
    }

    // Phase 8 fix: delete-all-sessions — CS 委托 SW 执行全清 + 广播所有 tab
    //   直接 chrome.storage.local.remove 在单个 tab 的 CS 里执行会导致其他
    //   tab 的 saveSession 把各自内存 session 重新写回 storage（"活尸"复活）。
    //   SW 单线程执行保证无竞态；tabs.query + sendMessage 广播保证所有 tab
    //   同步重置本地 _agentState。
    if (message.action === 'delete-all-sessions') {
      chrome.storage.local.remove('gobySessions').then(function () {
        // 广播 sessions-deleted 给所有 tab
        chrome.tabs.query({}, function (tabs) {
          for (var ti = 0; ti < tabs.length; ti++) {
            try {
              chrome.tabs.sendMessage(tabs[ti].id, { action: 'sessions-deleted' }, function () {
                void chrome.runtime.lastError; // 静默忽略未注入 CS 的 tab
              });
            } catch (e) { /* tab 不存在或 CS 未注入 — 跳过 */ }
          }
        });
        sendResponse({ ok: true });
      }).catch(function (err) {
        sendResponse({ ok: false, error: 'storage.remove 失败 — ' + (err && err.message || err) });
      });
      return true; // 异步响应
    }

    // ============================================================
    //  Plan 09-01: Skills 系统 — SW 侧处理
    // ============================================================

    // skill-import: CS → SW fetch() 下载远程 SKILL.md → 返回内容给 CS
    // 安全：仅允许 https:// URL（拒绝 http/data/file 协议）
    if (message.action === 'skill-import') {
      var skillUrl = message.url;
      if (!skillUrl || typeof skillUrl !== 'string') {
        sendResponse({ ok: false, error: '缺少 url 参数' });
        return false;
      }
      // 协议白名单
      var urlLower = skillUrl.toLowerCase();
      if (!urlLower.startsWith('https://')) {
        sendResponse({ ok: false, error: '仅支持 https:// 协议的技能文件 URL' });
        return false;
      }
      // SW 使用 fetch 下载（MV3 SW 环境可用）
      globalThis.fetch(skillUrl)
        .then(function (response) {
          if (!response.ok) {
            return response.text().then(function (body) {
              sendResponse({ ok: false, error: '下载失败 HTTP ' + response.status + ': ' + (body || response.statusText).substring(0, 200) });
            });
          }
          return response.text().then(function (text) {
            sendResponse({ ok: true, content: text });
          });
        })
        .catch(function (err) {
          sendResponse({ ok: false, error: '网络请求失败: ' + (err.message || String(err)) });
        });
      return true; // 异步响应
    }

    // skill-store: CS → SW 写入技能 Manifest 到 chrome.storage.local
    if (message.action === 'skill-store') {
      var skillManifest = message.skillManifest;
      if (!skillManifest || !skillManifest.domain) {
        sendResponse({ ok: false, error: '缺少 skillManifest 或 domain 字段' });
        return false;
      }
      chrome.storage.local.get(['gobySkills']).then(function (result) {
        var skills = result.gobySkills || {};
        skills[skillManifest.domain] = {
          name: skillManifest.name || '',
          description: skillManifest.description || '',
          domain: skillManifest.domain,
          actions: skillManifest.actions || [],
          installedAt: Date.now(),
          source: skillManifest.source || ''
        };
        return chrome.storage.local.set({ gobySkills: skills });
      }).then(function () {
        sendResponse({ ok: true, domain: skillManifest.domain });
      }).catch(function (err) {
        sendResponse({ ok: false, error: 'storage 写入失败: ' + (err.message || String(err)) });
      });
      return true; // 异步响应
    }

    // skill-list: CS → SW 读取所有已安装技能
    if (message.action === 'skill-list') {
      chrome.storage.local.get(['gobySkills']).then(function (result) {
        sendResponse({ ok: true, skills: result.gobySkills || {} });
      }).catch(function (err) {
        sendResponse({ ok: false, error: 'storage 读取失败: ' + (err.message || String(err)) });
      });
      return true; // 异步响应
    }

    // skill-remove: CS → SW 按 domain 删除技能
    if (message.action === 'skill-remove') {
      var rmDomain = message.domain;
      if (!rmDomain || typeof rmDomain !== 'string') {
        sendResponse({ ok: false, error: '缺少 domain 参数' });
        return false;
      }
      chrome.storage.local.get(['gobySkills']).then(function (result) {
        var skills = result.gobySkills || {};
        if (!skills[rmDomain]) {
          sendResponse({ ok: false, error: '技能 "' + rmDomain + '" 不存在' });
          return;
        }
        delete skills[rmDomain];
        return chrome.storage.local.set({ gobySkills: skills }).then(function () {
          sendResponse({ ok: true });
        });
      }).catch(function (err) {
        sendResponse({ ok: false, error: 'storage 操作失败: ' + (err.message || String(err)) });
      });
      return true; // 异步响应
    }

    return false;
  });

  // ============================================================
  //  Phase 8 / NAV-09 / D-16: chrome.tabs.onRemoved + chrome.windows.onRemoved
  //
  //  错误恢复路径：工作 Tab 意外关闭时（用户手动关 / 窗口关闭 / 浏览器崩），
  //  SW 必须向 chat Tab 发 workflow_error 通知，避免 chat Tab 永久卡
  //  isProcessing=true。无显式超时（D-17），用户兜底是手动关闭工作 Tab。
  //
  //  Pitfall 3 兜底：窗口关闭时 tabs.onRemoved 可能不触发（Chrome 行为不稳
  //  定），必须有 windows.onRemoved 监听兜底。两者协同：
  //    - tabs.onRemoved + isWindowClosing:false → 立即 delete + storage 清
  //    - tabs.onRemoved + isWindowClosing:true  → 标 status='error' 但保留
  //      （让 windows.onRemoved 兜底清理，避免双重通知+竞态）
  //    - windows.onRemoved → 找 workerWindowId 匹配的 workflow 兜底清理
  //
  //  必须在 SW top-level 注册（MV3 SW restart 后同步执行），保证 listener
  //  在新 SW 实例上立即恢复（应对 RESEARCH.md Pitfall 1）。
  // ============================================================

  // chrome.tabs.onRemoved：工作 Tab 被关闭时通知 chat Tab
  // - 遍历 _activeWorkflows 找 workerTabId === removedTabId && status='active'
  // - reason 文案：'工作 Tab 被关闭' + （isWindowClosing 时追加 '（窗口关闭）'）
  // - isWindowClosing === false：立即 delete + storage 清
  // - isWindowClosing === true：标 status='error'（避免重复通知），让 windows.onRemoved 兜底
  chrome.tabs.onRemoved.addListener(function (removedTabId, removeInfo) {
    Object.keys(_activeWorkflows).forEach(function (wfId) {
      var wf = _activeWorkflows[wfId];
      if (!wf || wf.workerTabId !== removedTabId || wf.status !== 'active') {
        return;
      }
      var reason = '工作 Tab 被关闭' +
        (removeInfo && removeInfo.isWindowClosing ? '（窗口关闭）' : '');
      sendToTabWithRetry(wf.chatTabId, {
        action: 'workflow_error',
        workflow_id: wfId,
        data: { reason: reason }
      }, 3);
      if (!removeInfo || !removeInfo.isWindowClosing) {
        // 非窗口关闭 — 立即清理
        updateActiveWorkflows(function (workflows) {
          delete workflows[wfId];
        });
      } else {
        // 窗口关闭 — 标 status='error' 但保留，让 windows.onRemoved 兜底清理
        // （T-08-16: 防止 windows.onRemoved 误清理仍 active 的 workflow；
        //  status='error' 后 windows.onRemoved 二次清理是幂等的，无副作用）
        updateActiveWorkflows(function (workflows) {
          if (workflows[wfId]) workflows[wfId].status = 'error';
        });
      }
    });
  });

  // chrome.windows.onRemoved：窗口关闭兜底（Pitfall 3 — 窗口关闭时
  // tabs.onRemoved 可能不触发）
  // - 遍历 _activeWorkflows 找 workerWindowId === windowId && status !== 'completed'
  // - 发 workflow_error 给 chatTabId（reason '工作 Tab 被关闭（窗口关闭）'）
  // - 同步 delete + storage 清（包含 status='error' 的 entry — 幂等清理）
  chrome.windows.onRemoved.addListener(function (windowId) {
    Object.keys(_activeWorkflows).forEach(function (wfId) {
      var wf = _activeWorkflows[wfId];
      if (!wf || wf.workerWindowId !== windowId || wf.status === 'completed') {
        return;
      }
      sendToTabWithRetry(wf.chatTabId, {
        action: 'workflow_error',
        workflow_id: wfId,
        data: { reason: '工作 Tab 被关闭（窗口关闭）' }
      }, 3);
      updateActiveWorkflows(function (workflows) {
        delete workflows[wfId];
      });
    });
  });

})();
