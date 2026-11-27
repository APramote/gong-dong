import type { Book, Wish } from '../db/types'
import { normalizeIsbn } from './isbn'

const DAY = 24 * 60 * 60 * 1000

/** เทียบชื่อเรื่องแบบไม่สนตัวพิมพ์ ช่องว่าง และเครื่องหมายวรรคตอน */
export const titleKey = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

/** ISBN-10 กับ ISBN-13 ของเล่มเดียวกันให้ค่าเดียวกัน (ตัด 978 และหลักตรวจสอบ) */
function isbnKey(raw: string): string {
  const s = normalizeIsbn(raw)
  if (!s) return ''
  if (s.length === 10) return s.slice(0, 9)
  return s.startsWith('978') ? s.slice(3, 12) : s
}

function sameTitle(a: string, b: string): boolean {
  const x = titleKey(a)
  const y = titleKey(b)
  if (!x || !y) return false
  if (x === y) return true
  // ชื่อสั้นกว่าอยู่ในชื่อยาว เช่น "แฮร์รี่ พอตเตอร์ กับศิลาอาถรรพ์" กับ "แฮร์รี่ พอตเตอร์ กับศิลาอาถรรพ์ (ปกแข็ง)"
  const [short, long] = x.length < y.length ? [x, y] : [y, x]
  return short.length >= 4 && long.includes(short)
}

export interface MatchQuery {
  title?: string
  isbn?: string
}

/** หาว่าเล่มนี้มีในคลังหรือในรายการอยากได้แล้วหรือยัง */
export function findMatches(query: MatchQuery, books: Book[], wishes: Wish[]) {
  const isbn = query.isbn ? isbnKey(query.isbn) : ''
  const title = query.title?.trim() ?? ''
  const hit = (b: { isbn: string; title: string }) =>
    (isbn !== '' && isbnKey(b.isbn) === isbn) || (title !== '' && sameTitle(b.title, title))
  return { owned: books.filter(hit), wished: wishes.filter(hit) }
}

export type PickFilter = 'any' | 'thin' | 'old'

/** เล่มบาง = ไม่เกิน 200 หน้า, ดองนาน = อยู่ในคลังเกิน 180 วัน */
export const THIN_PAGES = 200
export const OLD_DAYS = 180

/** เล่มดองที่สุ่มได้ (ไม่รวมเล่มที่อยู่ในมือ) */
export function dongPool(books: Book[], filter: PickFilter, categoryId = '', now = Date.now()): Book[] {
  return books
    .filter((b) => b.status === 'dong' && !b.takenAt)
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
  const months = Math.floor(days / 30.44)
  if (months < 12) return `ดองมา ${months} เดือน`
  const y = Math.floor(months / 12)
  const m = months % 12
  return `ดองมา ${y} ปี${m ? ` ${m} เดือน` : ''}`
}
