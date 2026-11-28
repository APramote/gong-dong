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

export type AiField = 'blurb' | 'tags' | 'cover'

export interface Book extends SyncFields {
  title: string
  authors: string
  publisher: string
  year: string
  pages: number | null
  isbn: string
  /** หมวดหนังสือ (ตาราง categories) — null คือยังไม่มีหมวด */
  categoryId: string | null
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
  /** ช่องที่ AI สร้างขึ้นเอง ไม่ใช่ข้อมูลที่ค้นเจอ ('blurb' คำโปรย · 'tags' แท็ก · 'cover' ปกจำลอง) ใช้กำกับป้าย AI — ผู้ใช้แก้ช่องนั้นเองแล้วป้ายหายไป */
  aiFields?: AiField[]
  /** คะแนนความชอบ: 1 ถึง 5 = ดาว (ชอบ) · -1 ถึง -5 = มะเขือ (ไม่ชอบ) · ไม่มีหรือ 0 = ยังไม่ให้คะแนน */
  rating?: number
  /** แถวบนชั้นที่วางซ้อนสองแถว: 0 = แถวหน้า (ค่าเริ่มต้น) 1 = แถวหลัง */
  row?: 0 | 1
  /** สีสัน (#rrggbb) จากรูป ใช้วาด 3D — ว่างคือให้แอปเลือกสีเอง */
  spineColor: string
  /** ชุดหนังสือ (ตาราง series) และเล่มที่ในชุด */
  seriesId: string | null
  seriesNo: number | null
  /** ข้อมูลนักสะสม */
  edition: string
  condition: string
  price: number | null
  /** วันที่ซื้อ YYYY-MM-DD */
  boughtAt: string
  boughtFrom: string
  signed: boolean
}

/** หนังสือที่อยากได้ (ยังไม่มีในคลัง) */
export interface Wish extends SyncFields {
  title: string
  authors: string
  isbn: string
  note: string
}

/** ชุดหนังสือ เช่น นิยายหลายเล่มจบ — total = จำนวนเล่มทั้งชุด (null คือยังไม่ทราบ) */
export interface Series extends SyncFields {
  name: string
  total: number | null
}

/** ประโยคที่ชอบจากหนังสือ */
export interface Quote extends SyncFields {
  bookId: string
  text: string
  page: number | null
  note: string
}

/** หน้าตาของที่เก็บสำหรับวาด 3D ได้จากรูปที่ถ่าย */
export interface Look {
  /** สีหลัก #rrggbb */
  color: string
  /** สัดส่วนกว้าง/สูงของตู้หรือกล่อง (0 = ไม่ทราบ) */
  ratio: number
  /** ตู้: จำนวนแถวลิ้นชักใต้ชั้นวาง */
  drawerRows?: number
  /** ตู้: จำนวนลิ้นชักต่อแถว */
  drawersPerRow?: number
  /** ตู้: จำนวนบานกระจกปิดหน้าชั้น (0, 1, 2) */
  doors?: number
  /** ตู้: มีขาตู้ */
  legs?: boolean
}

/**
 * บันทึกการอ่าน มีสองแบบ
 * - carry: การหยิบติดตัว ตั้งแต่หยิบจนวางคืน (อาจหลายวัน) ไม่นับเป็นเวลาอ่าน
 * - read:  การคั่นหน้าหนึ่งครั้ง = อ่านจากหน้า startPage ถึง endPage ใช้ทำสถิติ
 * รายการเก่าที่ไม่มี kind คือแบบเดิม (หยิบ-อ่าน-วางคืนในรายการเดียว)
 */
export interface ReadingSession extends SyncFields {
  kind?: 'carry' | 'read'
  /** minutes เป็นค่าประมาณจากจำนวนหน้า (ผู้ใช้ไม่ได้ใส่เวลาเอง) */
  estimated?: boolean
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

/** หมวดหนังสือ เปลี่ยนชื่อครั้งเดียวมีผลกับทุกเล่มในหมวด */
export interface Category extends SyncFields {
  name: string
}

/** ตู้หนังสือ — หนึ่งตู้มีหลายชั้นวาง */
export interface Bookcase extends SyncFields {
  name: string
  room: string
  look?: Look
  /** ความกว้างด้านในของชั้น (ซม.) ใช้กับทุกชั้นในตู้ — ไม่ใส่ = ยังไม่รู้ */
  shelfWidth?: number | null
  /** ผู้ใช้ยืนยันว่าหนังสือวางพอจริง แม้แอปคำนวณว่าล้น (ความหนาที่ประมาณจากจำนวนหน้าคลาดได้) — ภาพย่อความหนาให้พอดีชั้น และไม่เตือนว่าล้น */
  fitsAll?: boolean
}

export type PlaceKind = 'shelf' | 'drawer' | 'pile' | 'box'

/**
 * ที่เก็บหนังสือหนึ่งจุด
 * - shelf: ชั้นวางในตู้ (ใช้ bookcaseId, order — order 0 คือชั้นล่างสุด)
 * - drawer: ลิ้นชักในตู้ (ใช้ bookcaseId, order — นับจากแถวล่างสุด ซ้ายไปขวา)
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
  look?: Look
  /** ชั้นวาง: ความกว้างเฉพาะชั้นนี้ (ซม.) ถ้าต่างจากค่าของตู้ */
  width?: number | null
  /** ชั้นวาง: 2 = วางซ้อนสองแถว (แถวหน้าและแถวหลัง) */
  rows?: 1 | 2
}

/** รูปปก เก็บแยกจากข้อมูลหนังสือเพื่อให้รายการหนังสือเบา — id คือ id ของหนังสือ */
export interface Cover extends SyncFields {
  /** null เมื่อถูกลบ (เก็บเป็นเครื่องหมายลบไว้ไม่ให้รูปเก่ากลับมาตอน sync) */
  blob: Blob | null
  /** รูปย่อสำหรับรายการ สร้างจาก blob ในเครื่อง (ไม่ sync) */
  thumb?: Blob | null
}
