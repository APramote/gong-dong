import type { Category, Place } from './types'

const DEFAULT_NAME = /^ชั้นที่ \d+$/

/**
 * เวอร์ชันก่อนนับชั้นจากบนลงล่าง (order 0 = บนสุด) เปลี่ยนเป็นนับจากล่างขึ้นบน
 * คงตำแหน่งจริงของชั้นไว้: กลับลำดับ order และเปลี่ยนชื่อ "ชั้นที่ N" ให้ตรงเลขใหม่
 * ชั้นที่ผู้ใช้ตั้งชื่อเองไม่ถูกเปลี่ยนชื่อ คืนเฉพาะรายการที่เปลี่ยน
 */
export function flipShelfOrder(places: Place[], now = Date.now()): Place[] {
  const byCase = new Map<string, Place[]>()
  for (const p of places) {
    if (p.kind !== 'shelf' || !p.bookcaseId || p.deletedAt !== null) continue
    byCase.set(p.bookcaseId, [...(byCase.get(p.bookcaseId) ?? []), p])
  }
  const changed: Place[] = []
  for (const shelves of byCase.values()) {
    shelves.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    shelves.forEach((s, i) => {
      const order = shelves.length - 1 - i
      const name = DEFAULT_NAME.test(s.name) ? `ชั้นที่ ${order + 1}` : s.name
      if (order !== s.order || name !== s.name) changed.push({ ...s, order, name, updatedAt: now })
    })
  }
  return changed
}

/**
 * หมวดเดิมเป็นข้อความในแต่ละเล่ม ย้ายเข้าตารางหมวด
 * ชื่อที่ต่างกันแค่ตัวพิมพ์เล็ก/ใหญ่หรือช่องว่างรวมเป็นหมวดเดียว (ใช้ชื่อที่พบก่อน)
 * คืนหมวดที่ต้องสร้าง และ categoryId ของแต่ละเล่ม
 */
export function categoriesFromText(
  books: { id: string; category?: unknown }[],
  newId: () => string,
  now = Date.now(),
): { categories: Category[]; assign: Map<string, string | null> } {
  const byKey = new Map<string, Category>()
  const assign = new Map<string, string | null>()
  for (const b of books) {
    const name = typeof b.category === 'string' ? b.category.trim().replace(/\s+/g, ' ') : ''
    if (!name) {
      assign.set(b.id, null)
      continue
    }
    const key = name.toLowerCase()
    let cat = byKey.get(key)
    if (!cat) {
      cat = { id: newId(), name, createdAt: now, updatedAt: now, deletedAt: null }
      byKey.set(key, cat)
    }
    assign.set(b.id, cat.id)
  }
  return { categories: [...byKey.values()], assign }
}
