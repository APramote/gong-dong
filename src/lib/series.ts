import type { Book, Series } from '../db/types'

/** จำนวนเล่มสูงสุดต่อชุดที่รองรับ กันเลขผิดพลาด (เช่น วาง ISBN ลงช่องเล่มที่) ทำให้หน้าค้าง */
export const MAX_VOLUMES = 999

export interface SeriesSummary {
  series: Series
  books: Book[]
  /** เล่มที่ยังไม่มี (ตามเลขเล่ม 1 ถึงจำนวนทั้งชุด หรือถึงเลขสูงสุดที่มี) */
  missing: number[]
  /** จำนวนเล่มทั้งชุดที่ใช้คำนวณ */
  total: number
  /** อ่านจบกี่เล่มในชุด */
  done: number
}

/** สรุปชุดหนังสือ: เล่มที่มี เรียงตามเลขเล่ม และเล่มที่ขาด */
export function summarize(series: Series, all: Book[]): SeriesSummary {
  const books = all
    .filter((b) => b.seriesId === series.id)
    .sort((a, b) => (a.seriesNo ?? Infinity) - (b.seriesNo ?? Infinity) || a.title.localeCompare(b.title, 'th'))
  const have = new Set(
    books.map((b) => b.seriesNo).filter((n): n is number => n !== null && n >= 1 && n <= MAX_VOLUMES),
  )
  const top = Math.max(0, ...have)
  // เลขเล่มที่ไม่ได้ใส่ ถือว่าครอบคลุมเลขที่ขาดไปตามจำนวน
  let unnumbered = books.filter((b) => b.seriesNo === null).length
  // นับจำนวนเล่มที่ไม่ซ้ำ (มีเล่มเดียวกันสองฉบับไม่ทำให้ชุดยาวขึ้น)
  const total = Math.min(MAX_VOLUMES, Math.max(series.total ?? 0, top, have.size + unnumbered))
  const missing: number[] = []
  for (let n = 1; n <= total; n++) {
    if (have.has(n)) continue
    if (unnumbered > 0) unnumbered--
    else missing.push(n)
  }
  return { series, books, missing, total, done: books.filter((b) => b.status === 'done').length }
}

/** แสดงเลขเล่มที่ขาดแบบช่วง เช่น [2,3,4,7] → "2–4, 7" */
export function ranges(nums: number[]): string {
  const out: string[] = []
  for (let i = 0; i < nums.length; i++) {
    let j = i
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++
    out.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]))
    i = j
  }
  return out.join(', ')
}

const toAscii = (s: string) => s.replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))
const volume = (text: string | undefined) => {
  const n = text ? parseInt(text, 10) : NaN
  return Number.isFinite(n) && n >= 1 && n <= MAX_VOLUMES ? n : null
}

/**
 * เดาเลขเล่มจากชื่อเรื่องของหนังสือที่จะจัดเข้าชุดเดียวกัน (null = เดาไม่ได้ ให้ผู้ใช้ใส่เอง)
 * 1) ชื่อขึ้นต้นเหมือนกัน แล้วตามด้วยตัวเลข เช่น "ไซอิ๋ว 1", "ไซอิ๋ว 2" 2) มีคำว่า เล่ม/ภาค/vol/# นำหน้าตัวเลข
 * 3) ตัวเลขที่เติมศูนย์ เช่น 01 4) ตัวเลขท้ายชื่อ — เลขที่ซ้ำกันในกลุ่มถือว่าเดาผิด ไม่ใส่ให้
 */
export function guessVolumes(titles: string[]): (number | null)[] {
  const list = titles.map((x) => toAscii(x).trim())
  let prefix = ''
  if (list.length > 1) {
    prefix = list[0]
    for (const s of list) while (prefix && !s.startsWith(prefix)) prefix = prefix.slice(0, -1)
    // ตัดตัวเลขท้ายส่วนที่ซ้ำออก ("… 0" จาก 01/02 ไม่ใช่ส่วนของชื่อ)
    prefix = prefix.replace(/\d+$/, '')
  }
  const shared = prefix.trim().length >= 2
  const out = list.map((s) => {
    const afterPrefix = prefix.trim().length >= 2 ? volume(s.slice(prefix.length).match(/^\s*(\d{1,3})(?!\d)/)?.[1]) : null
    return (
      afterPrefix ??
      volume(s.match(/(?:เล่ม(?:ที่)?|ภาค(?:ที่)?|vol(?:ume)?\.?|#)\s*(\d{1,3})(?!\d)/i)?.[1]) ??
      // เลขเติมศูนย์และเลขท้ายชื่อ เชื่อได้เฉพาะเมื่อเล่มที่เลือกขึ้นต้นเหมือนกัน (ไม่อย่างนั้น "Catch-22" จะกลายเป็นเล่ม 22)
      (shared ? (volume(s.match(/(?<!\d)0(\d{1,2})(?!\d)/)?.[1]) ?? volume(s.match(/(?<!\d)(\d{1,3})\s*$/)?.[1])) : null)
    )
  })
  const seen = new Map<number, number>()
  for (const n of out) if (n !== null) seen.set(n, (seen.get(n) ?? 0) + 1)
  return out.map((n) => (n !== null && seen.get(n) === 1 ? n : null))
}
