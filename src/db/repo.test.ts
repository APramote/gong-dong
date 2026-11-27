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
