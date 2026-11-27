import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { CoverThumb } from '../components/Cover'
import { download } from '../lib/download'
import { formatMinutes } from '../lib/stats'
import { yearReview } from '../lib/yearReview'
import { t } from '../th'

const hourRange = (h: number) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`
const monthName = (m: number) => new Date(2000, m, 1).toLocaleDateString('th-TH', { month: 'long' })

/** สรุปการอ่านทั้งปี บันทึกเป็นรูปไว้แชร์ได้ */
export function YearPage() {
  const books = useLiveQuery(() => repo.listBooks(), [])
  const sessions = useLiveQuery(() => repo.listSessions(), []) ?? []
  const quotes = useLiveQuery(() => repo.listQuotes(), []) ?? []
  const categories = useLiveQuery(() => repo.listCategories(), []) ?? []
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const card = useRef<HTMLDivElement>(null)

  // ปีที่มีข้อมูล (อ่านจบ หรือมีการอ่าน) และปีปัจจุบันเสมอ
  const years = useMemo(() => {
    const ys = new Set([thisYear])
    for (const b of books ?? []) if (b.finishedAt) ys.add(new Date(b.finishedAt).getFullYear())
    for (const s of sessions) if (s.endedAt) ys.add(new Date(s.endedAt).getFullYear())
    return [...ys].sort((a, b) => b - a)
  }, [books, sessions, thisYear])
  const r = useMemo(() => yearReview(year, books ?? [], sessions, quotes, categories), [year, books, sessions, quotes, categories])
  if (!books) return <p className="empty">{t.common.loading}</p>

  async function save() {
    if (!card.current) return
    setSaving(true)
    setError('')
    try {
      const { toBlob } = await import('html-to-image')
      const bg = getComputedStyle(card.current).backgroundColor
      const blob = await toBlob(card.current, { pixelRatio: 2, backgroundColor: bg })
      if (!blob) throw new Error('no image')
      const file = new File([blob], t.year.file(year), { type: 'image/png' })
      // มือถือ: เปิดเมนูแชร์ (บันทึกลงคลังรูปหรือส่งต่อได้) ไม่มีก็ดาวน์โหลด
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: t.year.eyebrow(year) }).catch(() => {})
      } else download(file.name, blob)
    } catch {
      setError(t.year.saveFail)
    }
    setSaving(false)
  }

  const facts: [string, string][] = [
    r.topCategory && [t.year.favCategory, `${r.topCategory.name} · ${t.year.books(r.topCategory.count)}`],
    r.mostTime && [t.year.mostTime, `${r.mostTime.book.title} · ${formatMinutes(r.mostTime.minutes)}`],
    r.longest && [t.year.longest, `${r.longest.title} · ${t.year.pagesN(r.longest.pages!)}`],
    r.bestHour !== null && [t.year.bestHour, hourRange(r.bestHour)],
    r.bestMonth !== null && [t.year.bestMonth, monthName(r.bestMonth)],
    r.added > 0 && [t.year.added, t.year.books(r.added)],
  ].filter((x): x is [string, string] => Boolean(x))
  const hasData = r.finished.length > 0 || r.sessions > 0

  return (
    <div className="form">
      <div className="page-head">
        <h1>{t.year.title}</h1>
        {years.length > 1 && (
          <select aria-label={t.year.pickYear} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y + 543}
              </option>
            ))}
          </select>
        )}
      </div>

      {!hasData ? (
        <p className="empty">{t.year.empty}</p>
      ) : (
        <>
          <div className="year-card" ref={card}>
            <span className="eyebrow">{t.year.eyebrow(year)}</span>
            <h2 className="year-big">{t.year.finished(r.finished.length)}</h2>
            <p className="year-lead">{t.year.lead(r.finished.length)}</p>

            {r.finished.length > 0 && (
              <div className="year-covers">
                {r.finished.slice(0, 12).map((b) => (
                  <CoverThumb key={b.id} bookId={b.id} title={b.title} color={b.spineColor} />
                ))}
              </div>
            )}

            <div className="year-stats">
              <div>
                <strong>{formatMinutes(r.minutes)}</strong>
                <span>{t.year.time}</span>
              </div>
              <div>
                <strong>{r.pages.toLocaleString('th-TH')}</strong>
                <span>{t.year.pages}</span>
              </div>
              <div>
                <strong>{t.year.dayN(r.daysRead)}</strong>
                <span>{t.year.days}</span>
              </div>
              <div>
                <strong>{t.year.dayN(r.bestStreak)}</strong>
                <span>{t.year.streak}</span>
              </div>
            </div>

            {facts.length > 0 && (
              <dl className="year-facts">
                {facts.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}

            {r.quote && (
              <figure className="year-quote">
                <blockquote>{r.quote.quote.text}</blockquote>
                <figcaption>— {r.quote.book.title}</figcaption>
              </figure>
            )}
            <span className="year-brand">{t.appName}</span>
          </div>

          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button className="btn primary" disabled={saving} onClick={save}>
              {saving ? t.year.saving : t.year.save}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
