/**
 * Storage module tests — GobyStorage interface
 *
 * Tests 1-3 from PLAN.md behaviors:
 * 1. saveConfig → chrome.storage.local.set called with key "agentConfig", value matches input
 * 2. getConfig() with data → returns {baseUrl, apiKey, model} object
 * 3. getConfig() without data → returns default {baseUrl: '', apiKey: '', model: ''}
 */

// Load chrome mock
require('./__mocks__/chrome.js');

describe('GobyStorage', () => {
  beforeEach(() => {
    chrome.storage.local.__resetStore();
    chrome.storage.local.set.mockClear();
    chrome.storage.local.get.mockClear();
  });

  describe('saveConfig', () => {
    it('Test 1: stores config via chrome.storage.local.set with key "agentConfig"', async () => {
      // This will fail during RED phase — GobyStorage does not exist yet
      const config = {
        baseUrl: 'http://x',
        apiKey: 'sk-test',
        model: 'm1'
      };

      await GobyStorage.saveConfig(config);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        agentConfig: config
      });
    });

    it('stores different config values correctly', async () => {
      const config = {
        baseUrl: 'http://example.com/v1',
        apiKey: 'sk-abc123',
        model: 'gpt-4'
      };

      await GobyStorage.saveConfig(config);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        agentConfig: config
      });
    });
  });

  describe('getConfig', () => {
    it('Test 2: returns stored config from chrome.storage.local', async () => {
      const storedConfig = {
        baseUrl: 'http://127.0.0.1:8765/v1',
        apiKey: 'sk-test-key',
        model: 'Qwen3.6-35B-A3B'
      };

      // Pre-populate the mock store
      chrome.storage.local.set({ agentConfig: storedConfig });

      const result = await GobyStorage.getConfig();

      expect(result).toEqual(storedConfig);
      expect(chrome.storage.local.get).toHaveBeenCalledWith(['agentConfig']);
    });

    it('Test 3: returns default config when storage is empty', async () => {
      // Storage is empty (no pre-population)

      const result = await GobyStorage.getConfig();

      expect(result).toEqual({
        baseUrl: '',
        apiKey: '',
        model: ''
      });
      expect(chrome.storage.local.get).toHaveBeenCalledWith(['agentConfig']);
    });
  });
});
