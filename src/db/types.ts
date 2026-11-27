/** ฟิลด์ที่ทุกรายการต้องมี เพื่อใช้รวมข้อมูลตอน sync (รายการที่แก้ล่าสุดชนะ) */
export interface SyncFields {
  id: string
  createdAt: number
  updatedAt: number
  /** ลบแบบทำเครื่องหมาย เพื่อไม่ให้รายการโผล่กลับมาจากอุปกรณ์อื่น */
  deletedAt: number | null
}

export interface BookLink {
  title: string
  url: string
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
  /** คำโปรยบนปกหลัง */
  blurb: string
  /** สรุปรีวิวสั้น ๆ จากเว็บ (ไม่คัดลอกรีวิวเต็ม) */
  reviewSummary: string
  /** ลิงก์ต้นทางของข้อมูลที่ AI ค้นมา */
  links: BookLink[]
  note: string
  status: ReadingStatus
  currentPage: number | null
  /** ที่เก็บปัจจุบัน (ชั้นวาง / กอง / กล่อง) — null คือยังไม่ระบุที่เก็บ */
  placeId: string | null
  /** ลำดับในที่เก็บ: ชั้นวาง = ซ้ายไปขวา, กอง = ล่างขึ้นบน */
  position: number
  /** เวลาที่หยิบไปอ่าน — ไม่ใช่ null แปลว่าอยู่ในมือ (placeId จะเป็น null) */
  takenAt: number | null
  /** ที่เก็บที่หยิบมา ใช้เป็นค่าเริ่มต้นตอนวางคืน */
  takenFrom: string | null
  /** เวลาที่อ่านจบ ใช้ทำสถิติ */
  finishedAt: number | null
}

/** การหยิบไปอ่านหนึ่งครั้ง ตั้งแต่หยิบจนวางคืน */
export interface ReadingSession extends SyncFields {
  bookId: string
  fromPlaceId: string | null
  toPlaceId: string | null
  startedAt: number
  /** null = ยังอยู่ในมือ */
  endedAt: number | null
  startPage: number | null
  endPage: number | null
  /** เวลาอ่านจริง (นาที) ที่ผู้ใช้ยืนยันตอนวางคืน */
  minutes: number | null
  /** เวลาที่จับไว้แล้ว (มิลลิวินาที) ไม่รวมช่วงที่กำลังจับอยู่ */
  timerMs: number
  /** เวลาที่เริ่มจับรอบปัจจุบัน — null = ไม่ได้จับเวลาอยู่ */
  timerStartedAt: number | null
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

/** รูปปก เก็บแยกจากข้อมูลหนังสือเพื่อให้รายการหนังสือเบา — id คือ id ของหนังสือ */
export interface Cover {
  id: string
  blob: Blob
  updatedAt: number
}
