import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { GongDongDB } from '../db/db'
import { createRepo, emptyBook } from '../db/repo'
import { exportBackup, importBackup, parseSnapshot, syncAll, wipeLocal, wipeRemote, type RemoteStore } from './sync'

let n = 0
const device = () => {
  const db = new GongDongDB(`sync-${n++}`)
  return { db, repo: createRepo(db) }
}

/** ที่เก็บกลางจำลองในหน่วยความจำ */
function memoryStore(): RemoteStore & { files: Map<string, Blob> } {
  const files = new Map<string, Blob>()
  return {
    files,
    names: async () => new Set(files.keys()),
    get: async (name) => files.get(name) ?? null,
    put: async (name, blob) => void files.set(name, blob),
    del: async (name) => void files.delete(name),
  }
}

const tick = () => new Promise((r) => setTimeout(r, 3))

test('ซิงก์สองเครื่อง: ข้อมูลไปครบ แก้ล่าสุดชนะ ลบแล้วไม่กลับมา', async () => {
  const a = device()
  const b = device()
  const drive = memoryStore()
  const pile = await a.repo.addPlace('pile', { name: 'ข้างเตียง', location: '', label: '' })
  const id = await a.repo.addBook({ ...emptyBook, title: 'เล่มหนึ่ง', placeId: pile })
  const gone = await a.repo.addBook({ ...emptyBook, title: 'จะถูกลบ' })
  await a.repo.addWish({ title: 'อยากได้', authors: '', isbn: '', note: '' })

  expect(await syncAll(a.db, drive)).toMatchObject({ pulled: 0 })
  expect((await syncAll(b.db, drive)).pulled).toBe(4)
  expect((await b.repo.listBooks()).map((x) => x.title).sort()).toEqual(['จะถูกลบ', 'เล่มหนึ่ง'])
  expect((await b.repo.booksIn(pile)).map((x) => x.title)).toEqual(['เล่มหนึ่ง'])

  // แก้คนละเครื่อง: เครื่อง B แก้ทีหลัง ต้องชนะ และ B ลบอีกเล่ม
  await tick()
  await a.repo.updateBook(id, { ...(await a.repo.getBook(id))!, note: 'จาก A' })
  await tick()
  await b.repo.updateBook(id, { ...(await b.repo.getBook(id))!, note: 'จาก B' })
  await b.repo.deleteBook(gone)
  await syncAll(b.db, drive)
  await syncAll(a.db, drive)
  expect((await a.repo.getBook(id))!.note).toBe('จาก B')
  expect((await a.repo.listBooks()).map((x) => x.title)).toEqual(['เล่มหนึ่ง'])
  // ซิงก์ซ้ำเมื่อไม่มีอะไรเปลี่ยน ไม่มีการรับส่ง
  expect(await syncAll(a.db, drive)).toEqual({ pushed: 0, pulled: 0 })
  expect(await syncAll(b.db, drive)).toEqual({ pushed: 0, pulled: 0 })
})

test('ซิงก์รูปปก: ส่งขึ้น รับลง และการลบรูปตามไปอีกเครื่อง', async () => {
  const a = device()
  const b = device()
  const drive = memoryStore()
  const id = await a.repo.addBook({ ...emptyBook, title: 'มีปก' })
  await a.repo.setCover(id, new Blob(['รูป'], { type: 'image/jpeg' }))
  await syncAll(a.db, drive)
  expect(drive.files.has(`cover-${id}`)).toBe(true)
  await syncAll(b.db, drive)
  expect(await (await b.repo.getCover(id))!.text()).toBe('รูป')

  await tick()
  await b.repo.setCover(id, null)
  await syncAll(b.db, drive)
  expect(drive.files.has(`cover-${id}`)).toBe(false)
  await syncAll(a.db, drive)
  expect(await a.repo.getCover(id)).toBeUndefined()
})

test('ไฟล์สำรอง: กู้คืนในเครื่องใหม่ได้ครบ และไฟล์แปลกปลอมถูกปฏิเสธ', async () => {
  const a = device()
  const b = device()
  const id = await a.repo.addBook({ ...emptyBook, title: 'สำรอง' })
  await a.repo.setCover(id, new Blob(['ปก'], { type: 'image/jpeg' }))
  await a.repo.addQuote({ bookId: id, text: 'ประโยค', page: 1, note: '' })
  const file = await exportBackup(a.db, true)
  expect(await importBackup(b.db, file)).toBe(3)
  expect((await b.repo.getBook(id))!.title).toBe('สำรอง')
  expect(await (await b.repo.getCover(id))!.text()).toBe('ปก')
  expect((await b.repo.listQuotes(id)).length).toBe(1)
  // กู้คืนซ้ำไม่เพิ่มอะไร และไม่ทับข้อมูลที่ใหม่กว่า
  await tick()
  await b.repo.updateBook(id, { ...(await b.repo.getBook(id))!, note: 'ใหม่กว่า' })
  expect(await importBackup(b.db, file)).toBe(0)
  expect((await b.repo.getBook(id))!.note).toBe('ใหม่กว่า')

  await expect(importBackup(b.db, new Blob(['ไม่ใช่ json']))).rejects.toThrow('bad-file')
  await expect(importBackup(b.db, new Blob(['{"version":2}']))).rejects.toThrow('bad-file')
  // แถวที่ไม่มี id หรือเวลาแก้ไขถูกทิ้ง
  expect(parseSnapshot('{"version":1,"tables":{"books":[{"title":"x"},{"id":"1","updatedAt":5}]}}').tables.books).toHaveLength(1)
})

test('ล้างสถิติ: ลบประวัติการอ่าน หนังสือและการหยิบที่ค้างยังอยู่ และการลบตามไปอีกเครื่อง', async () => {
  const a = device()
  const b = device()
  const drive = memoryStore()
  const id = await a.repo.addBook({ ...emptyBook, title: 'อ่านอยู่', pages: 100 })
  await a.repo.takeBook(id)
  await a.repo.checkIn(id, { page: 20, minutes: 15 })
  await syncAll(a.db, drive)
  await syncAll(b.db, drive)
  expect((await b.repo.listSessions()).length).toBe(2)

  await tick()
  expect(await a.repo.clearStats()).toBe(1) // เฉพาะการอ่านที่จบแล้ว การหยิบที่ค้างคงไว้
  expect((await a.repo.listSessions()).map((s) => s.kind)).toEqual(['carry'])
  expect((await a.repo.getBook(id))!).toMatchObject({ currentPage: 20 })
  expect((await a.repo.getBook(id))!.takenAt).not.toBeNull()
  await syncAll(a.db, drive)
  await syncAll(b.db, drive)
  expect((await b.repo.listSessions()).map((s) => s.kind)).toEqual(['carry'])
})

test('ล้างทั้งหมด: เครื่องว่าง สำเนากลางว่าง และซิงก์ใหม่ไม่ดึงอะไรกลับมา', async () => {
  const a = device()
  const drive = memoryStore()
  const id = await a.repo.addBook({ ...emptyBook, title: 'จะหายไป' })
  await a.repo.setCover(id, new Blob(['ปก'], { type: 'image/jpeg' }))
  await syncAll(a.db, drive)
  expect(await wipeRemote(drive)).toBe(2)
  await wipeLocal(a.db)
  expect(await a.repo.listBooks()).toEqual([])
  expect(await a.db.covers.count()).toBe(0)
  expect(await syncAll(a.db, drive)).toEqual({ pushed: 0, pulled: 0 })
  expect(await a.repo.listBooks()).toEqual([])
})

test('ล้างเฉพาะเครื่อง: ซิงก์อีกครั้งข้อมูลกลับมาจากสำเนากลาง', async () => {
  const a = device()
  const drive = memoryStore()
  await a.repo.addBook({ ...emptyBook, title: 'ยังอยู่ใน Drive' })
  await syncAll(a.db, drive)
  await wipeLocal(a.db)
  expect((await syncAll(a.db, drive)).pulled).toBe(1)
  expect((await a.repo.listBooks()).map((x) => x.title)).toEqual(['ยังอยู่ใน Drive'])
})
