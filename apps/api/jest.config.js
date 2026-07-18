/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/test"],
  testMatch: ["**/*.spec.ts", "**/*.e2e-spec.ts"],
  setupFiles: ["<rootDir>/test/setup.ts"],
  moduleNameMapper: {
    "^@stackup/shared$": "<rootDir>/../../packages/shared/src/index.ts",
  },
};
