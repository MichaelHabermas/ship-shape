import globals from 'globals';
import tseslint from 'typescript-eslint';

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
    'warn',
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
  '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
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
      '**/docs/pr-evidence/**',
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
    files: ['api/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: typedTypeSafetyRules,
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
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
    files: ['shared/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: typedTypeSafetyRules,
  },
];
