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

// ---------- อ่านรูปที่เก็บ (ตู้ / กอง / กล่อง) ----------

export type StorageKind = 'bookcase' | 'pile' | 'box'

export interface ScannedBook extends RecognizedBook {
  /** สีสันของหนังสือ #rrggbb หรือว่าง */
  color: string
}

export interface StorageScan {
  /** สีหลักของตู้หรือกล่อง #rrggbb */
  color: string
  /** สัดส่วนกว้าง/สูงที่เห็นในรูป (0 = ไม่ทราบ) */
  ratio: number
  /** ข้อความบนป้ายกล่อง */
  label: string
  /** ตู้: แถวลิ้นชักใต้ชั้นวาง */
  drawerRows: number
  /** ตู้: ลิ้นชักต่อแถว */
  drawersPerRow: number
  /** ตู้: บานปิดหน้าชั้น (0, 1, 2) */
  doors: number
  /** ตู้: มีขาตู้ */
  legs: boolean
  /**
   * ตู้: แต่ละชั้นจากบนลงล่าง หนังสือในชั้นเรียงซ้ายไปขวา
   * กอง: หนึ่งรายการ หนังสือเรียงจากบนลงล่าง
   * กล่อง: หนังสือที่มองเห็นในกล่อง (ถ้าเปิดอยู่)
   */
  shelves: { books: ScannedBook[] }[]
}

const STORAGE_PROMPTS: Record<StorageKind, string> = {
  bookcase:
    'This photo shows a bookcase. Count every open shelf level that can hold books, from top to bottom, including ' +
    'empty ones, and return one entry per shelf in that order. Do not count drawers as shelves. For each shelf list ' +
    'every book whose spine is at least partly readable, left to right. Also return the main colour of the bookcase, ' +
    'its visible width divided by height, "drawerRows" (rows of drawers below the shelves, 0 if none), ' +
    '"drawersPerRow" (drawers side by side in one row, 0 if none), "doors" (number of glass or other doors covering ' +
    'the shelves: 0, 1 or 2) and "legs" (true if it stands on visible legs).',
  pile:
    'This photo shows a pile of books lying on top of each other. Return exactly one shelf entry whose books are ' +
    'listed from the top of the pile to the bottom. Also return the colour of the surface they rest on, 0 for ratio, ' +
    'drawerRows, drawersPerRow and doors, and false for legs.',
  box:
    'This photo shows a storage box. Read any text written or printed on the box (its label) exactly as written. ' +
    'Return the main colour of the box and its visible width divided by height. If the box is open and book spines ' +
    'or covers are readable, return them as one shelf entry; otherwise return an empty list of shelves. ' +
    'Return 0 for drawerRows, drawersPerRow and doors, and false for legs.',
}

export const storagePrompt = (kind: StorageKind) =>
  STORAGE_PROMPTS[kind] +
  ' For each book give "color": the dominant colour of its spine (or cover) as #rrggbb.' +
  RECOGNIZE_RULES +
  ' Colours must be #rrggbb hex values.'

/** JSON Schema ของผลอ่านรูปที่เก็บ (สำหรับ Claude) */
export const storageSchema = {
  type: 'object',
  properties: {
    color: { type: 'string' },
    ratio: { type: 'number' },
    label: { type: 'string' },
    drawerRows: { type: 'integer' },
    drawersPerRow: { type: 'integer' },
    doors: { type: 'integer' },
    legs: { type: 'boolean' },
    shelves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          books: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                authors: { type: 'string' },
                publisher: { type: 'string' },
                color: { type: 'string' },
              },
              required: ['title', 'authors', 'publisher', 'color'],
              additionalProperties: false,
            },
          },
        },
        required: ['books'],
        additionalProperties: false,
      },
    },
  },
  required: ['color', 'ratio', 'label', 'drawerRows', 'drawersPerRow', 'doors', 'legs', 'shelves'],
  additionalProperties: false,
} as const

const hex = (v: unknown) => {
  const m = /#?([0-9a-f]{6})\b/i.exec(typeof v === 'string' ? v : '')
  return m ? `#${m[1].toLowerCase()}` : ''
}

/** ทำความสะอาดผลอ่านรูปที่เก็บ: สีผิดรูปแบบทิ้งไป หนังสือไม่มีชื่อทิ้งไป จำกัดจำนวนชั้น */
export function cleanStorage(raw: any, kind: StorageKind): StorageScan {
  const ratio = Number(raw?.ratio)
  let shelves = (Array.isArray(raw?.shelves) ? raw.shelves : []).slice(0, 20).map((s: any) => ({
    books: cleanBooks(s?.books).map((b, i) => ({ ...b, color: hex(s?.books?.filter((x: any) => str(x?.title))[i]?.color) })),
  }))
  // กองมีได้ชั้นเดียว รวมทุกรายการเข้าด้วยกัน
  if (kind !== 'bookcase') shelves = shelves.length ? [{ books: shelves.flatMap((s: { books: ScannedBook[] }) => s.books) }] : []
  const int = (v: unknown, max: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0
  }
  const isCase = kind === 'bookcase'
  const drawerRows = isCase ? int(raw?.drawerRows, 4) : 0
  return {
    color: hex(raw?.color),
    ratio: Number.isFinite(ratio) && ratio > 0.1 && ratio < 10 ? ratio : 0,
    label: str(raw?.label),
    drawerRows,
    // มีแถวลิ้นชักแต่ไม่บอกจำนวนต่อแถว ถือว่าแถวละ 2
    drawersPerRow: drawerRows ? int(raw?.drawersPerRow, 6) || 2 : 0,
    doors: isCase ? int(raw?.doors, 2) : 0,
    legs: isCase && raw?.legs === true,
    shelves,
  }
}
