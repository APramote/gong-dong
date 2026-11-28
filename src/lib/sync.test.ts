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

test('ผลจากการตรวจ: ไฟล์ข้อมูลว่างใน Drive ไม่ทำให้ซิงก์ค้าง', async () => {
  const a = device()
  const drive = memoryStore()
  drive.files.set('data.json', new Blob([])) // สร้างไฟล์ไว้แต่ส่งเนื้อหาไม่สำเร็จ
  await a.repo.addBook({ ...emptyBook, title: 'ยังซิงก์ได้' })
  expect(await syncAll(a.db, drive)).toMatchObject({ pushed: 1 })
  expect(drive.files.get('data.json')!.size).toBeGreaterThan(0)
})

test('ผลจากการตรวจ: ที่เก็บถูกลบในเครื่องหนึ่ง หนังสือที่อีกเครื่องเพิ่งวางไว้ไม่หาย', async () => {
  const a = device()
  const b = device()
  const drive = memoryStore()
  const box = await a.repo.addPlace('box', { name: 'กล่อง', location: '', label: '' })
  const id = await a.repo.addBook({ ...emptyBook, title: 'เล่มในกล่อง' })
  await syncAll(a.db, drive)
  await syncAll(b.db, drive)
  await tick()
  await a.repo.deletePlace(box)
  await tick()
  await b.repo.moveBook(id, box) // B ยังไม่รู้ว่ากล่องถูกลบ
  await syncAll(a.db, drive)
  await syncAll(b.db, drive)
  await syncAll(a.db, drive)
  for (const d of [a, b]) {
    expect((await d.repo.getBook(id))!.placeId).toBeNull()
    expect((await d.repo.booksIn(null)).map((x) => x.title)).toEqual(['เล่มในกล่อง'])
  }
})

test('ผลจากการตรวจ: หยิบเล่มเดียวกันสองเครื่อง ไม่เหลือการหยิบค้างซ้อน', async () => {
  const a = device()
  const b = device()
  const drive = memoryStore()
  const id = await a.repo.addBook({ ...emptyBook, title: 'สองเครื่อง', pages: 100 })
  await syncAll(a.db, drive)
  await syncAll(b.db, drive)
  await tick()
  await b.repo.takeBook(id) // B หยิบ (ยังไม่ซิงก์)
  await tick()
  await a.repo.takeBook(id)
  await tick()
  await a.repo.returnBook(id, { placeId: null, page: 10, minutes: 5, finished: false }) // A หยิบแล้ววางคืนทีหลัง = ชนะ
  await syncAll(a.db, drive)
  await syncAll(b.db, drive)
  expect((await b.repo.getBook(id))!.takenAt).toBeNull()
  expect((await b.repo.listSessions()).filter((s) => s.endedAt === null)).toEqual([])
  await b.repo.takeBook(id)
  expect((await b.repo.listSessions()).filter((s) => s.endedAt === null)).toHaveLength(1)
})

test('ผลจากการตรวจ: ข้อมูลนำเข้าที่ชนิดผิดหรือแปลกปลอมถูกทำให้ปลอดภัย', () => {
  const now = 1_000_000_000_000
  const snap = parseSnapshot(
    JSON.stringify({
      version: 1,
      tables: {
        books: [
          { id: 'ok', updatedAt: 5, title: 'ดี', tags: null, links: [{ url: 'javascript:alert(1)' }, { url: 'https://a.example', title: 1 }], status: 'weird', evil: '<img>' },
          { id: 'future', updatedAt: now + 10 * 86400000, title: 'อนาคต' },
          { id: 'baddel', updatedAt: 5, deletedAt: 'yes' },
          { id: 'obj', updatedAt: 6, title: { a: 1 } },
        ],
        places: [{ id: 'p', updatedAt: 1, kind: 'castle', name: 'x' }],
        quotes: [{ id: 'q', updatedAt: 1, text: 't' }],
      },
      covers: [{ id: 'c', updatedAt: 3 }, { nope: 1 }],
    }),
    now,
  )
  expect(snap.tables.books!.map((b) => b.id)).toEqual(['ok', 'obj'])
  expect(snap.tables.books![0]).toMatchObject({ title: 'ดี', tags: [], links: [{ title: '', url: 'https://a.example' }], status: 'dong', deletedAt: null, createdAt: 5 })
  expect(snap.tables.books![0]).not.toHaveProperty('evil')
  expect(snap.tables.books![1].title).toBe('')
  expect(snap.tables.places).toEqual([])
  expect(snap.tables.quotes).toEqual([])
  expect(snap.covers).toEqual([{ id: 'c', createdAt: 3, updatedAt: 3, deletedAt: null }])
})

test('ซิงก์ความกว้างชั้น จำนวนแถว และแถวของหนังสือ', async () => {
  const a = device()
  const b = device()
  const drive = memoryStore()
  const caseId = await a.repo.addBookcase({ name: 'ตู้', room: '' }, 1)
  const shelf = (await a.repo.listPlaces())[0]
  const id = await a.repo.addBook({ ...emptyBook, title: 'แถวหลัง', placeId: shelf.id })
  await a.repo.setShelfWidth(caseId, 82.5)
  await a.repo.setShelfShape(shelf.id, { rows: 2, width: 70 })
  await a.repo.setRow(id, 1)
  await a.repo.setRating(id, -3)
  await syncAll(a.db, drive)
  await syncAll(b.db, drive)
  expect((await b.repo.getBook(id))!.rating).toBe(-3)
  expect((await b.repo.listBookcases())[0].shelfWidth).toBe(82.5)
  expect((await b.repo.getPlace(shelf.id))!).toMatchObject({ rows: 2, width: 70 })
  expect((await b.repo.getBook(id))!.row).toBe(1)
  // ค่าแปลกปลอมจากไฟล์ถูกทิ้ง
  const snap = parseSnapshot(JSON.stringify({ version: 1, tables: { bookcases: [{ id: 'x', updatedAt: 1, shelfWidth: -5 }], places: [{ id: 'p', updatedAt: 1, kind: 'shelf', width: 99999, rows: 7 }], books: [{ id: 'k', updatedAt: 1, row: 5, rating: 99 }] } }))
  expect(snap.tables.books![0]).not.toHaveProperty('rating')
  expect(snap.tables.bookcases![0]).not.toHaveProperty('shelfWidth')
  expect(snap.tables.places![0]).not.toHaveProperty('width')
  expect(snap.tables.places![0]).not.toHaveProperty('rows')
  expect(snap.tables.books![0]).not.toHaveProperty('row')
})

test('ไฟล์กลางรุ่น 2: เขียนเป็นรุ่น 2 อ่านได้ทั้งรุ่น 1 และ 2 รุ่นที่ไม่รู้จักถูกปฏิเสธ', async () => {
  const { SNAPSHOT_VERSION } = await import('./sync')
  expect(SNAPSHOT_VERSION).toBe(2)
  expect(parseSnapshot('{"version":2,"tables":{"books":[{"id":"1","updatedAt":5,"rating":-4}]}}').tables.books![0]).toMatchObject({ rating: -4 })
  expect(parseSnapshot('{"version":1,"tables":{}}').version).toBe(1)
  expect(() => parseSnapshot('{"version":3,"tables":{}}')).toThrow('newer-file')
  expect(() => parseSnapshot('{"version":0,"tables":{}}')).toThrow('bad-file')
})

test('ไฟล์จากแอปรุ่นใหม่กว่า: แจ้งให้อัปเดต ไม่อ่านเป็นไฟล์เสีย ไฟล์สำรองเขียนเป็นรุ่นปัจจุบัน', async () => {
  const { SNAPSHOT_VERSION } = await import('./sync')
  expect(() => parseSnapshot(`{"version":${SNAPSHOT_VERSION + 1},"tables":{}}`)).toThrow('newer-file')
  const { syncErrorText } = await import('./syncError')
  expect(syncErrorText(new Error('newer-file'))).toMatch(/อัปเดตแอป/)
  const a = device()
  const file = JSON.parse(await (await exportBackup(a.db, false)).text())
  expect(file.version).toBe(SNAPSHOT_VERSION)
})

test('การตั้งค่า AI ใช้ร่วมกันทุกเครื่อง: เครื่องใหม่ได้ key จากเครื่องเดิม ลบ key แล้วตามไปทุกเครื่อง ค่าที่ตั้งไว้ก่อนมีระบบนี้ไม่หาย', async () => {
  const { syncShared, SETTINGS_FILE } = await import('./sharedSettings')
  const drive = memoryStore()
  const base = {
    aiEnabled: true, provider: 'gemini', geminiKey: '', geminiModel: '', claudeKey: '', claudeModel: 'c', dailyGoalMinutes: 20, dailyGoalPages: 20,
    yearGoalBooks: 12, maxCategories: 12, organizeMode: 'minimal', googleClientId: '', lastSyncAt: 0, googleAccount: '', autoSync: true, syncSettings: true,
    sharedAt: 0, geminiKeyAt: 0, claudeKeyAt: 0,
  } as any
  const device = (init: object) => {
    let s = { ...base, ...init }
    return { io: { load: () => s, save: (n: any) => (s = n), defaults: base }, get: () => s, set: (patch: object) => (s = { ...s, ...patch }) }
  }
  const T = 1_800_000_000_000
  // มือถือ: ตั้ง key ผู้ให้บริการ และเป้าไว้นานแล้ว (ก่อนมีระบบนี้ เวลาทุกตัวเป็น 0)
  const phone = device({ geminiKey: 'KEY-PHONE', geminiModel: 'gemini-x', provider: 'claude', claudeKey: 'CK', yearGoalBooks: 30, googleAccount: 'phone' })
  // PC ใหม่: แก้เป้าหน้าต่อวันแล้วซิงก์ "ก่อน" มือถือ
  const pc = device({ googleAccount: 'pc', dailyGoalPages: 50, sharedAt: T })
  expect(await syncShared(drive, pc.io, T + 1)).toBe('pushed')
  // มือถือซิงก์ทีหลัง: ได้เป้าจาก PC แต่ผู้ให้บริการ เป้ารายปี และ key ที่ตั้งไว้เองไม่ถูกทับด้วยค่าเริ่มต้นของ PC
  expect(await syncShared(drive, phone.io, T + 2)).toBe('both')
  expect(phone.get()).toMatchObject({ provider: 'claude', yearGoalBooks: 30, dailyGoalPages: 50, geminiKey: 'KEY-PHONE', claudeKey: 'CK', googleAccount: 'phone' })
  expect(await syncShared(drive, pc.io, T + 3)).toBe('pulled')
  expect(pc.get()).toMatchObject({ provider: 'claude', yearGoalBooks: 30, dailyGoalPages: 50, geminiKey: 'KEY-PHONE', geminiModel: 'gemini-x', claudeKey: 'CK', googleAccount: 'pc' })
  expect(await syncShared(drive, pc.io, T + 4)).toBe('none')
  expect(await syncShared(drive, phone.io, T + 4)).toBe('none')
  // ลบ key โดยตั้งใจบน PC: ตามไปถึงมือถือ ไม่ถูกเติมกลับ
  pc.set({ geminiKey: '', geminiModel: '', geminiKeyAt: T + 10, sharedAt: T + 10 })
  expect(await syncShared(drive, pc.io, T + 11)).toBe('pushed')
  await syncShared(drive, phone.io, T + 12)
  expect(phone.get()).toMatchObject({ geminiKey: '', claudeKey: 'CK' })
  await syncShared(drive, pc.io, T + 13)
  expect(pc.get().geminiKey).toBe('')
  // ปิดสวิตช์: ไม่อ่านไม่เขียน
  const off = device({ syncSettings: false, geminiKey: 'LOCAL-ONLY', geminiKeyAt: T + 50, sharedAt: T + 50 })
  expect(await syncShared(drive, off.io, T + 51)).toBe('none')
  expect(JSON.parse(await drive.files.get(SETTINGS_FILE)!.text()).values.geminiKey).toBe('')
  // ไฟล์ที่ถูกแก้: ค่าผิดชนิดถูกทิ้ง เวลาในอนาคตไกลถูกจำกัด (ไม่ชนะตลอดไป)
  drive.files.set(SETTINGS_FILE, new Blob([JSON.stringify({ version: 1, sharedAt: T * 5, values: { provider: 'evil', maxCategories: -3, geminiKey: 'NEW', geminiKeyAt: T * 5 } })]))
  await syncShared(drive, pc.io, T + 60)
  expect(pc.get()).toMatchObject({ provider: 'claude', maxCategories: 12, geminiKey: 'NEW' })
  expect(pc.get().sharedAt).toBeLessThanOrEqual(T + 60 + 86400000)
  // ไฟล์จากแอปรุ่นใหม่กว่า: ไม่อ่าน ไม่เขียนทับ
  drive.files.set(SETTINGS_FILE, new Blob([JSON.stringify({ version: 2, sharedAt: 1, values: {} })]))
  expect(await syncShared(drive, pc.io, T + 70)).toBe('none')
  expect(JSON.parse(await drive.files.get(SETTINGS_FILE)!.text()).version).toBe(2)
})
