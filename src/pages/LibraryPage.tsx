import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { ReadingStatus } from '../db/types'
import { BookRow } from '../components/BookRow'
import { CoverThumb } from '../components/Cover'
import { placeGroups, placeLabel } from '../placeLabel'
import { t } from '../th'

const NO_PLACE = '__none__'
const IN_HAND = '__hand__'
const NO_CATEGORY = '__none__'
const PAGE = 100

export function LibraryPage() {
  const books = useLiveQuery(() => repo.listBooks(), [])
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []
  const categories = useLiveQuery(() => repo.listCategories(), []) ?? []
  // ตัวกรองหมวดอยู่ใน URL (?cat=) เพื่อให้ลิงก์จากหน้าหมวดเปิดคลังที่กรองแล้วได้
  const [params, setParams] = useSearchParams()
  const categoryId = params.get('cat') ?? ''
  const setCategoryId = (v: string) => setParams(v ? { cat: v } : {}, { replace: true })

  const [query, setQuery] = useState('')
  // ค้นหาตามค่าที่ตามหลังการพิมพ์ ช่องพิมพ์จะไม่หน่วงเมื่อคลังใหญ่
  const deferredQuery = useDeferredValue(query)
  /** แสดงทีละหน้า คลังหลายพันเล่มไม่ต้องวาดทุกแถวพร้อมกัน */
  const [limit, setLimit] = useState(PAGE)
  const [status, setStatus] = useState<ReadingStatus | ''>('')
  const [placeId, setPlaceId] = useState('')

  const labels = useMemo(
    () => new Map(places.map((p) => [p.id, placeLabel(p, bookcases)])),
    [places, bookcases],
  )

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  const shown = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return (books ?? [])
      .filter((b) =>
        !categoryId ? true : categoryId === NO_CATEGORY ? !b.categoryId : b.categoryId === categoryId,
      )
      .filter((b) => !status || b.status === status)
      .filter((b) =>
        !placeId
          ? true
          : placeId === IN_HAND
            ? Boolean(b.takenAt)
            : placeId === NO_PLACE
              ? !b.placeId && !b.takenAt
              : b.placeId === placeId,
      )
      .filter(
        (b) =>
          !q ||
          [b.title, b.authors, b.publisher, (b.categoryId && catName.get(b.categoryId)) || '', b.isbn, ...b.tags]
            .join(' ')
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => a.title.localeCompare(b.title, 'th'))
  }, [books, deferredQuery, status, placeId, categoryId, catName])

  // เปลี่ยนเงื่อนไขค้นหาแล้วเริ่มแสดงหน้าแรกใหม่
  useEffect(() => setLimit(PAGE), [deferredQuery, status, placeId, categoryId])

  if (!books) return <p className="empty">{t.common.loading}</p>
  const dong = books.filter((b) => b.status === 'dong').length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.nav.library}</h1>
          <p className="muted">{t.library.summary(books.length, dong)}</p>
        </div>
        <div className="actions">
          <Link to="/categories" className="btn">
            {t.categories.title}
          </Link>
          <Link to="/add" className="btn primary">
            {t.library.addBook}
          </Link>
        </div>
      </div>

      <nav className="tools" aria-label={t.tools.label}>
        {dong > 0 && <Link to="/random">{t.tools.random}</Link>}
        <Link to="/check">{t.tools.check}</Link>
        <Link to="/wishlist">{t.tools.wishlist}</Link>
        <Link to="/series">{t.tools.series}</Link>
        <Link to="/quotes">{t.tools.quotes}</Link>
      </nav>

      {/* หนังสือที่อยู่ในมือ: ทางลัดกลับไปอ่านต่อ */}
      {books.some((b) => b.takenAt) && (
        <div className="now-reading">
          {books
            .filter((b) => b.takenAt)
            .sort((a, b) => b.takenAt! - a.takenAt!)
            .slice(0, 3)
            .map((b) => {
              const pct = b.pages && b.currentPage ? Math.min(100, (b.currentPage / b.pages) * 100) : 0
              return (
                <Link to="/reading" className="now-card" key={b.id}>
                  <CoverThumb bookId={b.id} title={b.title} color={b.spineColor} />
                  <span className="now-text">
                    <span className="eyebrow">{t.library.continueReading}</span>
                    <span className="now-title">{b.title}</span>
                    {b.currentPage ? (
                      <span className="row-sub">{t.library.page(b.currentPage, b.pages)}</span>
                    ) : null}
                    {pct > 0 && (
                      <span className="progress" aria-hidden>
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    )}
                  </span>
                </Link>
              )
            })}
        </div>
      )}

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
          <option value={IN_HAND}>{t.library.inHand}</option>
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
        <select aria-label={t.book.category} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{t.categories.all}</option>
          <option value={NO_CATEGORY}>{t.categories.none}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="empty">{books.length === 0 ? t.library.empty : t.library.noMatch}</p>
      ) : (
        <ul className="list">
          {shown.slice(0, limit).map((b) => (
            <BookRow
              key={b.id}
              book={b}
              sub={[
                b.takenAt ? t.library.inHand : b.placeId ? labels.get(b.placeId) : t.library.noPlace,
                b.categoryId && catName.get(b.categoryId),
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <p className="center-actions actions">
          <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
            {t.library.showMore(Math.min(PAGE, shown.length - limit), shown.length - limit)}
          </button>
        </p>
      )}
    </>
  )
}
