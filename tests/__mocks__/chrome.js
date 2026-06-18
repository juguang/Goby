// Chrome API mock for Jest testing
// Mock chrome.storage.local with an in-memory store

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
    captureVisibleTab: jest.fn()
  },
  scripting: {
    executeScript: jest.fn()
  }
};
