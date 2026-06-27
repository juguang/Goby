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
