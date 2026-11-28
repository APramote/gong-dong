/** ส่วนที่ใช้ร่วมกันระหว่างผู้ให้บริการ AI (Gemini / Claude) */

export type AiErrorKind = 'off' | 'no-key' | 'bad-key' | 'quota' | 'credit' | 'refusal' | 'network' | 'other'

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
  /** คำโปรยนี้ AI เขียนเอง (หาคำโปรยจริงไม่เจอ) */
  blurbAi: boolean
  /** แท็กที่ AI ตั้งให้จากเนื้อหาของหนังสือ */
  tags: string[]
  /** สีปก (#rrggbb): สีหลักของปกจริงถ้ารู้ ไม่รู้ก็เป็นสีที่เข้ากับหนังสือ — '' = ไม่ได้ให้มา */
  coverColor: string
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
    '"blurb" (the publisher\'s back-cover or marketing blurb, quoted in its original language, max 3 sentences; ' +
    'if you cannot find a real one, write a short inviting blurb of 1-2 sentences in Thai based only on the synopsis),\n' +
    '"blurbWritten" (boolean: true if you wrote the blurb yourself, false if it is quoted from a source),\n' +
    '"tags" (array of 3-5 short topic tags in Thai that you choose from what the book is about, e.g. ["ประวัติศาสตร์","ชีวประวัติ"]),\n' +
    '"coverColor" (hex colour like "#7a4b2a": the dominant colour of the real cover if you know it, otherwise a colour that suits the book),\n' +
    '"reviewSummary" (what readers and critics say: main praise and criticism, 2-3 sentences, written in Thai; ' +
    'summarise, never copy a review).\n' +
    'Use an empty string for anything you did not find. Never guess or invent facts ' +
    '(the self-written blurb, the tags and the colour are the only things you may compose yourself). ' +
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
    blurbAi: raw?.blurbWritten === true && Boolean(clean(raw?.blurb)),
    tags: Array.isArray(raw?.tags)
      ? [...new Set((raw.tags as unknown[]).map((x) => clean(x).replace(/^#/, '').slice(0, 30)).filter(Boolean))].slice(0, 5)
      : [],
    coverColor: /^#[0-9a-f]{6}$/i.test(str(raw?.coverColor)) ? str(raw?.coverColor).toLowerCase() : '',
  }
}

// ---------- อ่านโครงสร้างตู้จากรูป ----------

/** ประเภทที่เก็บที่สร้างจากรูปได้ (เฉพาะตู้ที่ใช้ AI กอง/กล่องแค่จำรูป) */
export type StorageKind = 'bookcase' | 'pile' | 'box'

/** โครงสร้างตู้ที่อ่านจากรูป — ไม่รวมหนังสือ เพื่อความแม่นยำ */
export interface BookcaseScan {
  /** สีหลักของตู้ #rrggbb */
  color: string
  /** สัดส่วนกว้าง/สูงที่เห็นในรูป (0 = ไม่ทราบ) */
  ratio: number
  /** จำนวนชั้นวาง (อย่างน้อย 1) */
  shelfCount: number
  drawerRows: number
  drawersPerRow: number
  /** บานปิดหน้าชั้น (0, 1, 2) */
  doors: number
  legs: boolean
}

export const bookcasePrompt = () =>
  'This photo shows a bookcase. Describe only its structure; do not read or list any books. Return ' +
  '"shelfCount": the number of open shelf levels that can hold books (count empty ones too, do not count drawers), ' +
  '"color": the main colour of the bookcase as #rrggbb, "ratio": its visible width divided by height, ' +
  '"drawerRows" (rows of drawers below the shelves, 0 if none), "drawersPerRow" (drawers side by side in one row, ' +
  '0 if none), "doors" (number of glass or other doors covering the shelves: 0, 1 or 2) and "legs" (true if it ' +
  'stands on visible legs).'

/** JSON Schema ของโครงสร้างตู้ (สำหรับ Claude) */
export const bookcaseSchema = {
  type: 'object',
  properties: {
    shelfCount: { type: 'integer' },
    color: { type: 'string' },
    ratio: { type: 'number' },
    drawerRows: { type: 'integer' },
    drawersPerRow: { type: 'integer' },
    doors: { type: 'integer' },
    legs: { type: 'boolean' },
  },
  required: ['shelfCount', 'color', 'ratio', 'drawerRows', 'drawersPerRow', 'doors', 'legs'],
  additionalProperties: false,
} as const

const hex = (v: unknown) => {
  const m = /#?([0-9a-f]{6})\b/i.exec(typeof v === 'string' ? v : '')
  return m ? `#${m[1].toLowerCase()}` : ''
}

const clampInt = (v: unknown, max: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0
}

/** ทำความสะอาดผลอ่านโครงสร้างตู้: ค่าผิดรูปแบบใช้ค่าปลอดภัยแทน */
export function cleanBookcase(raw: any): BookcaseScan {
  const ratio = Number(raw?.ratio)
  const drawerRows = clampInt(raw?.drawerRows, 4)
  return {
    color: hex(raw?.color),
    ratio: Number.isFinite(ratio) && ratio > 0.1 && ratio < 10 ? ratio : 0,
    shelfCount: Math.max(1, clampInt(raw?.shelfCount, 20)),
    drawerRows,
    // มีแถวลิ้นชักแต่ไม่บอกจำนวนต่อแถว ถือว่าแถวละ 2
    drawersPerRow: drawerRows ? clampInt(raw?.drawersPerRow, 6) || 2 : 0,
    doors: clampInt(raw?.doors, 2),
    legs: raw?.legs === true,
  }
}

// ---------- อ่านปกหลายเล่มในรูปเดียว ----------

export interface CoverBook extends RecognizedBook {
  /** กรอบปกในรูป [ymin, xmin, ymax, xmax] สเกล 0–1000 หรือ null ถ้าไม่ทราบ */
  box: [number, number, number, number] | null
}

export const coversPrompt = () =>
  'This photo shows the front covers of one or more books, usually laid side by side. Return every book whose ' +
  'cover is visible, ordered left to right, then top to bottom. For each book also return "box": the bounding box ' +
  'of its whole front cover as [ymin, xmin, ymax, xmax] with values normalised to 0-1000.' +
  RECOGNIZE_RULES

export const coversSchema = {
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
          box: { type: 'array', items: { type: 'integer' } },
        },
        required: ['title', 'authors', 'publisher', 'box'],
        additionalProperties: false,
      },
    },
  },
  required: ['books'],
  additionalProperties: false,
} as const

/** ทำความสะอาดผลอ่านปก: กรอบที่ผิดรูปแบบหรือเล็กเกินไปถือว่าไม่ทราบ */
export function cleanCovers(rows: unknown): CoverBook[] {
  if (!Array.isArray(rows)) return []
  return rows
    .map((r: any) => {
      const b = Array.isArray(r?.box) ? r.box.map(Number) : []
      const ok =
        b.length === 4 &&
        b.every((v: number) => Number.isFinite(v) && v >= 0 && v <= 1000) &&
        b[2] - b[0] >= 20 &&
        b[3] - b[1] >= 20
      return {
        title: str(r?.title),
        authors: str(r?.authors),
        publisher: str(r?.publisher),
        box: ok ? (b as [number, number, number, number]) : null,
      }
    })
    .filter((b) => b.title)
}
