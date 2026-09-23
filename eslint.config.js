import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

// Verificaciones 1, 2 y 3 de la especificación:
//   1. no-undef                 -> variables/funciones no definidas
//   2. react/jsx-no-undef       -> componentes JSX usados sin importar
//   3. no-use-before-define     -> uso antes de declarar (incluye hooks,
//      callbacks de map/filter/reduce e inicializadores). React registra los
//      efectos durante el render, así que un useEffect escrito antes de la
//      variable que usa debe marcarse aunque su cuerpo corra después.
export default [
  // `verificar` corre lint ANTES de `vite build`, así que si `dist/` quedó
  // de una build anterior, ESLint lo relintea como si fuera código fuente
  // (service worker minificado incluido) y explota con cientos de falsos
  // errores. `dist` está en .gitignore pero ESLint no lo lee solo.
  { ignores: ['dist/**', 'dist-ssr/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-no-undef': 'error',
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-use-before-define': [
        'error',
        { functions: true, classes: true, variables: true, allowNamedExports: false },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
]
