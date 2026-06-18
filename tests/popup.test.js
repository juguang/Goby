/**
 * Popup module tests — popup.js interaction logic
 *
 * Tests 4-5 from PLAN.md behaviors:
 * 4. popup.js on DOMContentLoaded calls getConfig() and fills form fields
 * 5. Save button click collects values, calls saveConfig, shows green "已保存", fades after 2s
 */

// Load chrome mock and storage module first (creates global GobyStorage)
require('./__mocks__/chrome.js');
require('../storage.js');

// Helper: flush microtask queue by chaining multiple Promise.resolve().then() cycles
// The getConfig().then().then() chain takes 2 microtask ticks to complete.
// saveProfile now does readConfig → writeConfig → readConfig (cache refresh) = 3+ ticks.
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
      '<input type="text" id="baseUrl" />',
      '<input type="password" id="apiKey" />',
      '<input type="text" id="model" />',
      '<button class="btn-save" id="saveBtn">保存配置</button>',
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
    it('Test 4: loads config and fills form fields on DOMContentLoaded', function () {
      setupDom();

      // Pre-populate the mock's internal storage directly
      chrome.storage.local._raw.agentConfig = {
        baseUrl: 'http://example.com/v1',
        apiKey: 'sk-saved-key',
        model: 'gpt-4'
      };

      // Load popup.js — it calls loadConfig() synchronously since readyState is 'complete'
      loadPopup();

      // Wait for the getConfig().then().then() chain to complete (2 microtask cycles)
      return flushMicrotasks().then(function () {
        expect(document.getElementById('baseUrl').value).toBe('http://example.com/v1');
        expect(document.getElementById('apiKey').value).toBe('sk-saved-key');
        expect(document.getElementById('model').value).toBe('gpt-4');
      });
    });

    it('handles empty storage by filling empty strings', function () {
      setupDom();
      chrome.storage.local._reset();

      loadPopup();

      return flushMicrotasks().then(function () {
        expect(document.getElementById('baseUrl').value).toBe('');
        expect(document.getElementById('apiKey').value).toBe('');
        expect(document.getElementById('model').value).toBe('');
      });
    });
  });

  describe('Save button', function () {
    it('Test 5: saves config on button click with correct data', function () {
      setupDom();
      loadPopup();

      // Fill form fields
      document.getElementById('baseUrl').value = 'http://test.com/v1';
      document.getElementById('apiKey').value = 'sk-test-456';
      document.getElementById('model').value = 'qwen-3';

      // Click save button
      document.getElementById('saveBtn').click();

      // saveConfig() also goes through a promise chain
      return flushMicrotasks().then(function () {
        // saveConfig now stores in new multi-profile format
        expect(chrome.storage.local.set).toHaveBeenCalled();
        // Verify the data was stored correctly via getConfig
        return GobyStorage.getConfig().then(function (result) {
          expect(result.baseUrl).toBe('http://test.com/v1');
          expect(result.apiKey).toBe('sk-test-456');
          expect(result.model).toBe('qwen-3');
        }).then(function () {

          // Verify success feedback
          var saveStatus = document.getElementById('saveStatus');
          expect(saveStatus.textContent).toBe('已保存');
          expect(saveStatus.className).toContain('success');
        });
      });
    });

    it('shows error feedback when save fails', function () {
      chrome.storage.local.set.mockRejectedValueOnce(new Error('Storage error'));

      setupDom();
      loadPopup();

      document.getElementById('baseUrl').value = 'http://test.com/v1';
      document.getElementById('apiKey').value = 'sk-test';
      document.getElementById('model').value = 'qwen';

      document.getElementById('saveBtn').click();

      return flushMicrotasks().then(function () {
        return flushMicrotasks().then(function () {
          var saveStatus = document.getElementById('saveStatus');
          expect(saveStatus.className).toContain('error');
        });
      });
    });

    it('toggles API Key visibility on eye icon click', function () {
      setupDom();
      loadPopup();

      var apiKeyInput = document.getElementById('apiKey');
      var eyeToggle = document.getElementById('eyeToggle');

      // Default should be password
      expect(apiKeyInput.type).toBe('password');

      // Click eye toggle
      eyeToggle.click();
      expect(apiKeyInput.type).toBe('text');

      // Click again to toggle back
      eyeToggle.click();
      expect(apiKeyInput.type).toBe('password');
    });
  });
});
