/** Unit tests. Database tests use TEST_DATABASE_URL (a separate database, migrated by the global setup). */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Database tests truncate ~70 tables before each test; on Docker for Windows that can exceed Jest's 5 s default.
  testTimeout: 30_000,
  transform: {
    '^.+\.ts$': [
      '@swc/jest',
      { jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true }, target: 'es2022' } },
    ],
  },
  moduleNameMapper: { '^@hsrp/contracts$': '<rootDir>/../../packages/contracts/src/index.ts' },
  globalSetup: '<rootDir>/test/global-setup.cjs',
  setupFiles: ['<rootDir>/test/env.cjs'],
};
