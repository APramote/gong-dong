import { db } from '../db/db'
import { DEFAULT_GOOGLE_CLIENT_ID, loadSettings, saveSettings } from './settings'
import { isSyncWrite, TABLES, type SyncResult } from './sync'

/**
 * ซิงก์อัตโนมัติ: หลังการเปลี่ยนแปลงครั้งล่าสุด 1 นาที
 * ทำได้เงียบ ๆ เฉพาะตอนที่ยังมีสิทธิ์จาก Google อยู่ (ราว 1 ชั่วโมงหลังเข้าสู่ระบบหรือกดซิงก์)
 * สิทธิ์หมดแล้วแอปขอใหม่เองไม่ได้ (เบราว์เซอร์ให้เปิดหน้าต่างของ Google เฉพาะตอนผู้ใช้กด)
 * จึงแจ้งว่ามีการแก้ไขค้างอยู่ ให้กดซิงก์ครั้งเดียว
 */

export const DELAY = 60_000
const DIRTY = 'gong-dong.dirtyAt'

export interface AutoState {
  phase: 'idle' | 'syncing'
  /** มีการแก้ไขที่ยังไม่ได้ซิงก์ (และเข้าสู่ระบบ Google ไว้) */
  pending: boolean
  /** ลองซิงก์เองแล้วแต่สิทธิ์หมด ต้องให้ผู้ใช้กด */
  needsTap: boolean
  /** ข้อผิดพลาดของการซิงก์อัตโนมัติครั้งล่าสุด (จะลองใหม่เอง) */
  error: unknown
  lastSyncAt: number
  /** อีเมลบัญชี Google ที่เชื่อมไว้ ('' = ยังไม่เข้าสู่ระบบ) */
  account: string
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // เก็บไม่ได้ก็ยังซิงก์ด้วยมือได้
  }
}

let phase: AutoState['phase'] = 'idle'
let needsTap = false
let error: unknown = null
let snapshot: AutoState | null = null
const listeners = new Set<() => void>()

function emit() {
  snapshot = null
  for (const l of listeners) l()
}

/** การตั้งค่าที่เกี่ยวกับบัญชีหรือเวลาซิงก์เปลี่ยน ให้ทุกหน้าที่แสดงสถานะอ่านใหม่ */
export const refresh = emit

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getState(): AutoState {
  if (!snapshot) {
    const s = loadSettings()
    const pending = Boolean(s.googleAccount && read(DIRTY))
    snapshot = { phase, pending, needsTap: pending && needsTap, error, lastSyncAt: s.lastSyncAt, account: s.googleAccount }
  }
  return snapshot
}

let timer: ReturnType<typeof setTimeout> | undefined
function schedule(delay = DELAY) {
  clearTimeout(timer)
  timer = setTimeout(() => void auto(), delay)
}

let lastMark = 0
function markDirty() {
  const now = Date.now()
  // เพิ่มหรือลบทีละหลายพันแถวเรียกมาทุกแถว ทำงานจริงไม่เกินสี่ครั้งต่อวินาที
  if (now - lastMark < 250) return
  lastMark = now
  const wasClean = !read(DIRTY)
  write(DIRTY, String(now))
  // นับ 1 นาทีใหม่ทุกครั้งที่แก้ จะได้ไม่ซิงก์กลางการพิมพ์หรือเพิ่มหนังสือทีละหลายเล่ม
  retry = 0
  schedule()
  if (wasClean) emit()
}

/** ซิงก์เองถ้ามีของค้างและยังมีสิทธิ์อยู่ ไม่เปิดหน้าต่างใด ๆ */
let retry = 0
async function auto(): Promise<void> {
  if (!getState().pending || phase === 'syncing') return
  try {
    const r = await syncNow(false)
    retry = 0
    if (r === null) {
      needsTap = true
      emit()
    }
  } catch (e) {
    if ((e as Error)?.message === 'cancelled') return
    error = e
    // สิทธิ์ใช้ไม่ได้แล้ว ต้องให้ผู้ใช้กด ส่วนปัญหาอื่น (เช่น เน็ตหลุด) ลองใหม่เองโดยเว้นช่วงนานขึ้นเรื่อย ๆ
    if ((e as { kind?: string })?.kind === 'auth') needsTap = true
    else schedule(Math.min(DELAY * 2 ** retry++, 10 * DELAY))
    emit()
  }
}

let running: Promise<SyncResult | null> | null = null
/** เพิ่มขึ้นทุกครั้งที่ออกจากระบบหรือล้างข้อมูล การซิงก์ที่เริ่มก่อนหน้านั้นต้องหยุดและไม่บันทึกอะไร */
let epoch = 0

/**
 * ซิงก์หนึ่งรอบ ใช้ร่วมกันทั้งปุ่มและการซิงก์อัตโนมัติ (ไม่ทำซ้อนกัน)
 * interactive = มาจากการกดปุ่ม เปิดหน้าต่างของ Google ได้ถ้าต้องขอสิทธิ์
 * คืน null เมื่อไม่ใช่การกดปุ่มและไม่มีสิทธิ์เหลือ
 */
export async function syncNow(
  interactive: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<SyncResult | null> {
  if (running) {
    const joined = await running.catch(() => null)
    // รอบที่กำลังทำอยู่เป็นรอบอัตโนมัติที่ไม่มีสิทธิ์ แต่ครั้งนี้ผู้ใช้กดเอง: ทำใหม่แบบขอสิทธิ์ได้
    if (joined !== null || !interactive) return joined
  }
  const mine = epoch
  const job = (async () => {
    const s = loadSettings()
    const clientId = s.googleClientId || DEFAULT_GOOGLE_CLIENT_ID
    const [drive, { syncAll }] = await Promise.all([import('./drive'), import('./sync')])
    let token = drive.cachedToken(clientId)
    let email = s.googleAccount
    if (!token) {
      if (!interactive) return null
      ;({ token, email } = await drive.connect(clientId, s.googleAccount))
    } else if (!email) {
      // มีสิทธิ์อยู่แต่ยังไม่รู้ว่าเป็นบัญชีไหน (ครั้งก่อนถามบัญชีไม่สำเร็จ)
      email = (await drive.account(token)).email
    }
    if (mine !== epoch) throw new Error('cancelled')
    phase = 'syncing'
    error = null
    emit()
    const dirtyBefore = read(DIRTY)
    const result = await syncAll(db, drive.driveStore(token), onProgress, () => mine !== epoch)
    if (mine !== epoch) throw new Error('cancelled')
    // ระหว่างซิงก์ไม่มีการแก้ไขเพิ่ม = ไม่มีของค้างแล้ว (ถ้ามี จะซิงก์อีกรอบใน 1 นาที)
    if (read(DIRTY) === dirtyBefore) write(DIRTY, null)
    saveSettings({ ...loadSettings(), googleAccount: email, lastSyncAt: Date.now() })
    needsTap = false
    return result
  })()
  running = job
  try {
    return await job
  } finally {
    if (running === job) running = null
    phase = 'idle'
    emit()
  }
}

/** รอให้การซิงก์ที่กำลังทำอยู่ (ถ้ามี) จบก่อน */
export async function idle(): Promise<void> {
  await running?.catch(() => null)
}

/**
 * ออกจากระบบหรือล้างข้อมูล: ยกเลิกการซิงก์ที่ค้างอยู่ รอให้หยุดจริง แล้วล้างสถานะของค้าง
 * ต้องเรียกและรอให้เสร็จ "ก่อน" ลบข้อมูลหรือเปลี่ยนบัญชี ไม่อย่างนั้นการซิงก์ที่ค้างอาจเขียนทับสำเนากลาง
 */
export async function reset(): Promise<void> {
  epoch++
  clearTimeout(timer)
  await idle()
  clearTimeout(timer)
  write(DIRTY, null)
  needsTap = false
  error = null
  retry = 0
  emit()
}

let started = false
/** เริ่มเฝ้าการเปลี่ยนแปลงของข้อมูล เรียกครั้งเดียวตอนเปิดแอป */
export function start(): void {
  if (started) return
  started = true
  for (const name of [...TABLES, 'covers'] as const) {
    const table = db.table(name)
    // การเขียนของตัวซิงก์เอง (ข้อมูลที่รับมาจาก Drive) ไม่นับเป็นการแก้ไขของผู้ใช้
    table.hook('creating', (_key, _obj, tx) => {
      if (!isSyncWrite(tx)) markDirty()
    })
    table.hook('deleting', (_key, _obj, tx) => {
      if (!isSyncWrite(tx)) markDirty()
    })
    table.hook('updating', (mods, _key, _obj, tx) => {
      // รูปย่อเป็นของในเครื่อง ไม่ซิงก์ ไม่นับเป็นการแก้ไข
      const keys = Object.keys(mods)
      if (isSyncWrite(tx) || (keys.length && keys.every((k) => k === 'thumb'))) return
      markDirty()
    })
  }
  // ปิดหรือสลับออกจากแอปก่อนครบ 1 นาที: ซิงก์ทันทีถ้ายังมีสิทธิ์
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void auto()
  })
  // เน็ตกลับมา ลองซิงก์ของที่ค้าง
  window.addEventListener('online', () => {
    if (read(DIRTY)) schedule(2000)
  })
  // อีกแท็บหนึ่งแก้ไขหรือซิงก์ไป สถานะในแท็บนี้ต้องตามทัน
  window.addEventListener('storage', emit)
  // มีของค้างจากครั้งก่อน: ลองหลังเปิดแอปสักครู่ (ไม่มีสิทธิ์ก็จะขึ้นแถบให้กด)
  if (read(DIRTY)) schedule(4000)
}
