import type { Book, Series } from '../db/types'

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
  const have = new Set(books.map((b) => b.seriesNo).filter((n): n is number => n !== null))
  const top = Math.max(0, ...have)
  const total = Math.max(series.total ?? 0, top, books.length)
  const missing: number[] = []
  // เลขเล่มที่ไม่ได้ใส่ ถือว่าครอบคลุมเลขที่ขาดไปตามจำนวน
  let unnumbered = books.filter((b) => b.seriesNo === null).length
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
