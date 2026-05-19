module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  env: {
    es2021: true,
    node: true,
  },
  plugins: [
    '@typescript-eslint',
    'react',
    'react-native',
    'react-hooks',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  settings: {
    react: {
      version: 'detect',
    },
  },
  ignorePatterns: [
    '.expo/',
    '.turbo/',
    'assets/',
    'babel.config.js',
    'ios/',
    'metro.config.js',
    'node_modules/',
  ],
  rules: {
    'no-restricted-syntax': [
      'warn',
      {
        selector: 'Literal[value=/^#[0-9A-Fa-f]{3,8}$/]',
        message: 'Hardcoded colour found. Import from design-system.ts instead.',
      },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
    // TODO post-launch: turn these back up while doing the full UI/perf cleanup.
    'react-native/no-inline-styles': 'off',
    'no-mixed-spaces-and-tabs': 'off',
    'react/no-unescaped-entities': 'off',
    'react-hooks/set-state-in-effect': 'warn',
    'react-hooks/refs': 'warn',
    'react-hooks/preserve-manual-memoization': 'warn',
    'react-hooks/purity': 'warn',
    'react-hooks/immutability': 'warn',
    '@typescript-eslint/no-require-imports': 'warn',
    'no-empty': 'warn',
    'no-extra-semi': 'warn',
    'prefer-const': 'warn',
    'react/react-in-jsx-scope': 'off',
  },
}
