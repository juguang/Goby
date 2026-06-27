// Goby - AI 浏览器助手 | MCP Streamable HTTP 客户端
// Plan 10-01: 基于 Spike 03 PoC（poc/mcp-http-client.js）重构
//
// 职责:
//   McpHttpClient(endpoint, opts) — MCP Streamable HTTP transport 客户端
//   支持 initialize / listTools / callTool 三个方法
//   支持 Bearer token、请求超时、Mcp-Session-Id session 管理
//   支持 application/json 和 text/event-stream 两种响应类型
//
// 安全:
//   T-10-04: 请求超时 15s（AbortController）防止 DoS

(function () {
  'use strict';

  /**
   * MCP Streamable HTTP 客户端
   * @param {string} endpoint - MCP server 的 HTTP URL
   * @param {object} [opts] - 选项
   * @param {string} [opts.token] - Bearer token（可选）
   * @param {number} [opts.timeout=15000] - 请求超时毫秒数
   */
  function McpHttpClient(endpoint, opts) {
    this.endpoint = endpoint;
    this.opts = opts || {};
    this.sessionId = null;
    this.requestId = 1;
  }

  /**
   * 发送 JSON-RPC 请求（内部方法）
   * 处理两种响应：application/json（直接 parse）或 text/event-stream（SSE 行解析）
   * @param {string} method - JSON-RPC 方法名（如 'initialize'、'tools/list'、'tools/call'）
   * @param {object} [params] - JSON-RPC params 参数
   * @returns {Promise<object>} JSON-RPC 响应对象 { result, error } 或 { error }
   */
  McpHttpClient.prototype._send = async function (method, params) {
    var headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    };

    // 带上 sessionId（如果有）
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    // Bearer token 认证
    if (this.opts.token && typeof this.opts.token === 'string' && this.opts.token.trim()) {
      headers['Authorization'] = 'Bearer ' + this.opts.token.trim();
    }

    var body = JSON.stringify({
      jsonrpc: '2.0',
      id: this.requestId++,
      method: method,
      params: params || {}
    });

    // 请求超时（AbortController）
    var timeout = (typeof this.opts.timeout === 'number' && this.opts.timeout > 0)
      ? this.opts.timeout
      : 15000;

    var controller;
    var timeoutId;

    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      timeoutId = setTimeout(function () {
        controller.abort();
      }, timeout);
    }

    try {
      var res = await fetch(this.endpoint, {
        method: 'POST',
        headers: headers,
        body: body,
        signal: controller ? controller.signal : undefined
      });

      // 从响应头提取 sessionId
      var sid = res.headers.get('mcp-session-id');
      if (sid) {
        this.sessionId = sid;
      }

      // 非 2xx 响应
      if (!res.ok) {
        return { error: { message: 'HTTP ' + res.status + ': ' + res.statusText } };
      }

      var contentType = res.headers.get('content-type') || '';

      // text/event-stream — 解析 SSE 行，取第一个 result/error
      if (contentType.indexOf('text/event-stream') !== -1) {
        var text = await res.text();
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf('data: ') === 0) {
            try {
              var msg = JSON.parse(line.slice(6));
              if (msg.result !== undefined || msg.error !== undefined) {
                return msg;
              }
            } catch (e) {
              // 跳过非 JSON 行
            }
          }
        }
        return { error: { message: 'SSE 流中无 JSON-RPC response' } };
      }

      // 普通 JSON 响应
      return await res.json();
    } catch (err) {
      // 区分超时和网络错误
      if (err && err.name === 'AbortError') {
        return { error: { message: '请求超时 (' + timeout + 'ms)' } };
      }
      return { error: { message: '网络错误: ' + (err.message || String(err)) } };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

  /**
   * initialize — 建立 MCP session
   * 发送 initialize JSON-RPC（protocolVersion: "2024-11-05"）
   * 成功后再发送 notifications/initialized（fire-and-forget）
   * @returns {Promise<object>} 包含 serverInfo 等的结果
   */
  McpHttpClient.prototype.initialize = async function () {
    var res = await this._send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'goby', version: '0.4.0' }
    });

    if (res && res.error) {
      return res;
    }

    // 发送 notifications/initialized（fire-and-forget，不等待响应）
    try {
      var headers = { 'Content-Type': 'application/json' };
      if (this.sessionId) {
        headers['Mcp-Session-Id'] = this.sessionId;
      }
      if (this.opts.token && typeof this.opts.token === 'string' && this.opts.token.trim()) {
        headers['Authorization'] = 'Bearer ' + this.opts.token.trim();
      }

      fetch(this.endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
      }).catch(function () {
        // fire-and-forget，忽略网络错误
      });
    } catch (e) {
      // fire-and-forget，忽略异常
    }

    return res;
  };

  /**
   * listTools — 获取 MCP server 支持的工具列表
   * @returns {Promise<object>} JSON-RPC 响应，包含 result.tools 数组
   */
  McpHttpClient.prototype.listTools = async function () {
    return await this._send('tools/list', {});
  };

  /**
   * callTool — 调用 MCP server 的指定工具
   * @param {string} name - 工具名称
   * @param {object} [args] - 工具参数
   * @returns {Promise<object>} JSON-RPC 响应
   */
  McpHttpClient.prototype.callTool = async function (name, args) {
    return await this._send('tools/call', { name: name, arguments: args || {} });
  };

  // 暴露到全局（SW 环境可通过 self.McpHttpClient 访问）
  if (typeof self !== 'undefined') {
    self.McpHttpClient = McpHttpClient;
  }

  // CommonJS 导出（Jest 测试兼容）
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = McpHttpClient;
  }
})();
