import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { ReadingStatus } from '../db/types'
import { BookRow } from '../components/BookRow'
import { placeGroups, placeLabel } from '../placeLabel'
import { t } from '../th'

const NO_PLACE = '__none__'

export function LibraryPage() {
  const books = useLiveQuery(() => repo.listBooks(), [])
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ReadingStatus | ''>('')
  const [placeId, setPlaceId] = useState('')

  const labels = useMemo(
    () => new Map(places.map((p) => [p.id, placeLabel(p, bookcases)])),
    [places, bookcases],
  )

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (books ?? [])
      .filter((b) => !status || b.status === status)
      .filter((b) => !placeId || (placeId === NO_PLACE ? !b.placeId : b.placeId === placeId))
      .filter(
        (b) =>
          !q ||
          [b.title, b.authors, b.publisher, b.category, b.isbn, ...b.tags]
            .join(' ')
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => a.title.localeCompare(b.title, 'th'))
  }, [books, query, status, placeId])

  if (!books) return null
  const dong = books.filter((b) => b.status === 'dong').length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.nav.library}</h1>
          <p className="muted">{t.library.summary(books.length, dong)}</p>
        </div>
        <Link to="/book/new" className="btn primary">
          {t.library.addBook}
        </Link>
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder={t.library.search}
          aria-label={t.library.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label={t.book.status}
          value={status}
          onChange={(e) => setStatus(e.target.value as ReadingStatus | '')}
        >
          <option value="">{t.library.allStatus}</option>
          {Object.entries(t.status).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select aria-label={t.book.place} value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
          <option value="">{t.library.allPlaces}</option>
          <option value={NO_PLACE}>{t.library.noPlace}</option>
          {placeGroups(places, bookcases).map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="empty">{books.length === 0 ? t.library.empty : t.library.noMatch}</p>
      ) : (
        <ul className="list">
          {shown.map((b) => (
            <BookRow
              key={b.id}
              book={b}
              sub={b.placeId ? labels.get(b.placeId) : t.library.noPlace}
            />
          ))}
        </ul>
      )}
    </>
  )
}
