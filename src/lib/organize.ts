import type { Book, Bookcase, Category, Place, ReadingSession } from '../db/types'
import { placeLabel } from '../placeLabel'

const DAY = 24 * 60 * 60 * 1000
const YEAR = 365 * DAY

/** เวลาล่าสุดที่หนังสือถูกใช้งาน: วางคืนครั้งล่าสุด อ่านจบ หรือวันที่เพิ่มเข้าคลัง */
export function lastActivity(book: Book, sessions: ReadingSession[]): number {
  const mine = sessions.filter((s) => s.bookId === book.id)
  return Math.max(book.createdAt, book.finishedAt ?? 0, ...mine.map((s) => s.endedAt ?? s.startedAt))
}

export interface RuleAdvice {
  /** อ่านจบ/เลิกอ่าน และไม่ได้แตะนานกว่า 1 ปี แต่ยังอยู่นอกกล่อง */
  toBox: Book[]
  /** ยังดองหรือกำลังอ่าน แต่อยู่ในกล่อง หยิบยาก */
  outOfBox: Book[]
  unplaced: Book[]
  noCategory: Book[]
}

/** คำแนะนำจากกฎง่าย ๆ ไม่ใช้ AI */
export function ruleAdvice(
  books: Book[],
  places: Place[],
  sessions: ReadingSession[],
  now = Date.now(),
): RuleAdvice {
  const kindOf = new Map(places.map((p) => [p.id, p.kind]))
  const inBox = (b: Book) => (b.placeId ? kindOf.get(b.placeId) === 'box' : false)
  const atHome = books.filter((b) => !b.takenAt)
  return {
    toBox: atHome.filter(
      (b) =>
        b.placeId &&
        !inBox(b) &&
        (b.status === 'done' || b.status === 'dropped') &&
        now - lastActivity(b, sessions) > YEAR,
    ),
    outOfBox: atHome.filter((b) => inBox(b) && (b.status === 'dong' || b.status === 'reading')),
    unplaced: atHome.filter((b) => !b.placeId),
    noCategory: books.filter((b) => !b.categoryId),
  }
}

// ---------- ให้ AI วิเคราะห์ทั้งคลัง ----------

/** จำนวนเล่มสูงสุดต่อการวิเคราะห์หนึ่งครั้ง (กันคำขอใหญ่เกินไป) */
export const MAX_BOOKS = 400

export interface OrganizeInput {
  prompt: string
  /** รหัสสั้นในคำขอ → id จริง */
  bookIds: Map<string, string>
  placeIds: Map<string, string>
  /** จำนวนเล่มที่ไม่ได้ส่งไปเพราะเกินขีดจำกัด */
  skipped: number
}

const STATUS: Record<Book['status'], string> = { dong: 'unread', reading: 'reading', done: 'finished', dropped: 'dropped' }
const month = (t: number) => new Date(t).toISOString().slice(0, 7)

/** สร้างคำขอให้ AI ใช้รหัสสั้น (b1, p1) แทน id จริงเพื่อประหยัด token */
export function buildOrganizePrompt(
  books: Book[],
  places: Place[],
  bookcases: Bookcase[],
  sessions: ReadingSession[],
  categories: Category[] = [],
): OrganizeInput {
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const counts = new Map<string, number>()
  for (const b of books) if (b.placeId) counts.set(b.placeId, (counts.get(b.placeId) ?? 0) + 1)
  const placeIds = new Map<string, string>()
  const placeCode = new Map<string, string>()
  const placeLines = places.map((p, i) => {
    const code = `p${i + 1}`
    placeIds.set(code, p.id)
    placeCode.set(p.id, code)
    const extra = [p.label && `label "${p.label}"`, p.location && `at ${p.location}`].filter(Boolean).join(', ')
    return `${code} | ${p.kind} | ${placeLabel(p, bookcases)} | ${counts.get(p.id) ?? 0} books${extra ? ` | ${extra}` : ''}`
  })
  // ส่งเล่มที่ยังไม่มีหมวดหรือไม่มีที่เก็บก่อน ถ้าเกินขีดจำกัด
  const ordered = [...books]
    .filter((b) => !b.takenAt)
    .sort((a, b) => Number(Boolean(a.categoryId && a.placeId)) - Number(Boolean(b.categoryId && b.placeId)))
  const sent = ordered.slice(0, MAX_BOOKS)
  const bookIds = new Map<string, string>()
  const bookLines = sent.map((b, i) => {
    const code = `b${i + 1}`
    bookIds.set(code, b.id)
    return [
      code,
      b.title,
      b.authors || '-',
      (b.categoryId && catName.get(b.categoryId)) || '-',
      STATUS[b.status],
      b.placeId ? placeCode.get(b.placeId) : 'none',
      `last used ${month(lastActivity(b, sessions))}`,
    ].join(' | ')
  })
  const prompt =
    'You help a Thai reader organise their home book collection.\n\n' +
    'Storage places (code | kind | name | books now | details). Kinds: shelf and drawer belong to a bookcase, ' +
    'pile is a stack somewhere in the house, box is a storage box for books rarely read:\n' +
    placeLines.join('\n') +
    '\n\nBooks (code | title | authors | category | status | place | last used):\n' +
    bookLines.join('\n') +
    `\n\nExisting categories: ${categories.map((c) => c.name).join(', ') || '(none)'}.\n` +
    `Today is ${month(Date.now())}.\n` +
    'Tasks:\n' +
    '1. "categories": give every book a short Thai category name (for example นิยาย, ประวัติศาสตร์, จิตวิทยา, ' +
    'ธุรกิจ, การ์ตูน). Reuse existing category names where they fit and keep the whole set to at most 12 ' +
    'categories. Base it on what you know about the title and author; if unsure, use the closest broad category.\n' +
    '2. "moves": propose moving books so that each category sits together on the same shelves, unread and ' +
    'currently-read books stay easy to reach (shelves or piles, not boxes), and books finished or dropped long ago ' +
    'go into boxes. Only use the place codes listed above, only propose moves that change the place, and keep ' +
    'shelves reasonably balanced (roughly 20-40 books per shelf). At most 150 moves. Give a short Thai reason.\n' +
    '3. "summary": 3-5 sentences in Thai describing the collection and the main idea of the plan.\n' +
    '4. "tips": up to 5 short practical tips in Thai.\n' +
    'If there are no places, return an empty list of moves.'
  return { prompt, bookIds, placeIds, skipped: ordered.length - sent.length }
}

export const organizeSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    tips: { type: 'array', items: { type: 'string' } },
    categories: {
      type: 'array',
      items: {
        type: 'object',
        properties: { book: { type: 'string' }, category: { type: 'string' } },
        required: ['book', 'category'],
        additionalProperties: false,
      },
    },
    moves: {
      type: 'array',
      items: {
        type: 'object',
        properties: { book: { type: 'string' }, to: { type: 'string' }, reason: { type: 'string' } },
        required: ['book', 'to', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'tips', 'categories', 'moves'],
  additionalProperties: false,
} as const

export interface OrganizePlan {
  summary: string
  tips: string[]
  categories: { bookId: string; category: string }[]
  moves: { bookId: string; toPlaceId: string; reason: string }[]
}

/** แปลงรหัสสั้นกลับเป็น id จริง ทิ้งรายการที่อ้างรหัสที่ไม่มี หรือย้ายไปที่เดิม */
export function readPlan(raw: any, input: OrganizeInput, books: Book[]): OrganizePlan {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const placeOf = new Map(books.map((b) => [b.id, b.placeId]))
  const seen = new Set<string>()
  const categories = (Array.isArray(raw?.categories) ? raw.categories : [])
    .map((c: any) => ({ bookId: input.bookIds.get(str(c?.book)) ?? '', category: str(c?.category) }))
    .filter((c: { bookId: string; category: string }) => c.bookId && c.category && !seen.has(c.bookId) && seen.add(c.bookId))
  const moved = new Set<string>()
  const moves = (Array.isArray(raw?.moves) ? raw.moves : [])
    .map((m: any) => ({
      bookId: input.bookIds.get(str(m?.book)) ?? '',
      toPlaceId: input.placeIds.get(str(m?.to)) ?? '',
      reason: str(m?.reason),
    }))
    .filter(
      (m: { bookId: string; toPlaceId: string }) =>
        m.bookId && m.toPlaceId && placeOf.get(m.bookId) !== m.toPlaceId && !moved.has(m.bookId) && moved.add(m.bookId),
    )
  return {
    summary: str(raw?.summary),
    tips: (Array.isArray(raw?.tips) ? raw.tips : []).map(str).filter(Boolean).slice(0, 5),
    categories,
    moves,
  }
}
