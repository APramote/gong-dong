import type { GongDongDB } from '../db/db'
import type { Cover, SyncFields } from '../db/types'

/**
 * รวมข้อมูลระหว่างเครื่องนี้กับที่เก็บกลาง (Google Drive หรือไฟล์สำรอง)
 * กติกา: รายการเดียวกัน (id เดียวกัน) ฝั่งที่แก้ล่าสุด (updatedAt มากกว่า) ชนะ
 * การลบเป็นการทำเครื่องหมาย (deletedAt) จึงรวมแบบเดียวกันได้ รายการที่ลบไม่กลับมา
 */

/** ตารางข้อมูลที่ sync (รูปปกแยกเป็นไฟล์ของตัวเอง) */
export const TABLES = ['books', 'bookcases', 'places', 'sessions', 'categories', 'wishes', 'series', 'quotes'] as const
type TableName = (typeof TABLES)[number]

type Row = SyncFields & Record<string, unknown>
type CoverMeta = Pick<Cover, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>

/**
 * รุ่นของไฟล์ข้อมูลกลางใน Drive
 * รุ่น 2 เพิ่มฟิลด์ใหม่ (คะแนน ความกว้างชั้น แถวหน้า/หลัง): แอปรุ่นเก่าที่ไม่รู้จักฟิลด์เหล่านี้จะอ่านไฟล์รุ่น 2 ไม่ได้
 * และหยุดซิงก์จนกว่าจะอัปเดต ดีกว่าปล่อยให้เขียนทับไฟล์กลางด้วยข้อมูลที่ฟิลด์ใหม่หายไป
 */
export const SNAPSHOT_VERSION = 2

export interface Snapshot {
  version: 1 | 2
  savedAt: number
  tables: Partial<Record<TableName, Row[]>>
  /** รายการรูปปก (ตัวรูปอยู่ในไฟล์ cover-<id>) */
  covers: CoverMeta[]
}

/** ที่เก็บไฟล์ปลายทาง: Google Drive จริง หรือของจำลองในการทดสอบ */
export interface RemoteStore {
  names(): Promise<Set<string>>
  get(name: string): Promise<Blob | null>
  put(name: string, blob: Blob): Promise<void>
  del(name: string): Promise<void>
}

export interface SyncResult {
  /** จำนวนรายการที่ส่งขึ้น / รับลงมา (รวมรูปปก) */
  pushed: number
  pulled: number
  /** ผลของการซิงก์การตั้งค่า AI ที่ใช้ร่วมกัน (มีเมื่อซิงก์ผ่านตัวซิงก์หลัก) */
  shared?: import('./sharedSettings').SharedResult
  /** หลังซิงก์ เครื่องนี้มี API key ของผู้ให้บริการที่เลือกอยู่หรือไม่ */
  hasKey?: boolean
}

export const DATA_FILE = 'data.json'
const coverFile = (id: string) => `cover-${id}`

const DAY = 86400000
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** ขนาดเป็นเซนติเมตร: ต้องเป็นบวกและไม่เกินจริง (กันค่าเพี้ยนจากไฟล์ที่ถูกแก้) */
const size = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000 ? v : null)
const ref = (v: unknown) => (typeof v === 'string' && v ? v : null)
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)

/** ฟิลด์ sync ของทุกรายการ — คืน null ถ้าใช้ไม่ได้ (เวลาแก้ไขในอนาคตไกลจะชนะทุกการรวมตลอดไป จึงไม่รับ) */
function syncFields(x: unknown, now: number): SyncFields | null {
  if (typeof x !== 'object' || x === null) return null
  const r = x as Record<string, unknown>
  const updatedAt = num(r.updatedAt)
  if (typeof r.id !== 'string' || !r.id || updatedAt === null || updatedAt > now + DAY) return null
  if (r.deletedAt !== null && r.deletedAt !== undefined && num(r.deletedAt) === null) return null
  return { id: r.id, createdAt: num(r.createdAt) ?? updatedAt, updatedAt, deletedAt: num(r.deletedAt) }
}

/**
 * รับเฉพาะฟิลด์ที่รู้จักและบังคับชนิดให้ถูก
 * ข้อมูลจากไฟล์หรือ Drive อาจถูกแก้มา ค่าชนิดผิดจะทำให้หน้าจอพังทุกครั้งที่เปิด และฟิลด์แปลกปลอมจะถูกส่งต่อไปทุกเครื่อง
 */
const CLEAN: Record<TableName, (r: Record<string, unknown>) => Record<string, unknown> | null> = {
  books: (r) => ({
    title: str(r.title),
    authors: str(r.authors),
    publisher: str(r.publisher),
    year: str(r.year),
    pages: num(r.pages),
    isbn: str(r.isbn),
    categoryId: ref(r.categoryId),
    tags: Array.isArray(r.tags) ? r.tags.filter((x): x is string => typeof x === 'string') : [],
    synopsis: str(r.synopsis),
    blurb: str(r.blurb),
    reviewSummary: str(r.reviewSummary),
    // ลิงก์ต้องเป็น https เท่านั้น (เหมือนลิงก์ที่ได้จาก AI)
    links: Array.isArray(r.links)
      ? r.links
          .filter((l): l is { title?: unknown; url: string } => typeof l?.url === 'string' && /^https:\/\//i.test(l.url))
          .map((l) => ({ title: str(l.title), url: l.url }))
      : [],
    note: str(r.note),
    status: oneOf(r.status, ['dong', 'reading', 'done', 'dropped'] as const, 'dong'),
    currentPage: num(r.currentPage),
    placeId: ref(r.placeId),
    position: num(r.position) ?? 0,
    ...(r.row === 1 && { row: 1 }),
    ...(Array.isArray(r.aiFields) && { aiFields: r.aiFields.filter((x) => x === 'blurb' || x === 'tags' || x === 'cover') }),
    ...(typeof r.rating === 'number' && Number.isInteger(r.rating) && r.rating !== 0 && Math.abs(r.rating) <= 5 && { rating: r.rating }),
    takenAt: num(r.takenAt),
    takenFrom: ref(r.takenFrom),
    finishedAt: num(r.finishedAt),
    spineColor: /^#[0-9a-f]{6}$/i.test(str(r.spineColor)) ? str(r.spineColor) : '',
    seriesId: ref(r.seriesId),
    seriesNo: num(r.seriesNo),
    edition: str(r.edition),
    condition: str(r.condition),
    price: num(r.price),
    boughtAt: str(r.boughtAt),
    boughtFrom: str(r.boughtFrom),
    signed: r.signed === true,
  }),
  bookcases: (r) => ({
    name: str(r.name),
    room: str(r.room),
    ...(look(r.look) && { look: look(r.look) }),
    ...(size(r.shelfWidth) !== null && { shelfWidth: size(r.shelfWidth) }),
    ...(r.fitsAll === true && { fitsAll: true }),
  }),
  places: (r) =>
    ['shelf', 'drawer', 'pile', 'box'].includes(r.kind as string)
      ? {
          kind: r.kind,
          name: str(r.name),
          bookcaseId: ref(r.bookcaseId),
          order: num(r.order) ?? 0,
          location: str(r.location),
          label: str(r.label),
          ...(look(r.look) && { look: look(r.look) }),
          ...(size(r.width) !== null && { width: size(r.width) }),
          ...(r.rows === 2 && { rows: 2 }),
        }
      : null,
  sessions: (r) =>
    typeof r.bookId === 'string'
      ? {
          ...(r.kind === 'carry' || r.kind === 'read' ? { kind: r.kind } : {}),
          ...(r.estimated === true && { estimated: true }),
          bookId: r.bookId,
          fromPlaceId: ref(r.fromPlaceId),
          toPlaceId: ref(r.toPlaceId),
          startedAt: num(r.startedAt) ?? 0,
          endedAt: num(r.endedAt),
          startPage: num(r.startPage),
          endPage: num(r.endPage),
          minutes: num(r.minutes),
          timerMs: num(r.timerMs) ?? 0,
          timerStartedAt: num(r.timerStartedAt),
        }
      : null,
  categories: (r) => ({ name: str(r.name) }),
  wishes: (r) => ({ title: str(r.title), authors: str(r.authors), isbn: str(r.isbn), note: str(r.note) }),
  series: (r) => ({ name: str(r.name), total: num(r.total) }),
  quotes: (r) =>
    typeof r.bookId === 'string' ? { bookId: r.bookId, text: str(r.text), page: num(r.page), note: str(r.note) } : null,
}

function look(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null) return null
  const l = v as Record<string, unknown>
  return {
    color: /^#[0-9a-f]{6}$/i.test(str(l.color)) ? str(l.color) : '',
    ratio: num(l.ratio) ?? 0,
    ...(num(l.drawerRows) !== null && { drawerRows: num(l.drawerRows) }),
    ...(num(l.drawersPerRow) !== null && { drawersPerRow: num(l.drawersPerRow) }),
    ...(num(l.doors) !== null && { doors: num(l.doors) }),
    ...(typeof l.legs === 'boolean' && { legs: l.legs }),
  }
}

function cleanRows(name: TableName, rows: unknown, now: number): Row[] {
  if (!Array.isArray(rows)) return []
  const out: Row[] = []
  for (const x of rows) {
    const base = syncFields(x, now)
    const body = base && CLEAN[name](x as Record<string, unknown>)
    if (base && body) out.push({ ...body, ...base })
  }
  return out
}

/** อ่านไฟล์ข้อมูลกลาง รับเฉพาะรูปแบบที่รู้จัก ข้อมูลแปลกปลอมถูกทิ้ง */
export function parseSnapshot(text: string, now = Date.now()): Snapshot {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('bad-file')
  }
  return readSnapshot(raw, now)
}

function readSnapshot(raw: unknown, now: number): Snapshot {
  const o = raw as Partial<Snapshot> | null
  // ไฟล์จากแอปรุ่นใหม่กว่า: อ่านไม่ได้ และห้ามเขียนทับ ให้ผู้ใช้อัปเดตแอปก่อน
  if (o && typeof o === 'object' && typeof o.version === 'number' && o.version > SNAPSHOT_VERSION) throw new Error('newer-file')
  if (!o || typeof o !== 'object' || (o.version !== 1 && o.version !== SNAPSHOT_VERSION) || typeof o.tables !== 'object' || o.tables === null) throw new Error('bad-file')
  const tables: Snapshot['tables'] = {}
  for (const name of TABLES) tables[name] = cleanRows(name, (o.tables as Record<string, unknown>)[name], now)
  const covers: CoverMeta[] = []
  if (Array.isArray(o.covers))
    for (const c of o.covers) {
      const base = syncFields(c, now)
      if (base) covers.push(base)
    }
  return { version: 1, savedAt: num(o.savedAt) ?? 0, tables, covers }
}

/** ชนิดรูปที่รับเข้าเครื่อง (ไม่รับ SVG หรือไฟล์ชนิดอื่นที่ปลอมเป็นรูป) */
const IMAGE = /^image\/(jpeg|png|webp)$/

const empty = (): Snapshot => ({ version: 1, savedAt: 0, tables: {}, covers: [] })

/**
 * รวมตารางข้อมูลกับ snapshot ปลายทาง: เขียนรายการที่ปลายทางใหม่กว่าลงเครื่อง
 * คืน snapshot ที่รวมแล้ว (ไว้ส่งขึ้น) และจำนวนรายการที่ต่างกันแต่ละทาง
 */
async function mergeTables(db: GongDongDB, remote: Snapshot, fromSync = false) {
  let pushed = 0
  let pulled = 0
  for (const name of TABLES) {
    const table = db.table<Row, string>(name)
    const remoteRows = remote.tables[name] ?? []
    const remoteById = new Map(remoteRows.map((r) => [r.id, r]))
    // อ่าน เทียบ และเขียนในธุรกรรมเดียว การแก้ไขที่เกิดขึ้นระหว่างนั้นจะไม่ถูกทับ
    await db.transaction('rw', table, async (tx) => {
      if (fromSync) markSync(tx)
      const local = await table.toArray()
      const mine = new Map(local.map((r) => [r.id, r]))
      const incoming = remoteRows.filter((r) => {
        const l = mine.get(r.id)
        return !l || r.updatedAt > l.updatedAt
      })
      for (const l of local) {
        const theirs = remoteById.get(l.id)
        if (!theirs || l.updatedAt > theirs.updatedAt) pushed++
      }
      if (incoming.length) await table.bulkPut(incoming)
      pulled += incoming.length
    })
  }
  // รวมแล้วอาจมีข้อมูลที่อ้างถึงกันไม่ครบ ซ่อมก่อน (รายการที่ซ่อมต้องส่งขึ้นด้วย)
  if (pulled > 0) pushed += await repair(db, Date.now(), fromSync)
  return { pushed, pulled }
}

/**
 * ทำเครื่องหมายว่าธุรกรรมนี้เป็นการเขียนของตัวซิงก์เอง (ข้อมูลที่รับมาจากที่เก็บกลาง)
 * ตัวซิงก์อัตโนมัติใช้แยกออกจากการแก้ไขของผู้ใช้ จะได้ไม่นับเป็น "มีการแก้ไขที่ยังไม่ได้ซิงก์"
 */
const SYNC_MARK = '_gongDongSync'
const markSync = (tx: object) => void ((tx as Record<string, unknown>)[SYNC_MARK] = true)
export const isSyncWrite = (tx: unknown) => Boolean(tx && (tx as Record<string, unknown>)[SYNC_MARK])

/**
 * ซ่อมความสัมพันธ์ของข้อมูลหลังรวมจากเครื่องอื่น คืนจำนวนรายการที่แก้
 * - หนังสือที่ชี้ไปยังที่เก็บหรือชุดที่ถูกลบแล้ว: ย้ายไป "ยังไม่ระบุที่เก็บ" / ออกจากชุด (ไม่ให้หายจากทุกหน้า)
 * - การหยิบที่ค้างอยู่ของเล่มที่ไม่ได้อยู่ในมือแล้ว หรือค้างซ้อนกันหลายอัน: ปิดให้เหลืออันเดียว
 */
export async function repair(db: GongDongDB, now = Date.now(), fromSync = false): Promise<number> {
  return db.transaction('rw', [db.books, db.places, db.series, db.sessions], async (tx) => {
    if (fromSync) markSync(tx)
    let fixed = 0
    const live = async (name: 'places' | 'series') =>
      new Set((await db.table<Row, string>(name).toArray()).filter((x) => x.deletedAt === null).map((x) => x.id))
    const places = await live('places')
    const series = await live('series')
    const books = (await db.books.toArray()).filter((b) => b.deletedAt === null)
    let next = books.filter((b) => b.placeId === null).reduce((m, b) => Math.max(m, b.position + 1), 0)
    for (const b of books) {
      const patch: Record<string, unknown> = {}
      if (b.placeId && !places.has(b.placeId)) Object.assign(patch, { placeId: null, position: next++, row: 0 })
      if (b.seriesId && !series.has(b.seriesId)) Object.assign(patch, { seriesId: null, seriesNo: null })
      if (Object.keys(patch).length) {
        await db.books.update(b.id, { ...patch, updatedAt: now })
        fixed++
      }
    }
    const inHand = new Set(books.filter((b) => b.takenAt).map((b) => b.id))
    const open = (await db.sessions.toArray())
      .filter((x) => x.deletedAt === null && x.endedAt === null)
      .sort((a, b) => b.startedAt - a.startedAt)
    const kept = new Set<string>()
    for (const x of open) {
      if (inHand.has(x.bookId) && !kept.has(x.bookId)) {
        kept.add(x.bookId)
        continue
      }
      await db.sessions.update(x.id, { kind: 'carry', endedAt: now, timerStartedAt: null, updatedAt: now })
      fixed++
    }
    return fixed
  })
}

/** ข้อมูลทุกตารางในเครื่อง ณ ตอนนี้ */
async function readTables(db: GongDongDB): Promise<Snapshot['tables']> {
  const tables: Snapshot['tables'] = {}
  for (const name of TABLES) tables[name] = await db.table<Row, string>(name).toArray()
  return tables
}

/** sync สองทางกับที่เก็บกลาง */
export async function syncAll(
  db: GongDongDB,
  store: RemoteStore,
  onProgress: (done: number, total: number) => void = () => {},
  /** คืน true เมื่อผู้ใช้ออกจากระบบหรือล้างข้อมูลระหว่างซิงก์ ต้องหยุดก่อนเขียนอะไรเพิ่ม */
  cancelled: () => boolean = () => false,
): Promise<SyncResult> {
  const stop = () => {
    if (cancelled()) throw new Error('cancelled')
  }
  const names = await store.names()
  const got = names.has(DATA_FILE) ? await store.get(DATA_FILE) : null
  // ไฟล์ว่าง = สร้างไว้แต่ส่งเนื้อหาไม่สำเร็จ (เน็ตหลุดกลางทาง) ถือว่ายังไม่มีไฟล์ แล้วเขียนใหม่
  const file = got && got.size > 0 ? got : null
  const remote = file ? parseSnapshot(await file.text()) : empty()
  stop()
  const merged = await mergeTables(db, remote, true)
  let { pushed, pulled } = merged

  // รูปปก: เทียบจากรายการ (ไม่โหลดรูปทั้งหมด) แล้วรับส่งเฉพาะรูปที่ต่างกัน
  const localMeta = new Map<string, CoverMeta>()
  await db.covers.each((c) => {
    localMeta.set(c.id, { id: c.id, createdAt: c.createdAt, updatedAt: c.updatedAt, deletedAt: c.deletedAt })
  })
  const remoteMeta = new Map(remote.covers.map((c) => [c.id, c]))
  const manifest = new Map(remoteMeta)
  const up: CoverMeta[] = []
  const down: CoverMeta[] = []
  for (const [id, l] of localMeta) {
    const r = remoteMeta.get(id)
    if (!r || l.updatedAt > r.updatedAt) up.push(l)
  }
  for (const [id, r] of remoteMeta) {
    const l = localMeta.get(id)
    if (!l || r.updatedAt > l.updatedAt) down.push(r)
  }
  const total = up.length + down.length
  let done = 0
  for (const meta of up) {
    stop()
    const row = await db.covers.get(meta.id)
    if (row?.blob) await store.put(coverFile(meta.id), row.blob)
    else if (names.has(coverFile(meta.id))) await store.del(coverFile(meta.id))
    manifest.set(meta.id, meta)
    pushed++
    onProgress(++done, total)
  }
  for (const meta of down) {
    onProgress(++done, total)
    const blob = meta.deletedAt === null ? await store.get(coverFile(meta.id)) : null
    // รายการบอกว่ามีรูปแต่ไฟล์หายหรือไม่ใช่รูป: ข้ามไป ไม่ทับรูปในเครื่อง
    if (meta.deletedAt === null && (!blob || !IMAGE.test(blob.type))) continue
    stop()
    await db.transaction('rw', db.covers, (tx) => {
      markSync(tx)
      return db.covers.put({ ...meta, blob, thumb: null })
    })
    pulled++
  }

  // เขียนไฟล์ข้อมูลหลังรูปขึ้นครบ รายการรูปจะไม่ชี้ไปยังไฟล์ที่ยังไม่มี
  if (pushed > 0 || !file) {
    // อ่านจากเครื่องอีกครั้งตอนจะเขียน รวมสิ่งที่แก้ระหว่างรับส่งรูปด้วย
    const snapshot: Snapshot = { version: SNAPSHOT_VERSION, savedAt: Date.now(), tables: await readTables(db), covers: [...manifest.values()] }
    // ล้างข้อมูลหรือออกจากระบบไปแล้วระหว่างนี้: อย่าเขียนทับสำเนากลางด้วยข้อมูลที่ถูกล้าง
    stop()
    await store.put(DATA_FILE, new Blob([JSON.stringify(snapshot)], { type: 'application/json' }))
  }
  return { pushed, pulled }
}

/** ลบสำเนาทั้งหมดในที่เก็บกลาง คืนจำนวนไฟล์ที่ลบ */
export async function wipeRemote(store: RemoteStore): Promise<number> {
  // ลบไฟล์ข้อมูลก่อน ถ้าหยุดกลางทางจะไม่เหลือรายการที่ชี้ไปยังรูปที่ถูกลบแล้ว
  const names = [...(await store.names())].sort((a, b) => Number(b === DATA_FILE) - Number(a === DATA_FILE))
  for (const name of names) await store.del(name)
  return names.length
}

/** ล้างข้อมูลทั้งหมดในเครื่องนี้ (ลบจริง ไม่เหลือเครื่องหมายลบ) */
export async function wipeLocal(db: GongDongDB): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })
}

// ---------- สำรองเป็นไฟล์เดียว ----------

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function fromBase64(data: string, type: string): Blob {
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

interface BackupFile extends Snapshot {
  app: 'gong-dong'
  /** รูปปกฝังในไฟล์ (base64) — ไม่มีถ้าเลือกสำรองแบบไม่รวมรูป */
  images?: Record<string, { type: string; data: string }>
}

/** สำรองข้อมูลทั้งหมดเป็นไฟล์ JSON ไฟล์เดียว */
export async function exportBackup(db: GongDongDB, withCovers: boolean): Promise<Blob> {
  const tables = await readTables(db)
  const covers: CoverMeta[] = []
  const images: NonNullable<BackupFile['images']> = {}
  for (const c of await db.covers.toArray()) {
    // ไม่รวมรูป = ไม่บันทึกรายการรูปเลย กู้คืนแล้วรูปในเครื่องปลายทางจะไม่ถูกแตะ
    if (!withCovers) continue
    covers.push({ id: c.id, createdAt: c.createdAt, updatedAt: c.updatedAt, deletedAt: c.deletedAt })
    if (c.blob) images[c.id] = { type: c.blob.type || 'image/jpeg', data: await toBase64(c.blob) }
  }
  const file: BackupFile = { app: 'gong-dong', version: SNAPSHOT_VERSION, savedAt: Date.now(), tables, covers, images }
  return new Blob([JSON.stringify(file)], { type: 'application/json' })
}

/** ไฟล์สำรองใหญ่สุดที่รับ (กันไฟล์ผิดประเภททำให้แอปค้าง) */
const MAX_BACKUP = 300 * 1024 * 1024

/** กู้คืนจากไฟล์สำรอง: รวมเข้ากับข้อมูลในเครื่อง (รายการที่แก้ล่าสุดชนะ) ไม่ลบข้อมูลที่มีอยู่ */
export async function importBackup(db: GongDongDB, file: Blob): Promise<number> {
  if (file.size > MAX_BACKUP) throw new Error('bad-file')
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    throw new Error('bad-file')
  }
  const snapshot = readSnapshot(raw, Date.now())
  const given = (raw as BackupFile).images
  const images: NonNullable<BackupFile['images']> = typeof given === 'object' && given !== null ? given : {}
  let { pulled } = await mergeTables(db, snapshot)
  for (const meta of snapshot.covers) {
    const mine = await db.covers.get(meta.id)
    if (mine && mine.updatedAt >= meta.updatedAt) continue
    let blob: Blob | null = null
    if (meta.deletedAt === null) {
      const img = Object.hasOwn(images, meta.id) ? images[meta.id] : undefined
      if (!img || typeof img.data !== 'string' || !IMAGE.test(String(img.type))) continue
      try {
        blob = fromBase64(img.data, img.type)
      } catch {
        continue // รูปนี้เสีย ข้ามไป รูปอื่นยังกู้ได้
      }
    }
    await db.covers.put({ ...meta, blob, thumb: null })
    pulled++
  }
  return pulled
}
