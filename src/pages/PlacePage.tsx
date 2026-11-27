import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { BookRow } from '../components/BookRow'
import { FieldsForm } from '../components/FieldsForm'
import { placeFields } from '../placeFields'
import { placeLabel } from '../placeLabel'
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

  if (place === undefined) return null
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
            <button className="btn small danger" onClick={remove}>
              {t.common.delete}
            </button>
          </div>
        )}
      </div>

      {place && editing && (
        <FieldsForm
          fields={placeFields[place.kind]}
          initial={{ name: place.name, location: place.location, label: place.label }}
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await repo.updatePlace(place.id, v)
            setEditing(false)
          }}
        />
      )}

      <div className="section-head">
        <p className="muted">
          {t.common.books(books.length)}
          {place && place.kind !== 'box' && books.length > 1 &&
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
        <ol className="list">
          {books.map((b, i) => (
            <BookRow
              key={b.id}
              book={b}
              actions={
                <span className="reorder">
                  {place && place.kind !== 'box' && (
                    <>
                      <button
                        className="btn small"
                        aria-label={t.place.moveEarlier}
                        disabled={i === 0}
                        onClick={() => repo.shiftBook(b.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn small"
                        aria-label={t.place.moveLater}
                        disabled={i === books.length - 1}
                        onClick={() => repo.shiftBook(b.id, 1)}
                      >
                        ↓
                      </button>
                    </>
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
          ))}
        </ol>
      )}
    </>
  )
}
