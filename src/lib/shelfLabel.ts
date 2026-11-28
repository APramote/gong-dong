import type { Book } from '../db/types'

/** ป้ายหมวดของที่เก็บ: หมวดที่มีมากที่สุดสองหมวด หมวดที่เหลือนับรวมเป็น +N (ไม่มีหมวดเลย = ข้อความว่าง) */
export function categoryLabel(books: Pick<Book, 'categoryId'>[], nameOf: Map<string, string>): string {
  const count = new Map<string, number>()
  for (const b of books) {
    const name = b.categoryId ? nameOf.get(b.categoryId) : undefined
    if (name) count.set(name, (count.get(name) ?? 0) + 1)
  }
  const names = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th')).map(([name]) => name)
  return names.slice(0, 2).join(' · ') + (names.length > 2 ? ` +${names.length - 2}` : '')
}
