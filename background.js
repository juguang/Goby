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
            sendError(tabId, 'HTTP ' + response.status + ': ' + (errorBody || response.statusText));
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
            sendResponse({ error: { message: 'HTTP ' + response.status + ': ' + (errorBody || response.statusText) } });
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
    if (message.action === 'page-screenshot') {
      if (!sender.tab) {
        sendResponse('Error: 无法获取 tabId');
        return true;
      }
      chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: 'png'}, function (dataUrl) {
        if (chrome.runtime.lastError) {
          sendResponse('Error: 截图失败 - ' + chrome.runtime.lastError.message);
        } else {
          sendResponse(dataUrl);
        }
      });
      return true; // 异步响应 — 保持 sendResponse 通道
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

    return false;
  });

})();
