/** ส่วนที่ใช้ร่วมกันระหว่างผู้ให้บริการ AI (Gemini / Claude) */

export type AiErrorKind = 'no-key' | 'bad-key' | 'quota' | 'credit' | 'refusal' | 'network' | 'other'

/** รายละเอียดโควตาที่ได้จากคำตอบ 429 */
export interface QuotaInfo {
  /** 'day' = โควตารายวัน, 'minute' = ส่งถี่เกินต่อนาที, '' = ไม่ทราบ */
  period: 'day' | 'minute' | ''
  /** โควตาของการค้นเว็บ ไม่ใช่ของการเรียกโมเดล */
  search: boolean
  model: string
  limit: string
  retrySeconds: number | null
  /** ชื่อโควตาดิบจากผู้ให้บริการ ใช้แสดงประกอบเพื่อตรวจสอบ */
  id: string
  /** ข้อความ error ดิบจากผู้ให้บริการ */
  message: string
}

export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string = kind,
    public quota?: QuotaInfo,
  ) {
    super(message)
  }
}

export interface RecognizedBook {
  title: string
  authors: string
  publisher: string
}

export interface Enrichment {
  found: boolean
  authors: string
  publisher: string
  year: string
  pages: number | null
  isbn: string
  category: string
  synopsis: string
  blurb: string
  reviewSummary: string
  links: { title: string; url: string }[]
}

const RECOGNIZE = {
  cover:
    'This photo shows the front cover of one book. Read the cover and return that book. ' +
    'If the photo clearly shows several separate books, return each of them.',
  spine:
    'This photo shows book spines on a shelf or in a stack. Return every book whose spine is ' +
    'at least partly readable, in order from left to right (for a horizontal stack: top to bottom). ' +
    'Do not skip thin spines if any text on them is readable.',
}

const RECOGNIZE_RULES =
  ' Keep titles, author names and publisher names exactly in the script printed on the book ' +
  '(Thai stays Thai, do not translate or romanize). Use an empty string for anything you cannot read. ' +
  'Never invent a book that is not visible in the photo.'

export const recognizePrompt = (mode: 'cover' | 'spine') => RECOGNIZE[mode] + RECOGNIZE_RULES

/** JSON Schema ของรายการหนังสือที่อ่านจากรูป */
export const booksSchema = {
  type: 'object',
  properties: {
    books: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          authors: { type: 'string', description: 'Author names separated by ", "' },
          publisher: { type: 'string' },
        },
        required: ['title', 'authors', 'publisher'],
        additionalProperties: false,
      },
    },
  },
  required: ['books'],
  additionalProperties: false,
} as const

export function enrichPrompt(book: {
  title: string
  authors: string
  publisher: string
  isbn: string
}): string {
  const known = [
    `title: ${book.title}`,
    book.authors && `author: ${book.authors}`,
    book.publisher && `publisher: ${book.publisher}`,
    book.isbn && `ISBN: ${book.isbn}`,
  ]
    .filter(Boolean)
    .join('\n')
  return (
    'Search the web for this book and return facts about this exact edition or work.\n' +
    known +
    '\n\nReply with only one JSON object, no other text, with these keys:\n' +
    '"found" (boolean: false if you cannot confidently identify this exact book),\n' +
    '"authors", "publisher", "year" (4 digits), "pages" (number or null), "isbn", "category",\n' +
    '"synopsis" (what the book is about, 2-4 sentences, written in Thai),\n' +
    '"blurb" (the publisher\'s back-cover or marketing blurb, quoted in its original language, max 3 sentences),\n' +
    '"reviewSummary" (what readers and critics say: main praise and criticism, 2-3 sentences, written in Thai; ' +
    'summarise, never copy a review).\n' +
    'Use an empty string for anything you did not find. Never guess or invent facts. ' +
    'Keep names in the script used by the book (Thai stays Thai).'
  )
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** ทำความสะอาดรายการหนังสือจาก AI และทิ้งรายการที่ไม่มีชื่อ */
export function cleanBooks(rows: unknown): RecognizedBook[] {
  if (!Array.isArray(rows)) return []
  return rows
    .map((r: any) => ({ title: str(r?.title), authors: str(r?.authors), publisher: str(r?.publisher) }))
    .filter((b) => b.title)
}

/** แปลงข้อความคำตอบ (JSON ที่อาจมีข้อความปน) เป็น Enrichment */
export function parseEnrichmentText(
  text: string,
  rawLinks: { title?: unknown; url?: unknown }[],
): Enrichment {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let raw: any
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new AiError('other', 'unreadable response')
  }
  // ตัดเลขอ้างอิงแบบ [1] หรือ [1, 2] ที่ AI บางรุ่นใส่มา
  const clean = (v: unknown) => str(v).replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '')
  const pages = Number(raw?.pages)
  const seen = new Set<string>()
  const links = rawLinks
    .map((l) => ({ title: str(l.title), url: String(l.url ?? '') }))
    .filter((l) => /^https:\/\//.test(l.url) && !seen.has(l.url) && seen.add(l.url))
    .slice(0, 6)
  return {
    found: raw?.found === true,
    authors: clean(raw?.authors),
    publisher: clean(raw?.publisher),
    year: /\d{4}/.exec(clean(raw?.year))?.[0] ?? '',
    pages: Number.isInteger(pages) && pages > 0 ? pages : null,
    isbn: clean(raw?.isbn).replace(/[^0-9Xx]/g, ''),
    category: clean(raw?.category),
    synopsis: clean(raw?.synopsis),
    blurb: clean(raw?.blurb),
    reviewSummary: clean(raw?.reviewSummary),
    links,
  }
}
