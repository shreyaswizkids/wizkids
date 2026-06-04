import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/img': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/admin': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/student.html': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/mentor.html': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/sme.html': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/start.html': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
