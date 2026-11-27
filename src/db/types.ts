/** ฟิลด์ที่ทุกรายการต้องมี เพื่อใช้รวมข้อมูลตอน sync (รายการที่แก้ล่าสุดชนะ) */
export interface SyncFields {
  id: string
  createdAt: number
  updatedAt: number
  /** ลบแบบทำเครื่องหมาย เพื่อไม่ให้รายการโผล่กลับมาจากอุปกรณ์อื่น */
  deletedAt: number | null
}

export type ReadingStatus = 'dong' | 'reading' | 'done' | 'dropped'

export interface Book extends SyncFields {
  title: string
  authors: string
  publisher: string
  year: string
  pages: number | null
  isbn: string
  category: string
  tags: string[]
  synopsis: string
  note: string
  status: ReadingStatus
  currentPage: number | null
  /** ที่เก็บปัจจุบัน (ชั้นวาง / กอง / กล่อง) — null คือยังไม่ระบุที่เก็บ */
  placeId: string | null
  /** ลำดับในที่เก็บ: ชั้นวาง = ซ้ายไปขวา, กอง = ล่างขึ้นบน */
  position: number
}

/** ตู้หนังสือ — หนึ่งตู้มีหลายชั้นวาง */
export interface Bookcase extends SyncFields {
  name: string
  room: string
}

export type PlaceKind = 'shelf' | 'pile' | 'box'

/**
 * ที่เก็บหนังสือหนึ่งจุด
 * - shelf: ชั้นวางในตู้ (ใช้ bookcaseId, order)
 * - pile:  วางกอง (ใช้ location = ตำแหน่งในห้อง/บ้าน)
 * - box:   กล่อง (ใช้ label = ป้ายหน้ากล่อง, location = ที่จัดเก็บกล่อง)
 */
export interface Place extends SyncFields {
  kind: PlaceKind
  name: string
  bookcaseId: string | null
  order: number
  location: string
  label: string
}
