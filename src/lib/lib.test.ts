import { expect, test } from 'vitest'
import { GeminiError, parseBooks, pickDefaultModel } from './gemini'
import { normalizeIsbn } from './isbn'

test('เลือกรุ่น Flash ตัวเสถียรที่เลขรุ่นสูงสุด', () => {
  const ids = ['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.6-flash-lite', 'gemini-3.10-pro', 'gemini-3-flash-preview']
  expect(pickDefaultModel(ids)).toBe('gemini-3.6-flash')
  expect(pickDefaultModel(['gemini-3-flash-preview'])).toBe('gemini-3-flash-preview')
  expect(pickDefaultModel([])).toBe('')
})

const reply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] })

test('แปลงคำตอบของ Gemini เป็นรายการหนังสือ และทิ้งรายการที่ไม่มีชื่อ', () => {
  const data = reply(
    JSON.stringify([
      { title: ' คำพิพากษา ', authors: 'ชาติ กอบจิตติ', publisher: '' },
      { title: '', authors: 'ไม่มีชื่อเรื่อง', publisher: '' },
      { title: 'Sapiens', authors: null, publisher: 'Harvill' },
    ]),
  )
  expect(parseBooks(data)).toEqual([
    { title: 'คำพิพากษา', authors: 'ชาติ กอบจิตติ', publisher: '' },
    { title: 'Sapiens', authors: '', publisher: 'Harvill' },
  ])
})

test('คำตอบที่ไม่ใช่ JSON ถือเป็นข้อผิดพลาด ไม่ใช่รายการว่าง', () => {
  expect(() => parseBooks(reply('ขออภัย'))).toThrow(GeminiError)
  expect(() => parseBooks({})).toThrow(GeminiError)
})

test('ตรวจรูปแบบ ISBN', () => {
  expect(normalizeIsbn('978-616-04-1234-5')).toBe('9786160412345')
  expect(normalizeIsbn('0-306-40615-x')).toBe('030640615X')
  expect(normalizeIsbn('12345')).toBeNull()
})

test('แปลงผลค้นเว็บ: ตัดเลขอ้างอิง เก็บลิงก์ https ไม่ซ้ำ และรับ JSON ที่มีข้อความปน', async () => {
  const { parseEnrichment } = await import('./gemini')
  const data = {
    candidates: [
      {
        content: {
          parts: [
            {
              text:
                'นี่คือผล:\n```json\n{"found": true, "authors": "ชาติ กอบจิตติ", "year": "พ.ศ. 2524 (1981)",' +
                ' "pages": "320", "isbn": "978-974-8", "synopsis": "เรื่องของฟัก [1, 2]", "blurb": "",' +
                ' "reviewSummary": "ผู้อ่านชื่นชม [3]"}\n```',
            },
          ],
        },
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: 'https://a.example/1', title: 'A' } },
            { web: { uri: 'https://a.example/1', title: 'A ซ้ำ' } },
            { web: { uri: 'javascript:alert(1)', title: 'ไม่ปลอดภัย' } },
          ],
        },
      },
    ],
  }
  const r = parseEnrichment(data)
  expect(r).toMatchObject({
    found: true,
    authors: 'ชาติ กอบจิตติ',
    year: '2524',
    pages: 320,
    isbn: '9789748',
    synopsis: 'เรื่องของฟัก',
    reviewSummary: 'ผู้อ่านชื่นชม',
    publisher: '',
  })
  expect(r.links).toEqual([{ title: 'A', url: 'https://a.example/1' }])
  expect(() => parseEnrichment({ candidates: [{ content: { parts: [{ text: 'ไม่พบ' }] } }] })).toThrow()
})

test('อ่านรายละเอียดโควตาจากคำตอบ 429 ของ Google', async () => {
  const { parseQuota } = await import('./gemini')
  const body = JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
              quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
              quotaDimensions: { location: 'global', model: 'gemini-3.6-flash' },
              quotaValue: '20',
            },
          ],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37.2s' },
      ],
    },
  })
  expect(parseQuota(body)).toMatchObject({
    period: 'day',
    search: false,
    model: 'gemini-3.6-flash',
    limit: '20',
    retrySeconds: 38,
  })
  expect(parseQuota('not json')).toMatchObject({ period: '', search: false, id: '' })
})

test('สถิติการอ่านและเวลาเริ่มต้นตอนวางคืน', async () => {
  const { readingStats, defaultMinutes, formatMinutes, clock } = await import('./stats')
  const now = new Date(2026, 10, 20, 12, 0)
  const t = (d: number, h = 12) => new Date(2026, 10, d, h).getTime()
  const book = (o: object) => ({ status: 'reading', takenAt: null, finishedAt: null, createdAt: t(1), ...o }) as any
  const session = (o: object) =>
    ({ startedAt: t(19), endedAt: t(19, 13), startPage: 10, endPage: 50, minutes: 30, timerMs: 0, timerStartedAt: null, ...o }) as any
  const stats = readingStats(
    [book({ status: 'dong' }), book({ takenAt: t(20) }), book({ status: 'done', finishedAt: t(5) }), book({ createdAt: t(1, 0) - 86400000 * 30 })],
    [session({}), session({ endedAt: t(2), minutes: 60, startPage: null }), session({ endedAt: null, minutes: null })],
    now,
  )
  expect(stats).toEqual({ inHand: 1, dong: 1, minutesWeek: 30, minutesMonth: 90, pagesMonth: 90, finishedMonth: 1, finishedYear: 1, addedMonth: 3 })

  const start = t(20, 10)
  expect(defaultMinutes(session({ startedAt: start }), t(20, 11))).toBe(60)
  expect(defaultMinutes(session({ startedAt: t(18) }), now.getTime())).toBeNull() // นานเกินไป ให้กรอกเอง
  expect(defaultMinutes(session({ startedAt: t(18), timerMs: 25 * 60000 }), now.getTime())).toBe(25)
  expect(formatMinutes(80)).toBe('1 ชม. 20 นาที')
  expect(clock(3909000)).toBe('1:05:09')
})

test('ทำความสะอาดผลอ่านโครงสร้างตู้', async () => {
  const { cleanBookcase } = await import('./aiCommon')
  expect(
    cleanBookcase({ shelfCount: 4.4, color: '8B5A2B', ratio: 0.8, drawerRows: 1.2, drawersPerRow: 0, doors: 5, legs: true }),
  ).toEqual({ color: '#8b5a2b', ratio: 0.8, shelfCount: 4, drawerRows: 1, drawersPerRow: 2, doors: 2, legs: true })
  // ค่าผิดรูปแบบ: อย่างน้อย 1 ชั้น สีว่าง ratio 0 ไม่มีลิ้นชัก/บาน/ขา
  expect(cleanBookcase({ shelfCount: 'x', color: 'red', ratio: 50, legs: 'yes' })).toEqual({
    color: '',
    ratio: 0,
    shelfCount: 1,
    drawerRows: 0,
    drawersPerRow: 0,
    doors: 0,
    legs: false,
  })
})

test('ทำความสะอาดผลอ่านปกหลายเล่ม', async () => {
  const { cleanCovers } = await import('./aiCommon')
  expect(
    cleanCovers([
      { title: 'ก', authors: 'x', publisher: '', box: [100, 50, 600, 400] },
      { title: 'ข', authors: '', publisher: '', box: [100, 50, 105, 400] }, // เล็กเกินไป
      { title: 'ค', authors: '', publisher: '', box: [0, 0, 1200, 10] }, // เกินช่วง
      { title: '', authors: '', publisher: '', box: [0, 0, 500, 500] },
      { title: 'ง', authors: '', publisher: '' },
    ]),
  ).toEqual([
    { title: 'ก', authors: 'x', publisher: '', box: [100, 50, 600, 400] },
    { title: 'ข', authors: '', publisher: '', box: null },
    { title: 'ค', authors: '', publisher: '', box: null },
    { title: 'ง', authors: '', publisher: '', box: null },
  ])
})

test('แปลง JSON Schema เป็นรูปแบบของ Gemini', async () => {
  const { toGeminiSchema } = await import('./gemini')
  expect(
    toGeminiSchema({
      type: 'object',
      properties: { a: { type: 'array', items: { type: 'string' } }, b: { type: 'integer', description: 'x' } },
      required: ['a'],
      additionalProperties: false,
    }),
  ).toEqual({
    type: 'OBJECT',
    properties: { a: { type: 'ARRAY', items: { type: 'STRING' } }, b: { type: 'INTEGER', description: 'x' } },
    required: ['a'],
  })
})

test('คำแนะนำการจัดเก็บจากกฎ และการอ่านแผนของ AI', async () => {
  const { ruleAdvice, buildOrganizePrompt, readPlan } = await import('./organize')
  const now = new Date(2026, 10, 27).getTime()
  const old = now - 400 * 86400000
  const book = (id: string, o: object) =>
    ({ id, title: id, authors: '', category: '', status: 'dong', placeId: 'shelf', takenAt: null, finishedAt: null, createdAt: old, ...o }) as any
  const places = [
    { id: 'shelf', kind: 'shelf', name: 'ชั้นที่ 1', bookcaseId: null, label: '', location: '' },
    { id: 'box', kind: 'box', name: 'กล่อง 1', bookcaseId: null, label: 'เก่า', location: 'ใต้เตียง' },
  ] as any
  const books = [
    book('doneOld', { status: 'done', finishedAt: old }),
    book('doneRecent', { status: 'done', finishedAt: now - 10 * 86400000 }),
    book('dongInBox', { placeId: 'box' }),
    book('loose', { placeId: null, category: 'นิยาย' }),
    book('inHand', { placeId: null, takenAt: now }),
  ]
  // เล่มที่อ่านจบนานแล้วแต่เพิ่งหยิบอ่านซ้ำ ไม่ควรถูกแนะนำให้เก็บ
  const sessions = [{ bookId: 'doneRecent', startedAt: now - 5 * 86400000, endedAt: now - 5 * 86400000 }] as any
  const advice = ruleAdvice(books, places, sessions, now)
  expect(advice.toBox.map((b) => b.id)).toEqual(['doneOld'])
  expect(advice.outOfBox.map((b) => b.id)).toEqual(['dongInBox'])
  expect(advice.unplaced.map((b) => b.id)).toEqual(['loose'])
  expect(advice.noCategory.map((b) => b.id)).toEqual(['doneOld', 'doneRecent', 'dongInBox', 'inHand'])

  const input = buildOrganizePrompt(books, places, [], sessions)
  expect(input.prompt).toContain('p2 | box | กล่อง 1 | 1 books | label "เก่า", at ใต้เตียง')
  expect([...input.bookIds.values()]).not.toContain('inHand') // หนังสือในมือไม่ส่ง
  const code = (id: string) => [...input.bookIds].find(([, v]) => v === id)![0]
  const plan = readPlan(
    {
      summary: ' สรุป ',
      tips: ['a', '', 'b'],
      categories: [
        { book: code('doneOld'), category: 'ประวัติศาสตร์' },
        { book: code('doneOld'), category: 'ซ้ำ' },
        { book: 'b999', category: 'ไม่มีจริง' },
      ],
      moves: [
        { book: code('doneOld'), to: 'p2', reason: 'อ่านจบนานแล้ว' },
        { book: code('dongInBox'), to: 'p2', reason: 'ที่เดิม' },
        { book: code('loose'), to: 'p9', reason: 'ไม่มีที่นี้' },
      ],
    },
    input,
    books,
  )
  expect(plan).toEqual({
    summary: 'สรุป',
    tips: ['a', 'b'],
    categories: [{ bookId: 'doneOld', category: 'ประวัติศาสตร์' }],
    moves: [{ bookId: 'doneOld', toPlaceId: 'box', reason: 'อ่านจบนานแล้ว' }],
  })
})

test('สถิติ dashboard: วันต่อเนื่อง ช่วงเวลา รายเดือน และข้อความให้กำลังใจ', async () => {
  const { dashboard, motivation, readCoach } = await import('./dashboard')
  const now = new Date(2026, 10, 27, 22, 0).getTime()
  const at = (daysAgo: number, hour: number) => {
    const d = new Date(now - daysAgo * 86400000)
    d.setHours(hour, 0, 0, 0)
    return d.getTime()
  }
  const s = (daysAgo: number, hour: number, minutes: number, a: number | null = null, z: number | null = null) =>
    ({ bookId: 'x', startedAt: at(daysAgo, hour), endedAt: at(daysAgo, hour) + minutes * 60000, minutes, startPage: a, endPage: z, deletedAt: null }) as any
  // อ่านวันนี้ เมื่อวาน และ 2 วันก่อน (ต่อเนื่อง 3) และช่วง 10-14 วันก่อน (ต่อเนื่อง 5)
  const sessions = [s(0, 21, 30, 10, 40), s(1, 21, 20), s(2, 7, 10)]
  for (let i = 10; i <= 14; i++) sessions.push(s(i, 21, 15))
  sessions.push({ ...s(3, 21, 99), endedAt: null }) // ยังไม่วางคืน ไม่นับ
  const book = (o: object) => ({ status: 'dong', category: '', takenAt: null, finishedAt: null, createdAt: at(40, 12), pages: null, ...o }) as any
  const books = [
    book({ id: 'a', status: 'done', finishedAt: at(3, 12), category: 'นิยาย' }),
    book({ id: 'b', category: 'นิยาย', pages: 500 }),
    book({ id: 'c', pages: 120, createdAt: at(1, 12) }),
    book({ id: 'd', status: 'reading', category: 'ธุรกิจ' }),
  ]
  const d = dashboard(books, sessions, now)
  expect(d.daily).toHaveLength(30)
  expect(d.todayMinutes).toBe(30)
  expect(d.weekMinutes).toBe(60)
  expect(d.streak).toBe(3)
  expect(d.bestStreak).toBe(5)
  expect(d.byHour[21]).toBe(30 + 20 + 75)
  expect(d.byHour[7]).toBe(10)
  expect(d.avgPages).toBe(30)
  expect(d.monthly.at(-1)).toMatchObject({ finished: 1, added: 1 })
  expect(d.status).toEqual({ dong: 2, reading: 1, done: 1, dropped: 0 })
  expect(d.categories[0]).toEqual({ name: 'นิยาย', count: 2 })
  expect(d.oldestDong?.id).toBe('b')
  expect(d.shortestDong?.id).toBe('c')

  const msgs = motivation(d, { dailyMinutes: 20, yearBooks: 12 })
  expect(msgs[0]).toContain('ครบเป้า')
  expect(msgs[1]).toContain('ต่อเนื่อง 3 วัน')
  expect(msgs.some((m) => m.includes('21:00–22:00'))).toBe(true)

  const coach = readCoach(
    { headline: ' ดีมาก ', insights: ['a', 1, 'b'], tips: [], picks: [{ book: 'b1', reason: 'สั้น' }, { book: 'b9', reason: 'x' }] },
    new Map([['b1', 'c']]),
  )
  expect(coach).toEqual({ headline: 'ดีมาก', insights: ['a', 'b'], tips: [], picks: [{ bookId: 'c', reason: 'สั้น' }] })
})
