/** รุ่น Claude ที่ให้เลือก พร้อมราคา input / output ต่อล้าน token (แยกไฟล์เพื่อไม่ต้องโหลด SDK ตอนเปิดแอป) */
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', price: '$4 / $20' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', price: '$2 / $10' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', price: '$0.10 / $0.50' },
]
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'
