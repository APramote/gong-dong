import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * นโยบายความปลอดภัยของเนื้อหา (ใส่เฉพาะตอน build เพราะ dev server ใช้สคริปต์แบบ inline)
 * อนุญาตให้ติดต่อเฉพาะ AI และแหล่งข้อมูลหนังสือที่แอปใช้
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' blob: data: https://generativelanguage.googleapis.com https://api.anthropic.com https://www.googleapis.com https://openlibrary.org",
  "worker-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const csp = {
  name: 'gong-dong-csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
}

export default defineConfig({
  // เส้นทางสัมพัทธ์ เพื่อให้โฮสต์ใต้โฟลเดอร์ย่อย (เช่น GitHub Pages) ได้
  base: './',
  plugins: [
    react(),
    csp,
    VitePWA({
      // ถามผู้ใช้ก่อนอัปเดต และไม่ลบไฟล์ของเวอร์ชันเดิมระหว่างที่หน้าเก่ายังเปิดอยู่
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'กองดอง',
        short_name: 'กองดอง',
        description: 'จัดการหนังสือสำหรับนักอ่านและนักสะสม',
        lang: 'th',
        display: 'standalone',
        start_url: '.',
        theme_color: '#f5f0e6',
        background_color: '#f5f0e6',
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
