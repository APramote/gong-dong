import { AiError, type BookcaseScan, type CoverBook, type Enrichment, type RecognizedBook } from './aiCommon'
import { enrichBook, generateJson, listModels, recognizeBooks, recognizeCovers, scanBookcase } from './gemini'
import { loadSettings, type Settings } from './settings'

/** ใช้ผู้ให้บริการ AI ตามที่เลือกในหน้าตั้งค่า — โหลด Claude SDK เฉพาะตอนใช้ Claude */

const claude = () => import('./claude')

/** ผู้ใช้เปิดใช้ AI อยู่หรือไม่ (ไม่สนว่ามี key หรือยัง) */
export const aiOn = (s: Settings = loadSettings()) => s.aiEnabled

/** การตั้งค่าที่ใช้เรียก AI — ถ้าปิด AI ไว้ ไม่ส่งอะไรออกไปเลย */
function active(): Settings {
  const s = loadSettings()
  if (!s.aiEnabled) throw new AiError('off')
  return s
}

export function aiReady(s: Settings = loadSettings()): boolean {
  if (!s.aiEnabled) return false
  return s.provider === 'claude'
    ? Boolean(s.claudeKey && s.claudeModel)
    : Boolean(s.geminiKey && s.geminiModel)
}

export async function recognize(imageBase64: string, mode: 'cover' | 'spine'): Promise<RecognizedBook[]> {
  const s = active()
  return s.provider === 'claude'
    ? (await claude()).recognizeBooksClaude(s.claudeKey, s.claudeModel, imageBase64, mode)
    : recognizeBooks(s.geminiKey, s.geminiModel, imageBase64, mode)
}

export async function enrich(book: {
  title: string
  authors: string
  publisher: string
  isbn: string
}): Promise<Enrichment> {
  const s = active()
  return s.provider === 'claude'
    ? (await claude()).enrichBookClaude(s.claudeKey, s.claudeModel, book)
    : enrichBook(s.geminiKey, s.geminiModel, book)
}

/** รายชื่อรุ่น Gemini (ใช้ตรวจ key) — ผ่านด่านปิด AI เหมือนการเรียกอื่น */
export async function listGeminiModels(key: string): Promise<string[]> {
  active()
  return listModels(key)
}

export async function checkClaudeKey(key: string, model: string): Promise<void> {
  active()
  return (await claude()).checkClaudeKey(key, model)
}

/** อ่านโครงสร้างตู้จากรูป */
export async function scanShape(imageBase64: string): Promise<BookcaseScan> {
  const s = active()
  return s.provider === 'claude'
    ? (await claude()).scanBookcaseClaude(s.claudeKey, s.claudeModel, imageBase64)
    : scanBookcase(s.geminiKey, s.geminiModel, imageBase64)
}

export async function covers(imageBase64: string): Promise<CoverBook[]> {
  const s = active()
  return s.provider === 'claude'
    ? (await claude()).recognizeCoversClaude(s.claudeKey, s.claudeModel, imageBase64)
    : recognizeCovers(s.geminiKey, s.geminiModel, imageBase64)
}

/** ถามด้วยข้อความ รับ JSON ตาม schema (JSON Schema มาตรฐาน) */
export async function askJson<T>(prompt: string, schema: object): Promise<T> {
  const s = active()
  return s.provider === 'claude'
    ? (await claude()).generateJsonClaude(s.claudeKey, s.claudeModel, prompt, schema)
    : generateJson(s.geminiKey, s.geminiModel, prompt, schema)
}
