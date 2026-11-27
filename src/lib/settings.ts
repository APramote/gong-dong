/** ค่าตั้งค่าที่อยู่เฉพาะเครื่องนี้ (ไม่ sync) — API key ไม่ออกจากเครื่องนอกจากส่งให้ Google โดยตรง */
const KEY = 'gong-dong.settings'

export interface Settings {
  geminiKey: string
  geminiModel: string
}

const defaults: Settings = { geminiKey: '', geminiModel: '' }

export function loadSettings(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...defaults }
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}
