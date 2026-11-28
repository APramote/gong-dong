/**
 * ปกจำลองสำหรับเล่มที่ยังไม่มีรูปปก: ชื่อเรื่องและผู้แต่งบนสีที่ AI เลือกให้เข้ากับหนังสือ
 * วาดในเครื่อง (ไม่ได้ให้ AI สร้างรูป) และมีแถบ "ปกจำลอง · AI" กำกับในรูปเสมอ จะได้ไม่สับสนกับปกจริง
 */
const PALETTE = ['#8c3b2e', '#2f5d62', '#4a4e8c', '#6b8e4e', '#a0522d', '#3d3d3d', '#5b7fa6', '#7a5c99']

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** สีพื้นของปกจำลอง: สีที่ AI ให้มาถ้าถูกรูปแบบ ไม่อย่างนั้นเลือกจากชื่อเรื่อง (คงที่ต่อเล่ม) */
export const coverColor = (title: string, color?: string) => (color && /^#[0-9a-f]{6}$/i.test(color) ? color : PALETTE[hash(title) % PALETTE.length])

/** ตัดข้อความเป็นบรรทัดตามคำ (ภาษาไทยใช้ตัวตัดคำของเบราว์เซอร์) ไม่เกิน max บรรทัด */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  let words: string[]
  try {
    words = [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((x) => x.segment)
  } catch {
    words = text.match(/.[ัิ-ฺ็-๎]*/gsu) ?? [text]
  }
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur && ctx.measureText(cur + w).width > width) {
      lines.push(cur.trim())
      cur = w.trimStart()
    } else cur += w
  }
  if (cur.trim()) lines.push(cur.trim())
  if (lines.length > max) {
    lines.length = max
    lines[max - 1] = lines[max - 1].replace(/.[ัิ-ฺ็-๎]*$/su, '') + '…'
  }
  return lines
}

export async function makeCover(title: string, authors: string, color?: string): Promise<Blob> {
  const W = 400
  const H = 600
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const bg = coverColor(title, color)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  // ไล่เฉดให้มีมิติ และแถบสันด้านซ้าย
  const shade = ctx.createLinearGradient(0, 0, W, H)
  shade.addColorStop(0, 'rgba(255,255,255,0.14)')
  shade.addColorStop(1, 'rgba(0,0,0,0.28)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(0, 0, 14, H)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 2
  ctx.strokeRect(34, 30, W - 58, H - 110)
  ctx.fillStyle = '#fdf8ee'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let size = 62
  let lines: string[] = []
  // ชื่อยาวลดขนาดตัวอักษรจนพอดี 5 บรรทัด
  for (; size >= 26; size -= 6) {
    ctx.font = `700 ${size}px "Noto Serif Thai", "Noto Sans Thai", system-ui, serif`
    lines = wrap(ctx, title.trim() || '—', W - 110, 5)
    if (lines.length <= 5 && !lines[lines.length - 1].endsWith('…')) break
  }
  const lh = size * 1.45
  const top = 250 - ((lines.length - 1) * lh) / 2
  lines.forEach((l, i) => ctx.fillText(l, W / 2 + 6, top + i * lh))
  if (authors.trim()) {
    ctx.font = '500 22px "Noto Sans Thai", system-ui, sans-serif'
    ctx.fillStyle = 'rgba(253,248,238,0.9)'
    wrap(ctx, authors.trim(), W - 110, 2).forEach((l, i) => ctx.fillText(l, W / 2 + 6, 450 + i * 30))
  }
  // แถบกำกับ: ปกนี้ไม่ใช่ปกจริง
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, H - 54, W, 54)
  ctx.fillStyle = '#fdf8ee'
  ctx.font = '600 22px "Noto Sans Thai", system-ui, sans-serif'
  ctx.fillText('ปกจำลอง · AI', W / 2, H - 26)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('cover'))), 'image/jpeg', 0.85))
}
