// Chrome API mock for Jest testing
// Mock chrome.storage.local with an in-memory store

// importScripts polyfill for Service Worker tests in jsdom
// background.js uses importScripts('lib/mcp-client.js') to load McpHttpClient
if (typeof globalThis.importScripts !== 'function') {
  globalThis.importScripts = function () {
    // 在 test 环境下，lib/mcp-client.js 已通过 require 加载
    // importScripts 只需确保 self.McpHttpClient 可用即可
    if (typeof self.McpHttpClient !== 'function') {
      try {
        require('../../lib/mcp-client.js');
      } catch (e) {
        // 可能已在别处加载，静默跳过
      }
    }
  };
}

var chromeMockData = {};

global.chrome = {
  runtime: {
    lastError: null,
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    },
    onInstalled: {
      addListener: jest.fn()
    }
  },
  storage: {
    local: {
      get: jest.fn(function (keys) {
        return new Promise(function (resolve) {
          if (typeof keys === 'string') {
            resolve({ [keys]: chromeMockData[keys] !== undefined ? chromeMockData[keys] : null });
          } else if (Array.isArray(keys)) {
            var result = {};
            keys.forEach(function (key) {
              result[key] = chromeMockData[key] !== undefined ? chromeMockData[key] : null;
            });
            resolve(result);
          } else if (keys && typeof keys === 'object') {
            var result = {};
            Object.keys(keys).forEach(function (key) {
              result[key] = chromeMockData[key] !== undefined ? chromeMockData[key] : keys[key];
            });
            resolve(result);
          } else {
            resolve({});
          }
        });
      }),
      set: jest.fn(function (items) {
        return new Promise(function (resolve) {
          if (items) {
            Object.keys(items).forEach(function (key) {
              chromeMockData[key] = items[key];
            });
          }
          resolve();
        });
      }),
      remove: jest.fn(function (keys) {
        return new Promise(function (resolve) {
          if (Array.isArray(keys)) {
            keys.forEach(function (key) { delete chromeMockData[key]; });
          } else {
            delete chromeMockData[keys];
          }
          resolve();
        });
      }),
      clear: jest.fn(function () {
        Object.keys(chromeMockData).forEach(function (key) { delete chromeMockData[key]; });
        return Promise.resolve();
      }),
      _raw: chromeMockData,
      _reset: function () {
        Object.keys(chromeMockData).forEach(function (key) { delete chromeMockData[key]; });
      }
    }
  },
  action: {
    onClicked: {
      addListener: jest.fn()
    },
    setBadgeText: jest.fn()
  },
  tabs: {
    sendMessage: jest.fn(),
    query: jest.fn(),
    captureVisibleTab: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    // Phase 8 (NAV-09 / D-16): 工作 Tab 关闭检测
    onRemoved: {
      addListener: jest.fn()
    }
  },
  // Phase 8 (Pitfall 3 兜底): 窗口关闭时 tabs.onRemoved 可能不触发，加 windows.onRemoved 兜底
  windows: {
    onRemoved: {
      addListener: jest.fn()
    }
  },
  scripting: {
    executeScript: jest.fn()
  },
  // Bookmarks — 260627-jbi 收藏夹工具测试用
  // 调用 chrome._setBookmarks(nodes) / chrome._setBookmarkTree(tree) 写入测试夹具
  bookmarks: {
    search: jest.fn(function (query, cb) {
      cb = cb || function () {};
      var all = chromeMockData.__bookmarks || [];
      var q = String(query || '').toLowerCase();
      var matched = all.filter(function (b) {
        var t = (b.title || '').toLowerCase();
        var u = (b.url || '').toLowerCase();
        return t.indexOf(q) !== -1 || u.indexOf(q) !== -1;
      });
      cb(matched);
    }),
    getTree: jest.fn(function (cb) {
      cb = cb || function () {};
      cb(chromeMockData.__bookmarkTree || []);
    }),
    getSubTree: jest.fn(function (id, cb) {
      cb = cb || function () {};
      var tree = chromeMockData.__bookmarkTree || [];
      function find(nodes) {
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].id === id) return [nodes[i]];
          if (nodes[i].children) {
            var r = find(nodes[i].children);
            if (r) return r;
          }
        }
        return null;
      }
      cb(find(tree) || []);
    }),
    getRecent: jest.fn(function (count, cb) {
      cb = cb || function () {};
      var all = chromeMockData.__bookmarks || [];
      // 按 dateAdded 倒序（真实 chrome.bookmarks.getRecent 语义）
      var sorted = all.slice().sort(function (a, b) {
        return (b.dateAdded || 0) - (a.dateAdded || 0);
      });
      cb(sorted.slice(0, count));
    })
  }
};

// Bookmarks test helpers
chrome._setBookmarks = function (nodes) {
  chromeMockData.__bookmarks = nodes || [];
};
chrome._setBookmarkTree = function (tree) {
  chromeMockData.__bookmarkTree = tree || [];
};
