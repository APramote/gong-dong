import Anthropic from '@anthropic-ai/sdk'
import {
  AiError,
  cleanStorage,
  storagePrompt,
  storageSchema,
  type StorageKind,
  type StorageScan,
  booksSchema,
  cleanBooks,
  enrichPrompt,
  parseEnrichmentText,
  recognizePrompt,
  type Enrichment,
  type RecognizedBook,
} from './aiCommon'

const isHaiku = (model: string) => model.startsWith('claude-haiku')

function client(key: string): Anthropic {
  if (!key) throw new AiError('no-key')
  // แอปไม่มีเซิร์ฟเวอร์ key เก็บในเครื่องผู้ใช้เอง จึงต้องเรียกจากเบราว์เซอร์ตรง
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 })
}

/**
 * ถ้ารุ่นหลักปฏิเสธคำขอ ให้ API ส่งต่อไปรุ่นสำรองเองในคำขอเดียวกัน
 * Haiku 5.5 ไม่มีรุ่นสำรองฝั่งเซิร์ฟเวอร์
 */
const fallback = (model: string) =>
  isHaiku(model)
    ? {}
    : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }

export function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e
  // ข้อความจาก API อยู่ใน e.error.error.message ส่วน e.message มี JSON ดิบปน
  const apiMessage = (e as { error?: { error?: { message?: string } } })?.error?.error?.message
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new AiError('bad-key', e.message)
  if (e instanceof Anthropic.RateLimitError) {
    const retry = parseFloat(e.headers?.get('retry-after') ?? '')
    return new AiError('quota', e.message, {
      period: 'minute',
      search: false,
      model: '',
      limit: '',
      retrySeconds: Number.isFinite(retry) ? Math.ceil(retry) : null,
      id: '',
      message: (apiMessage ?? e.message).slice(0, 300),
    })
  }
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message))
    return new AiError('credit', e.message)
  if (e instanceof Anthropic.APIConnectionError) return new AiError('network', e.message)
  if (e instanceof Anthropic.APIError)
    return new AiError('other', `${e.status} ${apiMessage ?? e.message}`.slice(0, 300))
  return new AiError('other', String(e))
}

const textOf = (content: { type: string }[]) =>
  content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')

/** ตรวจว่า key ใช้ได้ — ดึงข้อมูลรุ่น ไม่เสียค่า token */
export async function checkClaudeKey(key: string, model: string): Promise<void> {
  try {
    await client(key).models.retrieve(model)
  } catch (e) {
    throw toAiError(e)
  }
}

export async function recognizeBooksClaude(
  key: string,
  model: string,
  imageBase64: string,
  mode: 'cover' | 'spine',
): Promise<RecognizedBook[]> {
  try {
    const res = await client(key).beta.messages.create({
      model,
      max_tokens: 16000,
      ...fallback(model),
      output_config: { format: { type: 'json_schema', schema: booksSchema as never } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: recognizePrompt(mode) },
          ],
        },
      ],
    })
    if (res.stop_reason === 'refusal') throw new AiError('refusal')
    let parsed: any
    try {
      parsed = JSON.parse(textOf(res.content))
    } catch {
      throw new AiError('other', 'unreadable response')
    }
    return cleanBooks(parsed?.books)
  } catch (e) {
    throw toAiError(e)
  }
}

export async function enrichBookClaude(
  key: string,
  model: string,
  book: { title: string; authors: string; publisher: string; isbn: string },
): Promise<Enrichment> {
  // Haiku ใช้เครื่องมือค้นเว็บรุ่นพื้นฐาน รุ่นอื่นใช้รุ่นที่กรองผลค้นได้เอง
  const webSearch = isHaiku(model)
    ? ({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as const)
    : ({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 } as const)
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    { role: 'user', content: enrichPrompt(book) },
  ]
  const links: { title: string; url: string }[] = []
  try {
    const c = client(key)
    // การค้นเว็บอาจหยุดกลางทาง (pause_turn) ส่งคำตอบเดิมกลับไปเพื่อให้ทำต่อ
    for (let round = 0; round < 4; round++) {
      const res = await c.beta.messages.create({
        model,
        max_tokens: 16000,
        ...fallback(model),
        tools: [webSearch],
        messages,
      })
      if (res.stop_reason === 'refusal') throw new AiError('refusal')
      for (const block of res.content) {
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) links.push({ title: r.title, url: r.url })
        }
      }
      if (res.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: res.content as never })
        continue
      }
      return parseEnrichmentText(textOf(res.content), links)
    }
    throw new AiError('other', 'web search did not finish')
  } catch (e) {
    throw toAiError(e)
  }
}

export async function scanStorageClaude(
  key: string,
  model: string,
  imageBase64: string,
  kind: StorageKind,
): Promise<StorageScan> {
  try {
    const res = await client(key).beta.messages.create({
      model,
      max_tokens: 16000,
      ...fallback(model),
      output_config: { format: { type: 'json_schema', schema: storageSchema as never } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: storagePrompt(kind) },
          ],
        },
      ],
    })
    if (res.stop_reason === 'refusal') throw new AiError('refusal')
    let parsed: any
    try {
      parsed = JSON.parse(textOf(res.content))
    } catch {
      throw new AiError('other', 'unreadable response')
    }
    return cleanStorage(parsed, kind)
  } catch (e) {
    throw toAiError(e)
  }
}
