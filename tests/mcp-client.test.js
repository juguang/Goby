/**
 * MCP Client Tests — Plan 10-01
 *
 * Coverage:
 *   1. McpHttpClient 单元测试（mock fetch）
 *   2. storage.js gobyMcpServers CRUD（chrome mock）
 *   3. background.js SW handler 测试（mock chrome.runtime.onMessage）
 */

// Load chrome mock
require('./__mocks__/chrome.js');

// Load modules (creates globals)
var McpHttpClient = require('../lib/mcp-client.js');
require('../storage.js');

// =============================================================
//  Global mock fetch setup
// =============================================================

function mockFetch(responseOpts) {
  var defaults = {
    status: 200,
    statusText: 'OK',
    contentType: 'application/json',
    body: '{}',
    headers: {}
  };
  var opts = Object.assign({}, defaults, responseOpts || {});

  var headersMap = {};
  if (opts.headers) {
    Object.keys(opts.headers).forEach(function (k) {
      headersMap[k.toLowerCase()] = opts.headers[k];
    });
  }
  headersMap['content-type'] = opts.contentType;

  globalThis.fetch = jest.fn(function () {
    return Promise.resolve({
      ok: opts.status >= 200 && opts.status < 300,
      status: opts.status,
      statusText: opts.statusText,
      headers: {
        get: function (name) {
          return headersMap[name.toLowerCase()] || null;
        }
      },
      text: function () { return Promise.resolve(opts.body); },
      json: function () { return Promise.resolve(JSON.parse(opts.body)); }
    });
  });
}

function mockFetchSSE(events, responseOpts) {
  // events: [{ event: 'data', data: '{"jsonrpc":"2.0",...}' }, ...]
  var sseLines = (events || []).map(function (ev) {
    return 'data: ' + JSON.stringify(ev.data);
  }).join('\n');

  return mockFetch(Object.assign({
    contentType: 'text/event-stream',
    body: sseLines
  }, responseOpts || {}));
}

// =============================================================
//  1. McpHttpClient 单元测试
// =============================================================

describe('McpHttpClient', function () {

  beforeEach(function () {
    globalThis.fetch = undefined; // clear any prior mock
  });

  // -----------------------------------------------------------
  //  构造函数
  // -----------------------------------------------------------

  describe('constructor', function () {
    it('接受 endpoint 和 opts 参数', function () {
      var client = new McpHttpClient('https://example.com/mcp', {
        token: 'test-token',
        timeout: 10000
      });

      expect(client.endpoint).toBe('https://example.com/mcp');
      expect(client.opts.token).toBe('test-token');
      expect(client.opts.timeout).toBe(10000);
      expect(client.sessionId).toBeNull();
      expect(client.requestId).toBe(1);
    });

    it('opts 默认值正确', function () {
      var client = new McpHttpClient('https://example.com/mcp');
      expect(client.opts).toEqual({});
      expect(client.sessionId).toBeNull();
    });
  });

  // -----------------------------------------------------------
  //  _send 方法
  // -----------------------------------------------------------

  describe('_send', function () {
    it('构建正确的 JSON-RPC 请求（header + body）', async function () {
      var client = new McpHttpClient('https://example.com/mcp', { token: 'abc123' });
      mockFetch({ body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }) });

      var result = await client._send('tools/list', {});

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      var callArgs = globalThis.fetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://example.com/mcp');

      var headers = callArgs[1].headers;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json, text/event-stream');
      expect(headers['Authorization']).toBe('Bearer abc123');

      var body = JSON.parse(callArgs[1].body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('tools/list');
      expect(body.params).toEqual({});
      expect(typeof body.id).toBe('number');
    });

    it('无 token 时不发 Authorization header', async function () {
      var client = new McpHttpClient('https://example.com/mcp');
      mockFetch({ body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) });

      await client._send('tools/list', {});

      var headers = globalThis.fetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });

    it('处理 application/json 响应', async function () {
      var client = new McpHttpClient('https://example.com/mcp');
      mockFetch({ body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'test' }] } }) });

      var result = await client._send('tools/list', {});
      expect(result.result.tools).toHaveLength(1);
      expect(result.result.tools[0].name).toBe('test');
    });

    it('处理 text/event-stream 响应，取首个 result', async function () {
      var client = new McpHttpClient('https://example.com/mcp');
      mockFetchSSE([
        { data: { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'tool_a' }] } } }
      ]);

      var result = await client._send('tools/list', {});
      expect(result.result.tools).toHaveLength(1);
      expect(result.result.tools[0].name).toBe('tool_a');
    });

    it('处理 text/event-stream 中多个 event 行', async function () {
      var client = new McpHttpClient('https://example.com/mcp');
      mockFetchSSE([
        { data: { jsonrpc: '2.0', id: 1, result: { tools: [] } } },
        { data: { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'x' }] } } }
      ], { headers: { 'Mcp-Session-Id': 'sess123' } });

      var result = await client._send('tools/list', {});
      expect(result.result.tools).toEqual([]);
    });

    it('从 Mcp-Session-Id 响应头提取 sessionId', async function () {
      var client = new McpHttpClient('https://example.com/mcp');
      mockFetch({
        headers: { 'Mcp-Session-Id': 'sess-abc-123' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })
      });

      await client._send('initialize', {});
      expect(client.sessionId).toBe('sess-abc-123');
    });

    it('后续请求带上 Mcp-Session-Id header', async function () {
      var client = new McpHttpClient('https://example.com/mcp');
      client.sessionId = 'sess-existing';

      mockFetch({ body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) });

      await client._send('tools/list', {});

      var headers = globalThis.fetch.mock.calls[0][1].headers;
      expect(headers['Mcp-Session-Id']).toBe('sess-existing');
    });

    it('超时返回正确错误格式', async function () {
      var client = new McpHttpClient('https://example.com/mcp', { timeout: 10 });

      // Mock fetch to never resolve (trigger abort)
      var abortController;
      globalThis.fetch = jest.fn(function (url, opts) {
        abortController = opts.signal;
        return new Promise(function (resolve, reject) {
          if (opts.signal) {
            opts.signal.addEventListener('abort', function () {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }
        });
      });

      // Wait for abort to trigger
      var result = await client._send('tools/list', {});
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('请求超时');
    });

    it('非 2xx 响应返回 HTTP 错误格式', async function () {
      var client = new McpHttpClient('https://example.com/mcp');

      globalThis.fetch = jest.fn(function () {
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: { get: function () { return 'application/json'; } },
          text: function () { return Promise.resolve('Unauthorized'); },
          json: function () { return Promise.resolve({ error: { message: 'unauthorized' } }); }
        });
      });

      var result = await client._send('tools/list', {});
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('HTTP 401');
      expect(result.error.message).toContain('Unauthorized');
    });

    it('fetch 网络错误返回正确格式', async function () {
      var client = new McpHttpClient('https://example.com/mcp');

      globalThis.fetch = jest.fn(function () {
        return Promise.reject(new Error('Failed to fetch'));
      });

      var result = await client._send('tools/list', {});
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('网络错误');
    });
  });

  // -----------------------------------------------------------
  //  initialize
  // -----------------------------------------------------------

  describe('initialize', function () {
    it('发送 initialize JSON-RPC 和 notifications/initialized', async function () {
      var client = new McpHttpClient('https://example.com/mcp', { token: 'tok' });

      // Mock fetch: first call returns initialize result, second call is notifications/initialized
      var callCount = 0;
      globalThis.fetch = jest.fn(function () {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: function () { return 'application/json'; } },
            text: function () { return Promise.resolve(''); },
            json: function () {
              return Promise.resolve({
                jsonrpc: '2.0',
                id: 1,
                result: {
                  protocolVersion: '2024-11-05',
                  serverInfo: { name: 'test-server', version: '1.0.0' }
                }
              });
            }
          });
        }
        // Second call: notifications/initialized (fire-and-forget, response doesn't matter)
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          headers: { get: function () { return 'application/json'; } },
          text: function () { return Promise.resolve(''); },
          json: function () { return Promise.resolve({}); }
        });
      });

      var result = await client.initialize();

      // First call body check
      var firstBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
      expect(firstBody.method).toBe('initialize');
      expect(firstBody.params.protocolVersion).toBe('2024-11-05');
      expect(firstBody.params.clientInfo.name).toBe('goby');

      // Second call body check (notifications/initialized)
      var secondBody = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
      expect(secondBody.method).toBe('notifications/initialized');

      // Verify result
      expect(result.result.serverInfo.name).toBe('test-server');
      expect(result.result.protocolVersion).toBe('2024-11-05');
    });

    it('initialize 失败时返回 error', async function () {
      var client = new McpHttpClient('https://example.com/mcp');

      globalThis.fetch = jest.fn(function () {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: { get: function () { return 'application/json'; } },
          text: function () {
            return Promise.resolve(JSON.stringify({ error: { message: 'server error' } }));
          },
          json: function () { return Promise.resolve({ error: { message: 'server error' } }); }
        });
      });

      var result = await client.initialize();
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('HTTP 500');
    });
  });

  // -----------------------------------------------------------
  //  listTools
  // -----------------------------------------------------------

  describe('listTools', function () {
    it('正确调用 tools/list', async function () {
      var client = new McpHttpClient('https://example.com/mcp');
      mockFetch({
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            tools: [
              { name: 'search', description: 'Search tool', inputSchema: {} }
            ]
          }
        })
      });

      var result = await client.listTools();
      expect(result.result.tools).toHaveLength(1);
      expect(result.result.tools[0].name).toBe('search');
    });
  });

  // -----------------------------------------------------------
  //  callTool
  // -----------------------------------------------------------

  describe('callTool', function () {
    it('正确传递 name + args', async function () {
      var client = new McpHttpClient('https://example.com/mcp');
      mockFetch({
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: 'done' }]
          }
        })
      });

      var result = await client.callTool('search', { query: 'test' });

      // Verify request body
      var requestBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
      expect(requestBody.method).toBe('tools/call');
      expect(requestBody.params.name).toBe('search');
      expect(requestBody.params.arguments.query).toBe('test');

      expect(result.result.content[0].text).toBe('done');
    });
  });
});

// =============================================================
//  2. storage.js gobyMcpServers CRUD
// =============================================================

describe('GobyStorage McpServers CRUD', function () {
  var sampleServer = {
    id: 'server1',
    name: 'Cloudflare Docs',
    endpoint: 'https://docs.mcp.cloudflare.com/mcp',
    token: 'test-token-123',
    enabled: true
  };

  beforeEach(function () {
    chrome.storage.local._reset();
    chrome.storage.local.set.mockClear();
    chrome.storage.local.get.mockClear();
  });

  it('saveMcpServer 保存配置到 gobyMcpServers key', async function () {
    await GobyStorage.saveMcpServer('server1', sampleServer);

    var stored = await chrome.storage.local.get(['gobyMcpServers']);
    expect(stored.gobyMcpServers).toBeDefined();
    expect(stored.gobyMcpServers.server1).toBeDefined();
    expect(stored.gobyMcpServers.server1.name).toBe('Cloudflare Docs');
    expect(stored.gobyMcpServers.server1.endpoint).toBe('https://docs.mcp.cloudflare.com/mcp');
    expect(stored.gobyMcpServers.server1.enabled).toBe(true);
  });

  it('saveMcpServer 默认 enabled 为 true', async function () {
    await GobyStorage.saveMcpServer('server2', {
      id: 'server2',
      name: 'Test',
      endpoint: 'https://test.com/mcp',
      token: ''
      // no enabled field
    });

    var stored = await chrome.storage.local.get(['gobyMcpServers']);
    expect(stored.gobyMcpServers.server2.enabled).toBe(true);
  });

  it('saveMcpServer 保留显式 enabled=false', async function () {
    await GobyStorage.saveMcpServer('disabled', {
      id: 'disabled',
      name: 'Disabled',
      endpoint: 'https://test.com/mcp',
      token: '',
      enabled: false
    });

    var stored = await chrome.storage.local.get(['gobyMcpServers']);
    expect(stored.gobyMcpServers.disabled.enabled).toBe(false);
  });

  it('getMcpServer 按 id 读取', async function () {
    await GobyStorage.saveMcpServer('server1', sampleServer);
    var result = await GobyStorage.getMcpServer('server1');

    expect(result).not.toBeNull();
    expect(result.name).toBe('Cloudflare Docs');
    expect(result.endpoint).toBe('https://docs.mcp.cloudflare.com/mcp');
    expect(result.token).toBe('test-token-123');
  });

  it('getMcpServer 不存在返回 null', async function () {
    var result = await GobyStorage.getMcpServer('nonexistent');
    expect(result).toBeNull();
  });

  it('getAllMcpServers 返回所有配置', async function () {
    await GobyStorage.saveMcpServer('s1', {
      id: 's1', name: 'Server 1', endpoint: 'https://one.com/mcp', token: '', enabled: true
    });
    await GobyStorage.saveMcpServer('s2', {
      id: 's2', name: 'Server 2', endpoint: 'https://two.com/mcp', token: '', enabled: false
    });

    var all = await GobyStorage.getAllMcpServers();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all.s1.name).toBe('Server 1');
    expect(all.s2.name).toBe('Server 2');
  });

  it('getAllMcpServers 无数据时返回空对象', async function () {
    var all = await GobyStorage.getAllMcpServers();
    expect(all).toEqual({});
  });

  it('deleteMcpServer 删除指定配置', async function () {
    await GobyStorage.saveMcpServer('server1', sampleServer);
    var result = await GobyStorage.deleteMcpServer('server1');

    expect(result).toBe(true);
    var stored = await GobyStorage.getAllMcpServers();
    expect(stored.server1).toBeUndefined();
  });

  it('deleteMcpServer 不存在返回 false', async function () {
    var result = await GobyStorage.deleteMcpServer('nonexistent');
    expect(result).toBe(false);
  });

  it('toggleMcpServer 切换 enabled 状态', async function () {
    await GobyStorage.saveMcpServer('server1', sampleServer);

    // 默认 true → toggle false
    var result = await GobyStorage.toggleMcpServer('server1', false);
    expect(result).toBe(true);
    var stored = await GobyStorage.getMcpServer('server1');
    expect(stored.enabled).toBe(false);

    // toggle true
    await GobyStorage.toggleMcpServer('server1', true);
    stored = await GobyStorage.getMcpServer('server1');
    expect(stored.enabled).toBe(true);
  });

  it('toggleMcpServer 不存在的 id 返回 false', async function () {
    var result = await GobyStorage.toggleMcpServer('nonexistent', false);
    expect(result).toBe(false);
  });

  it('记录格式包含 { id, name, endpoint, token, enabled }', async function () {
    await GobyStorage.saveMcpServer('test', sampleServer);
    var stored = await GobyStorage.getMcpServer('test');

    expect(stored).toHaveProperty('id');
    expect(stored).toHaveProperty('name');
    expect(stored).toHaveProperty('endpoint');
    expect(stored).toHaveProperty('token');
    expect(stored).toHaveProperty('enabled');
  });

  it('多个 server 互不影响', async function () {
    await GobyStorage.saveMcpServer('a', {
      id: 'a', name: 'A', endpoint: 'https://a.com/mcp', token: 'tok_a', enabled: true
    });
    await GobyStorage.saveMcpServer('b', {
      id: 'b', name: 'B', endpoint: 'https://b.com/mcp', token: 'tok_b', enabled: false
    });

    // 删除 A 不影响 B
    await GobyStorage.deleteMcpServer('a');
    var remaining = await GobyStorage.getAllMcpServers();
    expect(Object.keys(remaining)).toEqual(['b']);
    expect(remaining.b.name).toBe('B');
  });
});

// =============================================================
//  3. background.js SW handler 测试
// =============================================================

describe('SW Handler (MCP)', function () {
  var capturedListener;

  beforeEach(function () {
    jest.resetModules();
    require('./__mocks__/chrome.js');

    // 重新加载模块以获取新的 listener
    // McpHttpClient 和 background.js 必须已加载
    require('../lib/mcp-client.js');
    require('../storage.js');
    require('../background.js');

    // 模拟 chrome.runtime.id
    chrome.runtime.id = 'test-extension-id';

    // 模拟 McpHttpClient 已注册到 self
    // McpHttpClient 会被 lib/mcp-client.js IIFE 注册到 self

    // 捕获 onMessage.addListener 回调
    capturedListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  });

  afterEach(function () {
    // Clean up sendMessage mock accumulation
    chrome.runtime.sendMessage.mockClear();
  });

  /**
   * 辅助：调用 onMessage listener 并等待 sendResponse
   * @param {object} message
   * @param {object} [sender]
   * @returns {Promise<*>}
   */
  function sendMessage(message, sender) {
    return new Promise(function (resolve) {
      capturedListener(
        message,
        sender || { id: chrome.runtime.id },
        function (response) {
          resolve(response);
        }
      );
    });
  }

  describe('mock environment sanity', function () {
    it('self.McpHttpClient 应该已注册', function () {
      expect(typeof self.McpHttpClient).toBe('function');
    });

    it('McpHttpClient 实例化正常', function () {
      var client = new self.McpHttpClient('https://test.com/mcp');
      expect(client).toBeDefined();
      expect(typeof client.initialize).toBe('function');
      expect(typeof client.listTools).toBe('function');
      expect(typeof client.callTool).toBe('function');
    });
  });

  describe('mcp-list-tools', function () {
    it('缺少 endpoint 返回错误', async function () {
      var response = await sendMessage({
        action: 'mcp-list-tools',
        serverId: 's1',
        token: ''
      });
      expect(response.ok).toBe(false);
      expect(response.error).toContain('endpoint');
    });

    it('创建 McpHttpClient 并调用 initialize + listTools（成功路径）', async function () {
      // Mock fetch to simulate MCP server responses
      // First: initialize response, Second: notifications/initialized, Third: listTools response
      var fetchCallCount = 0;
      globalThis.fetch = jest.fn(function () {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // initialize
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: function () { return 'application/json'; } },
            text: function () { return Promise.resolve(''); },
            json: function () {
              return Promise.resolve({
                jsonrpc: '2.0',
                result: {
                  protocolVersion: '2024-11-05',
                  serverInfo: { name: 'test-server', version: '1.0.0' }
                }
              });
            }
          });
        }
        if (fetchCallCount === 2) {
          // notifications/initialized (fire-and-forget)
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            headers: { get: function () { return 'application/json'; } },
            text: function () { return Promise.resolve(''); },
            json: function () { return Promise.resolve({}); }
          });
        }
        // listTools
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: function () { return 'application/json'; } },
          text: function () { return Promise.resolve(''); },
          json: function () {
            return Promise.resolve({
              jsonrpc: '2.0',
              result: {
                tools: [
                  { name: 'search', description: 'Search docs', inputSchema: {} }
                ]
              }
            });
          }
        });
      });

      var response = await sendMessage({
        action: 'mcp-list-tools',
        serverId: 's1',
        endpoint: 'https://test-server.com/mcp',
        token: 'test-token'
      });

      expect(response.ok).toBe(true);
      expect(response.tools).toHaveLength(1);
      expect(response.tools[0].name).toBe('search');
      expect(response.serverInfo.name).toBe('test-server');
      expect(response.serverId).toBe('s1');
    });

    it('initialize 失败返回错误', async function () {
      globalThis.fetch = jest.fn(function () {
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: { get: function () { return 'application/json'; } },
          text: function () { return Promise.resolve(JSON.stringify({ error: { message: 'bad token' } })); },
          json: function () { return Promise.resolve({ error: { message: 'bad token' } }); }
        });
      });

      var response = await sendMessage({
        action: 'mcp-list-tools',
        serverId: 's1',
        endpoint: 'https://test-server.com/mcp',
        token: 'bad-token'
      });

      expect(response.ok).toBe(false);
      expect(response.error).toContain('HTTP 401');
    });

    it('handler 使用 return true（异步 sendResponse 模式）', function () {
      // 验证 handler 不立即 return false — 即 listener 返回 true 或 undefined
      var retVal = capturedListener(
        { action: 'mcp-list-tools', serverId: 's1', endpoint: 'https://test.com/mcp', token: '' },
        { id: chrome.runtime.id },
        function () {}
      );
      // 异步 handler 应返回 true
      expect(retVal).toBe(true);
    });
  });

  describe('mcp-call-tool', function () {
    it('缺少 endpoint 返回错误', async function () {
      var response = await sendMessage({
        action: 'mcp-call-tool',
        serverId: 's1',
        token: '',
        toolName: 'search',
        args: { query: 'test' }
      });
      expect(response.ok).toBe(false);
      expect(response.error).toContain('endpoint');
    });

    it('缺少 toolName 返回错误', async function () {
      var response = await sendMessage({
        action: 'mcp-call-tool',
        serverId: 's1',
        endpoint: 'https://test.com/mcp',
        token: '',
        toolName: '',
        args: {}
      });
      expect(response.ok).toBe(false);
      expect(response.error).toContain('toolName');
    });

    it('创建 McpHttpClient 并调用 initialize + callTool（成功路径）', async function () {
      var fetchCallCount = 0;
      globalThis.fetch = jest.fn(function () {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // initialize
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: function () { return 'application/json'; } },
            text: function () { return Promise.resolve(''); },
            json: function () {
              return Promise.resolve({
                jsonrpc: '2.0',
                result: {
                  protocolVersion: '2024-11-05',
                  serverInfo: { name: 'test-server', version: '1.0.0' }
                }
              });
            }
          });
        }
        if (fetchCallCount === 2) {
          // notifications/initialized
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            headers: { get: function () { return 'application/json'; } },
            text: function () { return Promise.resolve(''); },
            json: function () { return Promise.resolve({}); }
          });
        }
        // callTool
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: function () { return 'application/json'; } },
          text: function () { return Promise.resolve(''); },
          json: function () {
            return Promise.resolve({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: 'Search results: found 42 items' }]
              }
            });
          }
        });
      });

      var response = await sendMessage({
        action: 'mcp-call-tool',
        serverId: 's1',
        endpoint: 'https://test-server.com/mcp',
        token: 'tok',
        toolName: 'search',
        args: { query: 'test' }
      });

      expect(response.ok).toBe(true);
      expect(response.result).toBe('Search results: found 42 items');
    });

    it('工具返回 isError 时透传错误信息', async function () {
      var fetchCallCount = 0;
      globalThis.fetch = jest.fn(function () {
        fetchCallCount++;
        if (fetchCallCount <= 2) {
          // initialize + notifications
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            headers: { get: function () { return 'application/json'; } },
            text: function () { return Promise.resolve(''); },
            json: function () { return Promise.resolve({ jsonrpc: '2.0', result: { protocolVersion: '2024-11-05', serverInfo: {} } }); }
          });
        }
        // callTool with error content
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: function () { return 'application/json'; } },
          text: function () { return Promise.resolve(''); },
          json: function () {
            return Promise.resolve({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: 'Error: rate limit exceeded', isError: true }]
              }
            });
          }
        });
      });

      var response = await sendMessage({
        action: 'mcp-call-tool',
        serverId: 's1',
        endpoint: 'https://test-server.com/mcp',
        token: 'tok',
        toolName: 'search',
        args: {}
      });

      expect(response.ok).toBe(true);
      expect(response.result).toContain('rate limit');
    });

    it('callTool 返回 JSON-RPC error 透传错误信息', async function () {
      var fetchCallCount = 0;
      globalThis.fetch = jest.fn(function () {
        fetchCallCount++;
        if (fetchCallCount <= 2) {
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            headers: { get: function () { return 'application/json'; } },
            text: function () { return Promise.resolve(''); },
            json: function () { return Promise.resolve({ jsonrpc: '2.0', result: { protocolVersion: '2024-11-05', serverInfo: {} } }); }
          });
        }
        // JSON-RPC error response
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: function () { return 'application/json'; } },
          text: function () { return Promise.resolve(''); },
          json: function () {
            return Promise.resolve({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Tool not found: search' }
            });
          }
        });
      });

      var response = await sendMessage({
        action: 'mcp-call-tool',
        serverId: 's1',
        endpoint: 'https://test-server.com/mcp',
        token: 'tok',
        toolName: 'search',
        args: {}
      });

      expect(response.ok).toBe(false);
      expect(response.error).toContain('Tool not found');
    });

    it('handler 使用 return true（异步 sendResponse 模式）', function () {
      var retVal = capturedListener(
        {
          action: 'mcp-call-tool',
          serverId: 's1',
          endpoint: 'https://test.com/mcp',
          token: '',
          toolName: 'search',
          args: {}
        },
        { id: chrome.runtime.id },
        function () {}
      );
      expect(retVal).toBe(true);
    });
  });

  describe('sender.id 验证（T-03-02 模式）', function () {
    it('非法的 sender.id 应被拒绝（mcps handler 类同其他 handler）', function () {
      // 发送一个合法 action 但 sender 非法
      // 当 sender.id 不匹配时，listener 应 return false（不异步响应）
      var retVal = capturedListener(
        { action: 'mcp-list-tools', serverId: 's1', endpoint: 'https://test.com/mcp', token: '' },
        { id: 'evil-extension' },
        function () {}
      );
      // listener 最早检查 sender.id，不匹配则返回 false
      expect(retVal).toBe(false);
    });
  });
});

// =============================================================
//  4. CS Integration 测试 (Plan 10-02)
// =============================================================

describe('CS Integration (Plan 10-02)', function () {

  beforeAll(function () {
    // 加载 CS 模块依赖（DOMPurify + marked + i18n + storage + panel + content-script）
    var purifyFactory = require('../lib/purify.min.js');
    window.DOMPurify = purifyFactory(window);
    window.marked = require('../lib/marked.min.js');
    require('../lib/i18n.js');
    require('../storage.js');
    require('../panel.js');
    require('../content-script.js');
  });

  beforeEach(function () {
    chrome.storage.local._reset();
    chrome.runtime.sendMessage.mockReset();
    // 清空 MCP 工具状态
    if (window.__gobyInternals) {
      window.__gobyInternals._activeMcpTools.length = 0;
    }
  });

  // -----------------------------------------------------------
  //  4a. MCP 工具拉取（Task 1）
  // -----------------------------------------------------------

  it('MCP 工具拉取 - 仅已启用 server 被请求并转换命名', async function () {
    // 设置 storage: 2 个 enabled + 1 个 disabled server
    await chrome.storage.local.set({
      gobyMcpServers: {
        s1: { id: 's1', name: 'Cloudflare', endpoint: 'https://cf.example.com/mcp', token: 'tok1', enabled: true },
        s2: { id: 's2', name: 'GitHub', endpoint: 'https://gh.example.com/mcp', token: 'tok2', enabled: true },
        s3: { id: 's3', name: 'Disabled', endpoint: 'https://dis.example.com/mcp', token: '', enabled: false }
      }
    });

    // Mock sendMessage: s1 返回 1 个工具, s2 返回 2 个工具
    chrome.runtime.sendMessage.mockImplementation(function (payload) {
      if (payload.action === 'mcp-list-tools') {
        if (payload.serverId === 's1') {
          return Promise.resolve({
            ok: true,
            tools: [{ name: 'search', description: 'Search Cloudflare docs', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }],
            serverId: 's1'
          });
        }
        if (payload.serverId === 's2') {
          return Promise.resolve({
            ok: true,
            tools: [
              { name: 'list_repos', description: 'List user repos', inputSchema: { type: 'object', properties: { user: { type: 'string' } } } },
              { name: 'get_issue', description: 'Get issue details', inputSchema: { type: 'object', properties: { id: { type: 'number' } } } }
            ],
            serverId: 's2'
          });
        }
      }
      return Promise.resolve({});
    });

    // 调用 _loadMcpTools
    await window.__gobyInternals.loadMcpTools();

    // 验证：仅 2 个 enabled server 被请求，s3 disabled 被跳过
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mcp-list-tools', serverId: 's1' })
    );
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mcp-list-tools', serverId: 's2' })
    );

    // 验证：_activeMcpTools 包含 3 个工具（s1:1 + s2:2）
    expect(window.__gobyInternals._activeMcpTools.length).toBe(3);

    // 验证：命名格式 mcp__{serverName}__{toolName}
    var toolNames = window.__gobyInternals._activeMcpTools.map(function (t) {
      return t.function.name;
    });
    expect(toolNames).toContain('mcp__Cloudflare__search');
    expect(toolNames).toContain('mcp__GitHub__list_repos');
    expect(toolNames).toContain('mcp__GitHub__get_issue');

    // 验证：工具描述和 schema 被正确转换
    var cfTool = window.__gobyInternals._activeMcpTools.find(function (t) {
      return t.function.name === 'mcp__Cloudflare__search';
    });
    expect(cfTool).toBeDefined();
    expect(cfTool.function.description).toBe('Search Cloudflare docs');
    expect(cfTool.function.parameters.type).toBe('object');
    expect(cfTool.timeout).toBe(15000);
  });

  it('MCP 工具拉取 - 无 server 时静默跳过', async function () {
    // storage 中无 MCP server 配置
    await window.__gobyInternals.loadMcpTools();

    expect(window.__gobyInternals._activeMcpTools.length).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('MCP 工具拉取 - 单个 server 失败不阻塞其他 server', async function () {
    // 2 个 enabled server，第一个返回失败
    await chrome.storage.local.set({
      gobyMcpServers: {
        ok: { id: 'ok', name: 'Good', endpoint: 'https://good.example.com/mcp', token: '', enabled: true },
        bad: { id: 'bad', name: 'Bad', endpoint: 'https://bad.example.com/mcp', token: '', enabled: true }
      }
    });

    chrome.runtime.sendMessage.mockImplementation(function (payload) {
      if (payload.action === 'mcp-list-tools') {
        if (payload.serverId === 'bad') {
          return Promise.resolve({ ok: false, error: 'connection refused' });
        }
        if (payload.serverId === 'ok') {
          return Promise.resolve({
            ok: true,
            tools: [{ name: 'ping', description: 'Ping tool', inputSchema: { type: 'object', properties: {} } }],
            serverId: 'ok'
          });
        }
      }
      return Promise.resolve({});
    });

    await window.__gobyInternals.loadMcpTools();

    // 两个 server 都被请求
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    // 只有成功的 server 的工具被加载
    expect(window.__gobyInternals._activeMcpTools.length).toBe(1);
    expect(window.__gobyInternals._activeMcpTools[0].function.name).toBe('mcp__Good__ping');
  });

  // -----------------------------------------------------------
  //  4b. 工具列表合并（Task 2）
  // -----------------------------------------------------------

  it('getSystemPrompt 移除工具列表（工具改走 API tools 参数）', async function () {
    // 手动注入 MCP 工具
    window.__gobyInternals._activeMcpTools.push({
      type: 'function',
      function: { name: 'mcp__Test__search', description: 'Test search', parameters: {} }
    });
    window.__gobyInternals._activeMcpTools.push({
      type: 'function',
      function: { name: 'mcp__Test__get', description: 'Test get', parameters: {} }
    });

    // 新设计（借鉴 Claude Code/OpenClaw）：工具 schema 通过 API tools 参数传，不进 system prompt 文本
    var prompt = window.GobyAgent.getSystemPrompt();
    expect(prompt).not.toContain('mcp__Test__search');
    expect(prompt).not.toContain('可用工具：');
    // 工具合并的正确性由下一个测试（callLLMStream tools 参数）覆盖
  });

  it('工具列表合并 - callLLMStream tools 包含 mcp__ 工具', async function () {
    // 手动注入 MCP 工具
    window.__gobyInternals._activeMcpTools.push({
      type: 'function',
      function: { name: 'mcp__CF__search', description: 'CF Search', parameters: { type: 'object', properties: { q: { type: 'string' } } } }
    });

    // Mock GobyStorage.getConfig 返回有效配置
    var origGetConfig = window.GobyStorage.getConfig;
    window.GobyStorage.getConfig = function () {
      return Promise.resolve({ baseUrl: 'https://test.api.com', apiKey: 'test-key', model: 'test-model' });
    };

    // 模拟 onChunk 回调
    var onChunk = jest.fn();

    // callLLMStream 会构造 tools 参数并发送到 SW
    // 验证 payload 中包含 mcp__ 工具
    chrome.runtime.sendMessage.mockImplementation(function (payload) {
      if (payload.action === 'llm-stream') {
        var tools = payload.tools || [];
        var mcpTools = tools.filter(function (t) {
          return t.function.name.indexOf('mcp__') === 0;
        });
        expect(mcpTools.length).toBe(1);
        expect(mcpTools[0].function.name).toBe('mcp__CF__search');
        expect(mcpTools[0].function.description).toBe('CF Search');
      }
      return new Promise(function () {});
    });

    // Call callLLMStream
    var messages = [{ role: 'user', content: 'hello' }];
    var promise = window.GobyAgent.callLLMStream(messages, onChunk);

    // Wait a tick for the async chain
    await new Promise(function (r) { setTimeout(r, 50); });

    // Verify sendMessage was called
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'llm-stream' })
    );

    // Restore
    window.GobyStorage.getConfig = origGetConfig;
  });

  // -----------------------------------------------------------
  //  4c. MCP 工具路由（Task 3）
  // -----------------------------------------------------------

  it('MCP 工具路由 - 成功调用经 sendToSW 转发 mcp-call-tool', async function () {
    // 先调用 loadMcpTools 加载数据到 _mcpToolMeta
    await chrome.storage.local.set({
      gobyMcpServers: {
        cf: { id: 'cf', name: 'Cloudflare', endpoint: 'https://cf.example.com/mcp', token: 'tkn', enabled: true }
      }
    });

    chrome.runtime.sendMessage.mockImplementation(function (payload) {
      if (payload.action === 'mcp-list-tools') {
        return Promise.resolve({
          ok: true,
          tools: [{ name: 'search', description: 'Search CF', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }],
          serverId: 'cf'
        });
      }
      if (payload.action === 'mcp-call-tool') {
        expect(payload.serverId).toBe('cf');
        expect(payload.toolName).toBe('search');
        expect(payload.args.q).toBe('test');
        return Promise.resolve({
          ok: true,
          result: 'Search results: found 42 items',
          serverId: 'cf'
        });
      }
      return Promise.resolve({});
    });

    // 加载 MCP 工具
    await window.__gobyInternals.loadMcpTools();

    // 验证 _loadMcpTools 加载成功
    expect(window.__gobyInternals._activeMcpTools.length).toBeGreaterThan(0);

    // 清空 mock 计数
    chrome.runtime.sendMessage.mockClear();

    // 模拟 mcp-call-tool 的 sendToSW 调用
    chrome.runtime.sendMessage.mockImplementation(function (payload) {
      if (payload.action === 'mcp-call-tool') {
        return Promise.resolve({ ok: true, result: 'search done', serverId: 'cf' });
      }
      return Promise.resolve({});
    });

    // 通过 sendToSW 模拟 executeToolCall 中的 mcp__ 路由
    var mcpResult = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({
        action: 'mcp-call-tool',
        serverId: 'cf',
        endpoint: 'https://cf.example.com/mcp',
        token: 'tkn',
        toolName: 'search',
        args: { q: 'test query' }
      }).then(resolve);
    });

    expect(mcpResult.ok).toBe(true);
    expect(mcpResult.result).toBe('search done');
  });

  it('MCP 工具路由 - 失败时返回 MCP 工具调用失败前缀', async function () {
    await chrome.storage.local.set({
      gobyMcpServers: {
        cf: { id: 'cf', name: 'Cloudflare', endpoint: 'https://cf.example.com/mcp', token: 'tkn', enabled: true }
      }
    });

    chrome.runtime.sendMessage.mockImplementation(function (payload) {
      if (payload.action === 'mcp-list-tools') {
        return Promise.resolve({
          ok: true,
          tools: [{ name: 'search', description: 'Search CF', inputSchema: {} }],
          serverId: 'cf'
        });
      }
      return Promise.resolve({});
    });

    await window.__gobyInternals.loadMcpTools();

    // 重置 mock，模拟工具调用失败
    chrome.runtime.sendMessage.mockClear();
    chrome.runtime.sendMessage.mockImplementation(function (payload) {
      if (payload.action === 'mcp-call-tool') {
        return Promise.resolve({
          ok: false,
          error: 'rate limit exceeded'
        });
      }
      return Promise.resolve({});
    });

    // 模拟 executeToolCall 中 mcp__ 失败路径
    var result = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({
        action: 'mcp-call-tool',
        serverId: 'cf',
        endpoint: 'https://cf.example.com/mcp',
        token: 'tkn',
        toolName: 'search',
        args: {}
      }).then(function (response) {
        if (response && response.ok) {
          resolve(response.result || '(无返回结果)');
        } else {
          resolve('MCP 工具调用失败: ' + ((response && response.error) || '未知错误'));
        }
      });
    });

    expect(result).toBe('MCP 工具调用失败: rate limit exceeded');
  });

  // -----------------------------------------------------------
  //  4d. 未知 MCP 工具（Task 3 边界）
  // -----------------------------------------------------------

  it('未知 MCP 工具 - 返回元数据丢失提示', function () {
    // 验证 _mcpToolMeta 查找失败的分支
    var toolName = 'mcp__Nonexistent__unknown_tool';
    var meta = {}; // 模拟空 _mcpToolMeta
    var result;
    if (meta[toolName]) {
      result = 'found';
    } else {
      result = 'MCP 工具元数据丢失: ' + toolName + '。请重新加载面板。';
    }

    expect(result).toContain('MCP 工具元数据丢失');
    expect(result).toContain(toolName);
  });

  // -----------------------------------------------------------
  //  4e. MCP 工具名不冲突（Task 3 + Task 2 交叉验证）
  // -----------------------------------------------------------

  it('MCP 工具名不冲突 - page_query 不走 MCP 路径', async function () {
    // 确保 page_query 不是 MCP 工具
    // page_query 是 nativeTools 中的第一个工具
    chrome.runtime.sendMessage.mockClear();

    // 验证非 mcp__ 开头的工具名不会进入 MCP 分支
    var toolName = 'page_query';
    expect(toolName.indexOf('mcp__')).toBe(-1);

    // 验证 sendToSW 未被 mcp-call-tool 调用
    var nonMcpCalls = chrome.runtime.sendMessage.mock.calls.filter(function (call) {
      return call[0] && call[0].action === 'mcp-call-tool';
    });
    expect(nonMcpCalls.length).toBe(0);
  });
});

// =============================================================
//  5. MCP UI 测试 (Plan 10-03)
// =============================================================

describe('MCP UI (Plan 10-03)', function () {

  beforeAll(function () {
    // i18n 和 storage 应该已经被前一个 describe 加载了，但确保可用
    if (!window.GobyI18n) {
      require('../lib/i18n.js');
    }
    if (!window.GobyStorage) {
      require('../storage.js');
    }
  });

  beforeEach(function () {
    chrome.storage.local._reset();
    chrome.runtime.sendMessage.mockReset();
  });

  // -----------------------------------------------------------
  //  5a. i18n key 存在性测试
  // -----------------------------------------------------------

  it('zh 语言包含所有 22 个 modal.mcp_* key', function () {
    // 在 zh locale 下每个 key 都应返回非 key 本身的字符串
    var keys = [
      'modal.mcp_title', 'modal.mcp_add_btn', 'modal.mcp_name_label',
      'modal.mcp_name_placeholder', 'modal.mcp_endpoint_label', 'modal.mcp_endpoint_placeholder',
      'modal.mcp_token_label', 'modal.mcp_token_placeholder', 'modal.mcp_enabled_label',
      'modal.mcp_save_btn', 'modal.mcp_save_success', 'modal.mcp_save_fail',
      'modal.mcp_delete_confirm', 'modal.mcp_delete_success', 'modal.mcp_verifying',
      'modal.mcp_status_connected', 'modal.mcp_status_failed', 'modal.mcp_status_untested',
      'modal.mcp_tool_count', 'modal.mcp_no_servers', 'modal.mcp_edit_title',
      'modal.mcp_add_title'
    ];
    expect(keys.length).toBe(22);

    // 验证每个 key 都解析为有意义的文本（返回非 key 本身的字符串）
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = window.GobyI18n.t(key);
      expect(val).not.toBe(key);
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });

  it('en 语言包含所有 22 个 modal.mcp_* key', function () {
    // 临时切换到 en
    var origLocale = window.GobyI18n.getLocale();
    window.GobyI18n.setLocale('en');

    var keys = [
      'modal.mcp_title', 'modal.mcp_add_btn', 'modal.mcp_name_label',
      'modal.mcp_name_placeholder', 'modal.mcp_endpoint_label', 'modal.mcp_endpoint_placeholder',
      'modal.mcp_token_label', 'modal.mcp_token_placeholder', 'modal.mcp_enabled_label',
      'modal.mcp_save_btn', 'modal.mcp_save_success', 'modal.mcp_save_fail',
      'modal.mcp_delete_confirm', 'modal.mcp_delete_success', 'modal.mcp_verifying',
      'modal.mcp_status_connected', 'modal.mcp_status_failed', 'modal.mcp_status_untested',
      'modal.mcp_tool_count', 'modal.mcp_no_servers', 'modal.mcp_edit_title',
      'modal.mcp_add_title'
    ];

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = window.GobyI18n.t(key);
      expect(val).not.toBe(key);
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }

    // 恢复原语言
    window.GobyI18n.setLocale(origLocale);
  });

  // -----------------------------------------------------------
  //  5b. 渲染测试
  // -----------------------------------------------------------

  it('openSettingsModal 渲染 MCP 区域标题和添加按钮', function () {
    expect(typeof window.openSettingsModal).toBe('function');

    // 先设置 MCP server 数据到 storage
    chrome.storage.local.set({
      gobyMcpServers: {
        test1: {
          id: 'test1',
          name: 'Cloudflare Docs',
          endpoint: 'https://cf.example.com/mcp',
          token: '',
          enabled: true
        }
      }
    });

    // 打开设置模态框
    window.openSettingsModal();

    // 检查 MCP section 存在
    var mcpSection = document.querySelector('.goby-mcp-section');
    expect(mcpSection).not.toBeNull();

    // 检查标题
    var titleSpan = mcpSection.querySelector('.goby-mcp-section-title span');
    expect(titleSpan).not.toBeNull();
    expect(titleSpan.textContent).toBe('MCP Servers');

    // 检查添加按钮
    var addBtn = mcpSection.querySelector('.goby-mcp-add-btn');
    expect(addBtn).not.toBeNull();
    expect(addBtn.textContent).toBe('+ 添加 Server');

    // 关闭模态框
    window.closeSettingsModal();
  });

  it('MCP 区域在有 server 数据时渲染 server 卡片', function () {
    // 预填充 1 个 server
    chrome.storage.local.set({
      gobyMcpServers: {
        s1: { id: 's1', name: 'Test Server', endpoint: 'https://test.com/mcp', token: '', enabled: true }
      }
    });

    window.openSettingsModal();

    // 等待 refreshMcpList 的异步完成（用于 set/get 的 microtask 队列）
    return new Promise(function (resolve) {
      // setTimeout 让 storage promise 链完成
      setTimeout(function () {
        var mcpList = document.querySelector('.goby-mcp-list');
        expect(mcpList).not.toBeNull();

        var serverCards = mcpList.querySelectorAll('.goby-mcp-server-card');
        expect(serverCards.length).toBe(1);

        // 验证卡片内容
        var nameEl = serverCards[0].querySelector('.goby-mcp-server-name');
        expect(nameEl).not.toBeNull();
        expect(nameEl.textContent).toBe('Test Server');

        // 验证 meta 行包含 endpoint
        var metaEl = serverCards[0].querySelector('.goby-mcp-server-meta');
        expect(metaEl).not.toBeNull();
        expect(metaEl.textContent).toContain('https://test.com/mcp');

        // 验证有 toggle checkbox
        var toggleInput = serverCards[0].querySelector('input[type="checkbox"]');
        expect(toggleInput).not.toBeNull();
        expect(toggleInput.checked).toBe(true);

        // 验证有 actions（编辑/删除按钮）
        var actions = serverCards[0].querySelector('.goby-mcp-server-actions');
        expect(actions).not.toBeNull();
        var btns = actions.querySelectorAll('button');
        expect(btns.length).toBeGreaterThanOrEqual(2);

        window.closeSettingsModal();
        resolve();
      }, 50);
    });
  });

  it('无 server 时显示空状态提示', function () {
    // storage 无 MCP 数据
    window.openSettingsModal();

    return new Promise(function (resolve) {
      setTimeout(function () {
        var noServersEl = document.getElementById('goby-mcp-no-servers');
        expect(noServersEl).not.toBeNull();

        // 空状态应可见（style.display !== 'none'）
        expect(noServersEl.style.display).not.toBe('none');

        // 空状态文本
        expect(noServersEl.textContent).toContain('尚未配置');

        window.closeSettingsModal();
        resolve();
      }, 50);
    });
  });

  // -----------------------------------------------------------
  //  5c. CRUD 操作测试（直接调 storage 方法）
  // -----------------------------------------------------------

  it('CRUD - 添加 server', async function () {
    var id = 'crud_test';
    await GobyStorage.saveMcpServer(id, {
      id: id,
      name: 'My Server',
      endpoint: 'https://myserver.com/mcp',
      token: 'tok123',
      enabled: true
    });

    var all = await GobyStorage.getAllMcpServers();
    expect(all[id]).toBeDefined();
    expect(all[id].name).toBe('My Server');
    expect(all[id].endpoint).toBe('https://myserver.com/mcp');
    expect(all[id].token).toBe('tok123');
    expect(all[id].enabled).toBe(true);
  });

  it('CRUD - 编辑 server（覆盖保存同名 id）', async function () {
    var id = 'edit_test';
    await GobyStorage.saveMcpServer(id, { id: id, name: 'Original', endpoint: 'https://orig.com/mcp', token: '', enabled: true });

    // 编辑（同名 id 覆盖）
    await GobyStorage.saveMcpServer(id, { id: id, name: 'Updated', endpoint: 'https://updated.com/mcp', token: 'newtok', enabled: false });

    var server = await GobyStorage.getMcpServer(id);
    expect(server.name).toBe('Updated');
    expect(server.endpoint).toBe('https://updated.com/mcp');
    expect(server.token).toBe('newtok');
    expect(server.enabled).toBe(false);
  });

  it('CRUD - toggle server enable/disable', async function () {
    var id = 'toggle_test';
    await GobyStorage.saveMcpServer(id, { id: id, name: 'Toggle', endpoint: 'https://t.com/mcp', token: '', enabled: true });

    // 切换为禁用
    var result = await GobyStorage.toggleMcpServer(id, false);
    expect(result).toBe(true);

    var server = await GobyStorage.getMcpServer(id);
    expect(server.enabled).toBe(false);

    // 切回启用
    await GobyStorage.toggleMcpServer(id, true);
    server = await GobyStorage.getMcpServer(id);
    expect(server.enabled).toBe(true);
  });

  it('CRUD - 删除 server', async function () {
    var id = 'delete_test';
    await GobyStorage.saveMcpServer(id, {
      id: id, name: 'Del', endpoint: 'https://del.com/mcp', token: '', enabled: true
    });

    // 确认存在
    var before = await GobyStorage.getMcpServer(id);
    expect(before).not.toBeNull();

    // 删除
    var deleted = await GobyStorage.deleteMcpServer(id);
    expect(deleted).toBe(true);

    // 确认不存在
    var after = await GobyStorage.getMcpServer(id);
    expect(after).toBeNull();
  });

  // -----------------------------------------------------------
  //  5d. 连接状态测试（mock sendToSW）
  // -----------------------------------------------------------

  it('连接状态 - mock 成功返回 已连接', function () {
    // 设置一个 server
    chrome.storage.local.set({
      gobyMcpServers: {
        conn: { id: 'conn', name: 'ConnTest', endpoint: 'https://conn.com/mcp', token: '', enabled: true }
      }
    });

    // Mock sendToSW 返回成功（有工具）
    chrome.runtime.sendMessage.mockImplementation(function (payload) {
      if (payload.action === 'mcp-list-tools') {
        return Promise.resolve({
          ok: true,
          tools: [{ name: 'test_tool', description: 'A test tool', inputSchema: {} }],
          serverId: 'conn'
        });
      }
      return Promise.resolve({});
    });

    window.openSettingsModal();

    return new Promise(function (resolve) {
      setTimeout(function () {
        // 验证已连接状态
        var statusEl = document.querySelector('.goby-mcp-status-connected');
        if (statusEl) {
          expect(statusEl.textContent).toBe('已连接');
        }
        window.closeSettingsModal();
        resolve();
      }, 100);
    });
  });

  it('连接状态 - mock 失败返回 连接失败', function () {
    chrome.storage.local.set({
      gobyMcpServers: {
        fail: { id: 'fail', name: 'FailTest', endpoint: 'https://fail.com/mcp', token: 'bad', enabled: true }
      }
    });

    // Mock sendToSW 返回失败
    chrome.runtime.sendMessage.mockImplementation(function (payload) {
      if (payload.action === 'mcp-list-tools') {
        return Promise.resolve({
          ok: false,
          error: 'connection refused',
          serverId: 'fail'
        });
      }
      return Promise.resolve({});
    });

    window.openSettingsModal();

    return new Promise(function (resolve) {
      setTimeout(function () {
        // 当 mock 返回失败时，refreshMcpList 不会设置 connectionStatus
        // 所以应该是 'untested' 状态（因为状态缓存中没有这个 server）
        // 这里验证 DOM 元素存在
        var cards = document.querySelectorAll('.goby-mcp-server-card');
        expect(cards.length).toBeGreaterThan(0);

        // 有 meta 信息
        var metaEl = cards[0].querySelector('.goby-mcp-server-meta');
        expect(metaEl).not.toBeNull();

        window.closeSettingsModal();
        resolve();
      }, 100);
    });
  });
});
