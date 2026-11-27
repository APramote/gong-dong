import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { Book, ReadingSession } from '../db/types'
import { CoverThumb } from '../components/Cover'
import { ReturnForm } from '../components/ReturnForm'
import { SessionList } from '../components/SessionList'
import { WEEKDAYS_SHORT } from '../lib/dashboard'
import { clock, dayKey, daysAgo, formatMinutes, readingStats, timeAgo, timerTotal } from '../lib/stats'
import { placeLabel } from '../placeLabel'
import { t } from '../th'

/** แถบเวลาอ่าน 7 วันล่าสุด วันนี้อยู่ขวาสุด */
function WeekStrip({ sessions, now }: { sessions: ReadingSession[]; now: number }) {
  const days = useMemo(() => {
    const per = new Map<string, number>()
    for (const s of sessions)
      if (s.endedAt !== null && s.deletedAt === null)
        per.set(dayKey(s.endedAt), (per.get(dayKey(s.endedAt)) ?? 0) + (s.minutes ?? 0))
    return Array.from({ length: 7 }, (_, i) => {
      const at = daysAgo(now, 6 - i)
      return { key: dayKey(at), day: new Date(at).getDay(), minutes: per.get(dayKey(at)) ?? 0 }
    })
  }, [sessions, now])
  const max = Math.max(30, ...days.map((d) => d.minutes))
  const total = days.reduce((n, d) => n + d.minutes, 0)
  return (
    <div className="week">
      <div
        className="week-bars"
        role="img"
        aria-label={`${t.reading.weekLabel}: ${days.map((d) => `${WEEKDAYS_SHORT[d.day]} ${formatMinutes(d.minutes)}`).join(', ')}`}
      >
        {days.map((d, i) => (
          <div className={`week-day${i === 6 ? ' today' : ''}`} key={d.key} title={formatMinutes(d.minutes)}>
            <span className="week-track">
              <span className={d.minutes ? 'week-fill' : 'week-dot'} style={d.minutes ? { height: `${Math.max(8, (d.minutes / max) * 100)}%` } : undefined} />
            </span>
            <span className="week-label">{WEEKDAYS_SHORT[d.day]}</span>
          </div>
        ))}
      </div>
      <span className="muted">{t.reading.week(formatMinutes(total))}</span>
    </div>
  )
}

/** หนังสือในมือหนึ่งเล่ม: ปกใหญ่ ความคืบหน้า และนาฬิกาจับเวลา */
function Desk({
  book,
  session,
  now,
  from,
  placeExists,
}: {
  book: Book
  session: ReadingSession | undefined
  now: number
  from: string
  placeExists: (id: string) => boolean
}) {
  const [returning, setReturning] = useState(false)
  const timer = session ? timerTotal(session, now) : 0
  const running = Boolean(session?.timerStartedAt)
  const pct = book.pages && book.currentPage ? Math.min(100, (book.currentPage / book.pages) * 100) : 0

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
          <span className="row-sub">{t.reading.inHandSince(from, timeAgo(book.takenAt!, now))}</span>
        </div>
      </div>

      {(timer > 0 || running) && (
        <div className="desk-clock" aria-live="off">
          <span className="clock">{clock(timer)}</span>
          <span className="clock-state">
            {running && <span className="pulse" aria-hidden />}
            {running ? t.reading.readingNow : t.reading.paused}
          </span>
        </div>
      )}

      {returning ? (
        <ReturnForm
          book={book}
          session={session}
          placeExists={placeExists}
          onDone={() => setReturning(false)}
          onCancel={() => setReturning(false)}
        />
      ) : (
        <div className="actions">
          <button className={`btn ${running ? '' : 'primary'}`} onClick={() => repo.toggleTimer(book.id)}>
            {running ? `❚❚ ${t.reading.pause}` : `▶ ${t.reading.go}`}
          </button>
          <button className="btn" onClick={() => setReturning(true)}>
            {t.reading.return}
          </button>
        </div>
      )}
    </article>
  )
}

/** มือว่าง: เสนอเล่มจากกองดองให้หยิบ */
function Suggestions({ books }: { books: Book[] }) {
  const navigate = useNavigate()
  const dong = books.filter((b) => b.status === 'dong' && !b.takenAt)
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
      <p className="muted">{dong.length ? t.reading.emptyLead : t.reading.empty}</p>
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
  const running = [...open.values()].some((s) => s.timerStartedAt)
  // เดินนาฬิกาทุกวินาทีเมื่อมีการจับเวลา ไม่งั้นทุกนาทีพอ
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), running ? 1000 : 60000)
    return () => clearInterval(id)
  }, [running])

  if (!books) return <p className="empty">{t.common.loading}</p>
  const byId = new Map(books.map((b) => [b.id, b]))
  const placeName = (id: string | null) => {
    const p = id ? places.find((x) => x.id === id) : undefined
    return p ? placeLabel(p, bookcases) : t.library.noPlace
  }
  const inHand = books.filter((b) => b.takenAt).sort((a, b) => b.takenAt! - a.takenAt!)
  const s = readingStats(books, sessions, new Date(now))
  const today = sessions
    .filter((x) => x.endedAt !== null && dayKey(x.endedAt) === dayKey(now))
    .reduce((n, x) => n + (x.minutes ?? 0), 0)

  return (
    <div className="reading">
      <div className="page-head">
        <div>
          <h1>{t.reading.title}</h1>
          <p className="muted">{today ? t.reading.todayRead(formatMinutes(today)) : t.reading.todayNone}</p>
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
            now={now}
            from={placeName(b.takenFrom)}
            placeExists={(id) => places.some((p) => p.id === id)}
          />
        ))
      )}

      <WeekStrip sessions={sessions} now={now} />
      <p className="muted month-line">{t.reading.month(formatMinutes(s.minutesMonth), s.pagesMonth, s.finishedMonth)}</p>

      <section>
        <h2>{t.reading.recent}</h2>
        <SessionList sessions={sessions.slice(0, 5)} placeName={placeName} books={byId} />
        <p className="actions">
          {sessions.length > 0 && (
            <Link to="/stats" className="link">
              {t.reading.allStats}
            </Link>
          )}
          <Link to="/settings#remind" className="link">
            {t.remind.link}
          </Link>
        </p>
      </section>
    </div>
  )
}
