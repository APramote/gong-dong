import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { BookRow } from '../components/BookRow'
import { FieldsForm } from '../components/FieldsForm'
import { placeFields } from '../placeFields'
import { placeLabel } from '../placeLabel'
import { StoragePhoto } from '../components/StoragePhoto'
import { ShelfSize } from '../components/ShelfSize'
import { rowOf, rowsOf } from '../lib/capacity'
import { readWidth } from '../lib/bookcaseSize'
import type { Book } from '../db/types'
import { t } from '../th'

export function PlacePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const isNone = id === 'none'
  const placeId = isNone ? null : id

  const place = useLiveQuery(async () => (await repo.getPlace(id)) ?? null, [id])
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []
  const books = useLiveQuery(() => repo.booksIn(placeId), [placeId]) ?? []
  const [editing, setEditing] = useState(false)

  // ชั้นที่วางซ้อนสองแถว: แยกรายการเป็นแถวหน้าและแถวหลัง (ที่เก็บอื่นมีกลุ่มเดียว)
  const twoRows = Boolean(place && rowsOf(place) === 2)
  const groups: { row: 0 | 1; books: Book[] }[] = twoRows
    ? [
        { row: 0, books: books.filter((b) => rowOf(b) === 0) },
        { row: 1, books: books.filter((b) => rowOf(b) === 1) },
      ]
    : [{ row: 0, books }]
  if (place === undefined) return <p className="empty">{t.common.loading}</p>
  if (!place && !isNone) return <p className="empty">{t.place.notFound}</p>

  const title = place ? placeLabel(place, bookcases) : t.places.unplaced
  const detail = place ? [place.label, place.location].filter(Boolean).join(' · ') : ''

  async function remove() {
    if (!place || !confirm(t.places.confirmDeletePlace(place.name))) return
    await repo.deletePlace(place.id)
    navigate('/places')
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link to="/places">‹ {t.nav.places}</Link>
            {place && ` · ${t.kind[place.kind]}`}
          </p>
          <h1>{title}</h1>
          {detail && <p className="muted">{detail}</p>}
        </div>
        {place && (
          <div className="actions">
            <button className="btn small" onClick={() => setEditing(true)}>
              {t.common.edit}
            </button>
            {(place.kind === 'box' || place.kind === 'pile') && (
              <Link className="btn small" to={`/labels?ids=${place.id}`}>
                {t.labels.printOne}
              </Link>
            )}
            {/* ลิ้นชักเพิ่ม/ลดผ่านรูปทรงตู้ ไม่ลบทีละช่อง */}
            {place.kind !== 'drawer' && (
              <button className="btn small danger" onClick={remove}>
                {t.common.delete}
              </button>
            )}
          </div>
        )}
      </div>

      {place && editing && (
        <FieldsForm
          fields={placeFields[place.kind]}
          initial={{
            name: place.name,
            location: place.location,
            label: place.label,
            width: place.width ? String(place.width) : '',
            twoRows: rowsOf(place) === 2 ? '1' : '',
          }}
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            const rows = v.twoRows === '1' ? 2 : 1
            // กลับเป็นแถวเดียว: หนังสือแถวหลังจะมารวมกับแถวหน้า ถามก่อนถ้ามีเล่มอยู่แถวหลัง
            if (place.kind === 'shelf' && rows === 1 && rowsOf(place) === 2 && books.some((b) => b.row === 1) && !confirm(t.shelf.confirmOneRow)) return
            await repo.updatePlace(place.id, { name: v.name, location: v.location ?? place.location, label: v.label ?? place.label })
            if (place.kind === 'shelf') await repo.setShelfShape(place.id, { width: readWidth(v.width ?? ''), rows })
            setEditing(false)
          }}
        />
      )}

      {(place?.kind === 'shelf' || place?.kind === 'drawer') && place.bookcaseId && (
        <p>
          <Link className="btn small" to={`/view/bookcase/${place.bookcaseId}`}>
            {t.view.openBookcase}
          </Link>
        </p>
      )}
      {place && (place.kind === 'pile' || place.kind === 'box') && <StoragePhoto id={place.id} />}
      {place?.kind === 'shelf' && <ShelfSize place={place} bookcase={bookcases.find((x) => x.id === place.bookcaseId)} books={books} onEdit={() => setEditing(true)} />}

      <div className="section-head">
        <p className="muted">
          {t.common.books(books.length)}
          {place && (place.kind === 'shelf' || place.kind === 'pile') && books.length > 1 &&
            ` · ${place.kind === 'pile' ? t.place.orderPile : t.place.orderShelf}`}
        </p>
        {place && (
          <Link to={`/add?place=${place.id}`} className="btn primary">
            {t.place.addHere}
          </Link>
        )}
      </div>

      {books.length === 0 ? (
        <p className="empty">{t.place.empty}</p>
      ) : (
        groups.map((g) => (
          <div key={g.row} className="row-group">
            {twoRows && <h2 className="row-head">{g.row === 0 ? t.shelf.front : t.shelf.back}</h2>}
            {g.books.length === 0 ? (
              <p className="muted">{t.shelf.rowEmpty}</p>
            ) : (
              <ol className="list">
                {/* กอง: แสดงเล่มบนสุดก่อนเหมือนมองกองจริง ↑ = ขึ้นไปบนกอง; ชั้นวาง: ← → = ซ้าย/ขวา (ภายในแถวเดียวกัน) */}
                {(place?.kind === 'pile' ? [...g.books].reverse() : g.books).map((b, i, shown) => {
                  const pile = place?.kind === 'pile'
                  const first = i === 0
                  const last = i === shown.length - 1
                  return (
                    <BookRow
                      key={b.id}
                      book={b}
                      actions={
                        <span className="reorder">
                          {place && (place.kind === 'shelf' || place.kind === 'pile') && (
                            <>
                              <button
                                className="btn small"
                                aria-label={`${pile ? t.place.moveUp : t.place.moveLeft} ${b.title}`}
                                disabled={first}
                                onClick={() => repo.shiftBook(b.id, pile ? 1 : -1)}
                              >
                                {pile ? '↑' : '←'}
                              </button>
                              <button
                                className="btn small"
                                aria-label={`${pile ? t.place.moveDown : t.place.moveRight} ${b.title}`}
                                disabled={last}
                                onClick={() => repo.shiftBook(b.id, pile ? -1 : 1)}
                              >
                                {pile ? '↓' : '→'}
                              </button>
                            </>
                          )}
                          {twoRows && (
                            <button
                              className="btn small"
                              aria-label={`${g.row === 0 ? t.shelf.toBack : t.shelf.toFront} ${b.title}`}
                              onClick={() => repo.setRow(b.id, g.row === 0 ? 1 : 0)}
                            >
                              {g.row === 0 ? t.shelf.toBack : t.shelf.toFront}
                            </button>
                          )}
                          <button
                            className="btn small"
                            aria-label={`${t.reading.take} ${b.title}`}
                            onClick={async () => {
                              await repo.takeBook(b.id)
                              navigate('/reading')
                            }}
                          >
                            {t.reading.takeShort}
                          </button>
                        </span>
                      }
                    />
                  )
                })}
              </ol>
            )}
          </div>
        ))
      )}
    </>
  )
}
