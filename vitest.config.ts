import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Compiles `.vue` files for component tests; those opt into a DOM with
  // `// @vitest-environment happy-dom` so every other test stays on plain Node.
  plugins: [vue()],
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'plugins/*/tests/**/*.test.ts'],
    pool: 'forks',
  },
})
