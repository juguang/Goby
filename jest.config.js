module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/**/*.test.js'],
  // Reset modules between tests to ensure clean state
  resetModules: true,
  // Don't restore mocks between tests — we do it manually
  restoreMocks: false,
};
