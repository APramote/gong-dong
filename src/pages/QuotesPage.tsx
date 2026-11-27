import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { QuoteCard } from '../components/QuoteSection'
import { t } from '../th'

/** สมุดประโยคที่ชอบ รวมจากทุกเล่ม */
export function QuotesPage() {
  const quotes = useLiveQuery(() => repo.listQuotes(), [])
  const books = useLiveQuery(() => repo.listBooks(), []) ?? []
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query).trim().toLowerCase()
  const titles = useMemo(() => new Map(books.map((b) => [b.id, b.title])), [books])

  const shown = useMemo(
    () =>
      (quotes ?? [])
        // ประโยคของเล่มที่ถูกลบไปแล้วไม่ต้องแสดง
        .filter((x) => titles.has(x.bookId))
        .filter((x) => !q || `${x.text} ${titles.get(x.bookId)} ${x.note}`.toLowerCase().includes(q)),
    [quotes, titles, q],
  )
  if (!quotes) return <p className="empty">{t.common.loading}</p>

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.quotes.title}</h1>
          <p className="muted">{t.quotes.lead}</p>
        </div>
      </div>
      {quotes.length > 0 && (
        <div className="filters">
          <input
            type="search"
            placeholder={t.quotes.search}
            aria-label={t.quotes.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {shown.length === 0 ? (
        <p className="empty">{quotes.length ? t.library.noMatch : t.quotes.empty}</p>
      ) : (
        <div className="quotes">
          {shown.map((x) => (
            <QuoteCard
              key={x.id}
              quote={x}
              source={
                <Link to={`/book/${x.bookId}`} className="link">
                  {titles.get(x.bookId)}
                </Link>
              }
            />
          ))}
        </div>
      )}
    </>
  )
}
