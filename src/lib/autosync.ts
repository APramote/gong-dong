import { db } from '../db/db'
import { DEFAULT_GOOGLE_CLIENT_ID, loadSettings, saveSettings } from './settings'
import { TABLES, type SyncResult } from './sync'

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
  /** ข้อผิดพลาดของการซิงก์อัตโนมัติครั้งล่าสุด */
  error: unknown
  lastSyncAt: number
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

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getState(): AutoState {
  if (!snapshot) {
    const s = loadSettings()
    const pending = Boolean(s.googleAccount && read(DIRTY))
    snapshot = { phase, pending, needsTap: pending && needsTap, error, lastSyncAt: s.lastSyncAt }
  }
  return snapshot
}

let timer: ReturnType<typeof setTimeout> | undefined
function schedule(delay = DELAY) {
  clearTimeout(timer)
  timer = setTimeout(() => void auto(), delay)
}

function markDirty() {
  write(DIRTY, String(Date.now()))
  // นับ 1 นาทีใหม่ทุกครั้งที่แก้ จะได้ไม่ซิงก์กลางการพิมพ์หรือเพิ่มหนังสือทีละหลายเล่ม
  schedule()
  emit()
}

/** ซิงก์เองถ้ามีของค้างและยังมีสิทธิ์อยู่ ไม่เปิดหน้าต่างใด ๆ */
async function auto(): Promise<void> {
  if (!getState().pending || phase === 'syncing') return
  try {
    const r = await syncNow(false)
    if (r === null) {
      needsTap = true
      emit()
    }
  } catch (e) {
    error = e
    emit()
  }
}

let running: Promise<SyncResult | null> | null = null

/**
 * ซิงก์หนึ่งรอบ ใช้ร่วมกันทั้งปุ่มและการซิงก์อัตโนมัติ (ไม่ทำซ้อนกัน)
 * interactive = มาจากการกดปุ่ม เปิดหน้าต่างของ Google ได้ถ้าต้องขอสิทธิ์
 * คืน null เมื่อไม่ใช่การกดปุ่มและไม่มีสิทธิ์เหลือ
 */
export function syncNow(interactive: boolean, onProgress?: (done: number, total: number) => void): Promise<SyncResult | null> {
  running ??= (async () => {
    const s = loadSettings()
    const clientId = s.googleClientId || DEFAULT_GOOGLE_CLIENT_ID
    const [drive, { syncAll }] = await Promise.all([import('./drive'), import('./sync')])
    let token = drive.cachedToken(clientId)
    let email = s.googleAccount
    if (!token) {
      if (!interactive) return null
      ;({ token, email } = await drive.connect(clientId, s.googleAccount))
    }
    phase = 'syncing'
    error = null
    emit()
    const dirtyBefore = read(DIRTY)
    const result = await syncAll(db, drive.driveStore(token), onProgress)
    // ระหว่างซิงก์ไม่มีการแก้ไขเพิ่ม = ไม่มีของค้างแล้ว (ถ้ามี จะซิงก์อีกรอบใน 1 นาที)
    if (read(DIRTY) === dirtyBefore) write(DIRTY, null)
    saveSettings({ ...loadSettings(), googleAccount: email, lastSyncAt: Date.now() })
    needsTap = false
    return result
  })().finally(() => {
    running = null
    phase = 'idle'
    emit()
  })
  return running
}

/** ออกจากระบบหรือล้างข้อมูลแล้ว: ไม่มีอะไรค้างให้ซิงก์ */
export function reset(): void {
  clearTimeout(timer)
  write(DIRTY, null)
  needsTap = false
  error = null
  emit()
}

let started = false
/** เริ่มเฝ้าการเปลี่ยนแปลงของข้อมูล เรียกครั้งเดียวตอนเปิดแอป */
export function start(): void {
  if (started) return
  started = true
  for (const name of [...TABLES, 'covers'] as const) {
    const table = db.table(name)
    table.hook('creating', () => void markDirty())
    table.hook('deleting', () => void markDirty())
    table.hook('updating', (mods) => {
      // รูปย่อเป็นของในเครื่อง ไม่ซิงก์ ไม่นับเป็นการแก้ไข
      const keys = Object.keys(mods)
      if (keys.length && keys.every((k) => k === 'thumb')) return
      markDirty()
    })
  }
  // ปิดหรือสลับออกจากแอปก่อนครบ 1 นาที: ซิงก์ทันทีถ้ายังมีสิทธิ์
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void auto()
  })
  // มีของค้างจากครั้งก่อน: ลองหลังเปิดแอปสักครู่ (ไม่มีสิทธิ์ก็จะขึ้นแถบให้กด)
  if (read(DIRTY)) schedule(4000)
}
