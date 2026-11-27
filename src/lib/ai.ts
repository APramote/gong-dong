import type { CoverBook, Enrichment, RecognizedBook, StorageKind, StorageScan } from './aiCommon'
import { enrichBook, recognizeBooks, recognizeCovers, scanStorage } from './gemini'
import { loadSettings, type Settings } from './settings'

/** ใช้ผู้ให้บริการ AI ตามที่เลือกในหน้าตั้งค่า — โหลด Claude SDK เฉพาะตอนใช้ Claude */

const claude = () => import('./claude')

export function aiReady(s: Settings = loadSettings()): boolean {
  return s.provider === 'claude'
    ? Boolean(s.claudeKey && s.claudeModel)
    : Boolean(s.geminiKey && s.geminiModel)
}

export async function recognize(imageBase64: string, mode: 'cover' | 'spine'): Promise<RecognizedBook[]> {
  const s = loadSettings()
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
  const s = loadSettings()
  return s.provider === 'claude'
    ? (await claude()).enrichBookClaude(s.claudeKey, s.claudeModel, book)
    : enrichBook(s.geminiKey, s.geminiModel, book)
}

export async function checkClaudeKey(key: string, model: string): Promise<void> {
  return (await claude()).checkClaudeKey(key, model)
}

export async function scan(imageBase64: string, kind: StorageKind): Promise<StorageScan> {
  const s = loadSettings()
  return s.provider === 'claude'
    ? (await claude()).scanStorageClaude(s.claudeKey, s.claudeModel, imageBase64, kind)
    : scanStorage(s.geminiKey, s.geminiModel, imageBase64, kind)
}

export async function covers(imageBase64: string): Promise<CoverBook[]> {
  const s = loadSettings()
  return s.provider === 'claude'
    ? (await claude()).recognizeCoversClaude(s.claudeKey, s.claudeModel, imageBase64)
    : recognizeCovers(s.geminiKey, s.geminiModel, imageBase64)
}
