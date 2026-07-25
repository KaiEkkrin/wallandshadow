import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['build', 'node_modules', 'functions'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // eslint-plugin-react-hooks 7 folded the React Compiler rules into
      // `recommended`. Most of them pass as-is and are left enabled. These four
      // do not: they report 33 pre-existing violations across 24 files, largely
      // effects that call setState to derive state from props. Fixing those is a
      // real refactor of context providers, modals and the map annotations
      // layer — not something to fold into a dependency upgrade, since changing
      // effect semantics risks the real-time sync paths. Turned off to keep the
      // lint contract identical to the eslint 9 baseline; re-enable one at a
      // time when someone takes on the refactor.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Match strictness from functions config
      'eqeqeq': ['warn', 'always'],
      'no-var': 'warn',
      'prefer-const': 'warn',
      // Allow unused vars prefixed with underscore
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
);
