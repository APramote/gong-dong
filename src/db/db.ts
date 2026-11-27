import Dexie, { type Table } from 'dexie'
import type { Book, Bookcase, Place } from './types'

export class GongDongDB extends Dexie {
  books!: Table<Book, string>
  bookcases!: Table<Bookcase, string>
  places!: Table<Place, string>

  constructor(name = 'gong-dong') {
    super(name)
    this.version(1).stores({
      books: 'id, placeId, status, updatedAt',
      bookcases: 'id, updatedAt',
      places: 'id, kind, bookcaseId, updatedAt',
    })
  }
}

export const db = new GongDongDB()
