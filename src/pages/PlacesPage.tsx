import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { Place } from '../db/types'
import { FieldsForm } from '../components/FieldsForm'
import { bookcaseFields, placeFields } from '../placeFields'
import { t } from '../th'

export function PlacesPage() {
  const books = useLiveQuery(() => repo.listBooks(), []) ?? []
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []
  /** ฟอร์มที่เปิดอยู่: 'bookcase' | 'pile' | 'box' | `edit:<bookcaseId>` */
  const [open, setOpen] = useState<string | null>(null)
  const close = () => setOpen(null)

  const count = (placeId: string | null) =>
    books.filter((b) => b.placeId === placeId && !b.takenAt).length
  const unplaced = count(null)

  const placeRow = (p: Place, detail: string) => (
    <li className="row" key={p.id}>
      <Link to={`/place/${p.id}`} className="row-main">
        <span className="row-title">{p.name}</span>
        <span className="row-sub">{detail}</span>
      </Link>
      <span className="count">{t.common.books(count(p.id))}</span>
    </li>
  )

  const section = (
    title: string,
    addLabel: string,
    key: string,
    form: ReactNode,
    body: ReactNode,
  ) => (
    <section>
      <div className="section-head">
        <h2>{title}</h2>
        <button className="btn" onClick={() => setOpen(key)}>
          {addLabel}
        </button>
      </div>
      {open === key && form}
      {body}
    </section>
  )

  return (
    <>
      <div className="page-head">
        <h1>{t.nav.places}</h1>
        <Link to="/scan" className="btn primary">
          {t.scan.open}
        </Link>
      </div>

      {section(
        t.places.bookcases,
        t.places.addBookcase,
        'bookcase',
        <FieldsForm
          fields={[...bookcaseFields, { key: 'shelves', label: t.places.shelfCount, numeric: true }]}
          initial={{ shelves: '4' }}
          onCancel={close}
          onSubmit={async (v) => {
            const n = Math.min(Math.max(parseInt(v.shelves, 10) || 1, 1), 30)
            await repo.addBookcase({ name: v.name, room: v.room }, n)
            close()
          }}
        />,
        bookcases.length === 0 ? (
          <p className="empty">{t.places.emptyBookcases}</p>
        ) : (
          bookcases.map((bc) => {
            // แสดงชั้นบนสุดก่อนให้ตรงกับตู้จริง (ชั้นที่ 1 อยู่ล่างสุด)
            const shelves = [
              ...places.filter((p) => p.kind === 'shelf' && p.bookcaseId === bc.id).reverse(),
              ...places.filter((p) => p.kind === 'drawer' && p.bookcaseId === bc.id),
            ]
            return (
              <div className="card" key={bc.id}>
                <div className="section-head">
                  <div>
                    <h3>{bc.name}</h3>
                    {bc.room && <p className="muted">{bc.room}</p>}
                  </div>
                  <div className="actions">
                    <Link className="btn small primary" to={`/view/bookcase/${bc.id}`}>
                      {t.view.open}
                    </Link>
                    <button className="btn small" onClick={() => repo.addShelf(bc.id)}>
                      {t.places.addShelf}
                    </button>
                    <button className="btn small" onClick={() => setOpen(`edit:${bc.id}`)}>
                      {t.common.edit}
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() =>
                        confirm(t.places.confirmDeleteBookcase(bc.name)) && repo.deleteBookcase(bc.id)
                      }
                    >
                      {t.common.delete}
                    </button>
                  </div>
                </div>
                {open === `edit:${bc.id}` && (
                  <FieldsForm
                    fields={bookcaseFields}
                    initial={{ name: bc.name, room: bc.room }}
                    onCancel={close}
                    onSubmit={async (v) => {
                      await repo.updateBookcase(bc.id, { name: v.name, room: v.room })
                      close()
                    }}
                  />
                )}
                <ul className="list">{shelves.map((s) => placeRow(s, ''))}</ul>
              </div>
            )
          })
        ),
      )}

      {section(
        t.places.piles,
        t.places.addPile,
        'pile',
        <FieldsForm
          fields={placeFields.pile}
          onCancel={close}
          onSubmit={async (v) => {
            await repo.addPlace('pile', { name: v.name, location: v.location, label: '' })
            close()
          }}
        />,
        <PlaceList
          rows={places.filter((p) => p.kind === 'pile').map((p) => placeRow(p, p.location))}
          empty={t.places.emptyPiles}
        />,
      )}

      {section(
        t.places.boxes,
        t.places.addBox,
        'box',
        <FieldsForm
          fields={placeFields.box}
          onCancel={close}
          onSubmit={async (v) => {
            await repo.addPlace('box', { name: v.name, location: v.location, label: v.label })
            close()
          }}
        />,
        <PlaceList
          rows={places
            .filter((p) => p.kind === 'box')
            .map((p) => placeRow(p, [p.label, p.location].filter(Boolean).join(' · ')))}
          empty={t.places.emptyBoxes}
        />,
      )}

      {unplaced > 0 && (
        <section>
          <ul className="list">
            <li className="row">
              <Link to="/place/none" className="row-main">
                <span className="row-title">{t.places.unplaced}</span>
              </Link>
              <span className="count">{t.common.books(unplaced)}</span>
            </li>
          </ul>
        </section>
      )}
    </>
  )
}

function PlaceList({ rows, empty }: { rows: ReactNode[]; empty: string }) {
  return rows.length === 0 ? <p className="empty">{empty}</p> : <ul className="list">{rows}</ul>
}
