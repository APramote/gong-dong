import { DEFAULT_CLAUDE_MODEL } from './claudeModels'

/**
 * ค่าตั้งค่าที่อยู่เฉพาะเครื่องนี้ (ไม่ sync)
 * API key ไม่ออกจากเครื่อง นอกจากส่งให้ผู้ให้บริการ AI โดยตรง
 */
const KEY = 'gong-dong.settings'

export type Provider = 'gemini' | 'claude'

/** OAuth Client ID ของแอปนี้ (ค่าสาธารณะ ไม่ใช่รหัสลับ) ใช้เมื่อผู้ใช้ไม่ได้ใส่ค่าของตัวเอง */
export const DEFAULT_GOOGLE_CLIENT_ID = '671313942998-kui8lp7ujc4r2kmtf62ucm7dk9ldmg46.apps.googleusercontent.com'

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
  /** OAuth Client ID ที่ผู้ใช้ใส่เอง (ว่าง = ใช้ค่าของแอป) */
  googleClientId: string
  /** เวลาที่ sync สำเร็จล่าสุด (0 = ยังไม่เคย) */
  lastSyncAt: number
  /** อีเมลบัญชี Google ที่เข้าสู่ระบบไว้ (ว่าง = ยังไม่เข้า) — เก็บไว้แสดงผล ไม่ใช่โทเคน */
  googleAccount: string
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
  googleClientId: '',
  lastSyncAt: 0,
  googleAccount: '',
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
