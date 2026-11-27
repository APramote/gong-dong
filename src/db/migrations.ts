import type { Place } from './types'

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
