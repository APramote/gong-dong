const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export type GeminiErrorKind = 'no-key' | 'bad-key' | 'quota' | 'network' | 'other'

export class GeminiError extends Error {
  constructor(
    public kind: GeminiErrorKind,
    message: string = kind,
  ) {
    super(message)
  }
}

export interface RecognizedBook {
  title: string
  authors: string
  publisher: string
}

async function call(path: string, key: string, body?: unknown): Promise<any> {
  if (!key) throw new GeminiError('no-key')
  let res: Response
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new GeminiError('network')
  }
  if (res.ok) return res.json()
  const detail = await res.text().catch(() => '')
  if (res.status === 429) throw new GeminiError('quota', detail)
  // key ผิดรูปแบบได้ 400, key ถูกปิดหรือไม่มีสิทธิ์ได้ 401/403
  if (res.status === 401 || res.status === 403 || /API key not valid|API_KEY_INVALID/.test(detail))
    throw new GeminiError('bad-key', detail)
  throw new GeminiError('other', `${res.status} ${detail.slice(0, 300)}`)
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

const PROMPTS = {
  cover:
    'This photo shows the front cover of one book. Read the cover and return that book. ' +
    'If the photo clearly shows several separate books, return each of them.',
  spine:
    'This photo shows book spines on a shelf or in a stack. Return every book whose spine is ' +
    'at least partly readable, in order from left to right (for a horizontal stack: top to bottom). ' +
    'Do not skip thin spines if any text on them is readable.',
}

const RULES =
  ' Keep titles, author names and publisher names exactly in the script printed on the book ' +
  '(Thai stays Thai, do not translate or romanize). Use an empty string for anything you cannot read. ' +
  'Never invent a book that is not visible in the photo.'

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
          { text: PROMPTS[mode] + RULES },
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
  let rows: unknown
  try {
    rows = JSON.parse(text)
  } catch {
    throw new GeminiError('other', 'unreadable response')
  }
  if (!Array.isArray(rows)) return []
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return rows
    .map((r: any) => ({ title: str(r?.title), authors: str(r?.authors), publisher: str(r?.publisher) }))
    .filter((b) => b.title)
}
