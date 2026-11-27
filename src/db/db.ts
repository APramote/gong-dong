import Dexie, { type Table } from 'dexie'
import type { Book, Bookcase, Cover, Place, ReadingSession } from './types'

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
  }
}

export const db = new GongDongDB()
