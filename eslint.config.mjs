import globals from 'globals';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

const typedFileGlobs = [
  'api/src/**/*.ts',
  'web/src/**/*.{ts,tsx}',
  'shared/src/**/*.ts',
  'e2e/**/*.ts',
];

const maxLinesExemptGlobs = [
  '**/generated/**',
  '**/*.test.ts',
  '**/*.spec.ts',
  'e2e/**/*.ts',
  'api/src/db/migrations/**',
];

const maxLinesRule = [
  'warn',
  { max: 500, skipBlankLines: true, skipComments: true },
];

const typeSafetyRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/no-unused-vars': [
    'error',
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
  'max-lines': maxLinesRule,
  'import-x/no-duplicates': 'error',
};

const typedTypeSafetyRules = {
  ...typeSafetyRules,
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/no-unnecessary-type-assertion': 'error',
  '@typescript-eslint/no-unnecessary-condition': 'off',
  '@typescript-eslint/no-redundant-type-constituents': 'error',
  '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
  '@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'error',
  '@typescript-eslint/no-floating-promises': 'off',
  '@typescript-eslint/await-thenable': 'error',
  '@typescript-eslint/no-misused-promises': 'off',
  '@typescript-eslint/restrict-template-expressions': 'error',
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
      'import-x': importX,
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
  {
    files: maxLinesExemptGlobs,
    rules: {
      'max-lines': 'off',
    },
  },
];
