import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    base: './',
    server: {
      proxy: {
        '/api/twinkle': {
          target: 'https://t.tech/v0',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/twinkle/, ''),
          secure: false,
          configure: (proxy, options) => {
            proxy.on('proxyReq', (proxyReq, req, res) => {
              // Add API key to requests
              const apiKey = env.VITE_TWINKLE_API_KEY || 'wUgjkHpAR9u3q7zAFViM+w=='
              proxyReq.setHeader('Authorization', `Bearer ${apiKey}`)
            })
          }
        }
      }
    }
  }
})
