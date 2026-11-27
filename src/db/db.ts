import Dexie, { type Table } from 'dexie'
import type { Book, Bookcase, Cover, Place, ReadingSession } from './types'
import { flipShelfOrder } from './migrations'

export class GongDongDB extends Dexie {
  books!: Table<Book, string>
  bookcases!: Table<Bookcase, string>
  places!: Table<Place, string>
  covers!: Table<Cover, string>
  sessions!: Table<ReadingSession, string>

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
  }
}

export const db = new GongDongDB()
