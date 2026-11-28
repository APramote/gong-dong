import { repo } from '../db/repo'
import type { Bookcase, Place } from '../db/types'
import { rowsOf } from './capacity'
import { t } from '../th'

/** อ่านค่าความกว้างจากช่องกรอก: ตัวเลขบวกไม่เกิน 1,000 ซม. นอกนั้นถือว่าไม่ระบุ */
export const readWidth = (text: string): number | null => {
  const n = parseFloat(text.replace(',', '.'))
  return Number.isFinite(n) && n > 0 && n <= 1000 ? Math.round(n * 10) / 10 : null
}

/** ทุกชั้นของตู้วางซ้อนสองแถวอยู่หรือไม่ */
export const allTwoRows = (bookcaseId: string, places: Place[]) => {
  const shelves = places.filter((p) => p.kind === 'shelf' && p.bookcaseId === bookcaseId)
  return shelves.length > 0 && shelves.every((p) => rowsOf(p) === 2)
}

/** ค่าเริ่มต้นของฟอร์มแก้ไขตู้ */
export const bookcaseInitial = (bc: Bookcase, places: Place[]) => ({
  name: bc.name,
  room: bc.room,
  width: bc.shelfWidth ? String(bc.shelfWidth) : '',
  twoRows: allTwoRows(bc.id, places) ? '1' : '',
})

/** บันทึกฟอร์มแก้ไขตู้ (คืน false เมื่อผู้ใช้ยกเลิก): ชื่อ ห้อง ความกว้างชั้น และจำนวนแถว (เปลี่ยนจำนวนแถวเฉพาะเมื่อผู้ใช้เปลี่ยนช่องติ๊ก) */
export async function saveBookcase(bc: Bookcase, places: Place[], v: Record<string, string>): Promise<boolean> {
  const want = v.twoRows === '1'
  const change = want !== allTwoRows(bc.id, places)
  if (change && !want) {
    // กลับเป็นแถวเดียว: หนังสือแถวหลังจะมารวมกับแถวหน้า ถามก่อนถ้ามีเล่มอยู่แถวหลัง
    const shelves = new Set(places.filter((p) => p.kind === 'shelf' && p.bookcaseId === bc.id).map((p) => p.id))
    const behind = (await repo.listBooks()).some((b) => b.row === 1 && b.placeId !== null && shelves.has(b.placeId))
    if (behind && !confirm(t.shelf.confirmOneRow)) return false
  }
  await repo.updateBookcase(bc.id, { name: v.name, room: v.room })
  const width = readWidth(v.width ?? '')
  if (width !== (bc.shelfWidth ?? null)) await repo.setShelfWidth(bc.id, width)
  if (change) await repo.setBookcaseRows(bc.id, want ? 2 : 1)
  return true
}
