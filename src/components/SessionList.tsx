import type { Book, ReadingSession } from '../db/types'
import { formatMinutes } from '../lib/stats'
import { t } from '../th'

const date = (ms: number) =>
  new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

/** รายการประวัติการหยิบไปอ่าน (เฉพาะที่วางคืนแล้ว) */
export function SessionList({
  sessions,
  placeName,
  books,
}: {
  sessions: ReadingSession[]
  placeName: (id: string | null) => string
  /** ส่งมาเมื่อต้องการแสดงชื่อหนังสือในแต่ละรายการ */
  books?: Map<string, Book>
}) {
  const done = sessions.filter((s) => s.endedAt !== null)
  const duration = (s: ReadingSession) =>
    s.minutes ? (s.estimated ? t.reading.about(formatMinutes(s.minutes)) : formatMinutes(s.minutes)) : ''
  if (done.length === 0) return <p className="empty">{t.reading.noHistory}</p>
  return (
    <ul className="list">
      {done.map((s) => (
        <li className="row" key={s.id}>
          <div className="row-main">
            {books && <span className="row-title">{books.get(s.bookId)?.title ?? '—'}</span>}
            <span className={books ? 'row-sub' : 'row-title'}>
              {s.kind === 'carry'
                ? t.reading.carried(date(s.endedAt!))
                : t.reading.session(date(s.endedAt!), duration(s), t.reading.pagesRange(s.startPage, s.endPage))}
            </span>
            {/* การคั่นหน้าไม่มีการย้ายที่ แสดงที่เก็บเฉพาะรายการหยิบ-วางคืน */}
            {s.kind !== 'read' && (
              <span className="row-sub">{t.reading.moved(placeName(s.fromPlaceId), placeName(s.toPlaceId))}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
