import type { Settings } from './settings'
import type { RemoteStore } from './sync'

/**
 * การตั้งค่าที่ใช้ร่วมกันทุกเครื่อง: AI (ผู้ให้บริการ รุ่น และ API key) เป้าการอ่าน และตัวเลือกการจัดหมวด
 * เก็บเป็นไฟล์แยกในโฟลเดอร์ข้อมูลของแอปใน Google Drive ของผู้ใช้เอง (แอปอื่นและคนอื่นมองไม่เห็น)
 * ไม่รวมสิ่งที่เป็นของแต่ละเครื่อง: บัญชีที่เข้าสู่ระบบ เวลาซิงก์ Client ID และสวิตช์ซิงก์
 */
export const SETTINGS_FILE = 'settings.json'

export const SHARED_KEYS = [
  'aiEnabled',
  'provider',
  'geminiKey',
  'geminiModel',
  'claudeKey',
  'claudeModel',
  'dailyGoalMinutes',
  'dailyGoalPages',
  'yearGoalBooks',
  'maxCategories',
  'organizeMode',
] as const
type SharedKey = (typeof SHARED_KEYS)[number]
export type Shared = Pick<Settings, SharedKey>

interface SharedFile {
  version: 1
  /** เวลาที่การตั้งค่าชุดนี้ถูกแก้ล่าสุด */
  sharedAt: number
  values: Partial<Shared>
}

export const pickShared = (s: Settings): Shared => Object.fromEntries(SHARED_KEYS.map((k) => [k, s[k]])) as Shared

/** รับเฉพาะค่าที่ชนิดถูกต้อง (ไฟล์ใน Drive อาจถูกแก้มา) ค่าที่ผิดใช้ค่าของเครื่องนี้แทน */
function clean(raw: unknown, fallback: Shared): Shared {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (k: SharedKey, max = 300) => (typeof o[k] === 'string' && (o[k] as string).length <= max ? (o[k] as string) : (fallback[k] as string))
  const int = (k: SharedKey, lo: number, hi: number) =>
    typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= lo && (o[k] as number) <= hi ? Math.round(o[k] as number) : (fallback[k] as number)
  return {
    aiEnabled: typeof o.aiEnabled === 'boolean' ? o.aiEnabled : fallback.aiEnabled,
    provider: o.provider === 'gemini' || o.provider === 'claude' ? o.provider : fallback.provider,
    geminiKey: str('geminiKey'),
    geminiModel: str('geminiModel', 100),
    claudeKey: str('claudeKey'),
    claudeModel: str('claudeModel', 100),
    dailyGoalMinutes: int('dailyGoalMinutes', 0, 1440),
    dailyGoalPages: int('dailyGoalPages', 0, 5000),
    yearGoalBooks: int('yearGoalBooks', 0, 5000),
    maxCategories: int('maxCategories', 1, 200),
    organizeMode: o.organizeMode === 'minimal' || o.organizeMode === 'full' ? o.organizeMode : fallback.organizeMode,
  }
}

/**
 * รวมสองฝั่ง: ฝั่งที่แก้ล่าสุดชนะทั้งชุด ยกเว้น API key —
 * key ที่ว่างไม่ทับ key ที่อีกฝั่งมีอยู่ (เครื่องใหม่ที่ยังไม่ได้ใส่ key ต้องไม่ลบ key ของเครื่องเดิม)
 */
export function mergeShared(local: Shared, localAt: number, remote: Shared | null, remoteAt: number): { values: Shared; at: number } {
  if (!remote) return { values: local, at: localAt || Date.now() }
  const [win, lose, at] = remoteAt > localAt ? [remote, local, remoteAt] : [local, remote, localAt || remoteAt]
  const values = { ...win }
  if (!values.geminiKey && lose.geminiKey) Object.assign(values, { geminiKey: lose.geminiKey, geminiModel: lose.geminiModel })
  if (!values.claudeKey && lose.claudeKey) Object.assign(values, { claudeKey: lose.claudeKey, claudeModel: lose.claudeModel })
  return { values, at }
}

const same = (a: Shared, b: Shared) => SHARED_KEYS.every((k) => a[k] === b[k])

/**
 * ซิงก์การตั้งค่าร่วมกับ Drive คืน 'pulled' เมื่อเครื่องนี้ได้ค่าใหม่ 'pushed' เมื่อส่งขึ้น 'none' เมื่อไม่มีอะไรเปลี่ยน
 * ปิดสวิตช์ไว้ = ไม่อ่านและไม่เขียนไฟล์นี้เลย
 */
export async function syncShared(
  store: RemoteStore,
  io: { load: () => Settings; save: (s: Settings) => void },
): Promise<'pulled' | 'pushed' | 'both' | 'none'> {
  const local = io.load()
  if (!local.syncSettings) return 'none'
  const mine = pickShared(local)
  let remote: Shared | null = null
  let remoteAt = 0
  const names = await store.names()
  if (names.has(SETTINGS_FILE)) {
    try {
      const file = JSON.parse(await (await store.get(SETTINGS_FILE))!.text()) as SharedFile
      if (file?.version === 1 && typeof file.sharedAt === 'number') {
        remote = clean(file.values, mine)
        remoteAt = file.sharedAt
      }
    } catch {
      // ไฟล์อ่านไม่ได้: ถือว่ายังไม่มี แล้วเขียนใหม่จากเครื่องนี้
    }
  }
  // ยังไม่มีไฟล์ และเครื่องนี้ยังไม่มีอะไรให้แบ่ง (ไม่มี key และไม่เคยแก้การตั้งค่า): ไม่ต้องสร้างไฟล์
  if (!remote && !local.sharedAt && !mine.geminiKey && !mine.claudeKey) return 'none'
  const merged = mergeShared(mine, local.sharedAt, remote, remoteAt)
  const pull = !same(merged.values, mine)
  const push = !remote || !same(merged.values, remote) || merged.at !== remoteAt
  // อ่านค่าล่าสุดอีกครั้งก่อนบันทึก ไม่ทับค่าของเครื่อง (บัญชี เวลาซิงก์) ที่เปลี่ยนระหว่างรอเครือข่าย
  if (pull || local.sharedAt !== merged.at) io.save({ ...io.load(), ...merged.values, sharedAt: merged.at })
  if (push) {
    const file: SharedFile = { version: 1, sharedAt: merged.at, values: merged.values }
    await store.put(SETTINGS_FILE, new Blob([JSON.stringify(file)], { type: 'application/json' }))
  }
  return pull && push ? 'both' : pull ? 'pulled' : push ? 'pushed' : 'none'
}
