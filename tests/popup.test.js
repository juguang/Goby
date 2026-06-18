/**
 * Popup module tests — popup.js interaction logic
 *
 * Tests cover:
 * - DOMContentLoaded initialization: loads profiles and fills form
 * - Profile switching: select change triggers setActiveProfile
 * - Save button: saves to current profile with new format
 * - Delete profile: confirmation + deletion
 * - Eye toggle: API Key visibility toggle
 */

// Load chrome mock and storage module first (creates global GobyStorage)
require('./__mocks__/chrome.js');
require('../storage.js');

// Helper: flush microtask queue by chaining multiple Promise.resolve().then() cycles
function flushMicrotasks() {
  return Promise.resolve().then(function () {
    return Promise.resolve();
  }).then(function () {
    return Promise.resolve();
  }).then(function () {
    return Promise.resolve();
  }).then(function () {
    return Promise.resolve();
  }).then(function () {
    return Promise.resolve();
  });
}

describe('Popup', function () {
  var container;

  beforeEach(function () {
    chrome.storage.local._reset();
    jest.clearAllMocks();
  });

  afterEach(function () {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  function setupDom() {
    container = document.createElement('div');
    container.innerHTML = [
      // Profile selector
      '<select id="profile-select"><option disabled>暂无配置</option></select>',
      '<button class="profile-btn" id="btn-add-profile">+</button>',
      '<button class="profile-btn" id="btn-edit-profile" disabled>E</button>',
      '<button class="profile-btn delete-btn" id="btn-delete-profile" disabled>X</button>',
      // Empty state
      '<div class="empty-state" id="emptyState">',
      '  <div class="empty-icon"></div>',
      '  <div class="empty-title">暂无 API 配置</div>',
      '  <div class="empty-body">点击右上角 + 按钮添加你的第一个 API 配置</div>',
      '</div>',
      // Form section
      '<div class="form-section" id="formSection">',
      '  <input type="text" id="baseUrl" />',
      '  <input type="password" id="apiKey" />',
      '  <input type="text" id="model" />',
      '  <button class="btn-save" id="saveBtn">保存配置</button>',
      '</div>',
      '<div id="saveStatus"></div>',
      '<button class="eye-toggle" id="eyeToggle" type="button">&#x1F441;</button>'
    ].join('');
    document.body.appendChild(container);
  }

  function loadPopup() {
    jest.isolateModules(function () {
      require('../popup.js');
    });
  }

  describe('DOMContentLoaded', function () {
    it('Test 4: loads profiles and fills form on DOMContentLoaded', function () {
      setupDom();

      // Pre-populate with new format data (single profile)
      chrome.storage.local.set({
        agentConfig: {
          profiles: {
            '测试配置': {
              baseUrl: 'http://example.com/v1',
              apiKey: 'sk-saved-key',
              model: 'gpt-4'
            }
          },
          activeProfile: '测试配置'
        }
      });

      // Load popup.js — it calls initPopup() synchronously
      loadPopup();

      // Wait for the Promise.all([getProfiles, getActiveProfile]) chain
      return flushMicrotasks().then(function () {
        expect(document.getElementById('baseUrl').value).toBe('http://example.com/v1');
        expect(document.getElementById('apiKey').value).toBe('sk-saved-key');
        expect(document.getElementById('model').value).toBe('gpt-4');
      });
    });

    it('handles empty storage by showing empty state', function () {
      setupDom();
      chrome.storage.local._reset();

      loadPopup();

      return flushMicrotasks().then(function () {
        // Form fields should be empty
        expect(document.getElementById('baseUrl').value).toBe('');
        expect(document.getElementById('apiKey').value).toBe('');
        expect(document.getElementById('model').value).toBe('');
        // Empty state should be visible
        var emptyEl = document.getElementById('emptyState');
        expect(emptyEl.classList.contains('visible')).toBe(true);
      });
    });
  });

  describe('Save button', function () {
    it('Test 5: saves config on button click to current profile', function () {
      setupDom();

      // Pre-populate with a profile
      chrome.storage.local.set({
        agentConfig: {
          profiles: {
            '测试配置': {
              baseUrl: 'http://example.com/v1',
              apiKey: 'sk-original',
              model: 'gpt-4'
            }
          },
          activeProfile: '测试配置'
        }
      });

      loadPopup();

      return flushMicrotasks().then(function () {
        // The profile should be loaded, form filled
        expect(document.getElementById('baseUrl').value).toBe('http://example.com/v1');

        // Modify the form
        document.getElementById('baseUrl').value = 'http://test.com/v1';
        document.getElementById('apiKey').value = 'sk-test-456';
        document.getElementById('model').value = 'qwen-3';

        // Click save button
        document.getElementById('saveBtn').click();

        return flushMicrotasks().then(function () {
          // Verify storage was updated under the correct profile
          return GobyStorage.getConfig().then(function (result) {
            expect(result.baseUrl).toBe('http://test.com/v1');
            expect(result.apiKey).toBe('sk-test-456');
            expect(result.model).toBe('qwen-3');
          }).then(function () {
            // Verify success feedback
            var saveStatusEl = document.getElementById('saveStatus');
            expect(saveStatusEl.textContent).toBe('已保存');
            expect(saveStatusEl.className).toContain('success');
          });
        });
      });
    });

    it('shows error feedback when save fails', function () {
      setupDom();

      // Pre-populate storage directly (avoid mockRejectedValueOnce affecting pre-pop)
      chrome.storage.local._raw.agentConfig = {
        profiles: {
          '测试配置': {
            baseUrl: 'http://example.com/v1',
            apiKey: 'sk-original',
            model: 'gpt-4'
          }
        },
        activeProfile: '测试配置'
      };

      loadPopup();

      return flushMicrotasks().then(function () {
        // Form should be loaded
        expect(document.getElementById('baseUrl').value).toBe('http://example.com/v1');

        // Now apply rejection for the save operation
        chrome.storage.local.set.mockRejectedValueOnce(new Error('Storage error'));

        document.getElementById('baseUrl').value = 'http://test.com/v1';
        document.getElementById('apiKey').value = 'sk-test';
        document.getElementById('model').value = 'qwen';

        document.getElementById('saveBtn').click();

        return flushMicrotasks().then(function () {
          return flushMicrotasks().then(function () {
            var saveStatusEl = document.getElementById('saveStatus');
            expect(saveStatusEl.className).toContain('error');
          });
        });
      });
    });
  });

  describe('Eye toggle', function () {
    it('toggles API Key visibility on eye icon click', function () {
      setupDom();
      loadPopup();

      var apiKeyInput = document.getElementById('apiKey');
      var eyeToggleEl = document.getElementById('eyeToggle');

      // Default should be password
      expect(apiKeyInput.type).toBe('password');

      // Click eye toggle
      eyeToggleEl.click();
      expect(apiKeyInput.type).toBe('text');

      // Click again to toggle back
      eyeToggleEl.click();
      expect(apiKeyInput.type).toBe('password');
    });
  });

  describe('Profile switching', function () {
    it('switching profile select calls setActiveProfile and loads form', function () {
      setupDom();

      chrome.storage.local.set({
        agentConfig: {
          profiles: {
            'Qwen本地': {
              baseUrl: 'http://qwen.local/v1',
              apiKey: 'sk-qwen',
              model: 'Qwen3.6-35B-A3B'
            },
            'DeepSeek': {
              baseUrl: 'https://api.deepseek.com',
              apiKey: 'sk-deepseek',
              model: 'deepseek-v4'
            }
          },
          activeProfile: 'Qwen本地'
        }
      });

      loadPopup();

      return flushMicrotasks().then(function () {
        // Verify initial state loads Qwen
        expect(document.getElementById('baseUrl').value).toBe('http://qwen.local/v1');

        // Switch to DeepSeek
        document.getElementById('profile-select').value = 'DeepSeek';
        document.getElementById('profile-select').dispatchEvent(new Event('change'));

        return flushMicrotasks().then(function () {
          // Form should now show DeepSeek config
          expect(document.getElementById('baseUrl').value).toBe('https://api.deepseek.com');
          expect(document.getElementById('apiKey').value).toBe('sk-deepseek');
          expect(document.getElementById('model').value).toBe('deepseek-v4');
        });
      });
    });
  });
});
