import type { BookInput } from '../db/repo'

export type IsbnResult = Partial<
  Pick<BookInput, 'title' | 'authors' | 'publisher' | 'year' | 'pages' | 'isbn' | 'synopsis'>
> & {
  /** ชื่อหมวดจากแหล่งข้อมูล ใช้เป็นคำแนะนำ ไม่สร้างหมวดให้เอง */
  category?: string
}

/** คืน ISBN-10/13 ที่ตัดขีดและช่องว่างแล้ว หรือ null ถ้ารูปแบบไม่ถูก */
export function normalizeIsbn(raw: string): string | null {
  const s = raw.replace(/[^0-9Xx]/g, '').toUpperCase()
  return /^(\d{13}|\d{9}[\dX])$/.test(s) ? s : null
}

const year = (s: unknown) => (typeof s === 'string' ? (/\d{4}/.exec(s)?.[0] ?? '') : '')

async function googleBooks(isbn: string): Promise<IsbnResult | null> {
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`)
  if (!res.ok) return null
  const v = (await res.json()).items?.[0]?.volumeInfo
  if (!v?.title) return null
  return {
    isbn,
    title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
    authors: (v.authors ?? []).join(', '),
    publisher: v.publisher ?? '',
    year: year(v.publishedDate),
    pages: typeof v.pageCount === 'number' && v.pageCount > 0 ? v.pageCount : null,
    synopsis: v.description ?? '',
    category: v.categories?.[0] ?? '',
  }
}

async function openLibrary(isbn: string): Promise<IsbnResult | null> {
  const res = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
  )
  if (!res.ok) return null
  const v = (await res.json())[`ISBN:${isbn}`]
  if (!v?.title) return null
  return {
    isbn,
    title: v.title,
    authors: (v.authors ?? []).map((a: { name: string }) => a.name).join(', '),
    publisher: v.publishers?.[0]?.name ?? '',
    year: year(v.publish_date),
    pages: typeof v.number_of_pages === 'number' ? v.number_of_pages : null,
  }
}

/** ค้นข้อมูลหนังสือจาก ISBN: Google Books ก่อน แล้ว Open Library — null คือไม่พบทั้งสองที่ */
export async function lookupIsbn(isbn: string): Promise<IsbnResult | null> {
  for (const source of [googleBooks, openLibrary]) {
    try {
      const hit = await source(isbn)
      if (hit) return hit
    } catch {
      // แหล่งนี้ล่ม ลองแหล่งถัดไป
    }
  }
  return null
}
