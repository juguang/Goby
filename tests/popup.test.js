/**
 * Popup module tests — popup.js interaction logic
 *
 * Tests 4-5 from PLAN.md behaviors:
 * 4. popup.js on DOMContentLoaded calls getConfig() and fills form fields
 * 5. Save button click collects values, calls saveConfig, shows green "已保存", fades after 2s
 */

require('./__mocks__/chrome.js');

describe('Popup', () => {
  let container;

  beforeEach(() => {
    chrome.storage.local.__resetStore();
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Set up DOM environment
    container = document.createElement('div');
    container.innerHTML = `
      <input type="text" id="baseUrl" />
      <input type="password" id="apiKey" />
      <input type="text" id="model" />
      <button id="saveBtn">保存配置</button>
      <span id="saveStatus" style="display:none"></span>
    `;
    document.body.appendChild(container);

    // Mock getConfig to return default empty values first (for RED phase, GobyStorage won't exist yet)
  });

  afterEach(() => {
    document.body.removeChild(container);
    jest.useRealTimers();
  });

  describe('DOMContentLoaded', () => {
    it('Test 4: loads config and fills form fields on DOMContentLoaded', () => {
      // Set up the stored config
      const storedConfig = {
        baseUrl: 'http://example.com/v1',
        apiKey: 'sk-saved-key',
        model: 'gpt-4'
      };

      // Pre-populate storage
      chrome.storage.local.__resetStore();
      chrome.storage.local.set({ agentConfig: storedConfig });

      // Simulate DOMContentLoaded — this will fail during RED phase
      const event = new Event('DOMContentLoaded');
      document.dispatchEvent(event);

      // Check that form fields are populated
      expect(document.getElementById('baseUrl').value).toBe('http://example.com/v1');
      expect(document.getElementById('apiKey').value).toBe('sk-saved-key');
      expect(document.getElementById('model').value).toBe('gpt-4');
    });

    it('handles empty storage by filling empty strings', () => {
      // Storage is empty
      chrome.storage.local.__resetStore();

      const event = new Event('DOMContentLoaded');
      document.dispatchEvent(event);

      expect(document.getElementById('baseUrl').value).toBe('');
      expect(document.getElementById('apiKey').value).toBe('');
      expect(document.getElementById('model').value).toBe('');
    });
  });

  describe('Save button', () => {
    it('Test 5: saves config on button click and shows "已保存" feedback', async () => {
      // Fill form fields
      document.getElementById('baseUrl').value = 'http://test.com/v1';
      document.getElementById('apiKey').value = 'sk-test-456';
      document.getElementById('model').value = 'qwen-3';

      // Click save button
      document.getElementById('saveBtn').click();

      // Wait for async operations
      await Promise.resolve();

      // Verify storage was called
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        agentConfig: {
          baseUrl: 'http://test.com/v1',
          apiKey: 'sk-test-456',
          model: 'qwen-3'
        }
      });

      // Verify success feedback
      const saveStatus = document.getElementById('saveStatus');
      expect(saveStatus.textContent).toBe('已保存');
      expect(saveStatus.style.color).toBe('#22c55e');
      expect(saveStatus.style.display).not.toBe('none');
    });

    it('shows error feedback when save fails', async () => {
      // Make set reject
      chrome.storage.local.set.mockRejectedValueOnce(new Error('Storage error'));

      document.getElementById('baseUrl').value = 'http://test.com/v1';
      document.getElementById('apiKey').value = 'sk-test';
      document.getElementById('model').value = 'qwen';

      document.getElementById('saveBtn').click();

      // Let promise rejection settle
      await Promise.resolve();
      await Promise.resolve();

      const saveStatus = document.getElementById('saveStatus');
      expect(saveStatus.style.color).toBe('#ef4444');
    });
  });
});
