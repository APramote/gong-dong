import { db as defaultDb, type GongDongDB } from './db'
import type { Book, Bookcase, Place, PlaceKind, SyncFields } from './types'

const newId = () => crypto.randomUUID()

function stamp(): SyncFields {
  const now = Date.now()
  return { id: newId(), createdAt: now, updatedAt: now, deletedAt: null }
}

const alive = <T extends SyncFields>(rows: T[]) => rows.filter((r) => r.deletedAt === null)

export type BookInput = Omit<Book, keyof SyncFields | 'position'>
export type BookcaseInput = Pick<Bookcase, 'name' | 'room'>
export type PlaceInput = Pick<Place, 'name' | 'location' | 'label'>

export const emptyBook: BookInput = {
  title: '',
  authors: '',
  publisher: '',
  year: '',
  pages: null,
  isbn: '',
  category: '',
  tags: [],
  synopsis: '',
  note: '',
  status: 'dong',
  currentPage: null,
  placeId: null,
}

/** คำสั่งอ่าน/เขียนข้อมูลทั้งหมดของแอป รับ db เข้ามาเพื่อให้ทดสอบได้ */
export function createRepo(db: GongDongDB = defaultDb) {
  async function booksIn(placeId: string | null): Promise<Book[]> {
    const rows = alive(await db.books.toArray()).filter((b) => b.placeId === placeId)
    return rows.sort((a, b) => a.position - b.position)
  }

  /** ตำแหน่งถัดไปต่อท้ายที่เก็บ */
  async function nextPosition(placeId: string | null): Promise<number> {
    const rows = await booksIn(placeId)
    return rows.length ? rows[rows.length - 1].position + 1 : 0
  }

  return {
    // ---------- หนังสือ ----------
    async listBooks(): Promise<Book[]> {
      return alive(await db.books.toArray())
    },
    booksIn,

    async getBook(id: string): Promise<Book | undefined> {
      const b = await db.books.get(id)
      return b && b.deletedAt === null ? b : undefined
    },

    async addBook(input: BookInput): Promise<string> {
      const book: Book = { ...stamp(), ...input, position: await nextPosition(input.placeId) }
      await db.books.add(book)
      return book.id
    },

    async updateBook(id: string, input: BookInput): Promise<void> {
      const old = await db.books.get(id)
      if (!old) return
      // ย้ายที่เก็บ = ไปต่อท้ายที่ใหม่
      const position =
        old.placeId === input.placeId ? old.position : await nextPosition(input.placeId)
      await db.books.put({ ...old, ...input, position, updatedAt: Date.now() })
    },

    async moveBook(id: string, placeId: string | null): Promise<void> {
      const old = await db.books.get(id)
      if (!old || old.placeId === placeId) return
      await db.books.update(id, {
        placeId,
        position: await nextPosition(placeId),
        updatedAt: Date.now(),
      })
    },

    /** สลับลำดับกับเล่มข้างเคียงในที่เก็บเดียวกัน (dir -1 = เลื่อนไปก่อน, 1 = เลื่อนไปหลัง) */
    async shiftBook(id: string, dir: -1 | 1): Promise<void> {
      const book = await db.books.get(id)
      if (!book) return
      const rows = await booksIn(book.placeId)
      const i = rows.findIndex((b) => b.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= rows.length) return
      const now = Date.now()
      await db.transaction('rw', db.books, async () => {
        await db.books.update(rows[i].id, { position: rows[j].position, updatedAt: now })
        await db.books.update(rows[j].id, { position: rows[i].position, updatedAt: now })
      })
    },

    async deleteBook(id: string): Promise<void> {
      const now = Date.now()
      await db.books.update(id, { deletedAt: now, updatedAt: now })
      await db.covers.delete(id)
    },

    /** เพิ่มหลายเล่มต่อท้ายที่เก็บเดียวกันตามลำดับที่ส่งมา คืน id ตามลำดับ */
    async addBooks(inputs: BookInput[]): Promise<string[]> {
      const ids: string[] = []
      for (const input of inputs) ids.push(await this.addBook(input))
      return ids
    },

    // ---------- รูปปก ----------
    async getCover(bookId: string): Promise<Blob | undefined> {
      return (await db.covers.get(bookId))?.blob
    },

    async setCover(bookId: string, blob: Blob | null): Promise<void> {
      if (blob) await db.covers.put({ id: bookId, blob, updatedAt: Date.now() })
      else await db.covers.delete(bookId)
    },

    // ---------- ตู้หนังสือ ----------
    async listBookcases(): Promise<Bookcase[]> {
      return alive(await db.bookcases.toArray()).sort((a, b) => a.createdAt - b.createdAt)
    },

    /** สร้างตู้พร้อมชั้นวางตามจำนวนที่ระบุ */
    async addBookcase(input: BookcaseInput, shelfCount: number): Promise<string> {
      const bookcase: Bookcase = { ...stamp(), ...input }
      const shelves: Place[] = Array.from({ length: shelfCount }, (_, i) => ({
        ...stamp(),
        kind: 'shelf',
        name: `ชั้นที่ ${i + 1}`,
        bookcaseId: bookcase.id,
        order: i,
        location: '',
        label: '',
      }))
      await db.transaction('rw', db.bookcases, db.places, async () => {
        await db.bookcases.add(bookcase)
        await db.places.bulkAdd(shelves)
      })
      return bookcase.id
    },

    async updateBookcase(id: string, input: BookcaseInput): Promise<void> {
      await db.bookcases.update(id, { ...input, updatedAt: Date.now() })
    },

    /** ลบตู้ = ลบชั้นวางทั้งหมดในตู้ หนังสือกลับไปเป็น "ยังไม่ระบุที่เก็บ" */
    async deleteBookcase(id: string): Promise<void> {
      const shelves = alive(await db.places.where('bookcaseId').equals(id).toArray())
      await db.transaction('rw', db.bookcases, db.places, db.books, async () => {
        for (const s of shelves) await removePlace(db, s.id)
        const now = Date.now()
        await db.bookcases.update(id, { deletedAt: now, updatedAt: now })
      })
    },

    async addShelf(bookcaseId: string): Promise<string> {
      const shelves = alive(await db.places.where('bookcaseId').equals(bookcaseId).toArray())
      const order = shelves.reduce((m, s) => Math.max(m, s.order), -1) + 1
      const shelf: Place = {
        ...stamp(),
        kind: 'shelf',
        name: `ชั้นที่ ${order + 1}`,
        bookcaseId,
        order,
        location: '',
        label: '',
      }
      await db.places.add(shelf)
      return shelf.id
    },

    // ---------- ที่เก็บ (ชั้นวาง / กอง / กล่อง) ----------
    async listPlaces(): Promise<Place[]> {
      return alive(await db.places.toArray()).sort(
        (a, b) => a.order - b.order || a.createdAt - b.createdAt,
      )
    },

    async getPlace(id: string): Promise<Place | undefined> {
      const p = await db.places.get(id)
      return p && p.deletedAt === null ? p : undefined
    },

    async addPlace(kind: Exclude<PlaceKind, 'shelf'>, input: PlaceInput): Promise<string> {
      const place: Place = { ...stamp(), kind, bookcaseId: null, order: 0, ...input }
      await db.places.add(place)
      return place.id
    },

    async updatePlace(id: string, input: Partial<PlaceInput>): Promise<void> {
      await db.places.update(id, { ...input, updatedAt: Date.now() })
    },

    /** ลบที่เก็บ หนังสือข้างในกลับไปเป็น "ยังไม่ระบุที่เก็บ" (ไม่ลบหนังสือ) */
    async deletePlace(id: string): Promise<void> {
      await db.transaction('rw', db.places, db.books, () => removePlace(db, id))
    },
  }
}

async function removePlace(db: GongDongDB, id: string): Promise<void> {
  const now = Date.now()
  const books = await db.books.where('placeId').equals(id).toArray()
  for (const b of books) {
    if (b.deletedAt === null) await db.books.update(b.id, { placeId: null, updatedAt: now })
  }
  await db.places.update(id, { deletedAt: now, updatedAt: now })
}

export const repo = createRepo()
