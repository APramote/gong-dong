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

export interface Snapshot {
  version: 1
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
}

export const DATA_FILE = 'data.json'
const coverFile = (id: string) => `cover-${id}`

const isRow = (x: unknown): x is Row =>
  typeof x === 'object' && x !== null && typeof (x as Row).id === 'string' && typeof (x as Row).updatedAt === 'number'

/** อ่านไฟล์ข้อมูลกลาง รับเฉพาะรูปแบบที่รู้จัก ข้อมูลแปลกปลอมถูกทิ้ง */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('bad-file')
  }
  const o = raw as Partial<Snapshot> | null
  if (!o || typeof o !== 'object' || o.version !== 1 || typeof o.tables !== 'object' || o.tables === null) throw new Error('bad-file')
  const tables: Snapshot['tables'] = {}
  for (const name of TABLES) {
    const rows = (o.tables as Record<string, unknown>)[name]
    tables[name] = Array.isArray(rows) ? rows.filter(isRow) : []
  }
  return {
    version: 1,
    savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0,
    tables,
    covers: Array.isArray(o.covers) ? (o.covers.filter(isRow) as unknown as CoverMeta[]) : [],
  }
}

const empty = (): Snapshot => ({ version: 1, savedAt: 0, tables: {}, covers: [] })

/**
 * รวมตารางข้อมูลกับ snapshot ปลายทาง: เขียนรายการที่ปลายทางใหม่กว่าลงเครื่อง
 * คืน snapshot ที่รวมแล้ว (ไว้ส่งขึ้น) และจำนวนรายการที่ต่างกันแต่ละทาง
 */
async function mergeTables(db: GongDongDB, remote: Snapshot) {
  const tables: Snapshot['tables'] = {}
  let pushed = 0
  let pulled = 0
  for (const name of TABLES) {
    const table = db.table<Row, string>(name)
    const local = await table.toArray()
    const merged = new Map(local.map((r) => [r.id, r]))
    const remoteRows = remote.tables[name] ?? []
    const remoteById = new Map(remoteRows.map((r) => [r.id, r]))
    const incoming: Row[] = []
    for (const r of remoteRows) {
      const mine = merged.get(r.id)
      if (!mine || r.updatedAt > mine.updatedAt) {
        incoming.push(r)
        merged.set(r.id, r)
      }
    }
    for (const l of local) {
      const theirs = remoteById.get(l.id)
      if (!theirs || l.updatedAt > theirs.updatedAt) pushed++
    }
    if (incoming.length) await table.bulkPut(incoming)
    pulled += incoming.length
    tables[name] = [...merged.values()]
  }
  return { tables, pushed, pulled }
}

/** sync สองทางกับที่เก็บกลาง */
export async function syncAll(
  db: GongDongDB,
  store: RemoteStore,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<SyncResult> {
  const names = await store.names()
  const file = names.has(DATA_FILE) ? await store.get(DATA_FILE) : null
  const remote = file ? parseSnapshot(await file.text()) : empty()
  const merged = await mergeTables(db, remote)
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
    // รายการบอกว่ามีรูปแต่ไฟล์หาย: ข้ามไป ไม่ทับรูปในเครื่อง
    if (meta.deletedAt === null && !blob) continue
    await db.covers.put({ ...meta, blob, thumb: null })
    pulled++
  }

  // เขียนไฟล์ข้อมูลหลังรูปขึ้นครบ รายการรูปจะไม่ชี้ไปยังไฟล์ที่ยังไม่มี
  if (pushed > 0 || !file) {
    const snapshot: Snapshot = { version: 1, savedAt: Date.now(), tables: merged.tables, covers: [...manifest.values()] }
    await store.put(DATA_FILE, new Blob([JSON.stringify(snapshot)], { type: 'application/json' }))
  }
  return { pushed, pulled }
}

/** ลบสำเนาทั้งหมดในที่เก็บกลาง คืนจำนวนไฟล์ที่ลบ */
export async function wipeRemote(store: RemoteStore): Promise<number> {
  const names = [...(await store.names())]
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
  const tables: Snapshot['tables'] = {}
  for (const name of TABLES) tables[name] = await db.table<Row, string>(name).toArray()
  const covers: CoverMeta[] = []
  const images: NonNullable<BackupFile['images']> = {}
  for (const c of await db.covers.toArray()) {
    // ไม่รวมรูป = ไม่บันทึกรายการรูปเลย กู้คืนแล้วรูปในเครื่องปลายทางจะไม่ถูกแตะ
    if (!withCovers) continue
    covers.push({ id: c.id, createdAt: c.createdAt, updatedAt: c.updatedAt, deletedAt: c.deletedAt })
    if (c.blob) images[c.id] = { type: c.blob.type || 'image/jpeg', data: await toBase64(c.blob) }
  }
  const file: BackupFile = { app: 'gong-dong', version: 1, savedAt: Date.now(), tables, covers, images }
  return new Blob([JSON.stringify(file)], { type: 'application/json' })
}

/** กู้คืนจากไฟล์สำรอง: รวมเข้ากับข้อมูลในเครื่อง (รายการที่แก้ล่าสุดชนะ) ไม่ลบข้อมูลที่มีอยู่ */
export async function importBackup(db: GongDongDB, file: Blob): Promise<number> {
  const text = await file.text()
  const snapshot = parseSnapshot(text)
  const images = ((JSON.parse(text) as BackupFile).images ?? {}) as NonNullable<BackupFile['images']>
  let { pulled } = await mergeTables(db, snapshot)
  for (const meta of snapshot.covers) {
    const mine = await db.covers.get(meta.id)
    if (mine && mine.updatedAt >= meta.updatedAt) continue
    const img = images[meta.id]
    const ok = img && typeof img.data === 'string' && /^image\//.test(String(img.type))
    if (meta.deletedAt === null && !ok) continue
    await db.covers.put({ ...meta, blob: meta.deletedAt === null ? fromBase64(img.data, img.type) : null, thumb: null })
    pulled++
  }
  return pulled
}
