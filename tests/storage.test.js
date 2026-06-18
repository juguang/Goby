/**
 * Storage module tests — GobyStorage interface
 *
 * Tests cover multi-profile CRUD (saveProfile, getProfiles, deleteProfile,
 * setActiveProfile, getActiveProfile, profileExists), old-format migration,
 * and backward compatibility of saveConfig/getConfig.
 */

// Load chrome mock
require('./__mocks__/chrome.js');

// Load storage.js implementation (creates GobyStorage as a global)
require('../storage.js');

describe('GobyStorage', () => {
  beforeEach(() => {
    chrome.storage.local._reset();
    chrome.storage.local.set.mockClear();
    chrome.storage.local.get.mockClear();
  });

  // --- Legacy backward-compat tests (retained from Plan 01-01) ---

  describe('saveConfig (legacy backward compat)', () => {
    it('stores config via chrome.storage.local.set with key "agentConfig" (new format)', async () => {
      const config = {
        baseUrl: 'http://x',
        apiKey: 'sk-test',
        model: 'm1'
      };

      await GobyStorage.saveConfig(config);

      // saveConfig now wraps into new multi-profile format
      expect(chrome.storage.local.set).toHaveBeenCalled();
      const stored = await chrome.storage.local.get(['agentConfig']);
      expect(stored.agentConfig.profiles['默认配置']).toEqual({
        baseUrl: 'http://x',
        apiKey: 'sk-test',
        model: 'm1'
      });
      expect(stored.agentConfig.activeProfile).toBe('默认配置');
    });

    it('stores different config values correctly', async () => {
      const config = {
        baseUrl: 'http://example.com/v1',
        apiKey: 'sk-abc123',
        model: 'gpt-4'
      };

      await GobyStorage.saveConfig(config);

      const stored = await chrome.storage.local.get(['agentConfig']);
      expect(stored.agentConfig.profiles['默认配置'].baseUrl).toBe('http://example.com/v1');
      expect(stored.agentConfig.profiles['默认配置'].apiKey).toBe('sk-abc123');
      expect(stored.agentConfig.profiles['默认配置'].model).toBe('gpt-4');
    });
  });

  describe('getConfig (legacy backward compat)', () => {
    it('returns stored config from chrome.storage.local', async () => {
      const storedConfig = {
        baseUrl: 'http://127.0.0.1:8765/v1',
        apiKey: 'sk-test-key',
        model: 'Qwen3.6-35B-A3B'
      };

      chrome.storage.local.set({ agentConfig: storedConfig });

      const result = await GobyStorage.getConfig();

      expect(result).toEqual(storedConfig);
    });

    it('returns default config when storage is empty', async () => {
      const result = await GobyStorage.getConfig();

      expect(result).toEqual({
        baseUrl: '',
        apiKey: '',
        model: ''
      });
    });
  });

  // --- New multi-profile CRUD tests (Plan 01-02) ---

  describe('saveProfile', () => {
    it('Test 1: saves a profile under agentConfig.profiles', async () => {
      await GobyStorage.saveProfile('Qwen本地', {
        baseUrl: 'http://x',
        apiKey: 'k1',
        model: 'm1'
      });

      const result = await chrome.storage.local.get(['agentConfig']);
      expect(result.agentConfig.profiles['Qwen本地']).toEqual({
        baseUrl: 'http://x',
        apiKey: 'k1',
        model: 'm1'
      });
    });

    it('Test 2: saves a second profile without losing the first', async () => {
      await GobyStorage.saveProfile('Qwen本地', {
        baseUrl: 'http://x',
        apiKey: 'k1',
        model: 'm1'
      });
      await GobyStorage.saveProfile('DeepSeek', {
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-ds',
        model: 'deepseek-v4'
      });

      const result = await chrome.storage.local.get(['agentConfig']);
      const profiles = result.agentConfig.profiles;
      expect(Object.keys(profiles).length).toBe(2);
      expect(profiles['Qwen本地'].model).toBe('m1');
      expect(profiles['DeepSeek'].model).toBe('deepseek-v4');
    });

    it('sets activeProfile if no active profile exists', async () => {
      // Empty storage — no activeProfile
      await GobyStorage.saveProfile('测试', {
        baseUrl: 'http://x',
        apiKey: 'k',
        model: 'm'
      });

      const result = await chrome.storage.local.get(['agentConfig']);
      expect(result.agentConfig.activeProfile).toBe('测试');
    });
  });

  describe('getProfiles', () => {
    it('Test 3: returns the full profiles object', async () => {
      await GobyStorage.saveProfile('Qwen本地', {
        baseUrl: 'http://x',
        apiKey: 'k1',
        model: 'm1'
      });
      await GobyStorage.saveProfile('DeepSeek', {
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-ds',
        model: 'deepseek-v4'
      });

      const profiles = await GobyStorage.getProfiles();
      expect(profiles['Qwen本地'].baseUrl).toBe('http://x');
      expect(profiles['DeepSeek'].baseUrl).toBe('https://api.deepseek.com');
    });

    it('returns empty object when no profiles exist', async () => {
      const profiles = await GobyStorage.getProfiles();
      expect(profiles).toEqual({});
    });
  });

  describe('setActiveProfile', () => {
    it('Test 4: sets activeProfile in agentConfig', async () => {
      await GobyStorage.saveProfile('Qwen本地', {
        baseUrl: 'http://x',
        apiKey: 'k1',
        model: 'm1'
      });

      await GobyStorage.setActiveProfile('Qwen本地');

      const result = await chrome.storage.local.get(['agentConfig']);
      expect(result.agentConfig.activeProfile).toBe('Qwen本地');
    });

    it('rejects when profile does not exist', async () => {
      await expect(
        GobyStorage.setActiveProfile('不存在')
      ).rejects.toThrow(/不存在/);
    });
  });

  describe('getActiveProfile', () => {
    it('Test 5: returns the active profile name string', async () => {
      await GobyStorage.saveProfile('测试', {
        baseUrl: 'http://x',
        apiKey: 'k',
        model: 'm'
      });

      const active = await GobyStorage.getActiveProfile();
      expect(active).toBe('测试');
    });

    it('returns empty string when no active profile', async () => {
      const active = await GobyStorage.getActiveProfile();
      expect(active).toBe('');
    });
  });

  describe('deleteProfile', () => {
    it('Test 6a: removes the profile from profiles object', async () => {
      await GobyStorage.saveProfile('Qwen本地', {
        baseUrl: 'http://x',
        apiKey: 'k1',
        model: 'm1'
      });
      await GobyStorage.saveProfile('DeepSeek', {
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-ds',
        model: 'deepseek-v4'
      });

      await GobyStorage.deleteProfile('Qwen本地');

      const result = await chrome.storage.local.get(['agentConfig']);
      expect(result.agentConfig.profiles['Qwen本地']).toBeUndefined();
      expect(result.agentConfig.profiles['DeepSeek']).toBeDefined();
    });

    it('Test 6b: auto-switches activeProfile to remaining first profile', async () => {
      await GobyStorage.saveProfile('Qwen本地', {
        baseUrl: 'http://x',
        apiKey: 'k1',
        model: 'm1'
      });
      await GobyStorage.saveProfile('DeepSeek', {
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-ds',
        model: 'deepseek-v4'
      });
      await GobyStorage.setActiveProfile('Qwen本地');

      await GobyStorage.deleteProfile('Qwen本地');

      const result = await chrome.storage.local.get(['agentConfig']);
      expect(result.agentConfig.activeProfile).toBe('DeepSeek');
    });

    it('Test 6c: sets activeProfile to empty string when deleting last profile', async () => {
      await GobyStorage.saveProfile('仅有的', {
        baseUrl: 'http://x',
        apiKey: 'k',
        model: 'm'
      });
      await GobyStorage.setActiveProfile('仅有的');

      await GobyStorage.deleteProfile('仅有的');

      const result = await chrome.storage.local.get(['agentConfig']);
      expect(result.agentConfig.activeProfile).toBe('');
      expect(result.agentConfig.profiles).toEqual({});
    });
  });

  describe('profileExists', () => {
    it('returns true for existing profile', async () => {
      await GobyStorage.saveProfile('测试', {
        baseUrl: 'http://x',
        apiKey: 'k',
        model: 'm'
      });

      expect(GobyStorage.profileExists('测试')).toBe(true);
    });

    it('returns false for non-existent profile', async () => {
      expect(GobyStorage.profileExists('不存在')).toBe(false);
    });
  });

  describe('Old format migration', () => {
    it('Test 7: migrates old {baseUrl, apiKey, model} format to new profiles format', async () => {
      // Simulate old format (Plan 01-01) already in storage
      const oldData = {
        baseUrl: 'http://legacy.com/v1',
        apiKey: 'sk-legacy',
        model: 'legacy-model'
      };
      await chrome.storage.local.set({ agentConfig: oldData });

      // Call getProfiles() — should trigger migration
      const profiles = await GobyStorage.getProfiles();

      // Verify migration: old data moved to profiles["默认配置"]
      expect(profiles['默认配置']).toBeDefined();
      expect(profiles['默认配置'].baseUrl).toBe('http://legacy.com/v1');
      expect(profiles['默认配置'].apiKey).toBe('sk-legacy');
      expect(profiles['默认配置'].model).toBe('legacy-model');

      // Verify storage was updated with new format
      const stored = await chrome.storage.local.get(['agentConfig']);
      expect(stored.agentConfig.profiles).toBeDefined();
      expect(stored.agentConfig.activeProfile).toBe('默认配置');
      // Old top-level fields should be removed or not present on top level
      expect(stored.agentConfig.baseUrl).toBeUndefined();
    });

    it('does not re-migrate if already in new format', async () => {
      // Already in new format
      const newData = {
        profiles: {
          '现有配置': { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
        },
        activeProfile: '现有配置'
      };
      await chrome.storage.local.set({ agentConfig: newData });

      // Spy on set
      chrome.storage.local.set.mockClear();

      const profiles = await GobyStorage.getProfiles();

      // Should not call set (no migration needed)
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(profiles['现有配置'].baseUrl).toBe('http://x');
    });

    it('migrates only once — second access does not re-write', async () => {
      const oldData = {
        baseUrl: 'http://legacy.com/v1',
        apiKey: 'sk-legacy',
        model: 'legacy-model'
      };
      await chrome.storage.local.set({ agentConfig: oldData });

      // First call triggers migration
      await GobyStorage.getProfiles();
      const callCount = chrome.storage.local.set.mock.calls.length;

      // Second call should not trigger another migration
      await GobyStorage.getProfiles();
      expect(chrome.storage.local.set.mock.calls.length).toBe(callCount);
    });
  });

  describe('Backward compatibility (saveConfig/getConfig with multi-profile)', () => {
    it('saveConfig stores under profiles["默认配置"]', async () => {
      await GobyStorage.saveConfig({
        baseUrl: 'http://backward.com',
        apiKey: 'sk-bc',
        model: 'bc-model'
      });

      const stored = await chrome.storage.local.get(['agentConfig']);
      expect(stored.agentConfig.profiles['默认配置'].baseUrl).toBe('http://backward.com');
      expect(stored.agentConfig.activeProfile).toBe('默认配置');
    });

    it('getConfig returns the active profile config', async () => {
      await GobyStorage.saveProfile('测试', {
        baseUrl: 'http://active.com',
        apiKey: 'sk-active',
        model: 'active-model'
      });
      await GobyStorage.setActiveProfile('测试');

      const config = await GobyStorage.getConfig();
      expect(config.baseUrl).toBe('http://active.com');
      expect(config.apiKey).toBe('sk-active');
      expect(config.model).toBe('active-model');
    });
  });
});
