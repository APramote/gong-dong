import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { CoverThumb } from '../components/Cover'
import { ReturnForm } from '../components/ReturnForm'
import { SessionList } from '../components/SessionList'
import { clock, formatMinutes, readingStats, timeAgo, timerTotal } from '../lib/stats'
import { placeLabel } from '../placeLabel'
import { t } from '../th'

export function ReadingPage() {
  const books = useLiveQuery(() => repo.listBooks(), [])
  const sessions = useLiveQuery(() => repo.listSessions(), []) ?? []
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []
  const [returning, setReturning] = useState<string | null>(null)
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
  const stat = (label: string, value: string) => (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="muted">{label}</span>
    </div>
  )

  return (
    <>
      <div className="page-head">
        <h1>{t.reading.title}</h1>
      </div>
      <div className="stats">
        {stat(t.reading.stats.dong, t.reading.books(s.dong))}
        {stat(t.reading.stats.week, formatMinutes(s.minutesWeek))}
        {stat(t.reading.stats.month, formatMinutes(s.minutesMonth))}
        {stat(t.reading.stats.pagesMonth, String(s.pagesMonth))}
        {stat(t.reading.stats.finishedMonth, t.reading.books(s.finishedMonth))}
        {stat(t.reading.stats.addedMonth, t.reading.books(s.addedMonth))}
      </div>

      <section>
        <h2>
          {t.reading.stats.inHand} ({inHand.length})
        </h2>
        {inHand.length === 0 ? (
          <p className="empty">{t.reading.empty}</p>
        ) : (
          inHand.map((b) => {
            const session = open.get(b.id)
            const timer = session ? timerTotal(session, now) : 0
            return (
              <div className="card hand" key={b.id}>
                <div className="row">
                  <CoverThumb bookId={b.id} title={b.title} color={b.spineColor} />
                  <Link to={`/book/${b.id}`} className="row-main">
                    <span className="row-title">{b.title}</span>
                    <span className="row-sub">
                      {t.reading.inHandSince(placeName(b.takenFrom), timeAgo(b.takenAt!, now))}
                    </span>
                    {timer > 0 && (
                      <span className="row-sub">
                        {t.reading.timer} {clock(timer)}
                      </span>
                    )}
                  </Link>
                </div>
                {returning === b.id ? (
                  <ReturnForm
                    book={b}
                    session={session}
                    placeExists={(id) => places.some((p) => p.id === id)}
                    onDone={() => setReturning(null)}
                    onCancel={() => setReturning(null)}
                  />
                ) : (
                  <div className="actions">
                    <button
                      className={`btn ${session?.timerStartedAt ? 'running' : ''}`}
                      onClick={() => repo.toggleTimer(b.id)}
                    >
                      {session?.timerStartedAt ? t.reading.timerStop : t.reading.timerStart}
                    </button>
                    <button className="btn primary" onClick={() => setReturning(b.id)}>
                      {t.reading.return}
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </section>

      <section>
        <h2>{t.reading.recent}</h2>
        <SessionList sessions={sessions.slice(0, 20)} placeName={placeName} books={byId} />
      </section>
    </>
  )
}
