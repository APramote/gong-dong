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

export type DriveErrorKind = 'no-client' | 'blocked' | 'denied' | 'auth' | 'quota' | 'network' | 'other'
export class DriveError extends Error {
  kind: DriveErrorKind
  constructor(kind: DriveErrorKind, detail = '') {
    super(detail || kind)
    this.kind = kind
  }
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
}
interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void
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

/** ขอโทเคน (เปิดหน้าต่างของ Google ให้ผู้ใช้อนุญาต) ต้องเรียกจากการกดปุ่ม ไม่อย่างนั้นเบราว์เซอร์จะบล็อกหน้าต่าง */
export async function signIn(clientId: string): Promise<string> {
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
        token = { value: r.access_token, clientId: id, expires: Date.now() + (r.expires_in ?? 3600) * 1000 }
        resolve(r.access_token)
      },
      error_callback: (e) => reject(new DriveError(e.type === 'popup_failed_to_open' ? 'blocked' : 'denied', e.type)),
    })
    client.requestAccessToken({ prompt: '' })
  })
}

export function signOut(): void {
  token = null
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
  // 403 มีทั้งโควตาเต็มและยังไม่ได้เปิด Drive API แยกจากข้อความที่ Google ส่งมา
  const body = await res.text().catch(() => '')
  if (res.status === 403 && /storageQuota|rateLimit|quota/i.test(body)) throw new DriveError('quota')
  throw new DriveError('other', `${res.status} ${body.slice(0, 200)}`)
}

/** ที่เก็บไฟล์ใน appDataFolder ของบัญชีที่อนุญาต */
export function driveStore(accessToken: string): RemoteStore {
  let ids: Map<string, string> | null = null
  async function list(): Promise<Map<string, string>> {
    if (ids) return ids
    const found = new Map<string, string>()
    let pageToken = ''
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name)', pageSize: '1000' })
      if (pageToken) q.set('pageToken', pageToken)
      const data = (await (await call(accessToken, `${API}?${q}`)).json()) as {
        nextPageToken?: string
        files?: { id: string; name: string }[]
      }
      // ชื่อซ้ำ (เกิดได้ถ้าสองเครื่องสร้างพร้อมกัน) ใช้ไฟล์แรกที่เจอ
      for (const f of data.files ?? []) if (!found.has(f.name)) found.set(f.name, f.id)
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
      const id = (await list()).get(name)
      if (!id) return null
      return (await call(accessToken, `${API}/${encodeURIComponent(id)}?alt=media`)).blob()
    },
    async put(name, blob) {
      const map = await list()
      let id = map.get(name)
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
        map.set(name, id)
      }
      await call(accessToken, `${UPLOAD}/${encodeURIComponent(id)}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
      })
    },
    async del(name) {
      const map = await list()
      const id = map.get(name)
      if (!id) return
      await call(accessToken, `${API}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      map.delete(name)
    },
  }
}
