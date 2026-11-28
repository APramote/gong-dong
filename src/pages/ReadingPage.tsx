import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { Book, ReadingSession } from '../db/types'
import { CoverThumb } from '../components/Cover'
import { CheckInForm } from '../components/CheckInForm'
import { ReturnForm } from '../components/ReturnForm'
import { SessionList } from '../components/SessionList'
import { WEEKDAYS_SHORT } from '../lib/dashboard'
import { clock, dayKey, daysAgo, formatMinutes, pagesOf, readingStats, timeAgo, timerTotal } from '../lib/stats'
import { placeLabel } from '../placeLabel'
import { t } from '../th'

/** แถบเวลาอ่าน 7 วันล่าสุด วันนี้อยู่ขวาสุด */
function WeekStrip({ sessions, now }: { sessions: ReadingSession[]; now: number }) {
  const days = useMemo(() => {
    const per = new Map<string, { minutes: number; pages: number }>()
    for (const s of sessions) {
      if (s.endedAt === null || s.deletedAt !== null) continue
      const d = per.get(dayKey(s.endedAt)) ?? { minutes: 0, pages: 0 }
      d.minutes += s.minutes ?? 0
      d.pages += pagesOf(s)
      per.set(dayKey(s.endedAt), d)
    }
    return Array.from({ length: 7 }, (_, i) => {
      const at = daysAgo(now, 6 - i)
      return { key: dayKey(at), day: new Date(at).getDay(), ...(per.get(dayKey(at)) ?? { minutes: 0, pages: 0 }) }
    })
  }, [sessions, now])
  // แท่งแสดงจำนวนหน้า (สิ่งที่บันทึกจริง) วันที่มีแต่เวลา (ประวัติแบบเก่า) ใช้เวลาแทนให้ยังเห็นว่าได้อ่าน
  const byPages = days.some((d) => d.pages > 0)
  const value = (d: (typeof days)[number]) => (byPages ? d.pages || (d.minutes ? 1 : 0) : d.minutes)
  const max = Math.max(byPages ? 20 : 30, ...days.map(value))
  const total = days.reduce((n, d) => n + d.minutes, 0)
  const tip = (d: (typeof days)[number]) =>
    [d.pages ? t.dash.pagesN(d.pages) : '', d.minutes ? formatMinutes(d.minutes) : ''].filter(Boolean).join(' · ') || '–'
  return (
    <div className="week">
      <div
        className="week-bars"
        role="img"
        aria-label={`${t.reading.weekLabel}: ${days.map((d) => `${WEEKDAYS_SHORT[d.day]} ${tip(d)}`).join(', ')}`}
      >
        {days.map((d, i) => (
          <div className={`week-day${i === 6 ? ' today' : ''}`} key={d.key} title={tip(d)}>
            <span className="week-track">
              <span className={value(d) ? 'week-fill' : 'week-dot'} style={value(d) ? { height: `${Math.max(8, (value(d) / max) * 100)}%` } : undefined} />
            </span>
            <span className="week-label">{WEEKDAYS_SHORT[d.day]}</span>
          </div>
        ))}
      </div>
      <span className="muted">
        {t.reading.week(
          days.reduce((n, d) => n + d.pages, 0),
          total ? formatMinutes(total) : '',
        )}
      </span>
    </div>
  )
}

const DAY = 86400000

/** หนังสือที่พกอยู่หนึ่งเล่ม: ปก ความคืบหน้า ปุ่มคั่นหน้า และนาฬิกา (ถ้าอยากจับเวลา) */
function Desk({
  book,
  session,
  reads,
  from,
  placeExists,
}: {
  book: Book
  session: ReadingSession | undefined
  /** การคั่นหน้าของเล่มนี้ (ใหม่สุดก่อน) */
  reads: ReadingSession[]
  from: string
  placeExists: (id: string) => boolean
}) {
  const [mode, setMode] = useState<'idle' | 'checkin' | 'return'>('idle')
  const running = Boolean(session?.timerStartedAt)
  // นาฬิกาเดินเฉพาะในการ์ดนี้ ทุกวินาทีตอนจับเวลา ส่วนอื่นของหน้าไม่ต้องวาดใหม่ตาม
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), running ? 1000 : 60000)
    return () => clearInterval(id)
  }, [running, session?.timerMs])
  const timer = session ? timerTotal(session, now) : 0
  const pct = book.pages && book.currentPage ? Math.min(100, (book.currentPage / book.pages) * 100) : 0

  const todayPages = reads.filter((r) => dayKey(r.endedAt!) === dayKey(now)).reduce((n, r) => n + pagesOf(r), 0)
  // ความเร็วช่วง 7 วันล่าสุดของเล่มนี้ ใช้บอกว่าอีกกี่วันจบ
  const weekPages = reads.filter((r) => now - r.endedAt! < 7 * DAY).reduce((n, r) => n + pagesOf(r), 0)
  const left = book.pages && book.currentPage ? book.pages - book.currentPage : 0
  const estimate = weekPages > 0 && left > 0 ? Math.ceil(left / (weekPages / 7)) : 0
  // อ่านน้อยมากช่วงนี้ ตัวเลขจะเป็นปี ๆ ไม่ช่วยอะไร ไม่ต้องแสดง
  const daysLeft = estimate <= 180 ? estimate : 0
  const atEnd = Boolean(book.pages && book.currentPage && book.currentPage >= book.pages)
  const checkInBtn = useRef<HTMLButtonElement>(null)
  /** ปิดฟอร์มแล้วคืนโฟกัสไปที่ปุ่มคั่นหน้า (ผู้ใช้คีย์บอร์ดและโปรแกรมอ่านหน้าจอไม่หลุดตำแหน่ง) */
  const close = () => {
    setMode('idle')
    setTimeout(() => checkInBtn.current?.focus(), 0)
  }
  // พกมานานแต่ไม่ได้คั่นหน้าเลย ถามเบา ๆ
  const lastTouch = Math.max(book.takenAt ?? 0, reads[0]?.endedAt ?? 0)
  const staleDays = Math.floor((now - lastTouch) / DAY)

  return (
    <article className={`desk${running ? ' is-running' : ''}`}>
      <div className="desk-top">
        <Link to={`/book/${book.id}`} className="desk-cover" aria-label={book.title}>
          <CoverThumb bookId={book.id} title={book.title} color={book.spineColor} />
        </Link>
        <div className="desk-info">
          <Link to={`/book/${book.id}`} className="desk-title">
            {book.title}
          </Link>
          {book.authors && <span className="muted">{book.authors}</span>}
          <span className="row-sub">
            {book.currentPage ? t.reading.progress(book.currentPage, book.pages) : t.reading.notStarted}
          </span>
          {pct > 0 && (
            <span className="progress" aria-hidden>
              <span style={{ width: `${pct}%` }} />
            </span>
          )}
          {(todayPages > 0 || daysLeft > 0) && (
            <span className="desk-note">
              {[todayPages > 0 ? t.reading.readToday(todayPages) : '', daysLeft > 0 ? t.reading.forecast(daysLeft) : '']
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
          <span className="row-sub">{t.reading.carrying(from, timeAgo(book.takenAt!, now))}</span>
        </div>
      </div>

      {staleDays >= 7 && mode === 'idle' && <p className="muted stale">{t.reading.stale(staleDays)}</p>}

      {(timer > 0 || running) && (
        <div className="desk-clock" aria-live="off">
          <span className="clock">{clock(timer)}</span>
          <span className="clock-state">
            {running && <span className="pulse" aria-hidden />}
            {running ? t.reading.readingNow : t.reading.paused}
          </span>
        </div>
      )}

      {mode === 'checkin' ? (
        <CheckInForm
          book={book}
          timerMinutes={timer > 0 ? Math.max(1, Math.round(timer / 60000)) : 0}
          onDone={close}
          onCancel={close}
        />
      ) : mode === 'return' ? (
        <ReturnForm book={book} placeExists={placeExists} onDone={() => setMode('idle')} onCancel={close} />
      ) : (
        <div className="actions">
          {/* อ่านถึงหน้าสุดท้ายแล้ว ขั้นต่อไปคือวางคืน (ฟอร์มวางคืนติ๊กอ่านจบไว้ให้) */}
          <button ref={checkInBtn} className={`btn ${atEnd ? '' : 'primary'}`} onClick={() => setMode('checkin')}>
            {t.reading.checkIn}
          </button>
          <button className={`btn ${atEnd ? 'primary' : ''}`} onClick={() => setMode('return')}>
            {t.reading.return}
          </button>
          <button className="link-btn push" onClick={() => repo.toggleTimer(book.id)}>
            <span aria-hidden>{running ? '❚❚ ' : '▶ '}</span>
            {running ? t.reading.pause : t.reading.go}
          </button>
        </div>
      )}
    </article>
  )
}

/** มือว่าง: เสนอเล่มจากกองดองให้หยิบ */
function Suggestions({ books }: { books: Book[] }) {
  const navigate = useNavigate()
  // เล่มที่ให้มะเขือ 3 ลูกขึ้นไปไม่นำมาแนะนำ
  const dong = books.filter((b) => b.status === 'dong' && !b.takenAt && (b.rating ?? 0) > -3)
  const picks: { book: Book; note: string }[] = []
  const add = (b: Book | undefined, note: string) => b && !picks.some((p) => p.book.id === b.id) && picks.push({ book: b, note })
  add(
    dong.filter((b) => b.pages).sort((a, b) => a.pages! - b.pages!)[0],
    t.reading.suggestShort(dong.filter((b) => b.pages).sort((a, b) => a.pages! - b.pages!)[0]?.pages ?? 0),
  )
  const oldest = [...dong].sort((a, b) => a.createdAt - b.createdAt)[0]
  add(oldest, oldest ? t.dash.oldest(new Date(oldest.createdAt).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' })) : '')
  const newest = [...dong].sort((a, b) => b.createdAt - a.createdAt)[0]
  add(newest, newest ? timeAgo(newest.createdAt) : '')

  return (
    <div className="empty-hand">
      <h2>{t.reading.emptyTitle}</h2>
      <p className="muted">
        {books.length === 0 ? t.reading.noBooksLead : dong.length ? t.reading.emptyLead : t.reading.noDongLead}
      </p>
      {dong.length === 0 && (
        <Link to={books.length === 0 ? '/add' : '/'} className="btn">
          {books.length === 0 ? t.reading.addFirst : t.reading.goLibrary}
        </Link>
      )}
      {picks.length > 0 && (
        <div className="suggest-row">
          {picks.map(({ book, note }) => (
            <button
              key={book.id}
              className="suggest-book"
              onClick={async () => {
                await repo.takeBook(book.id)
                navigate('/reading')
              }}
            >
              <CoverThumb bookId={book.id} title={book.title} color={book.spineColor} />
              <span className="suggest-title">{book.title}</span>
              <span className="row-sub">{note}</span>
              <span className="suggest-take">{t.reading.takeShort}</span>
            </button>
          ))}
        </div>
      )}
      {dong.length > 1 && (
        <Link to="/random" className="btn">
          {t.reading.random}
        </Link>
      )}
    </div>
  )
}

export function ReadingPage() {
  const books = useLiveQuery(() => repo.listBooks(), [])
  const sessions = useLiveQuery(() => repo.listSessions(), []) ?? []
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []
  const [now, setNow] = useState(Date.now())

  const open = useMemo(() => new Map(sessions.filter((s) => s.endedAt === null).map((s) => [s.bookId, s])), [sessions])
  // ทั้งหน้าอัปเดตทุกนาทีพอ (นาฬิกาจับเวลาเดินเองในการ์ดของแต่ละเล่ม)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  if (!books) return <p className="empty">{t.common.loading}</p>
  const byId = new Map(books.map((b) => [b.id, b]))
  const placeName = (id: string | null) => {
    const p = id ? places.find((x) => x.id === id) : undefined
    return p ? placeLabel(p, bookcases) : t.library.noPlace
  }
  const inHand = books.filter((b) => b.takenAt).sort((a, b) => b.takenAt! - a.takenAt!)
  const s = readingStats(books, sessions, new Date(now))
  const todayRows = sessions.filter((x) => x.endedAt !== null && dayKey(x.endedAt) === dayKey(now))
  const today = todayRows.reduce((n, x) => n + (x.minutes ?? 0), 0)
  const todayPages = todayRows.reduce((n, x) => n + pagesOf(x), 0)
  const readsOf = (id: string) => sessions.filter((x) => x.bookId === id && x.endedAt !== null && x.kind !== 'carry')

  return (
    <div className="reading">
      <div className="page-head">
        <div>
          <h1>{t.reading.title}</h1>
          <p className="muted">
            {today || todayPages ? t.reading.todayRead(todayPages, today ? formatMinutes(today) : '') : t.reading.todayNone}
          </p>
        </div>
      </div>

      {inHand.length === 0 ? (
        <Suggestions books={books} />
      ) : (
        inHand.map((b) => (
          <Desk
            key={b.id}
            book={b}
            session={open.get(b.id)}
            reads={readsOf(b.id)}
            from={placeName(b.takenFrom)}
            placeExists={(id) => places.some((p) => p.id === id)}
          />
        ))
      )}

      <WeekStrip sessions={sessions} now={now} />
      <p className="muted month-line">{t.reading.month(s.minutesMonth ? formatMinutes(s.minutesMonth) : '', s.pagesMonth, s.finishedMonth)}</p>

      <section>
        <h2>{t.reading.recent}</h2>
        <SessionList
          sessions={sessions.filter((x) => x.endedAt !== null && x.kind !== 'carry').slice(0, 5)}
          placeName={placeName}
          books={byId}
        />
        <p className="actions">
          {sessions.length > 0 && (
            <Link to="/stats" className="link">
              {t.reading.allStats}
            </Link>
          )}
        </p>
      </section>
    </div>
  )
}
