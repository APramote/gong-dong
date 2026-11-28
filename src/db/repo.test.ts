import 'fake-indexeddb/auto'
import { beforeEach, expect, test, vi } from 'vitest'
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
  const rows = await repo.sessionsFor(id)
  // การหยิบติดตัว (ย้ายที่) กับการอ่าน (หน้าและเวลา) เป็นคนละรายการ
  const carry = rows.find((r) => r.kind === 'carry')!
  const read = rows.find((r) => r.kind === 'read')!
  expect(rows).toHaveLength(2)
  expect(carry).toMatchObject({ fromPlaceId: shelf, toPlaceId: box, endPage: null, minutes: null, timerStartedAt: null })
  expect(carry.endedAt).not.toBeNull()
  expect(read).toMatchObject({ startPage: 20, endPage: 85, minutes: 40 })
  expect(read.estimated).toBeUndefined()
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

test('ชุดหนังสือ: ใช้ชื่อเดิมได้ชุดเดิม ลบชุดแล้วหนังสือยังอยู่', async () => {
  const a = await repo.ensureSeries('  แฮร์รี่  พอตเตอร์ ')
  expect(await repo.ensureSeries('แฮร์รี่ พอตเตอร์')).toBe(a)
  const id = await repo.addBook({ ...emptyBook, title: 'เล่ม 1', seriesId: a, seriesNo: 1 })
  await repo.deleteSeries(a)
  expect(await repo.listSeries()).toEqual([])
  expect(await repo.getBook(id)).toMatchObject({ title: 'เล่ม 1', seriesId: null, seriesNo: null })
})

test('ประโยคที่ชอบ: ลบหนังสือแล้วประโยคของเล่มนั้นหายไปด้วย', async () => {
  const id = await repo.addBook({ ...emptyBook, title: 'ข้างหลังภาพ' })
  const other = await repo.addBook({ ...emptyBook, title: 'อื่น' })
  await repo.addQuote({ bookId: id, text: ' ฉันตายโดยปราศจากคนที่รักฉัน ', page: 120, note: '' })
  await repo.addQuote({ bookId: other, text: 'อีกเล่ม', page: null, note: '' })
  expect((await repo.listQuotes(id)).map((q) => q.text)).toEqual(['ฉันตายโดยปราศจากคนที่รักฉัน'])
  await repo.deleteBook(id)
  expect((await repo.listQuotes()).map((q) => q.text)).toEqual(['อีกเล่ม'])
})

test('ชุดหนังสือ: เปลี่ยนชื่อซ้ำกับชุดอื่นไม่ได้ และเพิ่มรายการอยากได้ซ้ำไม่ได้', async () => {
  const a = await repo.ensureSeries('ก')
  await repo.ensureSeries('ข')
  expect(await repo.updateSeries(a, { name: ' ข ' })).toBe(false)
  expect(await repo.updateSeries(a, { name: 'ค', total: 5 })).toBe(true)
  expect((await repo.getSeries(a))!).toMatchObject({ name: 'ค', total: 5 })
  const w = { authors: '', isbn: '', note: '' }
  expect(await repo.addWishes([{ ...w, title: 'ค เล่ม 1' }, { ...w, title: 'ค เล่ม 2' }])).toBe(2)
  expect(await repo.addWishes([{ ...w, title: 'ค เล่ม 2' }, { ...w, title: 'ค เล่ม 3' }])).toBe(1)
  expect((await repo.listWishes()).length).toBe(3)
})

test('คั่นหน้า: บันทึกการอ่านหลายครั้งโดยไม่ต้องวางคืน เวลาประมาณจากจำนวนหน้า', async () => {
  const id = await repo.addBook({ ...emptyBook, title: 'พกติดตัว', pages: 300 })
  await repo.takeBook(id)
  await repo.checkIn(id, { page: 20, minutes: null }) // ไม่ใส่เวลา = ประมาณ 1.5 นาที/หน้า
  await repo.checkIn(id, { page: 60, minutes: 40 }) // ใส่เวลาเอง = ได้ความเร็วจริง 1 นาที/หน้า
  await repo.checkIn(id, { page: 90, minutes: null }) // ประมาณจากความเร็วจริง
  const reads = (await repo.sessionsFor(id)).filter((r) => r.kind === 'read').sort((a, b) => a.endPage! - b.endPage!)
  expect(reads.map((r) => [r.startPage, r.endPage, r.minutes, r.estimated ?? false])).toEqual([
    [null, 20, 30, true],
    [20, 60, 40, false],
    [60, 90, 30, true],
  ])
  const book = (await repo.getBook(id))!
  expect(book).toMatchObject({ currentPage: 90, status: 'reading' })
  expect(book.takenAt).not.toBeNull() // ยังอยู่กับตัว
  // วางคืนโดยหน้าไม่เปลี่ยน ไม่สร้างการอ่านซ้ำ
  await repo.returnBook(id, { placeId: null, page: 90, minutes: null, finished: false })
  expect((await repo.sessionsFor(id)).filter((r) => r.kind === 'read')).toHaveLength(3)
  expect((await repo.sessionsFor(id)).filter((r) => r.kind === 'carry')[0].endedAt).not.toBeNull()
})

test('คั่นหน้า: ใช้เวลาที่จับไว้ แล้วเริ่มนับใหม่', async () => {
  const id = await repo.addBook({ ...emptyBook, title: 'จับเวลา', pages: 200 })
  await repo.takeBook(id)
  const start = Date.now()
  const clock = vi.spyOn(Date, 'now')
  try {
    clock.mockReturnValue(start)
    await repo.toggleTimer(id)
    clock.mockReturnValue(start + 12 * 60000) // อ่านไป 12 นาที นาฬิกายังเดินอยู่
    await repo.checkIn(id, { page: 10, minutes: null })
  } finally {
    clock.mockRestore()
  }
  const read = (await repo.sessionsFor(id)).find((r) => r.kind === 'read')!
  expect(read.minutes).toBe(12)
  expect(read.estimated).toBeUndefined() // เวลาจริง ไม่ใช่ค่าประมาณ
  expect((await repo.openSession(id))!).toMatchObject({ timerMs: 0, timerStartedAt: null })
})

test('ผลจากการตรวจ: คั่นหน้าโดยไม่มีอะไรเปลี่ยนไม่สร้างรายการเปล่า และค่าประมาณมีเพดาน', async () => {
  const id = await repo.addBook({ ...emptyBook, title: 'เล่มหนา', pages: 900 })
  await repo.takeBook(id)
  await repo.checkIn(id, { page: 500, minutes: null }) // คั่นครั้งแรกกลางเล่ม
  const [first] = (await repo.sessionsFor(id)).filter((r) => r.kind === 'read')
  expect(first.minutes).toBe(180) // ไม่ใช่ 750 นาที
  await repo.checkIn(id, { page: 500, minutes: null }) // กดบันทึกโดยไม่เปลี่ยนอะไร
  expect((await repo.sessionsFor(id)).filter((r) => r.kind === 'read')).toHaveLength(1)
  await repo.checkIn(id, { page: 480, minutes: null }) // แก้เลขหน้าย้อนกลับ = แค่แก้ที่คั่น
  expect((await repo.sessionsFor(id)).filter((r) => r.kind === 'read')).toHaveLength(1)
  expect((await repo.getBook(id))!.currentPage).toBe(480)
})

test('ผลจากการตรวจ: อ่านซ้ำเล่มที่จบแล้วนับหน้าใหม่ และหยิบมาเปิดดูเฉย ๆ ไม่เปลี่ยนวันที่อ่านจบ', async () => {
  const id = await repo.addBook({ ...emptyBook, title: 'เล่มโปรด', pages: 300, currentPage: 300, status: 'done' })
  const finishedAt = (await repo.getBook(id))!.finishedAt
  await repo.takeBook(id)
  await repo.returnBook(id, { placeId: null, page: 300, minutes: null, finished: true }) // แค่หยิบมาเปิดดู
  expect((await repo.getBook(id))!).toMatchObject({ status: 'done', finishedAt })
  await repo.takeBook(id)
  await repo.checkIn(id, { page: 40, minutes: 30 }) // เริ่มอ่านรอบใหม่
  const read = (await repo.sessionsFor(id)).find((r) => r.kind === 'read')!
  expect(read).toMatchObject({ startPage: null, endPage: 40 })
  expect((await repo.getBook(id))!).toMatchObject({ status: 'reading', currentPage: 40, finishedAt: null })
})

test('ผลจากการตรวจ: ตำแหน่งซ้ำกันหลังซิงก์ ยังเลื่อนลำดับได้', async () => {
  const db = new GongDongDB(`tie-${n++}`)
  const r = createRepo(db)
  const pile = await r.addPlace('pile', { name: 'กอง', location: '', label: '' })
  const ids: string[] = []
  for (const title of ['ก', 'ข', 'ค']) ids.push(await r.addBook({ ...emptyBook, title, placeId: pile }))
  // จำลองสองเครื่องเพิ่มเล่มลงกองเดียวกัน: ตำแหน่งซ้ำกัน
  await db.books.update(ids[1], { position: 0 })
  const before = (await r.booksIn(pile)).map((x) => x.id)
  await r.shiftBook(before[0], 1)
  const after = await r.booksIn(pile)
  expect(after.map((x) => x.id)).toEqual([before[1], before[0], before[2]])
  expect(after.map((x) => x.position)).toEqual([0, 1, 2])
})

test('รวมหมวด: หนังสือย้ายไปหมวดปลายทาง หมวดต้นทางหายไป', async () => {
  const a = await repo.ensureCategory('นิยายแปล')
  const b = await repo.ensureCategory('นิยาย')
  const id = await repo.addBook({ ...emptyBook, title: 'เล่ม', categoryId: a })
  await repo.mergeCategory(a, b)
  expect((await repo.getBook(id))!.categoryId).toBe(b)
  expect((await repo.listCategories()).map((c) => c.name)).toEqual(['นิยาย'])
  await repo.mergeCategory(b, a) // ปลายทางถูกลบไปแล้ว ไม่ทำอะไร
  expect((await repo.getBook(id))!.categoryId).toBe(b)
  expect((await repo.listCategories()).length).toBe(1)
})

test('จัดลำดับในที่เก็บตามรายการ: เล่มที่ไม่อยู่ในรายการต่อท้ายตามลำดับเดิม', async () => {
  const pile = await repo.addPlace('pile', { name: 'กอง', location: '', label: '' })
  const ids: Record<string, string> = {}
  for (const title of ['ก', 'ข', 'ค', 'ง']) ids[title] = await repo.addBook({ ...emptyBook, title, placeId: pile })
  expect(await repo.setOrder(pile, [ids['ค'], ids['ก']])).toBeGreaterThan(0)
  expect(await titles(pile)).toEqual(['ค', 'ก', 'ข', 'ง'])
  expect(await repo.setOrder(pile, [ids['ค'], ids['ก']])).toBe(0) // ลำดับเดิมแล้ว ไม่แตะอะไร
})

test('ย้ายหลายเล่มพร้อมกัน: ต่อท้ายตามลำดับ ข้ามเล่มในมือและเล่มที่อยู่ที่นั้นแล้ว', async () => {
  const shelf = await repo.addPlace('pile', { name: 'ปลายทาง', location: '', label: '' })
  const gone = await repo.addPlace('box', { name: 'ถูกลบ', location: '', label: '' })
  await repo.addBook({ ...emptyBook, title: 'อยู่ก่อน', placeId: shelf })
  const a = await repo.addBook({ ...emptyBook, title: 'ก' })
  const b = await repo.addBook({ ...emptyBook, title: 'ข' })
  const hand = await repo.addBook({ ...emptyBook, title: 'ในมือ' })
  const there = await repo.addBook({ ...emptyBook, title: 'อยู่แล้ว', placeId: shelf })
  await repo.takeBook(hand)
  expect(await repo.moveBooks([b, hand, there, a, 'ไม่มีจริง'], shelf)).toBe(2)
  expect(await titles(shelf)).toEqual(['อยู่ก่อน', 'อยู่แล้ว', 'ข', 'ก'])
  expect((await repo.getBook(hand))!.takenAt).not.toBeNull()
  await repo.deletePlace(gone)
  expect(await repo.moveBooks([a, b], gone)).toBe(0) // ที่ปลายทางถูกลบไปแล้ว ไม่ย้าย
  expect(await repo.moveBooks([a], null)).toBe(1) // ย้ายออกเป็นยังไม่ระบุที่เก็บได้
})

test('ตั้งหมวดและเปลี่ยนสถานะหลายเล่มพร้อมกัน', async () => {
  const cat = await repo.ensureCategory('นิยาย')
  const a = await repo.addBook({ ...emptyBook, title: 'ก' })
  const b = await repo.addBook({ ...emptyBook, title: 'ข', categoryId: cat })
  const done = await repo.addBook({ ...emptyBook, title: 'จบแล้ว', status: 'done' })
  expect(await repo.setCategoryMany([a, b, 'ไม่มีจริง'], cat)).toBe(1) // ข อยู่หมวดนี้แล้ว
  expect((await repo.getBook(a))!.categoryId).toBe(cat)
  expect(await repo.setCategoryMany([a, b], null)).toBe(2)
  const before = (await repo.getBook(done))!.finishedAt
  expect(await repo.setStatusMany([a, done], 'done')).toBe(1) // เล่มที่จบอยู่แล้วไม่ถูกแตะ วันที่อ่านจบคงเดิม
  expect((await repo.getBook(a))!.finishedAt).not.toBeNull()
  expect((await repo.getBook(done))!.finishedAt).toBe(before)
  expect(await repo.setStatusMany([a, done], 'dong')).toBe(2)
  expect((await repo.getBook(done))!).toMatchObject({ status: 'dong', finishedAt: null })
})

test('ชั้นวางซ้อนสองแถว: ย้ายไปแถวหลัง เลื่อนภายในแถว และกลับเป็นแถวเดียว', async () => {
  const db = new GongDongDB(`rows-${n++}`)
  const r = createRepo(db)
  const caseId = await r.addBookcase({ name: 'ตู้', room: '' }, 1)
  const shelf = (await r.listPlaces()).find((p) => p.bookcaseId === caseId)!
  const ids: Record<string, string> = {}
  for (const title of ['ก', 'ข', 'ค', 'ง']) ids[title] = await r.addBook({ ...emptyBook, title, placeId: shelf.id })
  await r.setShelfWidth(caseId, 80)
  await r.setShelfShape(shelf.id, { rows: 2, width: 60 })
  expect((await r.listBookcases())[0].shelfWidth).toBe(80)
  expect((await r.getPlace(shelf.id))!).toMatchObject({ rows: 2, width: 60 })
  await r.setRow(ids['ข'], 1)
  await r.setRow(ids['ง'], 1)
  const rowOf = async (row: number) => (await r.booksIn(shelf.id)).filter((b) => (b.row ?? 0) === row).map((b) => b.title)
  expect(await rowOf(0)).toEqual(['ก', 'ค'])
  expect(await rowOf(1)).toEqual(['ข', 'ง'])
  // เลื่อนภายในแถวหน้า: ก กับ ค สลับกัน ไม่ข้ามไปยุ่งกับแถวหลัง
  await r.shiftBook(ids['ก'], 1)
  expect(await rowOf(0)).toEqual(['ค', 'ก'])
  expect(await rowOf(1)).toEqual(['ข', 'ง'])
  await r.shiftBook(ids['ก'], 1) // อยู่ท้ายแถวแล้ว ไม่เปลี่ยน
  expect(await rowOf(0)).toEqual(['ค', 'ก'])
  // ย้ายออกไปที่อื่นแล้วกลับมา เริ่มที่แถวหน้า
  const pile = await r.addPlace('pile', { name: 'กอง', location: '', label: '' })
  await r.moveBook(ids['ข'], pile)
  expect((await r.getBook(ids['ข']))!.row ?? 0).toBe(0)
  // กลับเป็นแถวเดียว: เล่มแถวหลังมารวมแถวหน้า
  await r.setShelfShape(shelf.id, { rows: 1 })
  expect((await r.booksIn(shelf.id)).every((b) => (b.row ?? 0) === 0)).toBe(true)
})

test('ตั้งสองแถวทั้งตู้: ทุกชั้นเปลี่ยนตาม และกลับเป็นแถวเดียวพาเล่มแถวหลังมาแถวหน้า', async () => {
  const db = new GongDongDB(`caserows-${n++}`)
  const r = createRepo(db)
  const caseId = await r.addBookcase({ name: 'ตู้', room: '' }, 3)
  const shelves = (await r.listPlaces()).filter((p) => p.bookcaseId === caseId)
  const book = await r.addBook({ ...emptyBook, title: 'ก', placeId: shelves[1].id })
  await r.setBookcaseRows(caseId, 2)
  expect((await r.listPlaces()).filter((p) => p.bookcaseId === caseId).every((p) => p.rows === 2)).toBe(true)
  await r.setRow(book, 1)
  await r.setBookcaseRows(caseId, 1)
  expect((await r.listPlaces()).filter((p) => p.bookcaseId === caseId).every((p) => p.rows === 1)).toBe(true)
  expect((await r.getBook(book))!.row ?? 0).toBe(0)
})

test('ย้ายหลายเล่มเข้าชั้นสองแถว: แถวหน้าเต็มแล้วไปแถวหลัง และชั้นใหม่ของตู้ซ้อนทั้งตู้ก็ซ้อนด้วย', async () => {
  const db = new GongDongDB(`spill-${n++}`)
  const r = createRepo(db)
  const caseId = await r.addBookcase({ name: 'ตู้', room: '' }, 1)
  const shelf = (await r.listPlaces()).find((p) => p.bookcaseId === caseId)!
  await r.setShelfWidth(caseId, 10)
  await r.setBookcaseRows(caseId, 2)
  // เล่มละ 300 หน้า หนาราว 2.7 ซม. ชั้นกว้าง 10 ซม. วางได้แถวละ 3 เล่ม
  const ids: string[] = []
  for (let i = 0; i < 7; i++) ids.push(await r.addBook({ ...emptyBook, title: `เล่ม ${i}`, pages: 300 }))
  expect(await r.moveBooks(ids, shelf.id)).toBe(7)
  const rows = (await r.booksIn(shelf.id)).map((b) => b.row ?? 0)
  // 3 เล่มแถวหน้า 3 เล่มแถวหลัง เล่มที่ล้นทั้งสองแถวอยู่แถวหน้า
  expect(rows).toEqual([0, 0, 0, 1, 1, 1, 0])
  const added = await r.addShelf(caseId)
  expect((await r.getPlace(added))!.rows).toBe(2)
})

test('ให้คะแนน: ดาวและมะเขือเก็บในช่องเดียว แก้ไขหนังสือแล้วคะแนนไม่หาย', async () => {
  const db = new GongDongDB(`rating-${n++}`)
  const r = createRepo(db)
  const id = await r.addBook({ ...emptyBook, title: 'ก' })
  await r.setRating(id, 4)
  expect((await r.getBook(id))!.rating).toBe(4)
  await r.updateBook(id, { ...emptyBook, title: 'ข' })
  expect((await r.getBook(id))!).toMatchObject({ title: 'ข', rating: 4 })
  await r.setRating(id, -9)
  expect((await r.getBook(id))!.rating).toBe(-5)
  await r.setRating(id, 0)
  expect((await r.getBook(id))!.rating).toBe(0)
})
