import tseslint from 'typescript-eslint'

export default [
  { ignores: ['out/**', 'dist/**', 'release/**'] },
  ...tseslint.configs.recommended,
]
