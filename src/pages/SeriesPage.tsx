import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { BookRow } from '../components/BookRow'
import { ranges, summarize, type SeriesSummary } from '../lib/series'
import { t } from '../th'

function Progress({ s }: { s: SeriesSummary }) {
  const have = s.total - s.missing.length
  return (
    <span className="progress" aria-hidden>
      <span style={{ width: `${s.total ? (have / s.total) * 100 : 0}%` }} />
    </span>
  )
}

const status = (s: SeriesSummary) =>
  s.missing.length === 0 && s.total > 0
    ? t.series.complete
    : s.missing.length
      ? t.series.missing(ranges(s.missing))
      : ''

/** รายการชุดหนังสือทั้งหมด */
export function SeriesListPage() {
  const series = useLiveQuery(() => repo.listSeries(), [])
  const books = useLiveQuery(() => repo.listBooks(), []) ?? []
  const rows = useMemo(() => (series ?? []).map((s) => summarize(s, books)), [series, books])
  if (!series) return <p className="empty">{t.common.loading}</p>

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.series.title}</h1>
          <p className="muted">{t.series.lead}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="empty">{t.series.empty}</p>
      ) : (
        <ul className="list">
          {rows.map((s) => (
            <li className="row" key={s.series.id}>
              <Link to={`/series/${s.series.id}`} className="row-main">
                <span className="row-title">{s.series.name}</span>
                <span className="row-sub">
                  {[t.series.have(s.total - s.missing.length, s.total), status(s)].filter(Boolean).join(' · ')}
                </span>
                <Progress s={s} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** ชุดหนังสือหนึ่งชุด: เล่มที่มี เล่มที่ขาด ตั้งจำนวนเล่มทั้งชุด */
export function SeriesPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const series = useLiveQuery(async () => (await repo.getSeries(id)) ?? null, [id])
  const books = useLiveQuery(() => repo.listBooks(), []) ?? []
  const wishes = useLiveQuery(() => repo.listWishes(), []) ?? []
  const [wished, setWished] = useState(false)

  if (series === undefined) return <p className="empty">{t.common.loading}</p>
  if (series === null) return <p className="empty">{t.series.notFound}</p>
  const s = summarize(series, books)
  // เล่มที่ขาดและยังไม่ได้จดไว้ในรายการอยากได้
  const wishTitles = new Set(wishes.map((w) => w.title))
  const toWish = s.missing.filter((n) => !wishTitles.has(t.series.wishTitle(series.name, n)))

  return (
    <div className="form">
      <div>
        <h1>{series.name}</h1>
        <p className="muted">
          {[t.series.have(s.total - s.missing.length, s.total), s.done ? t.series.done(s.done) : ''].filter(Boolean).join(' · ')}
        </p>
        <Progress s={s} />
      </div>

      <div className="cols">
        <label>
          {t.series.name}
          <input
            defaultValue={series.name}
            onBlur={(e) => e.target.value.trim() && e.target.value !== series.name && repo.updateSeries(id, { name: e.target.value })}
          />
        </label>
        <label>
          {t.series.total}
          <input
            inputMode="numeric"
            defaultValue={series.total ?? ''}
            placeholder={t.series.totalHint}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10)
              repo.updateSeries(id, { total: Number.isFinite(n) && n > 0 ? n : null })
            }}
          />
        </label>
      </div>

      {s.missing.length > 0 && (
        <section>
          <h2>{t.series.missingTitle}</h2>
          <div className="missing">
            {s.missing.map((n) => (
              <span key={n} className="missing-no">
                {n}
              </span>
            ))}
          </div>
          {toWish.length > 0 && !wished ? (
            <p className="actions">
              <button
                className="btn"
                onClick={async () => {
                  for (const n of toWish)
                    await repo.addWish({ title: t.series.wishTitle(series.name, n), authors: s.books[0]?.authors ?? '', isbn: '', note: '' })
                  setWished(true)
                }}
              >
                {t.series.wishMissing(toWish.length)}
              </button>
            </p>
          ) : (
            wished && (
              <p className="muted">
                {t.series.wished} · <Link to="/wishlist" className="link">{t.wish.title}</Link>
              </p>
            )
          )}
        </section>
      )}

      <ul className="list">
        {s.books.map((b) => (
          <BookRow key={b.id} book={b} sub={t.series.no(b.seriesNo)} />
        ))}
      </ul>

      <div className="actions">
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm(t.series.confirmDelete(series.name))) return
            await repo.deleteSeries(id)
            navigate('/series', { replace: true })
          }}
        >
          {t.common.delete}
        </button>
      </div>
    </div>
  )
}
