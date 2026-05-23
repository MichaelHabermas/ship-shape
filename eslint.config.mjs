import globals from 'globals';
import tseslint from 'typescript-eslint';

const typedFileGlobs = [
  'api/src/**/*.ts',
  'web/src/**/*.{ts,tsx}',
  'shared/src/**/*.ts',
  'e2e/**/*.ts',
];

const typeSafetyRules = {
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-non-null-assertion': 'warn',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    {
      argsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    },
  ],
  '@typescript-eslint/consistent-type-assertions': [
    'off',
    {
      assertionStyle: 'as',
      objectLiteralTypeAssertions: 'never',
    },
  ],
};

const typedTypeSafetyRules = {
  ...typeSafetyRules,
  '@typescript-eslint/no-unsafe-assignment': 'warn',
  '@typescript-eslint/no-unsafe-member-access': 'warn',
  '@typescript-eslint/no-unsafe-argument': 'warn',
  '@typescript-eslint/no-unsafe-return': 'warn',
  '@typescript-eslint/no-unsafe-call': 'warn',
  '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
  '@typescript-eslint/no-unnecessary-condition': 'off',
  '@typescript-eslint/no-redundant-type-constituents': 'warn',
  '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',
  '@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'warn',
  '@typescript-eslint/no-floating-promises': 'off',
  '@typescript-eslint/await-thenable': 'warn',
  '@typescript-eslint/no-misused-promises': 'off',
  '@typescript-eslint/restrict-template-expressions': 'warn',
  '@typescript-eslint/explicit-module-boundary-types': 'off',
  '@typescript-eslint/switch-exhaustiveness-check': 'off',
  '@typescript-eslint/strict-boolean-expressions': 'off',
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dev-dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/my-docs/audit-evidence/**',
      '**/*.d.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: typeSafetyRules,
  },
  {
    files: typedFileGlobs,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: typedTypeSafetyRules,
  },
  {
    files: ['api/src/**/*.ts', 'shared/src/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
