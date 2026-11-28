import type { Book, Wish } from '../db/types'
import { normalizeIsbn } from './isbn'

const DAY = 24 * 60 * 60 * 1000

/** เทียบชื่อเรื่องแบบไม่สนตัวพิมพ์ ช่องว่าง และเครื่องหมายวรรคตอน */
export const titleKey = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

/** ISBN-10 กับ ISBN-13 ของเล่มเดียวกันให้ค่าเดียวกัน (ตัด 978 และหลักตรวจสอบ) */
export function isbnKey(raw: string): string {
  const s = normalizeIsbn(raw)
  if (!s) return ''
  if (s.length === 10) return s.slice(0, 9)
  return s.startsWith('978') ? s.slice(3, 12) : s
}

/**
 * ชื่อเดียวกันหรือไม่: ตรงกัน หรือชื่อหนึ่งคือชื่ออีกเล่มที่มีคำต่อท้ายสั้น ๆ เช่น "(ปกแข็ง)"
 * ส่วนที่เกินต้องไม่มีตัวเลข ("เล่ม 1" กับ "เล่ม 10" เป็นคนละเล่ม) และต้องสั้นกว่าชื่อหลักมาก
 */
export function sameKey(x: string, y: string): boolean {
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length < y.length ? [x, y] : [y, x]
  if (!long.startsWith(short) || short.length / long.length < 0.6) return false
  return !/[0-9๐-๙]/.test(long.slice(short.length))
}

/** ชื่อใกล้เคียง: มีคำค้นอยู่ในชื่อ หรือขึ้นต้นเหมือนกันเป็นส่วนใหญ่ (ใช้แสดงเป็น "เล่มชื่อคล้ายกัน" ไม่ใช่คำตัดสินว่ามีแล้ว) */
function nearKey(x: string, y: string): boolean {
  if (x.length < 3 || y.length < 3) return false
  if (x.includes(y) || y.includes(x)) return true
  // ขึ้นต้นเหมือนกันเกินครึ่ง เช่น เล่มอื่นในชุดเดียวกัน ("สี่แผ่นดิน เล่ม 1" กับ "สี่แผ่นดิน เล่ม 2")
  const min = Math.min(x.length, y.length)
  let same = 0
  while (same < min && x[same] === y[same]) same++
  return same >= Math.max(4, Math.ceil(min * 0.6))
}

export interface MatchQuery {
  title?: string
  isbn?: string
}

/**
 * เตรียมรายการไว้ค้นซ้ำหลายครั้ง: คำนวณกุญแจของแต่ละเล่มครั้งเดียว
 * (หน้าอยากได้เทียบทุกรายการกับทั้งคลัง คลังใหญ่จะช้าถ้าคำนวณใหม่ทุกคู่)
 */
export function matcher<T extends { isbn: string; title: string }>(rows: T[]) {
  const keyed = rows.map((row) => ({ row, isbn: isbnKey(row.isbn), title: titleKey(row.title) }))
  return (query: MatchQuery): T[] => {
    const isbn = query.isbn ? isbnKey(query.isbn) : ''
    const title = titleKey(query.title ?? '')
    if (!isbn && !title) return []
    return keyed.filter((k) => (isbn !== '' && k.isbn === isbn) || sameKey(k.title, title)).map((k) => k.row)
  }
}

/** เล่มที่ชื่อคล้ายคำค้น แต่ยังไม่ถือว่าเป็นเล่มเดียวกัน */
export function nearMatcher<T extends { isbn: string; title: string }>(rows: T[]) {
  const keyed = rows.map((row) => ({ row, title: titleKey(row.title) }))
  return (query: MatchQuery, exclude: T[] = []): T[] => {
    const title = titleKey(query.title ?? '')
    if (!title) return []
    const skip = new Set(exclude)
    return keyed.filter((k) => !skip.has(k.row) && nearKey(k.title, title)).map((k) => k.row)
  }
}

/** หาว่าเล่มนี้มีในคลังหรือในรายการอยากได้แล้วหรือยัง */
export function findMatches(query: MatchQuery, books: Book[], wishes: Wish[]) {
  return { owned: matcher(books)(query), wished: matcher(wishes)(query) }
}

export type PickFilter = 'any' | 'thin' | 'old'

/** เล่มบาง = ไม่เกิน 200 หน้า, ดองนาน = อยู่ในคลังเกิน 180 วัน */
export const THIN_PAGES = 200
export const OLD_DAYS = 180

/** เล่มดองที่สุ่มได้ (ไม่รวมเล่มที่อยู่ในมือ) */
export function dongPool(books: Book[], filter: PickFilter, categoryId = '', now = Date.now()): Book[] {
  return books
    // เล่มที่ให้มะเขือ 3 ลูกขึ้นไปไม่นำมาชวนอ่าน
    .filter((b) => b.status === 'dong' && !b.takenAt && (b.rating ?? 0) > -3)
    .filter((b) => !categoryId || b.categoryId === categoryId)
    .filter((b) =>
      filter === 'thin'
        ? b.pages !== null && b.pages <= THIN_PAGES
        : filter === 'old'
          ? now - b.createdAt > OLD_DAYS * DAY
          : true,
    )
}

/** สุ่มหนึ่งเล่ม หลีกเลี่ยงเล่มที่เพิ่งสุ่มได้ถ้ามีเล่มอื่นให้เลือก */
export function pickOne(pool: Book[], avoid: string | null = null, rand = Math.random): Book | null {
  const choices = pool.length > 1 ? pool.filter((b) => b.id !== avoid) : pool
  return choices.length ? choices[Math.floor(rand() * choices.length)] : null
}

/** ดองมานานเท่าไร เช่น "2 ปี 3 เดือน" */
export function dongFor(createdAt: number, now = Date.now()): string {
  const days = Math.max(0, Math.floor((now - createdAt) / DAY))
  if (days < 1) return 'เพิ่งเข้าคลังวันนี้'
  if (days < 30) return `ดองมา ${days} วัน`
  const months = Math.max(1, Math.floor(days / 30.44))
  if (months < 12) return `ดองมา ${months} เดือน`
  const y = Math.floor(months / 12)
  const m = months % 12
  return `ดองมา ${y} ปี${m ? ` ${m} เดือน` : ''}`
}
