import type { Book, Bookcase, Place } from '../db/types'

/**
 * ที่ว่างบนชั้น คิดจากความกว้างของชั้น (ซม.) กับความหนาของหนังสือที่ประมาณจากจำนวนหน้า
 * ใช้ร่วมกันทั้งหน้าที่เก็บ แผนจัดระเบียบ และภาพ 3D ให้ตัวเลขตรงกันทุกที่
 */

/** ช่องว่างเล็กน้อยระหว่างเล่ม (ซม.) */
export const GAP = 0.15
/** จำนวนหน้าที่ใช้เมื่อหนังสือไม่ได้ใส่จำนวนหน้า */
const DEFAULT_PAGES = 250

/** ความหนาของหนังสือ (ซม.) ประมาณจากจำนวนหน้า: กระดาษ + ปก จำกัดไว้ที่ 1–7 ซม. */
export const thickness = (b: Pick<Book, 'pages'>) => Math.min(7, Math.max(1, (b.pages ?? DEFAULT_PAGES) * 0.0065 + 0.6))

/** พื้นที่ที่หนังสือหนึ่งเล่มใช้บนชั้น (ความหนา + ช่องว่าง) */
export const footprint = (b: Pick<Book, 'pages'>) => thickness(b) + GAP

const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** ความกว้างของชั้น (ซม.): ค่าที่ตั้งเฉพาะชั้น ถ้าไม่มีใช้ค่าของตู้ — null คือยังไม่ได้ใส่ */
export function shelfWidth(place: Pick<Place, 'kind' | 'width'>, bookcase?: Pick<Bookcase, 'shelfWidth'> | null): number | null {
  if (place.kind !== 'shelf') return null
  return valid(place.width) ? place.width : valid(bookcase?.shelfWidth) ? bookcase.shelfWidth : null
}

/** จำนวนแถวบนชั้น: 2 = วางซ้อนสองแถว (แถวหน้าและแถวหลัง) */
export const rowsOf = (place: Pick<Place, 'kind' | 'rows'>): 1 | 2 => (place.kind === 'shelf' && place.rows === 2 ? 2 : 1)

/** แถวของหนังสือ: 0 = แถวหน้า 1 = แถวหลัง */
export const rowOf = (b: Pick<Book, 'row'>): 0 | 1 => (b.row === 1 ? 1 : 0)

export interface Usage {
  /** ความกว้างของชั้น — null คือไม่รู้ จึงบอกไม่ได้ว่าเต็มหรือยัง */
  width: number | null
  /** พื้นที่ที่ใช้ไปของแต่ละแถว (ซม.) แถวหน้าก่อน */
  used: number[]
  /** พื้นที่ทั้งหมดของชั้น (ความกว้าง × จำนวนแถว) */
  capacity: number | null
  /** มีแถวที่หนังสือเกินความกว้าง */
  over: boolean
}

/** สรุปการใช้พื้นที่ของชั้นหนึ่งชั้น จากหนังสือที่อยู่บนชั้นนั้น */
export function usage(place: Pick<Place, 'kind' | 'width' | 'rows'>, bookcase: Pick<Bookcase, 'shelfWidth'> | null | undefined, books: Pick<Book, 'pages' | 'row'>[]): Usage {
  const width = shelfWidth(place, bookcase)
  const rows = rowsOf(place)
  const used = Array<number>(rows).fill(0)
  // ชั้นแถวเดียว: หนังสือที่เคยอยู่แถวหลังนับรวมเป็นแถวเดียว
  for (const b of books) used[rows === 2 ? rowOf(b) : 0] += footprint(b)
  return { width, used, capacity: width === null ? null : width * rows, over: width !== null && used.some((u) => u > width) }
}
