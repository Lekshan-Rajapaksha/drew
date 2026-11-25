import tseslint from 'typescript-eslint'

export default [
  { ignores: ['out/**', 'dist/**', 'release/**', 'ardia/**'] },
  ...tseslint.configs.recommended,
]
