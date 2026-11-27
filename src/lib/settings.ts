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
  /** เป้าจำนวนเล่มที่อ่านจบต่อปี */
  yearGoalBooks: number
}

const defaults: Settings = {
  aiEnabled: true,
  provider: 'gemini',
  geminiKey: '',
  geminiModel: '',
  claudeKey: '',
  claudeModel: DEFAULT_CLAUDE_MODEL,
  dailyGoalMinutes: 20,
  yearGoalBooks: 12,
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
