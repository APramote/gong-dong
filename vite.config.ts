import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // เส้นทางสัมพัทธ์ เพื่อให้โฮสต์ใต้โฟลเดอร์ย่อย (เช่น GitHub Pages) ได้
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'กองดอง',
        short_name: 'กองดอง',
        description: 'จัดการหนังสือสำหรับนักอ่านและนักสะสม',
        lang: 'th',
        display: 'standalone',
        start_url: '.',
        theme_color: '#7a4b2a',
        background_color: '#f6f1e7',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: { environment: 'node' },
})
