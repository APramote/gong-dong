import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { Look } from '../db/types'
import { CoverThumb } from '../components/Cover'
import { StoragePhoto } from '../components/StoragePhoto'
import { ShapeFields } from '../components/ShapeFields'
import { FieldsForm } from '../components/FieldsForm'
import { bookcaseFields } from '../placeFields'
import { BookRow } from '../components/BookRow'
import type { Pick3D } from '../three/scene'
import { t } from '../th'

const Storage3D = lazy(() => import('../three/Storage3D'))

/** ตู้หนังสือแบบ 3D: แตะเล่มเพื่อดูรายละเอียดหรือหยิบไปอ่าน */
export function BookcaseViewPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const bookcase = useLiveQuery(async () => (await repo.getBookcase(id)) ?? null, [id])
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const books = useLiveQuery(() => repo.listBooks(), []) ?? []
  const [selected, setSelected] = useState<Pick3D | null>(null)
  const [doorsOpen, setDoorsOpen] = useState(false)
  /** ค่าที่กำลังแก้ ใช้แสดงทันทีระหว่างรอบันทึกลงฐานข้อมูล — null = ไม่ได้แก้อยู่ */
  const [draft, setDraft] = useState<Look | null>(null)
  const [renaming, setRenaming] = useState(false)

  if (bookcase === undefined) return <p className="empty">{t.common.loading}</p>
  if (!bookcase) return <p className="empty">{t.view.notFound}</p>

  // listPlaces เรียงตาม order อยู่แล้ว: ชั้นที่ 1 (ล่างสุด) มาก่อน
  const shelves = places.filter((p) => p.kind === 'shelf' && p.bookcaseId === id)
  const look = draft ?? bookcase.look ?? { color: '', ratio: 0 }
  // หนังสือที่อยู่ในมือไม่อยู่บนชั้น
  const onShelf = shelves.map((s) =>
    books.filter((b) => b.placeId === s.id && !b.takenAt).sort((a, b) => a.position - b.position),
  )
  const drawers = places.filter((p) => p.kind === 'drawer' && p.bookcaseId === id)
  const inPlace = (pid: string) =>
    books.filter((b) => b.placeId === pid && !b.takenAt).sort((a, b) => a.position - b.position)
  const as3D = (b: (typeof books)[number]) => ({ id: b.id, title: b.title, pages: b.pages, spineColor: b.spineColor })
  const pick = selected?.kind === 'book' ? books.find((b) => b.id === selected.id && !b.takenAt) : undefined
  const pickShelf = pick && shelves.find((s) => s.id === pick.placeId)
  const drawer = selected?.kind === 'drawer' ? drawers.find((d) => d.id === selected.id) : undefined
  const drawerBooks = drawer ? inPlace(drawer.id) : []

  async function changeShape(l: Look) {
    // ลดลิ้นชักที่มีหนังสืออยู่ ต้องถามก่อน
    const before = draft
    setDraft(l)
    const lost = await repo.booksInRemovedDrawers(id, l)
    if (lost && !confirm(t.shape.confirmFewerDrawers(lost))) return setDraft(before)
    await repo.updateBookcaseLook(id, l)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link to="/places">‹ {t.nav.places}</Link> · {t.places.bookcases}
          </p>
          <h1>{bookcase.name}</h1>
          {bookcase.room && <p className="muted">{bookcase.room}</p>}
        </div>
      </div>
      <div className="view3d-wrap">
        <Suspense fallback={null}>
          <Storage3D
            model={{
              shelves: onShelf.map((row) => row.map(as3D)),
              drawers: drawers.map((d) => ({ id: d.id, books: inPlace(d.id).map(as3D) })),
              look,
              doorsOpen,
            }}
            label={t.view.label3d(bookcase.name, shelves.length, drawers.length, onShelf.flat().length)}
            selected={pick || drawer ? selected : null}
            onSelect={setSelected}
          />
        </Suspense>
      </div>
      <p className="muted center">{t.view.hint}</p>
      <div className="actions center-actions">
        {(look.doors ?? 0) > 0 && (
          <button className="btn small" onClick={() => setDoorsOpen((o) => !o)}>
            {doorsOpen ? t.shape.closeDoors : t.shape.openDoors}
          </button>
        )}
        <button className="btn small" onClick={() => setDraft((d) => (d ? null : look))}>
          {draft ? t.shape.done : t.shape.edit}
        </button>
        <button className="btn small" onClick={() => setRenaming((r) => !r)}>
          {t.view.rename}
        </button>
        <button className="btn small" onClick={() => repo.addShelf(id)}>
          {t.places.addShelf}
        </button>
        <button
          className="btn small danger"
          onClick={async () => {
            if (!confirm(t.places.confirmDeleteBookcase(bookcase.name))) return
            await repo.deleteBookcase(id)
            navigate('/places', { replace: true })
          }}
        >
          {t.view.remove}
        </button>
      </div>
      {renaming && (
        <FieldsForm
          fields={bookcaseFields}
          initial={{ name: bookcase.name, room: bookcase.room }}
          onCancel={() => setRenaming(false)}
          onSubmit={async (v) => {
            await repo.updateBookcase(id, { name: v.name, room: v.room })
            setRenaming(false)
          }}
        />
      )}
      {draft && (
        <div className="inline-form form">
          <ShapeFields
            look={draft}
            onChange={changeShape}
          />
        </div>
      )}

      {pick && (
        <div className="card picked">
          <div className="row">
            <CoverThumb bookId={pick.id} title={pick.title} color={pick.spineColor} />
            <div className="row-main">
              <span className="row-title">{pick.title}</span>
              <span className="row-sub">
                {[pick.authors, pickShelf && t.view.onShelf(pickShelf.name)].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
          <div className="actions">
            <button
              className="btn primary"
              onClick={async () => {
                await repo.takeBook(pick.id)
                navigate('/reading')
              }}
            >
              {t.reading.take}
            </button>
            <Link className="btn" to={`/book/${pick.id}`}>
              {t.view.openBook}
            </Link>
          </div>
        </div>
      )}

      {drawer && (
        <div className="card picked">
          <div className="section-head">
            <h3>{drawer.name}</h3>
            <Link className="btn small" to={`/place/${drawer.id}`}>
              {t.view.openDrawer}
            </Link>
          </div>
          {drawerBooks.length === 0 ? (
            <p className="muted">{t.view.drawerEmpty}</p>
          ) : (
            <ul className="list">
              {drawerBooks.map((b) => (
                <BookRow
                  key={b.id}
                  book={b}
                  actions={
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
                  }
                />
              ))}
            </ul>
          )}
          <div className="actions">
            <Link className="btn primary" to={`/add?place=${drawer.id}`}>
              {t.view.addToDrawer}
            </Link>
          </div>
        </div>
      )}

      <section>
        <h2>{t.view.parts}</h2>
        <ul className="list">
          {/* ชั้นบนสุดก่อนเหมือนมองตู้จริง แล้วตามด้วยลิ้นชัก */}
          {[...[...shelves].reverse(), ...drawers].map((p) => (
            <li className="row" key={p.id}>
              <Link to={`/place/${p.id}`} className="row-main">
                <span className="row-title">{p.name}</span>
                <span className="row-sub">
                  {t.common.books(inPlace(p.id).length)}
                  {inPlace(p.id).length > 0 && ` · ${inPlace(p.id).map((b) => b.title).join(', ')}`}
                </span>
              </Link>
              <Link className="btn small" to={`/add?place=${p.id}`}>
                {t.view.addBooks}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t.view.photo}</h2>
        <StoragePhoto id={id} />
      </section>
    </>
  )
}
