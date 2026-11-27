import type { RemoteStore } from './sync'

/**
 * Google Drive เป็นที่เก็บกลาง ใช้โฟลเดอร์ข้อมูลของแอป (appDataFolder)
 * แอปเห็นเฉพาะไฟล์ที่ตัวเองสร้าง ไม่เห็นไฟล์อื่นใน Drive ของผู้ใช้
 * โทเคนเก็บในหน่วยความจำเท่านั้น (อายุราว 1 ชั่วโมง) ไม่บันทึกลงเครื่อง
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const GIS = 'https://accounts.google.com/gsi/client'
const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

export type DriveErrorKind = 'no-client' | 'blocked' | 'denied' | 'scope' | 'api-off' | 'wrong-account' | 'auth' | 'quota' | 'network' | 'other'
export class DriveError extends Error {
  kind: DriveErrorKind
  constructor(kind: DriveErrorKind, detail = '') {
    super(detail || kind)
    this.kind = kind
  }
}

interface TokenResponse {
  access_token?: string
  /** สิทธิ์ที่ผู้ใช้ติ๊กอนุญาตจริง (คั่นด้วยช่องว่าง) */
  scope?: string
  expires_in?: number
  error?: string
}
interface TokenClient {
  requestAccessToken(opts?: { prompt?: string; login_hint?: string }): void
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (r: TokenResponse) => void
            error_callback?: (e: { type?: string }) => void
          }): TokenClient
          revoke(accessToken: string, done?: () => void): void
        }
      }
    }
  }
}

let gis: Promise<void> | null = null
/** โหลดสคริปต์เข้าสู่ระบบของ Google เฉพาะเมื่อผู้ใช้กด sync */
function loadGis(): Promise<void> {
  gis ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gis = null
      s.remove()
      reject(new DriveError('network'))
    }
    document.head.append(s)
  })
  return gis
}

let token: { value: string; clientId: string; expires: number } | null = null

/** โทเคนที่ยังใช้ได้อยู่ในหน่วยความจำ (ไม่เปิดหน้าต่าง) — null ถ้าไม่มีหรือใกล้หมดอายุ */
export function cachedToken(clientId: string): string | null {
  return token && token.clientId === clientId.trim() && token.expires > Date.now() + 60_000 ? token.value : null
}

/** ขอโทเคน (เปิดหน้าต่างของ Google ให้ผู้ใช้อนุญาต) ต้องเรียกจากการกดปุ่ม ไม่อย่างนั้นเบราว์เซอร์จะบล็อกหน้าต่าง */
export async function signIn(clientId: string, hint = ''): Promise<string> {
  const id = clientId.trim()
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) throw new DriveError('no-client')
  if (token && token.clientId === id && token.expires > Date.now() + 60_000) return token.value
  await loadGis()
  const oauth = window.google?.accounts.oauth2
  if (!oauth) throw new DriveError('network')
  return new Promise<string>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: id,
      scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) return reject(new DriveError(r.error === 'access_denied' ? 'denied' : 'auth', r.error))
        // หน้าขออนุญาตของ Google มีช่องให้ติ๊กทีละสิทธิ์ ถ้าไม่ติ๊ก โทเคนจะใช้กับ Drive ไม่ได้
        if (r.scope !== undefined && !r.scope.split(' ').includes(SCOPE)) return reject(new DriveError('scope'))
        token = { value: r.access_token, clientId: id, expires: Date.now() + (r.expires_in ?? 3600) * 1000 }
        resolve(r.access_token)
      },
      error_callback: (e) => reject(new DriveError(e.type === 'popup_failed_to_open' ? 'blocked' : 'denied', e.type)),
    })
    // รู้บัญชีอยู่แล้วก็บอก Google ไว้ จะได้ไม่ต้องเลือกบัญชีซ้ำ
    client.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: 'select_account' })
  })
}

/**
 * ออกจากระบบ: ยกเลิกสิทธิ์ของโทเคนที่ถืออยู่แล้วลืมโทเคน
 * คืน true ถ้าได้สั่งยกเลิกสิทธิ์กับ Google (ไม่มีโทเคนในมือ เช่น เปิดแอปใหม่ = ไม่มีอะไรให้ยกเลิก)
 */
export function signOut(): boolean {
  const had = Boolean(token && window.google)
  if (token) window.google?.accounts.oauth2.revoke(token.value)
  token = null
  return had
}

export interface Account {
  email: string
  name: string
}

/**
 * เข้าสู่ระบบแล้วตรวจว่าเป็นบัญชีที่คาดไว้
 * (login_hint เป็นแค่คำแนะนำ ผู้ใช้เลือกบัญชีอื่นในหน้าต่างของ Google ได้
 *  ถ้าไม่ตรวจ ข้อมูลอาจถูกรวมหรือถูกลบในบัญชีที่ไม่ได้ตั้งใจ)
 */
export async function connect(clientId: string, expectedEmail = ''): Promise<{ token: string; email: string }> {
  const value = await signIn(clientId, expectedEmail)
  const who = await account(value)
  if (expectedEmail && who.email.toLowerCase() !== expectedEmail.toLowerCase()) {
    // ไม่ใช้โทเคนของบัญชีที่ไม่ตรง และไม่เก็บไว้ให้ครั้งต่อไปหยิบไปใช้
    token = null
    throw new DriveError('wrong-account', who.email)
  }
  return { token: value, email: who.email }
}

/** บัญชี Google ที่อนุญาตไว้ (ถามจาก Drive ใช้สิทธิ์เดิม ไม่ต้องขอสิทธิ์อ่านโปรไฟล์เพิ่ม) */
export async function account(accessToken: string): Promise<Account> {
  const res = await call(accessToken, 'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)')
  const user = ((await res.json()) as { user?: { displayName?: string; emailAddress?: string } }).user
  return { email: String(user?.emailAddress ?? ''), name: String(user?.displayName ?? '') }
}

async function call(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } })
  } catch {
    throw new DriveError('network')
  }
  if (res.ok) return res
  if (res.status === 401) {
    token = null
    throw new DriveError('auth')
  }
  // 403 มีหลายสาเหตุ แยกจากเหตุผลที่ Google ส่งมา
  const body = await res.text().catch(() => '')
  let reason = ''
  let message = ''
  try {
    const err = (JSON.parse(body) as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } }).error
    reason = err?.errors?.[0]?.reason ?? err?.status ?? ''
    message = err?.message ?? ''
  } catch {
    // ไม่ใช่ JSON ใช้รหัสสถานะอย่างเดียว
  }
  const detail = `${res.status} ${reason} ${message}`.trim().slice(0, 240)
  if (res.status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason + message) || /has not been used|is disabled/i.test(message))
      throw new DriveError('api-off', detail)
    if (/insufficient|scope/i.test(reason + message)) throw new DriveError('scope', detail)
    if (/storageQuota|rateLimit|quota/i.test(reason + message)) throw new DriveError('quota', detail)
  }
  throw new DriveError('other', detail)
}

/** ที่เก็บไฟล์ใน appDataFolder ของบัญชีที่อนุญาต */
export function driveStore(accessToken: string): RemoteStore {
  /** ชื่อไฟล์ → id ทุกตัวที่ใช้ชื่อนั้น (สองเครื่องสร้างพร้อมกันได้ชื่อซ้ำ ตัวแรกคือตัวที่ใช้) */
  let ids: Map<string, string[]> | null = null
  async function list(): Promise<Map<string, string[]>> {
    if (ids) return ids
    const found = new Map<string, string[]>()
    let pageToken = ''
    do {
      const q = new URLSearchParams({
        spaces: 'appDataFolder',
        fields: 'nextPageToken,files(id,name)',
        pageSize: '1000',
        orderBy: 'createdTime',
      })
      if (pageToken) q.set('pageToken', pageToken)
      const data = (await (await call(accessToken, `${API}?${q}`)).json()) as {
        nextPageToken?: string
        files?: { id: string; name: string }[]
      }
      for (const f of data.files ?? []) found.set(f.name, [...(found.get(f.name) ?? []), f.id])
      pageToken = data.nextPageToken ?? ''
    } while (pageToken)
    ids = found
    return found
  }
  return {
    async names() {
      return new Set((await list()).keys())
    },
    async get(name) {
      const id = (await list()).get(name)?.[0]
      if (!id) return null
      return (await call(accessToken, `${API}/${encodeURIComponent(id)}?alt=media`)).blob()
    },
    async put(name, blob) {
      const map = await list()
      let id = map.get(name)?.[0]
      if (!id) {
        // สร้างไฟล์เปล่าก่อน แล้วค่อยส่งเนื้อหา (สองขั้นตอนตามเอกสารของ Drive)
        const made = (await (
          await call(accessToken, `${API}?fields=id`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, parents: ['appDataFolder'] }),
          })
        ).json()) as { id: string }
        id = made.id
        map.set(name, [id])
      }
      await call(accessToken, `${UPLOAD}/${encodeURIComponent(id)}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
      })
    },
    async del(name) {
      const map = await list()
      // ลบทุกไฟล์ที่ใช้ชื่อนี้ ไม่เหลือสำเนาซ้ำที่จะโผล่กลับมา
      for (const id of map.get(name) ?? []) await call(accessToken, `${API}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      map.delete(name)
    },
  }
}
