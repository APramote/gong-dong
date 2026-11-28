import { DEFAULT_CLAUDE_MODEL } from './claudeModels'

/**
 * ค่าตั้งค่าของแอป เก็บในเครื่องนี้
 * ส่วนที่ใช้ร่วมกันทุกเครื่อง (AI รวม API key และเป้าการอ่าน) ซิงก์ไปยังโฟลเดอร์ข้อมูลของแอปใน Google Drive ของผู้ใช้เอง
 * เมื่อเปิดสวิตช์ "ใช้การตั้งค่า AI เดียวกันทุกเครื่อง" (ดู sharedSettings.ts) — key ไม่ถูกส่งไปที่อื่นนอกจากผู้ให้บริการ AI และ Drive ของผู้ใช้
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
  /** จำนวนหมวดสูงสุดที่อยากมี AI จะไม่ตั้งหมวดเกินนี้ */
  maxCategories: number
  /** วิธีจัดระเบียบที่เลือกครั้งล่าสุด */
  organizeMode: 'minimal' | 'full'
  /** OAuth Client ID ที่ผู้ใช้ใส่เอง (ว่าง = ใช้ค่าของแอป) */
  googleClientId: string
  /** เวลาที่ sync สำเร็จล่าสุด (0 = ยังไม่เคย) */
  lastSyncAt: number
  /** อีเมลบัญชี Google ที่เข้าสู่ระบบไว้ (ว่าง = ยังไม่เข้า) — เก็บไว้แสดงผล ไม่ใช่โทเคน */
  googleAccount: string
  /** ซิงก์อัตโนมัติหลังแก้ไข (ปิด = ซิงก์เฉพาะตอนกดเอง) */
  autoSync: boolean
  /** ซิงก์การตั้งค่า AI (รวม API key) และเป้าการอ่านไปทุกเครื่องผ่าน Google Drive ของผู้ใช้ */
  syncSettings: boolean
  /** เวลาที่การตั้งค่าที่ใช้ร่วมกันถูกแก้ล่าสุดในเครื่องนี้ (0 = ยังไม่เคยแก้) */
  sharedAt: number
  /** เวลาที่ key แต่ละตัวถูกใส่ เปลี่ยน หรือลบล่าสุด (0 = ไม่เคยแตะ) ใช้ตัดสินว่า key ของเครื่องไหนใหม่กว่า รวมถึงการลบโดยตั้งใจ */
  geminiKeyAt: number
  claudeKeyAt: number
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
  maxCategories: 12,
  organizeMode: 'minimal',
  googleClientId: '',
  lastSyncAt: 0,
  googleAccount: '',
  autoSync: true,
  syncSettings: true,
  sharedAt: 0,
  geminiKeyAt: 0,
  claudeKeyAt: 0,
}

/** ค่าเริ่มต้น (ใช้ดูว่าเครื่องนี้เคยตั้งค่าอะไรเองบ้าง) */
export const defaultSettings: Readonly<Settings> = defaults

export function loadSettings(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...defaults }
  }
}

/** การตั้งค่าที่ซิงก์ไปทุกเครื่อง (ต้องตรงกับ SHARED_KEYS ใน sharedSettings.ts) */
const SHARED: (keyof Settings)[] = [
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
]
let sharedListener: (() => void) | null = null
/** ตัวซิงก์อัตโนมัติลงทะเบียนไว้ จะได้รู้ว่ามีการตั้งค่าที่ต้องส่งขึ้น */
export const onSharedChange = (fn: () => void) => {
  sharedListener = fn
}

export function saveSettings(s: Settings): void {
  // การตั้งค่าที่ใช้ร่วมกันเปลี่ยน (และผู้เรียกไม่ได้กำหนดเวลามาเอง เช่น ค่าที่รับมาจาก Drive): จดเวลาไว้ให้ตัวซิงก์
  const before = loadSettings()
  const changed = SHARED.some((k) => before[k] !== s[k])
  // ผู้เรียกทั่วไปไม่แตะเวลา: จดให้เอง (เวลาต้องเดินหน้าเสมอ แม้นาฬิกาเครื่องเคยเดินเร็ว) ตัวซิงก์กำหนดเวลามาเองจึงไม่จดซ้ำ
  const mine = changed && s.sharedAt === before.sharedAt
  const now = Math.max(Date.now(), before.sharedAt + 1)
  const next = mine
    ? {
        ...s,
        sharedAt: now,
        ...(before.geminiKey !== s.geminiKey && s.geminiKeyAt === before.geminiKeyAt && { geminiKeyAt: now }),
        ...(before.claudeKey !== s.claudeKey && s.claudeKeyAt === before.claudeKeyAt && { claudeKeyAt: now }),
      }
    : s
  localStorage.setItem(KEY, JSON.stringify(next))
  if (mine) sharedListener?.()
}
