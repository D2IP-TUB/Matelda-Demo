// Kept apart from vite.config.ts: vitest 3 bundles its own Vite types, which clash with
// the app's Vite 8 types in the type-checked build config.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
