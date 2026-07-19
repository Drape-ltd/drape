/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  watchman: false,
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^@drape/drape-vision/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        target: 'ES2020',
        lib: ['ES2020'],
        esModuleInterop: true,
        baseUrl: '.',
        paths: {
          '@drape/drape-vision/*': ['src/*'],
        },
        types: ['jest'],
        typeRoots: ['../shared/node_modules/@types'],
      },
    }],
  },
}
