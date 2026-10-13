import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

/**
 * Backend the development server proxies to. Same shape as production, where
 * a Vercel rewrite forwards /api to the backend: the browser only ever talks
 * to its own origin, so the session cookie is first-party in both.
 */
const backend = process.env.VITE_DEV_PROXY_TARGET ?? process.env.VITE_API_URL ?? 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: backend,
        changeOrigin: true,
        rewrite: (url) => url.replace(/^\/api/, ''),
      },
      '/socket.io': { target: backend, ws: true, changeOrigin: true },
    },
  },
})
