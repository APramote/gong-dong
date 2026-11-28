import type { Book } from '../db/types'

/** หมวดของที่เก็บ: หมวดที่มีมากที่สุดสองหมวด หมวดที่เหลือนับรวมเป็น "+N หมวด" (ไม่มีหมวดเลย = รายการว่าง) */
export function categoryLines(books: Pick<Book, 'categoryId'>[], nameOf: Map<string, string>): string[] {
  const count = new Map<string, number>()
  for (const b of books) {
    const name = b.categoryId ? nameOf.get(b.categoryId) : undefined
    if (name) count.set(name, (count.get(name) ?? 0) + 1)
  }
  const names = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th')).map(([name]) => name)
  return names.length > 2 ? [names[0], `${names[1]} +${names.length - 2}`] : names
}

/** หมวดเป็นข้อความบรรทัดเดียว (ใช้ในคำอธิบายใต้ภาพ) */
export const categoryLabel = (books: Pick<Book, 'categoryId'>[], nameOf: Map<string, string>) => categoryLines(books, nameOf).join(' · ')
