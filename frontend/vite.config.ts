import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // VITE_BASE_PATH: 경로 배포 시 '/track/' — 독립 포트 시 '/' (기본)
  const base = env.VITE_BASE_PATH || '/'

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      host: '0.0.0.0',
      port: 7001,
      proxy: {
        '/api': {
          target: 'http://localhost:7000',
          changeOrigin: true,
        },
      },
    },
  }
})
