import type { Book, Category, Quote, ReadingSession } from '../db/types'
import { dayKey } from './stats'

const DAY = 86400000

export interface YearReview {
  year: number
  finished: Book[]
  minutes: number
  pages: number
  sessions: number
  /** วันที่ได้อ่าน */
  daysRead: number
  bestStreak: number
  added: number
  topCategory: { name: string; count: number } | null
  /** เล่มที่ใช้เวลาอ่านมากที่สุดในปี */
  mostTime: { book: Book; minutes: number } | null
  longest: Book | null
  /** ชั่วโมงที่อ่านมากที่สุด 0–23 หรือ null */
  bestHour: number | null
  /** เดือนที่อ่านมากที่สุด 0–11 หรือ null */
  bestMonth: number | null
  quote: { quote: Quote; book: Book } | null
}

/** สรุปการอ่านของหนึ่งปีปฏิทิน */
export function yearReview(
  year: number,
  books: Book[],
  sessions: ReadingSession[],
  quotes: Quote[] = [],
  categories: Category[] = [],
): YearReview {
  const start = new Date(year, 0, 1).getTime()
  const end = new Date(year + 1, 0, 1).getTime()
  const inYear = (t: number | null) => t !== null && t >= start && t < end
  const byId = new Map(books.map((b) => [b.id, b]))
  const done = sessions.filter((s) => s.deletedAt === null && inYear(s.endedAt))

  const finished = books.filter((b) => inYear(b.finishedAt)).sort((a, b) => a.finishedAt! - b.finishedAt!)
  const minutes = done.reduce((n, s) => n + (s.minutes ?? 0), 0)
  const pages = done.reduce((n, s) => n + (s.endPage !== null ? Math.max(0, s.endPage - (s.startPage ?? 0)) : 0), 0)

  const perDay = new Set(done.filter((s) => (s.minutes ?? 0) > 0 || s.endPage !== null).map((s) => dayKey(s.endedAt!)))
  let bestStreak = 0
  let run = 0
  for (let t = start + DAY / 2; t < end; t += DAY) {
    run = perDay.has(dayKey(t)) ? run + 1 : 0
    bestStreak = Math.max(bestStreak, run)
  }

  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const counts = new Map<string, number>()
  for (const b of finished) {
    const name = b.categoryId ? catName.get(b.categoryId) : undefined
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const topCat = [...counts].sort((a, b) => b[1] - a[1])[0]

  const perBook = new Map<string, number>()
  for (const s of done) perBook.set(s.bookId, (perBook.get(s.bookId) ?? 0) + (s.minutes ?? 0))
  const top = [...perBook].filter(([id, m]) => m > 0 && byId.has(id)).sort((a, b) => b[1] - a[1])[0]

  const hours = Array<number>(24).fill(0)
  const months = Array<number>(12).fill(0)
  for (const s of done) {
    hours[new Date(s.startedAt).getHours()] += s.minutes ?? 0
    months[new Date(s.endedAt!).getMonth()] += s.minutes ?? 0
  }
  const peak = (arr: number[]) => (Math.max(...arr) > 0 ? arr.indexOf(Math.max(...arr)) : null)

  // ประโยคที่เก็บในปีนี้ เลือกอันที่ยาวพอดีอ่าน (ไม่สั้นหรือยาวเกิน) เพื่อให้วางบนการ์ดสวย
  const yearQuotes = quotes
    .filter((q) => q.deletedAt === null && inYear(q.createdAt) && byId.has(q.bookId))
    .sort((a, b) => Math.abs(a.text.length - 90) - Math.abs(b.text.length - 90))
  const q = yearQuotes[0]

  return {
    year,
    finished,
    minutes,
    pages,
    sessions: done.length,
    daysRead: perDay.size,
    bestStreak,
    added: books.filter((b) => inYear(b.createdAt)).length,
    topCategory: topCat ? { name: topCat[0], count: topCat[1] } : null,
    mostTime: top ? { book: byId.get(top[0])!, minutes: top[1] } : null,
    longest: finished.filter((b) => b.pages).sort((a, b) => b.pages! - a.pages!)[0] ?? null,
    bestHour: peak(hours),
    bestMonth: peak(months),
    quote: q ? { quote: q, book: byId.get(q.bookId)! } : null,
  }
}
