import type { Book, ReadingSession } from '../db/types'

export interface ReadingStats {
  inHand: number
  dong: number
  minutesWeek: number
  minutesMonth: number
  pagesMonth: number
  finishedMonth: number
  finishedYear: number
  addedMonth: number
}

/** วันที่แบบ yyyy-mm-dd ตามเวลาท้องถิ่น ใช้เป็นกุญแจรายวัน */
export const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** เที่ยงวันของวันที่ย้อนไป k วันตามปฏิทิน (ไม่ใช้ k×24 ชม. ซึ่งเพี้ยนในเขตเวลาที่มีเวลาออมแสง) */
export const daysAgo = (now: number, k: number) => {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - k, 12).getTime()
}

/** กุญแจของ 7 วันล่าสุดตามปฏิทิน รวมวันนี้ */
export const lastWeekKeys = (now: number) => new Set(Array.from({ length: 7 }, (_, k) => dayKey(daysAgo(now, k))))

const startOfMonth = (now: Date) => new Date(now.getFullYear(), now.getMonth(), 1).getTime()
const startOfYear = (now: Date) => new Date(now.getFullYear(), 0, 1).getTime()

/** สรุปสถิติการอ่าน — นับเฉพาะการหยิบที่วางคืนแล้ว */
export function readingStats(books: Book[], sessions: ReadingSession[], now = new Date()): ReadingStats {
  const week = lastWeekKeys(now.getTime())
  const month = startOfMonth(now)
  const year = startOfYear(now)
  const done = sessions.filter((s) => s.endedAt !== null)
  const sum = (rows: ReadingSession[], f: (s: ReadingSession) => number) =>
    rows.reduce((n, s) => n + f(s), 0)
  const inMonth = done.filter((s) => s.endedAt! >= month)
  return {
    inHand: books.filter((b) => b.takenAt).length,
    dong: books.filter((b) => b.status === 'dong').length,
    minutesWeek: sum(done.filter((s) => week.has(dayKey(s.endedAt!))), (s) => s.minutes ?? 0),
    minutesMonth: sum(inMonth, (s) => s.minutes ?? 0),
    // ไม่มีที่คั่นตอนหยิบ ถือว่าเริ่มจากหน้าแรก
    pagesMonth: sum(inMonth, (s) => (s.endPage !== null ? Math.max(0, s.endPage - (s.startPage ?? 0)) : 0)),
    finishedMonth: books.filter((b) => b.finishedAt && b.finishedAt >= month).length,
    finishedYear: books.filter((b) => b.finishedAt && b.finishedAt >= year).length,
    addedMonth: books.filter((b) => b.createdAt >= month).length,
  }
}

/** เวลาที่จับไว้ทั้งหมดรวมรอบที่กำลังจับ (มิลลิวินาที) */
export const timerTotal = (s: ReadingSession, now = Date.now()) =>
  s.timerMs + (s.timerStartedAt ? now - s.timerStartedAt : 0)

/**
 * เวลาอ่านเริ่มต้นตอนวางคืน (นาที)
 * ใช้เวลาที่จับไว้ถ้ามี ไม่อย่างนั้นใช้ช่วงหยิบถึงคืน แต่ถ้านานเกิน 6 ชม. คงไม่ได้อ่านทั้งหมด ให้กรอกเอง
 */
export function defaultMinutes(s: ReadingSession, now = Date.now()): number | null {
  const timer = timerTotal(s, now)
  if (timer > 0) return Math.max(1, Math.round(timer / 60000))
  const elapsed = now - s.startedAt
  return elapsed <= 6 * 60 * 60 * 1000 ? Math.max(1, Math.round(elapsed / 60000)) : null
}

/** ระยะเวลาแบบไทย เช่น "1 ชม. 20 นาที" */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h && m) return `${h} ชม. ${m} นาที`
  return h ? `${h} ชม.` : `${m} นาที`
}

/** เวลาที่ผ่านมาแบบไทย เช่น "3 ชม. ที่แล้ว" */
export function timeAgo(t: number, now = Date.now()): string {
  const min = Math.floor((now - t) / 60000)
  if (min < 1) return 'เมื่อสักครู่'
  if (min < 60) return `${min} นาทีที่แล้ว`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ชม. ที่แล้ว`
  return `${Math.floor(h / 24)} วันที่แล้ว`
}

/** นาฬิกาจับเวลา เช่น "1:05:09" หรือ "05:09" */
export function clock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
