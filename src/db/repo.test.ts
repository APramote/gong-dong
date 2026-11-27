import 'fake-indexeddb/auto'
import { beforeEach, expect, test } from 'vitest'
import { GongDongDB } from './db'
import { createRepo, emptyBook } from './repo'

let n = 0
let repo: ReturnType<typeof createRepo>

beforeEach(() => {
  repo = createRepo(new GongDongDB(`test-${n++}`))
})

const titles = async (placeId: string | null) => (await repo.booksIn(placeId)).map((b) => b.title)

test('สร้างตู้พร้อมชั้นวางตามจำนวน และเพิ่มชั้นได้', async () => {
  const id = await repo.addBookcase({ name: 'ตู้ A', room: 'ห้องนอน' }, 3)
  await repo.addShelf(id)
  const shelves = (await repo.listPlaces()).filter((p) => p.bookcaseId === id)
  expect(shelves.map((s) => s.name)).toEqual(['ชั้นที่ 1', 'ชั้นที่ 2', 'ชั้นที่ 3', 'ชั้นที่ 4'])
})

test('หนังสือเรียงตามลำดับที่เพิ่ม และสลับลำดับได้', async () => {
  const pile = await repo.addPlace('pile', { name: 'ข้างเตียง', location: '', label: '' })
  for (const title of ['ก', 'ข', 'ค']) await repo.addBook({ ...emptyBook, title, placeId: pile })
  const [, second] = await repo.booksIn(pile)
  await repo.shiftBook(second.id, -1)
  expect(await titles(pile)).toEqual(['ข', 'ก', 'ค'])
  await repo.shiftBook(second.id, -1) // อยู่บนสุดแล้ว ไม่เปลี่ยน
  expect(await titles(pile)).toEqual(['ข', 'ก', 'ค'])
})

test('ย้ายหนังสือไปต่อท้ายที่เก็บใหม่', async () => {
  const pile = await repo.addPlace('pile', { name: 'กอง', location: '', label: '' })
  const box = await repo.addPlace('box', { name: 'กล่อง 1', location: 'ใต้บันได', label: 'นิยาย' })
  await repo.addBook({ ...emptyBook, title: 'อยู่ในกล่อง', placeId: box })
  const id = await repo.addBook({ ...emptyBook, title: 'ย้ายมา', placeId: pile })
  await repo.moveBook(id, box)
  expect(await titles(pile)).toEqual([])
  expect(await titles(box)).toEqual(['อยู่ในกล่อง', 'ย้ายมา'])
})

test('ลบตู้แล้วหนังสือไม่หาย แต่กลับไปยังไม่ระบุที่เก็บ', async () => {
  const bc = await repo.addBookcase({ name: 'ตู้ A', room: '' }, 2)
  const [shelf] = await repo.listPlaces()
  await repo.addBook({ ...emptyBook, title: 'เล่มหนึ่ง', placeId: shelf.id })
  await repo.deleteBookcase(bc)
  expect(await repo.listBookcases()).toEqual([])
  expect(await repo.listPlaces()).toEqual([])
  expect(await titles(null)).toEqual(['เล่มหนึ่ง'])
})

test('ลบหนังสือเป็นการทำเครื่องหมายลบ ไม่แสดงในรายการ', async () => {
  const id = await repo.addBook({ ...emptyBook, title: 'ลบทิ้ง' })
  await repo.deleteBook(id)
  expect(await repo.listBooks()).toEqual([])
  expect(await repo.getBook(id)).toBeUndefined()
})

test('เพิ่มหลายเล่มพร้อมกันเรียงตามลำดับที่ส่งมา', async () => {
  const [shelf] = await repo
    .addBookcase({ name: 'ตู้ B', room: '' }, 1)
    .then(() => repo.listPlaces())
  await repo.addBooks(['หนึ่ง', 'สอง', 'สาม'].map((title) => ({ ...emptyBook, title, placeId: shelf.id })))
  expect(await titles(shelf.id)).toEqual(['หนึ่ง', 'สอง', 'สาม'])
})

test('หยิบไปอ่านแล้ววางคืนที่อื่น บันทึกการอ่านและย้ายที่เก็บ', async () => {
  const shelf = await repo.addPlace('pile', { name: 'กอง A', location: '', label: '' })
  const box = await repo.addPlace('box', { name: 'กล่อง B', location: '', label: '' })
  const id = await repo.addBook({ ...emptyBook, title: 'เล่มอ่าน', pages: 300, currentPage: 20, placeId: shelf })
  await repo.addBook({ ...emptyBook, title: 'อยู่ในกล่องก่อน', placeId: box })

  await repo.takeBook(id)
  let book = (await repo.getBook(id))!
  expect(book.takenAt).not.toBeNull()
  expect(book.takenFrom).toBe(shelf)
  expect(book.status).toBe('reading')
  expect(await titles(shelf)).toEqual([])
  expect(await titles(null)).toEqual([]) // อยู่ในมือ ไม่นับเป็นยังไม่ระบุที่เก็บ
  await repo.takeBook(id) // หยิบซ้ำไม่สร้างรายการใหม่
  expect(await repo.sessionsFor(id)).toHaveLength(1)

  await repo.toggleTimer(id)
  expect((await repo.openSession(id))!.timerStartedAt).not.toBeNull()

  await repo.returnBook(id, { placeId: box, page: 85, minutes: 40, finished: false })
  book = (await repo.getBook(id))!
  expect(book).toMatchObject({ takenAt: null, placeId: box, currentPage: 85, status: 'reading' })
  expect(await titles(box)).toEqual(['อยู่ในกล่องก่อน', 'เล่มอ่าน'])
  const [s] = await repo.sessionsFor(id)
  expect(s).toMatchObject({ fromPlaceId: shelf, toPlaceId: box, startPage: 20, endPage: 85, minutes: 40, timerStartedAt: null })
  expect(s.endedAt).not.toBeNull()
  expect(await repo.openSession(id)).toBeUndefined()
})

test('วางคืนแบบอ่านจบ ตั้งสถานะและวันที่อ่านจบ แก้ฟอร์มทีหลังไม่ทับสถานะในมือ', async () => {
  const id = await repo.addBook({ ...emptyBook, title: 'จบแล้ว', pages: 120 })
  await repo.takeBook(id)
  // ฟอร์มที่เปิดค้างไว้ก่อนหยิบส่งค่า placeId เก่ามา ต้องไม่ทำให้หนังสือหลุดออกจากมือ
  const stale = (await repo.getBook(id))!
  await repo.updateBook(id, { ...stale, placeId: 'somewhere', note: 'โน้ต' })
  expect((await repo.getBook(id))!).toMatchObject({ placeId: null, note: 'โน้ต' })
  expect((await repo.getBook(id))!.takenAt).not.toBeNull()

  await repo.returnBook(id, { placeId: null, page: 100, minutes: null, finished: true })
  const book = (await repo.getBook(id))!
  expect(book).toMatchObject({ status: 'done', currentPage: 120 })
  expect(book.finishedAt).not.toBeNull()
})

test('ย้ายเลขชั้นจากนับบนลงล่างเป็นล่างขึ้นบน คงชื่อที่ตั้งเอง', async () => {
  const { flipShelfOrder } = await import('./migrations')
  const shelf = (id: string, order: number, name: string, bookcaseId = 'bc') =>
    ({ id, kind: 'shelf', bookcaseId, order, name, deletedAt: null, createdAt: 0, updatedAt: 0, location: '', label: '' }) as any
  const changed = flipShelfOrder(
    [
      shelf('top', 0, 'ชั้นที่ 1'),
      shelf('mid', 1, 'ชั้นการ์ตูน'),
      shelf('low', 2, 'ชั้นที่ 3'),
      shelf('only', 0, 'ชั้นที่ 1', 'other'), // ตู้ชั้นเดียว ไม่เปลี่ยน
      { ...shelf('gone', 3, 'ชั้นที่ 4'), deletedAt: 1 },
    ],
    5,
  )
  expect(changed.map((p) => [p.id, p.order, p.name])).toEqual([
    ['top', 2, 'ชั้นที่ 3'],
    ['low', 0, 'ชั้นที่ 1'],
  ])
  expect(changed[0].updatedAt).toBe(5)
})

test('เปิดฐานข้อมูลเวอร์ชันเก่าแล้วเลขชั้นถูกเปลี่ยนเป็นล่างขึ้นบน', async () => {
  const Dexie = (await import('dexie')).default
  const name = 'upgrade-test'
  const old = new Dexie(name)
  old.version(3).stores({
    books: 'id, placeId, status, updatedAt',
    bookcases: 'id, updatedAt',
    places: 'id, kind, bookcaseId, updatedAt',
    covers: 'id, updatedAt',
    sessions: 'id, bookId, updatedAt',
  })
  const base = { kind: 'shelf', bookcaseId: 'bc', deletedAt: null, createdAt: 0, updatedAt: 0, location: '', label: '' }
  await old.table('places').bulkAdd([
    { ...base, id: 'top', order: 0, name: 'ชั้นที่ 1' },
    { ...base, id: 'low', order: 1, name: 'ชั้นที่ 2' },
  ])
  old.close()
  const fresh = createRepo(new GongDongDB(name))
  const shelves = await fresh.listPlaces()
  expect(shelves.map((s) => [s.id, s.order, s.name])).toEqual([
    ['low', 0, 'ชั้นที่ 1'],
    ['top', 1, 'ชั้นที่ 2'],
  ])
})

test('ลิ้นชักเป็นที่เก็บ: สร้างตามรูปทรงตู้ ลดจำนวนแล้วหนังสือไม่หาย และไม่ปนกับชั้น', async () => {
  const look = { color: '', ratio: 0, drawerRows: 1, drawersPerRow: 2 }
  const id = await repo.addBookcaseWithBooks({ name: 'ตู้ลิ้นชัก', room: '' }, look, [[{ ...emptyBook, title: 'บนชั้น' }]])
  let drawers = await repo.drawersOf(id)
  expect(drawers.map((d) => [d.name, d.order, d.kind])).toEqual([
    ['ลิ้นชัก 1', 0, 'drawer'],
    ['ลิ้นชัก 2', 1, 'drawer'],
  ])
  await repo.addBook({ ...emptyBook, title: 'ในลิ้นชัก 2', placeId: drawers[1].id })
  // เพิ่มชั้นไม่ชนเลขกับลิ้นชัก
  await repo.addShelf(id)
  const shelves = (await repo.listPlaces()).filter((p) => p.bookcaseId === id && p.kind === 'shelf')
  expect(shelves.map((s) => s.name)).toEqual(['ชั้นที่ 1', 'ชั้นที่ 2'])

  const fewer = { ...look, drawersPerRow: 1 }
  expect(await repo.booksInRemovedDrawers(id, fewer)).toBe(1)
  await repo.updateBookcaseLook(id, fewer)
  drawers = await repo.drawersOf(id)
  expect(drawers.map((d) => d.name)).toEqual(['ลิ้นชัก 1'])
  expect(await titles(null)).toEqual(['ในลิ้นชัก 2'])

  await repo.updateBookcaseLook(id, { ...look, drawerRows: 2, drawersPerRow: 2 })
  expect((await repo.drawersOf(id)).map((d) => d.name)).toEqual(['ลิ้นชัก 1', 'ลิ้นชัก 2', 'ลิ้นชัก 3', 'ลิ้นชัก 4'])
})

test('หมวดหนังสือ: สร้างไม่ซ้ำ เปลี่ยนชื่อ รวมหมวด และลบโดยหนังสือไม่หาย', async () => {
  const novel = await repo.ensureCategory('  นิยาย ')
  expect(await repo.ensureCategory('นิยาย')).toBe(novel)
  const fiction = await repo.ensureCategory('Fiction')
  expect(await repo.ensureCategory('fiction')).toBe(fiction)
  const a = await repo.addBook({ ...emptyBook, title: 'ก', categoryId: novel })
  const b = await repo.addBook({ ...emptyBook, title: 'ข', categoryId: fiction })
  await repo.setCategoryByName(a, 'นิยาย')
  expect((await repo.getBook(a))!.categoryId).toBe(novel)

  // เปลี่ยนชื่อเฉย ๆ
  expect(await repo.renameCategory(fiction, 'นิยายแปล')).toBe(fiction)
  // เปลี่ยนชื่อให้ตรงกับหมวดที่มีอยู่ = รวมหมวด
  expect(await repo.renameCategory(fiction, 'นิยาย')).toBe(novel)
  expect((await repo.getBook(b))!.categoryId).toBe(novel)
  expect((await repo.listCategories()).map((c) => c.name)).toEqual(['นิยาย'])

  await repo.deleteCategory(novel)
  expect(await repo.listCategories()).toEqual([])
  expect((await repo.getBook(a))!.categoryId).toBeNull()
  expect(await titles(null)).toEqual(['ก', 'ข'])
})

test('เปิดฐานข้อมูลเวอร์ชันที่หมวดเป็นข้อความ แล้วหมวดย้ายเข้าตารางหมวด', async () => {
  const Dexie = (await import('dexie')).default
  const name = 'category-upgrade'
  const old = new Dexie(name)
  old.version(4).stores({
    books: 'id, placeId, status, updatedAt',
    bookcases: 'id, updatedAt',
    places: 'id, kind, bookcaseId, updatedAt',
    covers: 'id, updatedAt',
    sessions: 'id, bookId, updatedAt',
  })
  const book = (id: string, category: string) => ({ ...emptyBook, id, title: id, category, createdAt: 0, updatedAt: 0, deletedAt: null, position: 0, placeId: null })
  await old.table('books').bulkAdd([book('x', 'นิยาย'), book('y', ' นิยาย  '), book('z', 'Fiction'), book('w', 'fiction'), book('v', '')])
  old.close()
  const fresh = createRepo(new GongDongDB(name))
  const cats = await fresh.listCategories()
  // ชื่อที่ต่างกันแค่ตัวพิมพ์รวมเป็นหมวดเดียว ใช้ตัวสะกดที่พบก่อน
  expect(cats.map((c) => c.name.toLowerCase()).sort()).toEqual(['fiction', 'นิยาย'])
  const id = (n: string) => cats.find((c) => c.name.toLowerCase() === n.toLowerCase())!.id
  const got = Object.fromEntries((await fresh.listBooks()).map((b) => [b.id, b.categoryId]))
  expect(got).toEqual({ x: id('นิยาย'), y: id('นิยาย'), z: id('Fiction'), w: id('Fiction'), v: null })
  expect('category' in (await fresh.getBook('x'))!).toBe(false)
})

test('ผลจากการตรวจ: ลบที่เก็บแล้วหนังสือต่อท้ายรายการไม่มีที่เก็บ ไม่ชนตำแหน่ง', async () => {
  await repo.addBook({ ...emptyBook, title: 'A' })
  await repo.addBook({ ...emptyBook, title: 'B' })
  const pile = await repo.addPlace('pile', { name: 'กอง', location: '', label: '' })
  await repo.addBooks(['C', 'D'].map((title) => ({ ...emptyBook, title, placeId: pile })))
  await repo.deletePlace(pile)
  const rows = await repo.booksIn(null)
  expect(rows.map((b) => b.title)).toEqual(['A', 'B', 'C', 'D'])
  expect(new Set(rows.map((b) => b.position)).size).toBe(4)
})

test('ผลจากการตรวจ: ลบรูปปกเก็บเป็นเครื่องหมายลบ', async () => {
  const id = await repo.addBook({ ...emptyBook, title: 'มีปก' })
  await repo.setCover(id, new Blob(['x']))
  expect(await repo.getCover(id)).toBeInstanceOf(Blob)
  await repo.setCover(id, null)
  expect(await repo.getCover(id)).toBeUndefined()
})

test('ผลจากการตรวจ: กดซ้ำเร็ว ๆ ไม่ได้ลิ้นชักหรือหมวดซ้ำ', async () => {
  const bc = await repo.addBookcase({ name: 'ตู้', room: '' }, 1)
  const look = { color: '', ratio: 0, drawerRows: 2, drawersPerRow: 2 }
  await Promise.all([repo.updateBookcaseLook(bc, look), repo.updateBookcaseLook(bc, look)])
  const drawers = await repo.drawersOf(bc)
  expect(drawers.map((d) => d.order)).toEqual([0, 1, 2, 3])
  const ids = await Promise.all([repo.ensureCategory('นิยาย'), repo.ensureCategory('นิยาย ')])
  expect(ids[0]).toBe(ids[1])
  expect(await repo.listCategories()).toHaveLength(1)
})

test('ผลจากการตรวจ: วางคืนโดยไม่จบ ล้างวันที่อ่านจบ และที่ถูกลบไปแล้วไม่รับหนังสือ', async () => {
  const id = await repo.addBook({ ...emptyBook, title: 'อ่านซ้ำ', status: 'done' })
  expect((await repo.getBook(id))!.finishedAt).not.toBeNull()
  const box = await repo.addPlace('box', { name: 'กล่อง', location: '', label: '' })
  await repo.takeBook(id)
  await repo.deletePlace(box) // ที่วางคืนถูกลบระหว่างหยิบไปอ่าน
  await repo.returnBook(id, { placeId: box, page: 10, minutes: 5, finished: false })
  const b = (await repo.getBook(id))!
  expect(b).toMatchObject({ status: 'reading', finishedAt: null, placeId: null })
  await repo.moveBook(id, box)
  expect((await repo.getBook(id))!.placeId).toBeNull()
})

test('ผลจากการตรวจ: ลบหนังสือที่อยู่ในมือ ไม่ทิ้งการหยิบค้างไว้', async () => {
  const id = await repo.addBook({ ...emptyBook, title: 'หยิบแล้วลบ' })
  await repo.takeBook(id)
  await repo.deleteBook(id)
  expect(await repo.openSession(id)).toBeUndefined()
  expect(await repo.listSessions()).toEqual([])
})

test('ผลจากการตรวจ: อัปเกรดตารางรูปปกเดิมให้มีฟิลด์ sync', async () => {
  const Dexie = (await import('dexie')).default
  const name = 'cover-upgrade'
  const old = new Dexie(name)
  old.version(5).stores({
    books: 'id, placeId, status, categoryId, updatedAt',
    bookcases: 'id, updatedAt',
    places: 'id, kind, bookcaseId, updatedAt',
    covers: 'id, updatedAt',
    sessions: 'id, bookId, updatedAt',
    categories: 'id, name, updatedAt',
  })
  await old.table('covers').add({ id: 'c1', blob: new Blob(['x']), updatedAt: 42 })
  old.close()
  const fresh = new GongDongDB(name)
  expect(await fresh.covers.get('c1')).toMatchObject({ createdAt: 42, updatedAt: 42, deletedAt: null })
  expect(await createRepo(fresh).getCover('c1')).toBeInstanceOf(Blob)
})

test('รายการอยากได้: ซื้อแล้วกลายเป็นเล่มดองในคลัง', async () => {
  const pile = await repo.addPlace('pile', { name: 'กองใหม่', location: '', label: '' })
  const wid = await repo.addWish({ title: '  ปีศาจ ', authors: 'เสนีย์ เสาวพงศ์', isbn: '9789740000000', note: 'ร้านเล็ก' })
  expect((await repo.listWishes()).map((w) => w.title)).toEqual(['ปีศาจ'])
  const id = await repo.wishToBook(wid, pile)
  const book = await repo.getBook(id!)
  expect(book).toMatchObject({ title: 'ปีศาจ', authors: 'เสนีย์ เสาวพงศ์', status: 'dong', placeId: pile, note: 'ร้านเล็ก' })
  expect(book!.boughtAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(await repo.listWishes()).toEqual([])
  // กดซ้ำไม่สร้างเล่มซ้ำ
  expect(await repo.wishToBook(wid)).toBeUndefined()
  expect((await repo.listBooks()).length).toBe(1)
})

test('หนังสือเก่าที่ไม่มีฟิลด์ใหม่ได้ค่าเริ่มต้น', async () => {
  const id = await repo.addBook({ ...emptyBook, title: 'เก่า' })
  const b = await repo.getBook(id)
  expect(b).toMatchObject({ seriesId: null, seriesNo: null, price: null, signed: false, edition: '' })
})
