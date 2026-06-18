// Chrome API mock for Jest testing
// Mock chrome.storage.local with an in-memory store

const storage = {};

global.chrome = {
  runtime: {
    lastError: null,
    onMessage: {
      addListener: jest.fn()
    },
    onInstalled: {
      addListener: jest.fn()
    }
  },
  storage: {
    local: {
      get: jest.fn((keys) => {
        return new Promise((resolve) => {
          if (typeof keys === 'string') {
            const val = storage[keys];
            resolve({ [keys]: val !== undefined ? val : null });
          } else if (Array.isArray(keys)) {
            const result = {};
            keys.forEach(key => {
              const val = storage[key];
              result[key] = val !== undefined ? val : null;
            });
            resolve(result);
          } else if (typeof keys === 'object' && keys !== null) {
            const result = { ...keys };
            Object.keys(keys).forEach(key => {
              const val = storage[key];
              if (val !== undefined) {
                result[key] = val;
              }
            });
            resolve(result);
          } else {
            resolve({});
          }
        });
      }),
      set: jest.fn((items) => {
        return new Promise((resolve) => {
          Object.assign(storage, items);
          resolve();
        });
      }),
      remove: jest.fn((keys) => {
        return new Promise((resolve) => {
          if (Array.isArray(keys)) {
            keys.forEach(key => delete storage[key]);
          } else {
            delete storage[keys];
          }
          resolve();
        });
      }),
      clear: jest.fn(() => {
        Object.keys(storage).forEach(key => delete storage[key]);
        return Promise.resolve();
      }),
      // Helper to reset the mock store between tests
      __resetStore: () => {
        Object.keys(storage).forEach(key => delete storage[key]);
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
    query: jest.fn()
  }
};
