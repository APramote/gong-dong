const BASE = 'https://generativelanguage.googleapis.com/v1beta'

import {
  AiError,
  cleanCovers,
  coversPrompt,
  type CoverBook,
  bookcasePrompt,
  cleanBookcase,
  type BookcaseScan,
  cleanBooks,
  enrichPrompt,
  parseEnrichmentText,
  recognizePrompt,
  type Enrichment,
  type QuotaInfo,
  type RecognizedBook,
} from './aiCommon'

export { AiError as GeminiError }
export type { Enrichment, RecognizedBook }

export function parseQuota(body: string): QuotaInfo {
  let details: any[] = []
  let message = ''
  try {
    const err = JSON.parse(body)?.error
    details = err?.details ?? []
    message = String(err?.message ?? '')
  } catch {
    message = body
  }
  const v = details.find((d) => /QuotaFailure$/.test(d?.['@type'] ?? ''))?.violations?.[0] ?? {}
  const retry = details.find((d) => /RetryInfo$/.test(d?.['@type'] ?? ''))?.retryDelay
  const id = `${v.quotaId ?? ''} ${v.quotaMetric ?? ''}`.trim()
  const seconds = parseFloat(String(retry ?? ''))
  return {
    period: /PerDay/i.test(id) ? 'day' : /PerMinute/i.test(id) ? 'minute' : '',
    search: /search|ground/i.test(id),
    model: String(v.quotaDimensions?.model ?? ''),
    limit: String(v.quotaValue ?? ''),
    retrySeconds: Number.isFinite(seconds) ? Math.ceil(seconds) : null,
    id,
    message: message.replace(/\s+/g, ' ').trim().slice(0, 300),
  }
}


async function call(path: string, key: string, body?: unknown): Promise<any> {
  if (!key) throw new AiError('no-key')
  let res: Response
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new AiError('network')
  }
  if (res.ok) return res.json()
  const detail = await res.text().catch(() => '')
  if (res.status === 429) throw new AiError('quota', detail, parseQuota(detail))
  // key ผิดรูปแบบได้ 400, key ถูกปิดหรือไม่มีสิทธิ์ได้ 401/403
  if (res.status === 401 || res.status === 403 || /API key not valid|API_KEY_INVALID/.test(detail))
    throw new AiError('bad-key', detail)
  throw new AiError('other', `${res.status} ${detail.slice(0, 300)}`)
}

/** รุ่นที่อ่านภาพและตอบข้อความได้ ตัดรุ่นเฉพาะทาง (สร้างภาพ เสียง ฯลฯ) ออก */
export async function listModels(key: string): Promise<string[]> {
  const data = await call('models?pageSize=1000', key)
  return ((data.models ?? []) as any[])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''))
    .filter((id) => /^gemini-/.test(id) && !/image|tts|audio|live|embedding|robotics|computer/.test(id))
    .sort()
}

/** เลือกรุ่น Flash ตัวเสถียรที่เลขรุ่นสูงสุด (เร็วและอยู่ในโควตาฟรี) */
export function pickDefaultModel(ids: string[]): string {
  const stable = ids
    .map((id) => ({ id, m: /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(id) }))
    .filter((x) => x.m)
    .sort((a, b) => parseFloat(b.m![1]) - parseFloat(a.m![1]))
  return stable[0]?.id ?? ids.find((id) => id.includes('flash')) ?? ids[0] ?? ''
}

/** อ่านชื่อหนังสือจากรูปปกหรือรูปสันปก */
export async function recognizeBooks(
  key: string,
  model: string,
  imageBase64: string,
  mode: 'cover' | 'spine',
): Promise<RecognizedBook[]> {
  const data = await call(`models/${model}:generateContent`, key, {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: recognizePrompt(mode) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            authors: { type: 'STRING', description: 'Author names separated by ", "' },
            publisher: { type: 'STRING' },
          },
          required: ['title', 'authors', 'publisher'],
        },
      },
    },
  })
  return parseBooks(data)
}

export function parseBooks(data: any): RecognizedBook[] {
  const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => p.text ?? '')
    .join('')
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AiError('other', 'unreadable response')
  }
  // รองรับทั้งรูปแบบ { books: [...] } และอาร์เรย์ตรง ๆ
  return cleanBooks(Array.isArray(parsed) ? parsed : parsed?.books)
}

/**
 * ให้ Gemini ค้นเว็บด้วย Google Search แล้วสรุปข้อมูลหนังสือ
 * ใช้ JSON ในข้อความแทน responseSchema เพราะการค้นเว็บใช้คู่กับ schema ไม่ได้ในบางรุ่น
 */
export async function enrichBook(
  key: string,
  model: string,
  book: { title: string; authors: string; publisher: string; isbn: string },
): Promise<Enrichment> {
  const prompt = enrichPrompt(book)
  const data = await call(`models/${model}:generateContent`, key, {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0 },
  })
  return parseEnrichment(data)
}

export function parseEnrichment(data: any): Enrichment {
  const candidate = data?.candidates?.[0]
  const text: string = (candidate?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
  const links = ((candidate?.groundingMetadata?.groundingChunks ?? []) as any[]).map((c) => ({
    title: c?.web?.title,
    url: c?.web?.uri,
  }))
  return parseEnrichmentText(text, links)
}

/** อ่านโครงสร้างตู้จากรูป (ไม่อ่านหนังสือ) */
export async function scanBookcase(key: string, model: string, imageBase64: string): Promise<BookcaseScan> {
  const data = await call(`models/${model}:generateContent`, key, {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: bookcasePrompt() },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          shelfCount: { type: 'INTEGER' },
          color: { type: 'STRING', description: '#rrggbb' },
          ratio: { type: 'NUMBER' },
          drawerRows: { type: 'INTEGER' },
          drawersPerRow: { type: 'INTEGER' },
          doors: { type: 'INTEGER' },
          legs: { type: 'BOOLEAN' },
        },
        required: ['shelfCount', 'color', 'ratio', 'drawerRows', 'drawersPerRow', 'doors', 'legs'],
      },
    },
  })
  const text: string = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
  try {
    return cleanBookcase(JSON.parse(text))
  } catch {
    throw new AiError('other', 'unreadable response')
  }
}

/** อ่านปกหลายเล่มในรูปเดียว พร้อมกรอบของแต่ละปก */
export async function recognizeCovers(key: string, model: string, imageBase64: string): Promise<CoverBook[]> {
  const data = await call(`models/${model}:generateContent`, key, {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: coversPrompt() },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            authors: { type: 'STRING' },
            publisher: { type: 'STRING' },
            box: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '[ymin, xmin, ymax, xmax] 0-1000' },
          },
          required: ['title', 'authors', 'publisher', 'box'],
        },
      },
    },
  })
  const text: string = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AiError('other', 'unreadable response')
  }
  return cleanCovers(Array.isArray(parsed) ? parsed : parsed?.books)
}

/** แปลง JSON Schema มาตรฐานเป็นรูปแบบ schema ของ Gemini (ชนิดตัวพิมพ์ใหญ่ ไม่มี additionalProperties) */
export function toGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema
  const out: any = {}
  if (schema.type) out.type = String(schema.type).toUpperCase()
  if (schema.description) out.description = schema.description
  if (schema.enum) out.enum = schema.enum
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    )
  }
  if (schema.items) out.items = toGeminiSchema(schema.items)
  if (schema.required) out.required = schema.required
  return out
}

/** ส่งคำสั่งข้อความแล้วรับ JSON ตาม schema กลับมา */
export async function generateJson(key: string, model: string, prompt: string, schema: object): Promise<any> {
  const data = await call(`models/${model}:generateContent`, key, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) },
  })
  const text: string = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
  try {
    return JSON.parse(text)
  } catch {
    throw new AiError('other', 'unreadable response')
  }
}
