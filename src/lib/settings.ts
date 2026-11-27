import { DEFAULT_CLAUDE_MODEL } from './claudeModels'

/**
 * ค่าตั้งค่าที่อยู่เฉพาะเครื่องนี้ (ไม่ sync)
 * API key ไม่ออกจากเครื่อง นอกจากส่งให้ผู้ให้บริการ AI โดยตรง
 */
const KEY = 'gong-dong.settings'

export type Provider = 'gemini' | 'claude'

export interface Settings {
  /** ปิดแล้วแอปไม่ส่งข้อมูลหรือรูปให้ AI เลย (key ที่บันทึกไว้ยังอยู่) */
  aiEnabled: boolean
  provider: Provider
  geminiKey: string
  geminiModel: string
  claudeKey: string
  claudeModel: string
  /** เป้าเวลาอ่านต่อวัน (นาที) */
  dailyGoalMinutes: number
  /** เป้าจำนวนหน้าที่อ่านต่อวัน */
  dailyGoalPages: number
  /** เป้าจำนวนเล่มที่อ่านจบต่อปี */
  yearGoalBooks: number
  /** เตือนเวลาอ่าน: วันในสัปดาห์ (0 = อาทิตย์) และเวลา HH:MM */
  reminderDays: number[]
  reminderTime: string
  /** OAuth Client ID ของ Google (ไม่ใช่รหัสลับ) ใช้ sync กับ Google Drive */
  googleClientId: string
  /** เวลาที่ sync สำเร็จล่าสุด (0 = ยังไม่เคย) */
  lastSyncAt: number
}

const defaults: Settings = {
  aiEnabled: true,
  provider: 'gemini',
  geminiKey: '',
  geminiModel: '',
  claudeKey: '',
  claudeModel: DEFAULT_CLAUDE_MODEL,
  dailyGoalMinutes: 20,
  dailyGoalPages: 20,
  yearGoalBooks: 12,
  reminderDays: [0, 1, 2, 3, 4, 5, 6],
  reminderTime: '21:00',
  googleClientId: '',
  lastSyncAt: 0,
}

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
