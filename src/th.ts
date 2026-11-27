import type { PlaceKind, ReadingStatus } from './db/types'

/** ข้อความทั้งหมดในแอป รวมไว้ที่เดียวเพื่อให้เพิ่มภาษาอื่นได้ภายหลัง */
export const t = {
  appName: 'กองดอง',
  nav: { library: 'คลังหนังสือ', places: 'ที่เก็บ' },

  common: {
    save: 'บันทึก',
    cancel: 'ยกเลิก',
    delete: 'ลบ',
    edit: 'แก้ไข',
    add: 'เพิ่ม',
    back: 'กลับ',
    books: (n: number) => `${n} เล่ม`,
  },

  status: {
    dong: 'ดอง',
    reading: 'กำลังอ่าน',
    done: 'อ่านจบ',
    dropped: 'เลิกอ่าน',
  } satisfies Record<ReadingStatus, string>,

  kind: {
    shelf: 'หนังสือชั้นวาง',
    pile: 'หนังสือวางกอง',
    box: 'หนังสือเก็บในกล่อง',
  } satisfies Record<PlaceKind, string>,

  library: {
    addBook: 'เพิ่มหนังสือ',
    search: 'ค้นหาชื่อเรื่อง ผู้แต่ง แท็ก ISBN',
    allStatus: 'ทุกสถานะ',
    allPlaces: 'ทุกที่เก็บ',
    noPlace: 'ยังไม่ระบุที่เก็บ',
    empty: 'ยังไม่มีหนังสือ กด "เพิ่มหนังสือ" เพื่อเริ่มต้น',
    noMatch: 'ไม่พบหนังสือที่ตรงกับเงื่อนไข',
    summary: (total: number, dong: number) => `ทั้งหมด ${total} เล่ม · ดองอยู่ ${dong} เล่ม`,
  },

  book: {
    newTitle: 'เพิ่มหนังสือ',
    editTitle: 'แก้ไขหนังสือ',
    notFound: 'ไม่พบหนังสือเล่มนี้',
    title: 'ชื่อเรื่อง',
    authors: 'ผู้แต่ง',
    publisher: 'สำนักพิมพ์',
    year: 'ปีที่พิมพ์',
    pages: 'จำนวนหน้า',
    isbn: 'ISBN',
    category: 'หมวด',
    tags: 'แท็ก (คั่นด้วยจุลภาค)',
    synopsis: 'เรื่องย่อ / คำโปรย',
    note: 'โน้ตส่วนตัว',
    status: 'สถานะการอ่าน',
    currentPage: 'อ่านถึงหน้า',
    place: 'ที่เก็บ',
    titleRequired: 'กรุณากรอกชื่อเรื่อง',
    confirmDelete: (title: string) => `ลบ "${title}" ออกจากคลัง?`,
  },

  places: {
    bookcases: 'ตู้หนังสือ',
    piles: 'วางกอง',
    boxes: 'กล่อง',
    addBookcase: 'เพิ่มตู้',
    addPile: 'เพิ่มกอง',
    addBox: 'เพิ่มกล่อง',
    addShelf: 'เพิ่มชั้น',
    bookcaseName: 'ชื่อตู้',
    room: 'ห้อง / ตำแหน่งตู้',
    shelfCount: 'จำนวนชั้น',
    shelfName: 'ชื่อชั้น',
    pileName: 'ชื่อกอง',
    pileLocation: 'ตำแหน่งในห้อง / บ้าน',
    boxName: 'ชื่อกล่อง',
    boxLabel: 'ป้ายหน้ากล่อง',
    boxLocation: 'ที่จัดเก็บกล่อง',
    nameRequired: 'กรุณากรอกชื่อ',
    emptyBookcases: 'ยังไม่มีตู้หนังสือ',
    emptyPiles: 'ยังไม่มีกอง',
    emptyBoxes: 'ยังไม่มีกล่อง',
    unplaced: 'ยังไม่ระบุที่เก็บ',
    confirmDeleteBookcase: (name: string) =>
      `ลบตู้ "${name}" และชั้นวางทั้งหมด? หนังสือจะไม่ถูกลบ แต่จะกลับไปเป็น "ยังไม่ระบุที่เก็บ"`,
    confirmDeletePlace: (name: string) =>
      `ลบ "${name}"? หนังสือจะไม่ถูกลบ แต่จะกลับไปเป็น "ยังไม่ระบุที่เก็บ"`,
  },

  place: {
    notFound: 'ไม่พบที่เก็บนี้',
    empty: 'ยังไม่มีหนังสือในที่เก็บนี้',
    orderShelf: 'เรียงจากซ้ายไปขวา',
    orderPile: 'เรียงจากล่างขึ้นบน',
    moveEarlier: 'เลื่อนขึ้น',
    moveLater: 'เลื่อนลง',
    addHere: 'เพิ่มหนังสือที่นี่',
  },
}
