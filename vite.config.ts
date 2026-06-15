import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: {
    // Lyssna på alla interface så att LAN-spel (etapp 2) och test från
    // andra enheter funkar redan under utveckling.
    host: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
