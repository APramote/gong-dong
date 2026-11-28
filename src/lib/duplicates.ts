import type { Book } from '../db/types'
import { isbnKey, sameKey, titleKey } from './picks'

const KEY = 'gong-dong.notDup'

/** ลายเซ็นของกลุ่ม: id เรียงแล้วต่อกัน (ใช้จำว่ากลุ่มนี้ผู้ใช้บอกว่าไม่ซ้ำ) */
export const groupKey = (group: Pick<Book, 'id'>[]) => group.map((b) => b.id).sort().join('|')

/** กลุ่มที่ผู้ใช้บอกว่ามีหลายเล่มจริง (จำในเครื่องนี้) */
export function loadIgnored(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function ignoreGroup(group: Pick<Book, 'id'>[]): void {
  const next = loadIgnored()
  next.add(groupKey(group))
  try {
    localStorage.setItem(KEY, JSON.stringify([...next].slice(-500)))
  } catch {
    // เก็บไม่ได้ (พื้นที่เต็ม) กลุ่มนี้จะกลับมาแสดงอีก ไม่เสียข้อมูล
  }
}

const authorKey = (s: string) => titleKey(s)

/** สองเล่มนี้น่าจะเป็นเล่มเดียวกัน: ISBN ตรงกัน หรือชื่อเรื่องเดียวกันและผู้แต่งไม่ขัดกัน (เลขเล่มในชุดต้องไม่ต่างกัน) */
function same(a: Keyed, b: Keyed): boolean {
  if (a.book.seriesNo && b.book.seriesNo && a.book.seriesNo !== b.book.seriesNo) return false
  if (a.isbn && a.isbn === b.isbn) return true
  // ISBN ต่างกันชัดเจน = คนละฉบับพิมพ์ ไม่นับว่าซ้ำจากชื่ออย่างเดียว
  if (a.isbn && b.isbn) return false
  if (!sameKey(a.title, b.title)) return false
  return !a.author || !b.author || a.author === b.author
}

interface Keyed {
  book: Book
  isbn: string
  title: string
  author: string
}

/** จำนวนข้อมูลที่เล่มนี้มี ใช้เลือกเล่มที่ควรเก็บไว้ */
export function richness(b: Book): number {
  const filled = [b.authors, b.publisher, b.year, b.pages, b.isbn, b.categoryId, b.synopsis, b.blurb, b.reviewSummary, b.placeId, b.seriesId, b.note, b.rating]
  return (
    filled.filter(Boolean).length +
    (b.tags.length ? 1 : 0) +
    // เล่มที่เริ่มอ่านแล้วหรืออยู่ในมือมีประวัติ ควรเป็นเล่มที่เก็บ
    (b.status !== 'dong' ? 3 : 0) +
    (b.takenAt ? 5 : 0)
  )
}

/** เล่มที่ควรเก็บของกลุ่ม: ข้อมูลมากที่สุด เท่ากันเลือกเล่มที่เพิ่มก่อน */
export const bestOf = (group: Book[]): Book => [...group].sort((a, b) => richness(b) - richness(a) || a.createdAt - b.createdAt)[0]

/** กลุ่มหนังสือที่น่าจะซ้ำกัน (กลุ่มละ 2 เล่มขึ้นไป) ไม่รวมกลุ่มที่ผู้ใช้บอกว่าไม่ซ้ำ */
export function duplicateGroups(books: Book[], ignored: Set<string> = new Set()): Book[][] {
  const rows: Keyed[] = books.map((book) => ({ book, isbn: isbnKey(book.isbn), title: titleKey(book.title), author: authorKey(book.authors) }))
  const parent = rows.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  // จับคู่เฉพาะเล่มที่มีโอกาสซ้ำ: ISBN เดียวกัน หรือชื่อขึ้นต้นเหมือนกัน (ไม่ต้องเทียบทุกคู่ของทั้งคลัง)
  const buckets = new Map<string, number[]>()
  rows.forEach((r, i) => {
    for (const k of [r.isbn && `i:${r.isbn}`, r.title && `t:${r.title.slice(0, 4)}`]) {
      if (!k) continue
      const list = buckets.get(k)
      if (list) list.push(i)
      else buckets.set(k, [i])
    }
  })
  for (const list of buckets.values())
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) if (same(rows[list[x]], rows[list[y]])) parent[find(list[x])] = find(list[y])
  const groups = new Map<number, Book[]>()
  rows.forEach((r, i) => {
    const root = find(i)
    const list = groups.get(root)
    if (list) list.push(r.book)
    else groups.set(root, [r.book])
  })
  return [...groups.values()]
    .filter((g) => g.length > 1 && !ignored.has(groupKey(g)))
    .map((g) => g.sort((a, b) => a.createdAt - b.createdAt))
    .sort((a, b) => a[0].title.localeCompare(b[0].title, 'th'))
}
