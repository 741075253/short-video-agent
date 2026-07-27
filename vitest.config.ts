import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true
  },
  server: {
    watch: {
      ignored: ['**/data/**']
    }
  }
})
