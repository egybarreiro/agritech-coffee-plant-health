import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  envDir: false,
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    globals: true,
  },
})