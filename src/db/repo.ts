import { db as defaultDb, type GongDongDB } from './db'
import { pace, timerTotal } from '../lib/stats'
import { footprint, rowsOf, shelfWidth } from '../lib/capacity'
import type { Book, Bookcase, Category, Look, Place, PlaceKind, Quote, ReadingSession, Series, SyncFields, Wish } from './types'

const newId = () => crypto.randomUUID()

function stamp(): SyncFields {
  const now = Date.now()
  return { id: newId(), createdAt: now, updatedAt: now, deletedAt: null }
}

/** เรียงตามเวลาที่จบ (รายการที่ยังไม่จบใช้เวลาเริ่ม) ใหม่สุดก่อน */
const latestFirst = (a: ReadingSession, b: ReadingSession) =>
  (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt) || b.createdAt - a.createdAt

/** เพดานเวลาอ่านต่อหนึ่งรายการ: จากนาฬิกา 12 ชม. จากการประมาณ 3 ชม. */
const MAX_TIMER_MINUTES = 720
const MAX_ESTIMATE_MINUTES = 180

const alive = <T extends SyncFields>(rows: T[]) => rows.filter((r) => r.deletedAt === null)

/** ฟิลด์ที่ระบบจัดการเอง ฟอร์มแก้ไขไม่ได้ */
type SystemFields = 'position' | 'takenAt' | 'takenFrom' | 'finishedAt' | 'row' | 'rating'
export type BookInput = Omit<Book, keyof SyncFields | SystemFields>

export interface ReturnInput {
  placeId: string | null
  page: number | null
  minutes: number | null
  finished: boolean
}
export interface CheckInInput {
  page: number | null
  /** null = ใช้เวลาที่จับไว้ หรือประมาณจากจำนวนหน้า */
  minutes: number | null
}
export type BookcaseInput = Pick<Bookcase, 'name' | 'room'>
export type PlaceInput = Pick<Place, 'name' | 'location' | 'label'>
export type WishInput = Pick<Wish, 'title' | 'authors' | 'isbn' | 'note'>
export type QuoteInput = Pick<Quote, 'bookId' | 'text' | 'page' | 'note'>

export const emptyBook: BookInput = {
  title: '',
  authors: '',
  publisher: '',
  year: '',
  pages: null,
  isbn: '',
  categoryId: null,
  tags: [],
  synopsis: '',
  blurb: '',
  reviewSummary: '',
  links: [],
  spineColor: '',
  note: '',
  status: 'dong',
  currentPage: null,
  placeId: null,
  seriesId: null,
  seriesNo: null,
  edition: '',
  condition: '',
  price: null,
  boughtAt: '',
  boughtFrom: '',
  signed: false,
}

/** ชื่อหมวดแบบเรียบร้อย: ตัดช่องว่างหัวท้ายและช่องว่างซ้ำ */
export const normName = (name: string) => name.trim().replace(/\s+/g, ' ')

/** จำนวนลิ้นชักตามรูปทรงตู้ */
export const drawerCount = (look?: Look) =>
  look?.drawerRows ? look.drawerRows * Math.max(1, look.drawersPerRow ?? 2) : 0

/** หนังสือที่บันทึกจากเวอร์ชันก่อนอาจขาดฟิลด์ใหม่ เติมค่าเริ่มต้นให้ */
const withDefaults = (b: Book): Book => ({
  ...emptyBook,
  ...b,
  categoryId: b.categoryId ?? null,
  takenAt: b.takenAt ?? null,
  takenFrom: b.takenFrom ?? null,
  finishedAt: b.finishedAt ?? null,
  seriesId: b.seriesId ?? null,
  seriesNo: b.seriesNo ?? null,
  price: b.price ?? null,
  signed: b.signed ?? false,
  // ข้อมูลจากไฟล์หรือเครื่องอื่นอาจไม่ครบ รายการต้องเป็นอาร์เรย์เสมอ
  tags: Array.isArray(b.tags) ? b.tags : [],
  links: Array.isArray(b.links) ? b.links : [],
})

/** คำสั่งอ่าน/เขียนข้อมูลทั้งหมดของแอป รับ db เข้ามาเพื่อให้ทดสอบได้ */
export function createRepo(db: GongDongDB = defaultDb) {
  async function booksIn(placeId: string | null): Promise<Book[]> {
    // ใช้ดัชนี placeId (IndexedDB ไม่ทำดัชนีค่า null จึงต้องไล่ทั้งตารางเฉพาะกรณียังไม่ระบุที่เก็บ)
    const rows =
      placeId === null
        ? await db.books.filter((b) => b.placeId === null).toArray()
        : await db.books.where('placeId').equals(placeId).toArray()
    // หนังสือที่อยู่ในมือไม่นับว่าอยู่ในที่เก็บใด
    return alive(rows)
      .filter((b) => !b.takenAt)
      .sort((a, b) => a.position - b.position)
  }

  /** การหยิบที่ยังไม่วางคืนของหนังสือเล่มนี้ */
  // สองฟังก์ชันนี้คืน Promise ของ Dexie โดยตรง (ไม่ห่อด้วย async) เพื่อให้ใช้ในธุรกรรมได้โดยธุรกรรมไม่ปิดก่อนเวลา
  function openSession(bookId: string): PromiseLike<ReadingSession | undefined> {
    return openSessions(bookId).then((rows) => rows[0])
  }

  /**
   * การหยิบที่ยังไม่วางคืนทั้งหมดของเล่มนี้ ใหม่สุดก่อน
   * ปกติมีได้อันเดียว แต่หลังซิงก์สองเครื่องที่หยิบเล่มเดียวกันอาจมีค้างมากกว่าหนึ่ง
   */
  function openSessions(bookId: string) {
    return db.sessions
      .where('bookId')
      .equals(bookId)
      .toArray()
      .then((rows) => rows.filter((r) => r.deletedAt === null && r.endedAt === null).sort((a, b) => b.startedAt - a.startedAt))
  }

  async function placeAlive(placeId: string | null): Promise<boolean> {
    if (placeId === null) return true
    const p = await db.places.get(placeId)
    return Boolean(p && p.deletedAt === null)
  }

  async function findCategory(name: string): Promise<Category | undefined> {
    const key = normName(name).toLowerCase()
    return alive(await db.categories.toArray()).find((c) => c.name.toLowerCase() === key)
  }

  async function drawers(bookcaseId: string): Promise<Place[]> {
    const rows = alive(await db.places.where('bookcaseId').equals(bookcaseId).toArray())
    return rows.filter((p) => p.kind === 'drawer').sort((a, b) => a.order - b.order)
  }

  /**
   * บันทึกการอ่านหนึ่งครั้งของเล่มนี้ (ต้องเรียกในธุรกรรมที่มี books และ sessions)
   * บันทึกเฉพาะเมื่อมีอะไรให้บันทึกจริง (หน้าเพิ่ม ใส่เวลา หรือจับเวลาไว้)
   */
  async function logReading(id: string, input: CheckInInput): Promise<void> {
    const book = await db.books.get(id)
    if (!book || book.deletedAt !== null) return
    const now = Date.now()
    const carry = await openSession(id)
    const timer = carry ? timerTotal(carry, now) : 0
    const page = input.page
    // อ่านซ้ำเล่มที่จบแล้ว: หน้าที่น้อยกว่าเดิมคือเริ่มรอบใหม่ นับจากหน้าแรก
    const rereading = book.status === 'done' && page !== null && page < (book.currentPage ?? 0)
    const startPage = rereading ? null : book.currentPage
    const pages = page !== null ? Math.max(0, page - (startPage ?? 0)) : 0
    const pageChanged = page !== null && page !== book.currentPage
    // คืน Promise ของ Dexie โดยตรง (ไม่ห่อด้วย async) เพื่อไม่ให้ธุรกรรมปิดก่อนเวลา
    const setPage = () =>
      db.books.update(id, {
        currentPage: page,
        status: book.status === 'dong' || rereading ? 'reading' : book.status,
        ...(rereading && { finishedAt: null }),
        updatedAt: now,
      })
    // ไม่มีอะไรให้บันทึก (หน้าไม่เพิ่ม ไม่ใส่เวลา ไม่ได้จับเวลา): แค่แก้เลขหน้าถ้าเปลี่ยน ไม่สร้างรายการเปล่า
    if (pages === 0 && !input.minutes && timer === 0) {
      if (pageChanged) await setPage()
      return
    }
    let minutes = input.minutes
    let estimated = false
    // ลืมหยุดนาฬิกาข้ามวัน หรือคั่นหน้าครั้งแรกกลางเล่ม ไม่ควรกลายเป็นเวลาอ่านมหาศาล
    if (minutes === null && timer > 0) minutes = Math.min(MAX_TIMER_MINUTES, Math.max(1, Math.round(timer / 60000)))
    else if (minutes === null && pages > 0) {
      const all = await db.sessions.toArray()
      minutes = Math.min(MAX_ESTIMATE_MINUTES, Math.max(1, Math.round(pages * pace(all))))
      estimated = true
    }
    await db.sessions.add({
      ...stamp(),
      kind: 'read',
      ...(estimated && { estimated }),
      bookId: id,
      fromPlaceId: null,
      toPlaceId: null,
      startedAt: now - (minutes ?? 0) * 60000,
      endedAt: now,
      startPage,
      endPage: page,
      minutes,
      timerMs: 0,
      timerStartedAt: null,
    })
    // เวลาที่จับไว้ถูกใช้ไปแล้ว เริ่มนับใหม่สำหรับการอ่านครั้งถัดไป
    if (carry && timer > 0) await db.sessions.update(carry.id, { timerMs: 0, timerStartedAt: null, updatedAt: now })
    if (pageChanged) await setPage()
  }

  /** ตำแหน่งถัดไปต่อท้ายที่เก็บ */
  async function nextPosition(placeId: string | null): Promise<number> {
    const rows = await booksIn(placeId)
    return rows.length ? rows[rows.length - 1].position + 1 : 0
  }

  return {
    // ---------- ชุดหนังสือ ----------
    async listSeries(): Promise<Series[]> {
      return alive(await db.series.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'th'))
    },

    async getSeries(id: string): Promise<Series | undefined> {
      const s = await db.series.get(id)
      return s && s.deletedAt === null ? s : undefined
    },

    /** หาชุดจากชื่อ ไม่มีก็สร้างใหม่ คืน id */
    async ensureSeries(name: string): Promise<string> {
      const clean = normName(name)
      if (!clean) throw new Error('empty series name')
      return db.transaction('rw', db.series, async () => {
        const found = alive(await db.series.toArray()).find((x) => x.name.toLowerCase() === clean.toLowerCase())
        if (found) return found.id
        const row: Series = { ...stamp(), name: clean, total: null }
        await db.series.add(row)
        return row.id
      })
    },

    /** แก้ชื่อหรือจำนวนเล่มของชุด — คืน false ถ้าชื่อใหม่ซ้ำกับชุดอื่น (ไม่แก้อะไร) */
    async updateSeries(id: string, input: Partial<Pick<Series, 'name' | 'total'>>): Promise<boolean> {
      return db.transaction('rw', db.series, async () => {
        const patch: Partial<Pick<Series, 'name' | 'total'>> = { ...input }
        if (patch.name !== undefined) {
          const clean = normName(patch.name)
          if (!clean) return false
          const clash = alive(await db.series.toArray()).some((x) => x.id !== id && x.name.toLowerCase() === clean.toLowerCase())
          if (clash) return false
          patch.name = clean
        }
        await db.series.update(id, { ...patch, updatedAt: Date.now() })
        return true
      })
    },

    /** ลบชุด หนังสือในชุดไม่ถูกลบ แค่ไม่อยู่ในชุดแล้ว */
    async deleteSeries(id: string): Promise<void> {
      const now = Date.now()
      await db.transaction('rw', db.series, db.books, async () => {
        await db.books.where('seriesId').equals(id).modify({ seriesId: null, seriesNo: null, updatedAt: now })
        await db.series.update(id, { deletedAt: now, updatedAt: now })
      })
    },

    // ---------- ประโยคที่ชอบ ----------
    async listQuotes(bookId?: string): Promise<Quote[]> {
      const rows = bookId ? await db.quotes.where('bookId').equals(bookId).toArray() : await db.quotes.toArray()
      return alive(rows).sort((a, b) => b.createdAt - a.createdAt)
    },

    async addQuote(input: QuoteInput): Promise<string> {
      const q: Quote = { ...stamp(), ...input, text: input.text.trim() }
      await db.quotes.add(q)
      return q.id
    },

    async updateQuote(id: string, input: Partial<Omit<QuoteInput, 'bookId'>>): Promise<void> {
      await db.quotes.update(id, { ...input, updatedAt: Date.now() })
    },

    async deleteQuote(id: string): Promise<void> {
      const now = Date.now()
      await db.quotes.update(id, { deletedAt: now, updatedAt: now })
    },

    // ---------- รายการอยากได้ ----------
    async listWishes(): Promise<Wish[]> {
      return alive(await db.wishes.toArray()).sort((a, b) => b.createdAt - a.createdAt)
    },

    async addWish(input: WishInput): Promise<string> {
      const wish: Wish = { ...stamp(), ...input, title: input.title.trim() }
      await db.wishes.add(wish)
      return wish.id
    },

    /** เพิ่มหลายรายการในครั้งเดียว ข้ามชื่อที่มีอยู่แล้ว (กดซ้ำไม่ได้รายการซ้ำ) คืนจำนวนที่เพิ่มจริง */
    async addWishes(inputs: WishInput[]): Promise<number> {
      return db.transaction('rw', db.wishes, async () => {
        const have = new Set(alive(await db.wishes.toArray()).map((w) => w.title))
        const rows: Wish[] = []
        for (const input of inputs) {
          const title = input.title.trim()
          if (!title || have.has(title)) continue
          have.add(title)
          rows.push({ ...stamp(), ...input, title })
        }
        await db.wishes.bulkAdd(rows)
        return rows.length
      })
    },

    async updateWish(id: string, input: Partial<WishInput>): Promise<void> {
      await db.wishes.update(id, { ...input, updatedAt: Date.now() })
    },

    async deleteWish(id: string): Promise<void> {
      const now = Date.now()
      await db.wishes.update(id, { deletedAt: now, updatedAt: now })
    },

    /** ซื้อแล้ว: ย้ายจากรายการอยากได้เข้าคลังเป็นเล่มดอง คืน id ของหนังสือ */
    async wishToBook(id: string, placeId: string | null = null): Promise<string | undefined> {
      return db.transaction('rw', db.wishes, db.books, db.places, async () => {
        const w = await db.wishes.get(id)
        if (!w || w.deletedAt !== null) return undefined
        const target = (await placeAlive(placeId)) ? placeId : null
        const now = Date.now()
        const book: Book = {
          ...emptyBook,
          ...stamp(),
          title: w.title,
          authors: w.authors,
          isbn: w.isbn,
          note: w.note,
          placeId: target,
          boughtAt: new Date(now).toLocaleDateString('sv'),
          position: await nextPosition(target),
          takenAt: null,
          takenFrom: null,
          finishedAt: null,
        }
        await db.books.add(book)
        await db.wishes.update(id, { deletedAt: now, updatedAt: now })
        return book.id
      })
    },

    // ---------- หนังสือ ----------
    async listBooks(): Promise<Book[]> {
      return alive(await db.books.toArray()).map(withDefaults)
    },
    booksIn,

    async getBook(id: string): Promise<Book | undefined> {
      const b = await db.books.get(id)
      return b && b.deletedAt === null ? withDefaults(b) : undefined
    },

    async addBook(input: BookInput): Promise<string> {
      const book: Book = {
        ...stamp(),
        ...input,
        position: await nextPosition(input.placeId),
        takenAt: null,
        takenFrom: null,
        finishedAt: input.status === 'done' ? Date.now() : null,
      }
      await db.books.add(book)
      return book.id
    },

    async updateBook(id: string, input: BookInput): Promise<void> {
      const old = await db.books.get(id)
      if (!old) return
      // หนังสือในมือย้ายที่ผ่านฟอร์มไม่ได้ ต้องวางคืน
      const placeId = old.takenAt ? null : input.placeId
      // ย้ายที่เก็บ = ไปต่อท้ายที่ใหม่
      const position = old.placeId === placeId ? old.position : await nextPosition(placeId)
      const finishedAt =
        input.status !== 'done' ? null : old.status === 'done' ? (old.finishedAt ?? null) : Date.now()
      await db.books.put({
        ...old,
        ...input,
        placeId,
        position,
        // ย้ายที่เก็บแล้วเริ่มที่แถวหน้า (แถวหน้า/หลังเป็นของชั้นเดิม)
        row: old.placeId === placeId ? (old.row ?? 0) : 0,
        // คะแนนให้ผ่านปุ่มดาว/มะเขือเท่านั้น ฟอร์มที่ถือค่าเก่าอยู่ต้องไม่เขียนทับ
        ...(old.rating !== undefined && { rating: old.rating }),
        finishedAt,
        // ฟอร์มอาจถือค่าเก่าอยู่ ใช้ค่าในฐานข้อมูลเสมอ
        takenAt: old.takenAt ?? null,
        takenFrom: old.takenFrom ?? null,
        updatedAt: Date.now(),
      })
    },

    // ---------- หมวดหนังสือ ----------
    async listCategories(): Promise<Category[]> {
      return alive(await db.categories.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'th'))
    },

    /** หาหมวดตามชื่อ (ไม่สนตัวพิมพ์และช่องว่างซ้ำ) ไม่มีก็สร้างใหม่ คืน id */
    async ensureCategory(name: string): Promise<string> {
      const clean = normName(name)
      if (!clean) throw new Error('empty category name')
      // หาและสร้างในธุรกรรมเดียว กันกดซ้ำแล้วได้หมวดชื่อเดียวกันสองอัน
      return db.transaction('rw', db.categories, async () => {
        const found = await findCategory(clean)
        if (found) return found.id
        const cat: Category = { ...stamp(), name: clean }
        await db.categories.add(cat)
        return cat.id
      })
    },

    async setCategory(bookId: string, categoryId: string | null): Promise<void> {
      await db.books.update(bookId, { categoryId, updatedAt: Date.now() })
    },

    async setCategoryByName(bookId: string, name: string): Promise<void> {
      await this.setCategory(bookId, await this.ensureCategory(name))
    },

    /**
     * เปลี่ยนชื่อหมวด ถ้าชื่อใหม่ตรงกับหมวดอื่นที่มีอยู่ ให้รวมเข้าด้วยกัน (ย้ายหนังสือแล้วลบหมวดนี้)
     * คืน id ของหมวดที่เหลืออยู่
     */
    async renameCategory(id: string, name: string): Promise<string> {
      const clean = normName(name)
      if (!clean) return id
      const other = await findCategory(clean)
      const now = Date.now()
      if (other && other.id !== id) {
        await db.transaction('rw', db.books, db.categories, async () => {
          await db.books.where('categoryId').equals(id).modify({ categoryId: other.id, updatedAt: now })
          await db.categories.update(id, { deletedAt: now, updatedAt: now })
        })
        return other.id
      }
      await db.categories.update(id, { name: clean, updatedAt: now })
      return id
    },

    /** รวมหมวดหนึ่งเข้ากับอีกหมวด: ย้ายหนังสือทั้งหมดแล้วลบหมวดต้นทาง */
    async mergeCategory(fromId: string, intoId: string): Promise<void> {
      if (fromId === intoId) return
      const now = Date.now()
      await db.transaction('rw', db.books, db.categories, async () => {
        const into = await db.categories.get(intoId)
        if (!into || into.deletedAt !== null) return
        await db.books.where('categoryId').equals(fromId).modify({ categoryId: intoId, updatedAt: now })
        await db.categories.update(fromId, { deletedAt: now, updatedAt: now })
      })
    },

    /** ลบหมวด หนังสือในหมวดกลายเป็นไม่มีหมวด (ไม่ถูกลบ) */
    async deleteCategory(id: string): Promise<void> {
      const now = Date.now()
      await db.transaction('rw', db.books, db.categories, async () => {
        await db.books.where('categoryId').equals(id).modify({ categoryId: null, updatedAt: now })
        await db.categories.update(id, { deletedAt: now, updatedAt: now })
      })
    },

    async moveBook(id: string, placeId: string | null): Promise<void> {
      await db.transaction('rw', db.books, db.places, async () => {
        const old = await db.books.get(id)
        // ที่ปลายทางถูกลบไปแล้ว (เช่น แผนจัดระเบียบที่เปิดค้างไว้) ไม่ย้าย
        if (!old || old.takenAt || old.placeId === placeId || !(await placeAlive(placeId))) return
        await db.books.update(id, {
          placeId,
          position: await nextPosition(placeId),
          row: 0,
          updatedAt: Date.now(),
        })
      })
    },

    /** สลับลำดับกับเล่มข้างเคียงในที่เก็บเดียวกัน (dir -1 = เลื่อนไปก่อน, 1 = เลื่อนไปหลัง) */
    /**
     * ย้ายหลายเล่มไปที่เก็บเดียวกัน ต่อท้ายตามลำดับที่ส่งมา ในธุรกรรมเดียว คืนจำนวนเล่มที่ย้ายจริง
     * (ข้ามเล่มที่อยู่ในมือ เล่มที่อยู่ที่นั้นอยู่แล้ว และไม่ย้ายถ้าที่ปลายทางถูกลบไปแล้ว)
     */
    async moveBooks(ids: string[], placeId: string | null): Promise<number> {
      return db.transaction('rw', db.books, db.places, db.bookcases, async () => {
        if (!(await placeAlive(placeId))) return 0
        let position = await nextPosition(placeId)
        // ชั้นสองแถวที่รู้ความกว้าง: แถวหน้าเต็มแล้วเล่มถัดไปไปอยู่แถวหลัง
        const place = placeId ? await db.places.get(placeId) : undefined
        const width = place ? shelfWidth(place, place.bookcaseId ? await db.bookcases.get(place.bookcaseId) : null) : null
        const spill = Boolean(place && rowsOf(place) === 2 && width !== null)
        const used = [0, 0]
        if (spill) for (const b of await booksIn(placeId)) if (!b.takenAt) used[b.row === 1 ? 1 : 0] += footprint(b)
        const now = Date.now()
        let moved = 0
        for (const id of ids) {
          const b = await db.books.get(id)
          if (!b || b.deletedAt !== null || b.takenAt || b.placeId === placeId) continue
          const size = footprint(b)
          const row = spill && used[0] + size > width! && used[1] + size <= width! ? 1 : 0
          used[row] += size
          await db.books.update(id, { placeId, position: position++, row, updatedAt: now })
          moved++
        }
        return moved
      })
    },

    /** ตั้งหมวดให้หลายเล่มพร้อมกัน (null = ไม่มีหมวด) คืนจำนวนเล่มที่เปลี่ยน */
    async setCategoryMany(ids: string[], categoryId: string | null): Promise<number> {
      return db.transaction('rw', db.books, async () => {
        const now = Date.now()
        let changed = 0
        for (const id of ids) {
          const b = await db.books.get(id)
          if (!b || b.deletedAt !== null || (b.categoryId ?? null) === categoryId) continue
          await db.books.update(id, { categoryId, updatedAt: now })
          changed++
        }
        return changed
      })
    },

    /**
     * เปลี่ยนสถานะการอ่านหลายเล่มพร้อมกัน คืนจำนวนเล่มที่เปลี่ยน
     * วันที่อ่านจบใช้กฎเดียวกับฟอร์มหนังสือ: เปลี่ยนเป็นอ่านจบ = วันนี้ เปลี่ยนออกจากอ่านจบ = ล้างวันที่
     */
    async setStatusMany(ids: string[], status: Book['status']): Promise<number> {
      return db.transaction('rw', db.books, async () => {
        const now = Date.now()
        let changed = 0
        for (const id of ids) {
          const b = await db.books.get(id)
          if (!b || b.deletedAt !== null || b.status === status) continue
          await db.books.update(id, { status, finishedAt: status === 'done' ? now : null, updatedAt: now })
          changed++
        }
        return changed
      })
    },

    /** จัดลำดับหนังสือในที่เก็บตามรายการ id ที่ส่งมา (เล่มที่ไม่อยู่ในรายการต่อท้ายตามลำดับเดิม) คืนจำนวนเล่มที่เปลี่ยนตำแหน่ง */
    async setOrder(placeId: string, ids: string[]): Promise<number> {
      return db.transaction('rw', db.books, async () => {
        const rows = await booksIn(placeId)
        const rank = new Map(ids.map((id, i) => [id, i]))
        const ordered = [...rows].sort(
          (a, b) => (rank.get(a.id) ?? ids.length + a.position) - (rank.get(b.id) ?? ids.length + b.position),
        )
        const now = Date.now()
        let changed = 0
        for (let k = 0; k < ordered.length; k++)
          if (ordered[k].position !== k) {
            await db.books.update(ordered[k].id, { position: k, updatedAt: now })
            changed++
          }
        return changed
      })
    },

    async shiftBook(id: string, dir: -1 | 1): Promise<void> {
      const book = await db.books.get(id)
      if (!book) return
      const rows = await booksIn(book.placeId)
      // เลื่อนภายในแถวเดียวกัน (ชั้นที่วางซ้อนสองแถว แถวหน้าและแถวหลังเรียงแยกกัน)
      const mine = rows.filter((b) => (b.row ?? 0) === (book.row ?? 0))
      const at = mine.findIndex((b) => b.id === id)
      const other = mine[at + dir]
      if (at < 0 || !other) return
      const i = rows.findIndex((b) => b.id === id)
      const j = rows.findIndex((b) => b.id === other.id)
      const now = Date.now()
      // สลับสองเล่มแล้วเรียงเลขตำแหน่งใหม่ทั้งที่เก็บ (หลังซิงก์ตำแหน่งอาจซ้ำกัน สลับค่าเฉย ๆ จะไม่ขยับ)
      const order = [...rows]
      ;[order[i], order[j]] = [order[j], order[i]]
      await db.transaction('rw', db.books, async () => {
        for (let k = 0; k < order.length; k++)
          if (order[k].position !== k || k === i || k === j) await db.books.update(order[k].id, { position: k, updatedAt: now })
      })
    },

    /** ย้ายหนังสือไปแถวหน้า (0) หรือแถวหลัง (1) ของชั้นเดิม ไปต่อท้ายแถวนั้น */
    /** ให้คะแนน: 1..5 = ดาว, -1..-5 = มะเขือ, 0 = ล้างคะแนน */
    async setRating(id: string, rating: number): Promise<void> {
      const value = Math.max(-5, Math.min(5, Math.trunc(rating) || 0))
      await db.books.update(id, { rating: value, updatedAt: Date.now() })
    },

    async setRow(id: string, row: 0 | 1): Promise<void> {
      await db.transaction('rw', db.books, async () => {
        const b = await db.books.get(id)
        if (!b || b.deletedAt !== null || b.takenAt || (b.row ?? 0) === row) return
        await db.books.update(id, { row, position: await nextPosition(b.placeId), updatedAt: Date.now() })
      })
    },

    /** ตั้งความกว้างของชั้นทั้งตู้ (ซม.) — null = ไม่ระบุ */
    async setShelfWidth(bookcaseId: string, width: number | null): Promise<void> {
      await db.bookcases.update(bookcaseId, { shelfWidth: width, updatedAt: Date.now() })
    },

    /** ตั้งจำนวนแถวของทุกชั้นในตู้ (กลับเป็นแถวเดียว หนังสือแถวหลังกลับมาแถวหน้า) */
    async setBookcaseRows(bookcaseId: string, rows: 1 | 2): Promise<void> {
      await db.transaction('rw', db.places, db.books, async () => {
        const now = Date.now()
        const shelves = alive(await db.places.where('bookcaseId').equals(bookcaseId).toArray()).filter((p) => p.kind === 'shelf')
        for (const p of shelves) {
          if ((p.rows ?? 1) === rows) continue
          await db.places.update(p.id, { rows, updatedAt: now })
          if (rows === 1)
            await db.books
              .where('placeId')
              .equals(p.id)
              .filter((b) => b.row === 1)
              .modify({ row: 0, updatedAt: now })
        }
      })
    },

    /** ตั้งความกว้างเฉพาะชั้น และจำนวนแถว (เปลี่ยนกลับเป็นแถวเดียว หนังสือแถวหลังกลับมาแถวหน้า) */
    async setShelfShape(placeId: string, shape: { width?: number | null; rows?: 1 | 2 }): Promise<void> {
      await db.transaction('rw', db.places, db.books, async () => {
        const now = Date.now()
        await db.places.update(placeId, { ...shape, updatedAt: now })
        if (shape.rows === 1)
          await db.books
            .where('placeId')
            .equals(placeId)
            .filter((b) => b.row === 1)
            .modify({ row: 0, updatedAt: now })
      })
    },

    async deleteBook(id: string): Promise<void> {
      const now = Date.now()
      await db.transaction('rw', [db.books, db.sessions, db.covers, db.quotes], async () => {
        await db.books.update(id, { deletedAt: now, updatedAt: now })
        await db.quotes.where('bookId').equals(id).modify({ deletedAt: now, updatedAt: now })
        // การหยิบที่ค้างอยู่ของเล่มที่ถูกลบ ไม่ควรค้างเป็น "อยู่ในมือ" ตลอดไป
        for (const open of await openSessions(id)) await db.sessions.update(open.id, { deletedAt: now, updatedAt: now })
        await putCover(db, id, null)
      })
    },

    // ---------- หยิบไปอ่าน / วางคืน ----------
    /** หยิบหนังสือออกจากที่เก็บ เริ่มบันทึกการอ่าน */
    async takeBook(id: string): Promise<void> {
      await db.transaction('rw', db.books, db.sessions, async () => {
        const book = await db.books.get(id)
        if (!book || book.deletedAt !== null || book.takenAt) return
        const now = Date.now()
        // การหยิบที่ค้างจากเครื่องอื่น (เล่มไม่ได้อยู่ในมือแล้ว) ปิดก่อนเริ่มการหยิบใหม่
        for (const stale of await openSessions(id))
          await db.sessions.update(stale.id, { kind: 'carry', endedAt: now, timerStartedAt: null, updatedAt: now })
        await db.sessions.add({
          ...stamp(),
          kind: 'carry',
          bookId: id,
          fromPlaceId: book.placeId,
          toPlaceId: null,
          startedAt: now,
          endedAt: null,
          startPage: book.currentPage,
          endPage: null,
          minutes: null,
          timerMs: 0,
          timerStartedAt: null,
        })
        await db.books.update(id, {
          placeId: null,
          takenAt: now,
          takenFrom: book.placeId,
          status: book.status === 'dong' ? 'reading' : book.status,
          updatedAt: now,
        })
      })
    },

    /**
     * คั่นหน้า: บันทึกว่าอ่านถึงหน้าไหน (หนังสือยังอยู่กับตัว ไม่ต้องวางคืน)
     * เวลาอ่าน: ที่ผู้ใช้ใส่ > เวลาที่จับไว้ > ประมาณจากจำนวนหน้ากับความเร็วอ่านของผู้ใช้
     */
    async checkIn(id: string, input: CheckInInput): Promise<void> {
      await db.transaction('rw', db.books, db.sessions, () => logReading(id, input))
    },

    /** วางคืนที่เดิมหรือที่ใหม่ ถ้าหน้าที่คั่นเปลี่ยนหรือมีเวลาที่จับไว้ บันทึกเป็นการอ่านอีกหนึ่งครั้ง */
    async returnBook(id: string, input: ReturnInput): Promise<void> {
      await db.transaction('rw', db.books, db.sessions, db.places, async () => {
        // ที่วางคืนถูกลบไประหว่างนั้น วางเป็น "ยังไม่ระบุที่เก็บ" แทน
        const placeId = (await placeAlive(input.placeId)) ? input.placeId : null
        const position = await nextPosition(placeId)
        const before = await db.books.get(id)
        if (!before || !before.takenAt) return
        const finished = input.finished
        const page = finished && before.pages ? before.pages : input.page
        await logReading(id, { page, minutes: input.minutes })
        // อ่านค่าล่าสุดหลังบันทึกการอ่าน (สถานะและหน้าอาจเปลี่ยนไปแล้ว)
        const book = (await db.books.get(id))!
        const now = Date.now()
        // ปิดการหยิบที่ค้างทุกอัน (หลังซิงก์สองเครื่องอาจมีมากกว่าหนึ่ง)
        for (const session of await openSessions(id))
          await db.sessions.update(session.id, {
            kind: 'carry',
            endedAt: now,
            toPlaceId: placeId,
            timerStartedAt: null,
            updatedAt: now,
          })
        // เล่มที่จบอยู่แล้วและแค่หยิบมาเปิดดู (ไม่ได้อ่านเพิ่ม) คงวันที่อ่านจบเดิมไว้
        const untouched = before.status === 'done' && book.status === 'done' && before.finishedAt !== null
        await db.books.update(id, {
          placeId,
          position,
          row: 0,
          takenAt: null,
          takenFrom: null,
          currentPage: page ?? book.currentPage,
          status: finished ? 'done' : book.status === 'done' ? 'reading' : book.status,
          // อ่านจบ = วันที่วางคืน (อ่านซ้ำจบก็นับใหม่) ไม่จบ = ไม่มีวันที่อ่านจบ
          finishedAt: finished ? (untouched ? before.finishedAt : now) : null,
          updatedAt: now,
        })
      })
    },

    /** เริ่มหรือหยุดจับเวลาอ่านของหนังสือที่อยู่ในมือ */
    async toggleTimer(bookId: string): Promise<void> {
      const session = await openSession(bookId)
      if (!session) return
      const now = Date.now()
      await db.sessions.update(
        session.id,
        session.timerStartedAt
          ? { timerMs: session.timerMs + (now - session.timerStartedAt), timerStartedAt: null, updatedAt: now }
          : { timerStartedAt: now, updatedAt: now },
      )
    },

    openSession,

    /**
     * ล้างสถิติการอ่าน: ลบประวัติการอ่านทั้งหมด (ทำเครื่องหมายลบ จึงตามไปทุกเครื่องเมื่อซิงก์)
     * หนังสือ หน้าที่คั่น และสถานะอ่านจบยังอยู่ การหยิบที่ยังไม่วางคืนคงไว้ให้วางคืนได้ตามปกติ
     */
    async clearStats(): Promise<number> {
      const now = Date.now()
      return db.sessions
        .filter((s) => s.deletedAt === null && s.endedAt !== null)
        .modify({ deletedAt: now, updatedAt: now })
    },

    async listSessions(): Promise<ReadingSession[]> {
      return alive(await db.sessions.toArray()).sort(latestFirst)
    },

    async sessionsFor(bookId: string): Promise<ReadingSession[]> {
      const rows = alive(await db.sessions.where('bookId').equals(bookId).toArray())
      return rows.sort(latestFirst)
    },

    /** เพิ่มหลายเล่มต่อท้ายที่เก็บตามลำดับที่ส่งมา ในธุรกรรมเดียว คืน id ตามลำดับ */
    async addBooks(inputs: BookInput[]): Promise<string[]> {
      return db.transaction('rw', db.books, async () => {
        const next = new Map<string | null, number>()
        const rows: Book[] = []
        for (const input of inputs) {
          if (!next.has(input.placeId)) next.set(input.placeId, await nextPosition(input.placeId))
          const position = next.get(input.placeId)!
          next.set(input.placeId, position + 1)
          rows.push({
            ...stamp(),
            ...input,
            position,
            takenAt: null,
            takenFrom: null,
            finishedAt: input.status === 'done' ? Date.now() : null,
          })
        }
        await db.books.bulkAdd(rows)
        return rows.map((r) => r.id)
      })
    },

    // ---------- รูปปก ----------
    async getCover(bookId: string): Promise<Blob | undefined> {
      const c = await db.covers.get(bookId)
      return c && c.deletedAt === null && c.blob ? c.blob : undefined
    },

    /** รูปย่อของปก (ถ้ามี) และรูปเต็มไว้สร้างรูปย่อ */
    async getThumb(id: string): Promise<{ thumb?: Blob; blob?: Blob }> {
      const c = await db.covers.get(id)
      if (!c || c.deletedAt !== null || !c.blob) return {}
      return { thumb: c.thumb ?? undefined, blob: c.blob }
    },

    /** เก็บรูปย่อที่สร้างแล้ว ไม่แตะ updatedAt เพราะเป็นข้อมูลที่สร้างใหม่ได้ในเครื่อง ไม่ใช่การแก้ไข */
    async saveThumb(id: string, thumb: Blob): Promise<void> {
      await db.covers.update(id, { thumb })
    },

    /** ตั้งรูป (ปกหนังสือ หรือรูปที่เก็บ) — null = ลบ โดยเก็บเครื่องหมายลบไว้ */
    async setCover(id: string, blob: Blob | null): Promise<void> {
      await putCover(db, id, blob)
    },

    // ---------- ตู้หนังสือ ----------
    async listBookcases(): Promise<Bookcase[]> {
      return alive(await db.bookcases.toArray()).sort((a, b) => a.createdAt - b.createdAt)
    },

    /** สร้างตู้พร้อมชั้นวางตามจำนวนที่ระบุ — ชั้นที่ 1 (order 0) อยู่ล่างสุด */
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

    /**
     * สร้างตู้จากรูป: ชั้นตามจำนวนที่ส่งมา (ล่างขึ้นบน) พร้อมหนังสือแต่ละชั้นเรียงซ้ายไปขวา
     * คืน id ของตู้
     */
    async addBookcaseWithBooks(
      input: BookcaseInput,
      look: Look,
      shelves: BookInput[][],
    ): Promise<string> {
      const id = await this.addBookcase(input, Math.max(1, shelves.length))
      await db.bookcases.update(id, { look, updatedAt: Date.now() })
      const created = alive(await db.places.where('bookcaseId').equals(id).toArray())
        .filter((p) => p.kind === 'shelf')
        .sort(
        (a, b) => a.order - b.order,
      )
      for (let i = 0; i < shelves.length; i++) {
        for (const book of shelves[i]) await this.addBook({ ...book, placeId: created[i].id })
      }
      await this.syncDrawers(id, look)
      return id
    },

    async getBookcase(id: string): Promise<Bookcase | undefined> {
      const b = await db.bookcases.get(id)
      return b && b.deletedAt === null ? b : undefined
    },

    async updateBookcaseLook(id: string, look: Look): Promise<void> {
      await db.bookcases.update(id, { look, updatedAt: Date.now() })
      await this.syncDrawers(id, look)
    },

    /** ลิ้นชักของตู้ เรียงจากแถวล่างสุด ซ้ายไปขวา */
    async drawersOf(bookcaseId: string): Promise<Place[]> {
      return drawers(bookcaseId)
    },

    /** จำนวนหนังสือในลิ้นชักที่จะหายไปถ้าเปลี่ยนเป็นรูปทรงนี้ ใช้ถามก่อนบันทึก */
    async booksInRemovedDrawers(bookcaseId: string, look: Look): Promise<number> {
      const keep = drawerCount(look)
      const extra = (await drawers(bookcaseId)).slice(keep)
      let n = 0
      for (const d of extra) n += (await booksIn(d.id)).length
      return n
    },

    /**
     * ทำให้จำนวนลิ้นชักตรงกับรูปทรงตู้: เพิ่มที่ขาด ลบที่เกิน
     * หนังสือในลิ้นชักที่ถูกลบกลับไปเป็น "ยังไม่ระบุที่เก็บ"
     */
    async syncDrawers(bookcaseId: string, look: Look): Promise<void> {
      const want = drawerCount(look)
      await db.transaction('rw', db.places, db.books, async () => {
        // อ่านภายในธุรกรรม กันกดเร็ว ๆ แล้วได้ลิ้นชักซ้ำ
        const have = await drawers(bookcaseId)
        for (let i = have.length; i < want; i++) {
          await db.places.add({
            ...stamp(),
            kind: 'drawer',
            name: `ลิ้นชัก ${i + 1}`,
            bookcaseId,
            order: i,
            location: '',
            label: '',
          })
        }
        for (const d of have.slice(want)) await removePlace(db, d.id)
      })
    },

    async updateBookcase(id: string, input: BookcaseInput): Promise<void> {
      await db.bookcases.update(id, { ...input, updatedAt: Date.now() })
    },

    /** ลบตู้ = ลบชั้นวางทั้งหมดในตู้ หนังสือกลับไปเป็น "ยังไม่ระบุที่เก็บ" */
    async deleteBookcase(id: string): Promise<void> {
      await putCover(db, id, null)
      const shelves = alive(await db.places.where('bookcaseId').equals(id).toArray())
      await db.transaction('rw', db.bookcases, db.places, db.books, async () => {
        for (const s of shelves) await removePlace(db, s.id)
        const now = Date.now()
        await db.bookcases.update(id, { deletedAt: now, updatedAt: now })
      })
    },

    async addShelf(bookcaseId: string): Promise<string> {
      const shelves = alive(await db.places.where('bookcaseId').equals(bookcaseId).toArray()).filter(
        (p) => p.kind === 'shelf',
      )
      const order = shelves.reduce((m, s) => Math.max(m, s.order), -1) + 1
      const shelf: Place = {
        ...stamp(),
        kind: 'shelf',
        name: `ชั้นที่ ${order + 1}`,
        bookcaseId,
        order,
        location: '',
        label: '',
        // ตู้ที่วางซ้อนสองแถวทุกชั้น ชั้นใหม่ก็ซ้อนสองแถวด้วย
        ...(shelves.length > 0 && shelves.every((s) => s.rows === 2) && { rows: 2 as const }),
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
      await putCover(db, id, null)
      await db.transaction('rw', db.places, db.books, () => removePlace(db, id))
    },
  }
}

async function removePlace(db: GongDongDB, id: string): Promise<void> {
  const now = Date.now()
  const books = (await db.books.where('placeId').equals(id).toArray())
    .filter((b) => b.deletedAt === null)
    .sort((a, b) => a.position - b.position)
  // ต่อท้ายรายการ "ยังไม่ระบุที่เก็บ" ตามลำดับเดิม ไม่ให้ตำแหน่งชนกับเล่มที่อยู่ก่อน
  const unplaced = (await db.books.toArray()).filter((b) => b.placeId === null && b.deletedAt === null && !b.takenAt)
  let next = unplaced.reduce((m, b) => Math.max(m, b.position + 1), 0)
  for (const b of books) await db.books.update(b.id, { placeId: null, position: next++, row: 0, updatedAt: now })
  await db.places.update(id, { deletedAt: now, updatedAt: now })
}

/** ตั้งหรือลบรูป โดยการลบเก็บเป็นเครื่องหมายลบ (blob = null) */
async function putCover(db: GongDongDB, id: string, blob: Blob | null): Promise<void> {
  const now = Date.now()
  const old = await db.covers.get(id)
  if (!blob && (!old || old.deletedAt !== null)) return
  await db.covers.put({
    id,
    blob,
    thumb: null,
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
    deletedAt: blob ? null : now,
  })
}

export const repo = createRepo()
