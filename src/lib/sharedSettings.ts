import type { Settings } from './settings'
import type { RemoteStore } from './sync'

/**
 * การตั้งค่าที่ใช้ร่วมกันทุกเครื่อง: AI (ผู้ให้บริการ รุ่น และ API key) เป้าการอ่าน และตัวเลือกการจัดหมวด
 * เก็บเป็นไฟล์แยกในโฟลเดอร์ข้อมูลของแอปใน Google Drive ของผู้ใช้เอง (แอปอื่นและคนอื่นมองไม่เห็น)
 * ไม่รวมสิ่งที่เป็นของแต่ละเครื่อง: บัญชีที่เข้าสู่ระบบ เวลาซิงก์ Client ID และสวิตช์ซิงก์
 */
export const SETTINGS_FILE = 'settings.json'
const FILE_VERSION = 1
const DAY = 86400000

/** ค่าทั่วไป: เครื่องที่แก้ล่าสุดชนะทั้งชุด */
const PLAIN_KEYS = ['aiEnabled', 'provider', 'dailyGoalMinutes', 'dailyGoalPages', 'yearGoalBooks', 'maxCategories', 'organizeMode'] as const
/** API key กับรุ่นของมัน: ตัดสินแยกทีละตัวด้วยเวลาของ key เอง (การลบ key โดยตั้งใจก็ตามไปทุกเครื่อง) */
const KEY_SETS = [
  { key: 'geminiKey', model: 'geminiModel', at: 'geminiKeyAt' },
  { key: 'claudeKey', model: 'claudeModel', at: 'claudeKeyAt' },
] as const
export const SHARED_KEYS = [...PLAIN_KEYS, 'geminiKey', 'geminiModel', 'geminiKeyAt', 'claudeKey', 'claudeModel', 'claudeKeyAt'] as const
type SharedKey = (typeof SHARED_KEYS)[number]
export type Shared = Pick<Settings, SharedKey>

interface SharedFile {
  version: number
  /** เวลาที่การตั้งค่าชุดนี้ถูกแก้ล่าสุด */
  sharedAt: number
  values: Partial<Shared>
}

export const pickShared = (s: Settings): Shared => Object.fromEntries(SHARED_KEYS.map((k) => [k, s[k]])) as Shared

/** เวลาจากไฟล์: ต้องเป็นตัวเลขไม่ติดลบ และไม่อยู่ในอนาคตเกินหนึ่งวัน (นาฬิกาเพี้ยนหรือไฟล์ถูกแก้ จะได้ไม่ชนะตลอดไป) */
const stamp = (v: unknown, now: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, now + DAY) : 0)

/** รับเฉพาะค่าที่ชนิดถูกต้อง (ไฟล์ใน Drive อาจถูกแก้มา) ค่าที่ผิดใช้ค่าของเครื่องนี้แทน */
function clean(raw: unknown, fallback: Shared, now: number): Shared {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (k: SharedKey, max = 300) => (typeof o[k] === 'string' && (o[k] as string).length <= max ? (o[k] as string) : (fallback[k] as string))
  const int = (k: SharedKey, lo: number, hi: number) =>
    typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= lo && (o[k] as number) <= hi ? Math.round(o[k] as number) : (fallback[k] as number)
  return {
    aiEnabled: typeof o.aiEnabled === 'boolean' ? o.aiEnabled : fallback.aiEnabled,
    provider: o.provider === 'gemini' || o.provider === 'claude' ? o.provider : fallback.provider,
    geminiKey: str('geminiKey'),
    geminiModel: str('geminiModel', 100),
    geminiKeyAt: stamp(o.geminiKeyAt, now),
    claudeKey: str('claudeKey'),
    claudeModel: str('claudeModel', 100),
    claudeKeyAt: stamp(o.claudeKeyAt, now),
    dailyGoalMinutes: int('dailyGoalMinutes', 0, 1440),
    dailyGoalPages: int('dailyGoalPages', 0, 5000),
    yearGoalBooks: int('yearGoalBooks', 0, 5000),
    maxCategories: int('maxCategories', 1, 200),
    organizeMode: o.organizeMode === 'minimal' || o.organizeMode === 'full' ? o.organizeMode : fallback.organizeMode,
  }
}

/**
 * รวมสองฝั่ง
 * - ค่าทั่วไป: ฝั่งที่แก้ล่าสุดชนะทั้งชุด ยกเว้นเครื่องที่ตั้งค่าไว้ก่อนมีระบบนี้ (เวลาเป็น 0): ค่าที่เครื่องนั้นเคยตั้งเอง (ต่างจากค่าเริ่มต้น) ยังอยู่
 * - API key: ตัดสินแยกทีละตัวด้วยเวลาของ key เอง เวลาเท่ากัน (เช่น 0 ทั้งคู่) ฝั่งที่มี key ชนะฝั่งที่ว่าง
 */
export function mergeShared(
  local: Shared,
  localAt: number,
  remote: Shared | null,
  remoteAt: number,
  defaults: Shared,
  now = Date.now(),
  /** เครื่องนี้ยังไม่เคยซิงก์เลย: ค่าที่เพิ่งแตะก่อนเข้าสู่ระบบไม่ควรทับการตั้งค่าที่เครื่องอื่นใช้อยู่ทั้งชุด */
  firstSync = false,
): { values: Shared; at: number } {
  if (!remote) return { values: local, at: localAt || now }
  // เครื่องที่ตั้งค่าไว้ก่อนมีระบบนี้ (เวลา 0) หรือเครื่องใหม่ที่ซิงก์ครั้งแรก: เริ่มจากของกลาง แล้วคงเฉพาะค่าที่เครื่องนี้ตั้งเอง (ต่างจากค่าเริ่มต้น)
  const gentle = localAt === 0 || firstSync
  const remoteWins = remoteAt > localAt || gentle
  const values: Shared = { ...(remoteWins ? remote : local) }
  let at = gentle ? remoteAt : Math.max(localAt, remoteAt)
  if (gentle) {
    let kept = false
    for (const k of PLAIN_KEYS)
      if (local[k] !== defaults[k] && local[k] !== remote[k]) {
        ;(values as Record<string, unknown>)[k] = local[k]
        kept = true
      }
    // มีค่าของเครื่องนี้รวมเข้าไป = ชุดใหม่ ต้องใหม่กว่าของเดิมเพื่อส่งต่อให้เครื่องอื่น
    if (kept) at = Math.max(now, remoteAt + 1)
  }
  for (const set of KEY_SETS) {
    const [l, r] = [local[set.at], remote[set.at]]
    // เวลาเท่ากัน: ฝั่งที่มี key ชนะฝั่งที่ว่าง — มีทั้งคู่ (เช่น เครื่องเก่าสองเครื่องที่เวลาเป็น 0) ใช้ของฝั่งที่ชนะค่าทั่วไป จะได้ลงเอยตรงกัน
    const takeRemote = r > l || (r === l && Boolean(remote[set.key]) && (!local[set.key] || remoteWins))
    const from = takeRemote ? remote : local
    Object.assign(values, { [set.key]: from[set.key], [set.model]: from[set.model], [set.at]: from[set.at] })
  }
  return { values, at }
}

const same = (a: Shared, b: Shared) => SHARED_KEYS.every((k) => a[k] === b[k])

/**
 * ผลของการซิงก์การตั้งค่า: pulled = เครื่องนี้ได้ค่าใหม่ · pushed = ส่งขึ้น · both = ทั้งสองทาง · none = ตรงกันอยู่แล้ว
 * absent = ยังไม่มีการตั้งค่าใน Drive และเครื่องนี้ก็ยังไม่มีอะไรให้ส่ง · off = ปิดสวิตช์ไว้ · newer = ไฟล์มาจากแอปรุ่นใหม่กว่า
 */
export type SharedResult = 'pulled' | 'pushed' | 'both' | 'none' | 'absent' | 'off' | 'newer'

/**
 * ซิงก์การตั้งค่าร่วมกับ Drive คืน 'pulled' เมื่อเครื่องนี้ได้ค่าใหม่ 'pushed' เมื่อส่งขึ้น 'none' เมื่อไม่มีอะไรเปลี่ยน
 * ปิดสวิตช์ไว้ = ไม่อ่านและไม่เขียนไฟล์นี้เลย
 */
export async function syncShared(
  store: RemoteStore,
  io: { load: () => Settings; save: (s: Settings) => void; defaults: Settings },
  now = Date.now(),
): Promise<SharedResult> {
  const local = io.load()
  if (!local.syncSettings) return 'off'
  const mine = pickShared(local)
  let remote: Shared | null = null
  let remoteAt = 0
  const names = await store.names()
  if (names.has(SETTINGS_FILE)) {
    try {
      const file = JSON.parse(await (await store.get(SETTINGS_FILE))!.text()) as SharedFile
      // ไฟล์จากแอปรุ่นใหม่กว่า: ไม่อ่านและไม่เขียนทับ รอให้เครื่องนี้อัปเดตก่อน
      if (typeof file?.version === 'number' && file.version > FILE_VERSION) return 'newer'
      if (file?.version === FILE_VERSION && typeof file.sharedAt === 'number') {
        remote = clean(file.values, mine, now)
        remoteAt = stamp(file.sharedAt, now)
      }
    } catch {
      // ไฟล์อ่านไม่ได้: ถือว่ายังไม่มี แล้วเขียนใหม่จากเครื่องนี้
    }
  }
  // ยังไม่มีไฟล์ และเครื่องนี้ยังไม่มีอะไรให้แบ่ง (ไม่มี key และไม่เคยแก้การตั้งค่า): ไม่ต้องสร้างไฟล์
  if (!remote && !local.sharedAt && !mine.geminiKey && !mine.claudeKey) return 'absent'
  const merged = mergeShared(mine, local.sharedAt, remote, remoteAt, pickShared(io.defaults), now, local.lastSyncAt === 0)
  const pull = !same(merged.values, mine)
  const push = !remote || !same(merged.values, remote) || merged.at !== remoteAt
  // ผู้ใช้แก้การตั้งค่าระหว่างรอเครือข่าย: รอบนี้ไม่บันทึกทับ ปล่อยให้รอบถัดไปรวมใหม่ (การแก้นั้นทำเครื่องหมายค้างซิงก์ไว้แล้ว)
  const latest = io.load()
  if (latest.sharedAt !== local.sharedAt || !same(pickShared(latest), mine)) return 'none'
  if (pull || local.sharedAt !== merged.at) io.save({ ...latest, ...merged.values, sharedAt: merged.at })
  if (push) {
    const file: SharedFile = { version: FILE_VERSION, sharedAt: merged.at, values: merged.values }
    await store.put(SETTINGS_FILE, new Blob([JSON.stringify(file)], { type: 'application/json' }))
  }
  return pull && push ? 'both' : pull ? 'pulled' : push ? 'pushed' : 'none'
}
