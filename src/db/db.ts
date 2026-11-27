import Dexie, { type Table } from 'dexie'
import type { Book, Bookcase, Category, Cover, Place, Quote, ReadingSession, Series, Wish } from './types'
import { categoriesFromText, flipShelfOrder } from './migrations'

export class GongDongDB extends Dexie {
  books!: Table<Book, string>
  bookcases!: Table<Bookcase, string>
  places!: Table<Place, string>
  covers!: Table<Cover, string>
  sessions!: Table<ReadingSession, string>
  categories!: Table<Category, string>
  wishes!: Table<Wish, string>
  series!: Table<Series, string>
  quotes!: Table<Quote, string>

  constructor(name = 'gong-dong') {
    super(name)
    this.version(1).stores({
      books: 'id, placeId, status, updatedAt',
      bookcases: 'id, updatedAt',
      places: 'id, kind, bookcaseId, updatedAt',
    })
    this.version(2).stores({ covers: 'id, updatedAt' })
    this.version(3).stores({ sessions: 'id, bookId, updatedAt' })
    // นับชั้นจากล่างขึ้นบน
    this.version(4)
      .stores({})
      .upgrade(async (tx) => {
        const places = tx.table<Place, string>('places')
        await places.bulkPut(flipShelfOrder(await places.toArray()))
      })
    // หมวดหนังสือเป็นตารางของตัวเอง
    this.version(5)
      .stores({ categories: 'id, name, updatedAt', books: 'id, placeId, status, categoryId, updatedAt' })
      .upgrade(async (tx) => {
        const books = tx.table('books')
        const rows = await books.toArray()
        const { categories, assign } = categoriesFromText(rows, () => crypto.randomUUID())
        await tx.table('categories').bulkAdd(categories)
        const now = Date.now()
        await books.toCollection().modify((b: Record<string, unknown>) => {
          const id = assign.get(b.id as string) ?? null
          if (id !== (b.categoryId ?? null)) b.updatedAt = now
          b.categoryId = id
          delete b.category
        })
      })
    // รูปปกมีฟิลด์ sync ครบ (ลบแบบทำเครื่องหมาย)
    this.version(6)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('covers')
          .toCollection()
          .modify((c: Record<string, unknown>) => {
            c.createdAt ??= c.updatedAt
            c.deletedAt ??= null
          })
      })
    // รายการอยากได้ ชุดหนังสือ และประโยคที่ชอบ
    this.version(7).stores({
      wishes: 'id, updatedAt',
      series: 'id, updatedAt',
      quotes: 'id, bookId, updatedAt',
      books: 'id, placeId, status, categoryId, seriesId, updatedAt',
    })
  }
}

export const db = new GongDongDB()
