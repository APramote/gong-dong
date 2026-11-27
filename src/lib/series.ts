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
