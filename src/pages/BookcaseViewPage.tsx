import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { Look } from '../db/types'
import { CoverThumb } from '../components/Cover'
import { StoragePhoto } from '../components/StoragePhoto'
import { ShapeFields } from '../components/ShapeFields'
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

  if (bookcase === undefined) return null
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
    const lost = await repo.booksInRemovedDrawers(id, l)
    if (lost && !confirm(t.shape.confirmFewerDrawers(lost))) return
    setDraft(l)
    await repo.updateBookcaseLook(id, l)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link to="/places">‹ {t.nav.places}</Link> · {t.kind.shelf}
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
      </div>
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
            <CoverThumb bookId={pick.id} />
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
        <h2>{t.view.photo}</h2>
        <StoragePhoto id={id} />
      </section>
    </>
  )
}
