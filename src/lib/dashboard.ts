import type { Book, Category, ReadingSession } from '../db/types'
import { dayKey, daysAgo, formatMinutes, pagesOf } from './stats'

export { dayKey }

const DAY = 24 * 60 * 60 * 1000

const monthKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export interface Goals {
  dailyMinutes: number
  dailyPages: number
  yearBooks: number
}

export interface Dashboard {
  /** นาทีอ่านรายวัน ย้อนหลัง 30 วัน (เก่าสุดก่อน) */
  daily: { day: string; minutes: number; pages: number }[]
  todayMinutes: number
  todayPages: number
  weekMinutes: number
  weekPages: number
  streak: number
  bestStreak: number
  /** นาทีอ่านแยกตามชั่วโมงที่เริ่มอ่าน 0–23 */
  byHour: number[]
  /** นาทีอ่านแยกตามวันในสัปดาห์ 0 = อาทิตย์ */
  byWeekday: number[]
  sessions: number
  avgMinutes: number
  avgPages: number
  /** 12 เดือนล่าสุด: อ่านจบ และเพิ่มเข้าคลัง */
  monthly: { month: string; finished: number; added: number }[]
  status: { dong: number; reading: number; done: number; dropped: number }
  /** หมวดที่มีหนังสือมากที่สุด 8 อันดับ ที่เหลือรวมเป็น "อื่น ๆ" */
  categories: { name: string; count: number }[]
  finishedYear: number
  /** ส่วนของปีที่ผ่านไปแล้ว 0–1 ใช้เทียบความคืบหน้าเป้ารายปี */
  yearProgress: number
  oldestDong: Book | null
  shortestDong: Book | null
  /** ของสะสม: มูลค่ารวมจากราคาที่บันทึกไว้ */
  collection: { value: number; priced: number; signed: number }
}

/** นาทีของการอ่านหนึ่งครั้ง (ที่วางคืนแล้ว) */
const minutesOf = (s: ReadingSession) => s.minutes ?? 0

export function dashboard(
  books: Book[],
  sessions: ReadingSession[],
  now = Date.now(),
  categoryList: Category[] = [],
): Dashboard {
  const catName = new Map(categoryList.map((c) => [c.id, c.name]))
  const done = sessions.filter((s) => s.endedAt !== null && s.deletedAt === null)
  const perDay = new Map<string, number>()
  const perDayPages = new Map<string, number>()
  for (const s of done) {
    const key = dayKey(s.endedAt!)
    perDay.set(key, (perDay.get(key) ?? 0) + minutesOf(s))
    perDayPages.set(key, (perDayPages.get(key) ?? 0) + pagesOf(s))
  }

  const daily = Array.from({ length: 30 }, (_, i) => {
    const day = dayKey(daysAgo(now, 29 - i))
    return { day, minutes: perDay.get(day) ?? 0, pages: perDayPages.get(day) ?? 0 }
  })

  // วันที่ได้อ่าน = มีเวลาอ่านหรือมีหน้าที่อ่านเพิ่ม
  const readDay = (key: string) => (perDay.get(key) ?? 0) > 0 || (perDayPages.get(key) ?? 0) > 0
  // วันที่อ่านต่อเนื่อง: ถ้าวันนี้ยังไม่ได้อ่าน นับจากเมื่อวาน (ยังไม่ถือว่าขาด)
  const readOn = (t: number) => readDay(dayKey(t))
  let streak = 0
  for (let k = readOn(now) ? 0 : 1; readOn(daysAgo(now, k)); k++) streak++
  const days = [...new Set([...perDay.keys(), ...perDayPages.keys()])].filter(readDay).sort()
  let bestStreak = 0
  let run = 0
  let prev = ''
  for (const d of days) {
    const expected = prev ? dayKey(new Date(`${prev}T12:00:00`).getTime() + DAY) : ''
    run = d === expected ? run + 1 : 1
    bestStreak = Math.max(bestStreak, run)
    prev = d
  }

  const byHour = Array<number>(24).fill(0)
  const byWeekday = Array<number>(7).fill(0)
  for (const s of done) {
    const d = new Date(s.startedAt)
    byHour[d.getHours()] += minutesOf(s)
    byWeekday[d.getDay()] += minutesOf(s)
  }
  const timed = done.filter((s) => s.minutes)
  const paged = done.filter((s) => s.endPage !== null && s.kind !== 'carry')

  const thisMonth = new Date(now)
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - (11 - i), 1)
    const key = monthKey(d.getTime())
    return {
      month: key,
      finished: books.filter((b) => b.finishedAt && monthKey(b.finishedAt) === key).length,
      added: books.filter((b) => monthKey(b.createdAt) === key).length,
    }
  })

  const counts = new Map<string, number>()
  for (const b of books) {
    const name = (b.categoryId && catName.get(b.categoryId)) || 'ไม่มีหมวด'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const ranked = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  const categories = ranked.length > 8 ? [...ranked.slice(0, 7), { name: 'อื่น ๆ', count: ranked.slice(7).reduce((n, c) => n + c.count, 0) }] : ranked

  const yearStart = new Date(new Date(now).getFullYear(), 0, 1).getTime()
  const yearEnd = new Date(new Date(now).getFullYear() + 1, 0, 1).getTime()
  const dong = books.filter((b) => b.status === 'dong' && !b.takenAt)

  return {
    daily,
    todayMinutes: perDay.get(dayKey(now)) ?? 0,
    todayPages: perDayPages.get(dayKey(now)) ?? 0,
    weekMinutes: daily.slice(-7).reduce((n, d) => n + d.minutes, 0),
    weekPages: daily.slice(-7).reduce((n, d) => n + d.pages, 0),
    streak,
    bestStreak: Math.max(bestStreak, streak),
    byHour,
    byWeekday,
    sessions: done.filter((s) => s.kind !== 'carry').length,
    avgMinutes: timed.length ? Math.round(timed.reduce((n, s) => n + minutesOf(s), 0) / timed.length) : 0,
    avgPages: paged.length
      ? Math.round(paged.reduce((n, s) => n + pagesOf(s), 0) / paged.length)
      : 0,
    monthly,
    status: {
      dong: books.filter((b) => b.status === 'dong').length,
      reading: books.filter((b) => b.status === 'reading').length,
      done: books.filter((b) => b.status === 'done').length,
      dropped: books.filter((b) => b.status === 'dropped').length,
    },
    categories,
    finishedYear: books.filter((b) => b.finishedAt && b.finishedAt >= yearStart).length,
    yearProgress: (now - yearStart) / (yearEnd - yearStart),
    oldestDong: dong.length ? dong.reduce((a, b) => (b.createdAt < a.createdAt ? b : a)) : null,
    shortestDong: dong.filter((b) => b.pages).reduce<Book | null>((a, b) => (!a || b.pages! < a.pages! ? b : a), null),
    collection: {
      value: books.reduce((n, b) => n + (b.price ?? 0), 0),
      priced: books.filter((b) => b.price !== null && b.price !== undefined).length,
      signed: books.filter((b) => b.signed).length,
    },
  }
}

const hourRange = (h: number) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`
export const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
/** ตัวย่อวันแบบไทย (ตัดตัวอักษรตรง ๆ จะได้สระลอยไม่มีพยัญชนะ) */
export const WEEKDAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']

/** ข้อความให้กำลังใจจากสถิติจริง เรียงจากสำคัญที่สุด */
export function motivation(d: Dashboard, goals: Goals): string[] {
  const out: string[] = []
  const minutesDone = d.todayMinutes >= goals.dailyMinutes
  const pagesDone = d.todayPages >= goals.dailyPages
  if (minutesDone && pagesDone) out.push(`วันนี้ครบทั้งสองเป้า ${goals.dailyPages} หน้า และ ${formatMinutes(goals.dailyMinutes)} เยี่ยม`)
  else if (pagesDone) out.push(`วันนี้อ่านครบเป้า ${goals.dailyPages} หน้าแล้ว เยี่ยม`)
  else if (minutesDone) out.push(`วันนี้อ่านครบเป้า ${formatMinutes(goals.dailyMinutes)}แล้ว เยี่ยม`)
  else if (d.todayPages > 0)
    out.push(`วันนี้อ่านไปแล้ว ${d.todayPages} หน้า อีกแค่ ${goals.dailyPages - d.todayPages} หน้าถึงเป้า`)
  else if (d.todayMinutes > 0)
    out.push(`วันนี้อ่านไปแล้ว ${formatMinutes(d.todayMinutes)} อีกแค่ ${formatMinutes(goals.dailyMinutes - d.todayMinutes)} ถึงเป้า`)
  else out.push(`วันนี้ยังไม่ได้อ่าน อ่านแค่ ${goals.dailyPages} หน้า หรือ ${formatMinutes(goals.dailyMinutes)} ก็ถึงเป้า`)

  if (d.streak >= 2) out.push(`อ่านต่อเนื่อง ${d.streak} วันแล้ว${d.streak >= d.bestStreak ? ' สถิติใหม่ของคุณ' : ` ใกล้สถิติเดิม ${d.bestStreak} วันแล้ว`}`)
  else if (d.bestStreak >= 3) out.push(`เคยอ่านต่อเนื่องได้ ${d.bestStreak} วัน เริ่มนับใหม่วันนี้เลย`)

  const expected = goals.yearBooks * d.yearProgress
  if (goals.yearBooks > 0) {
    if (d.finishedYear >= goals.yearBooks) out.push(`ปีนี้อ่านจบ ${d.finishedYear} เล่ม ครบเป้า ${goals.yearBooks} เล่มแล้ว สุดยอด`)
    else if (d.finishedYear >= expected) out.push(`เป้าปีนี้นำอยู่ อ่านจบแล้ว ${d.finishedYear} จาก ${goals.yearBooks} เล่ม`)
    else out.push(`เป้าปีนี้ยังตามอยู่ ${Math.ceil(expected - d.finishedYear)} เล่ม หยิบเล่มบาง ๆ จากกองดองมาอ่านกัน`)
  }

  const month = d.monthly[d.monthly.length - 1]
  if (month.finished > month.added) out.push(`เดือนนี้กองดองลดลง ${month.finished - month.added} เล่ม ดีมาก`)
  else if (month.added > month.finished)
    out.push(`เดือนนี้ดองเพิ่ม ${month.added - month.finished} เล่ม กองดองโตขึ้นอีกนิด`)

  const top = d.byHour.indexOf(Math.max(...d.byHour))
  if (d.byHour[top] > 0) out.push(`คุณอ่านได้ดีที่สุดช่วง ${hourRange(top)}`)
  return out
}
