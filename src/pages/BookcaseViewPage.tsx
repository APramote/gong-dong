import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { Look } from '../db/types'
import { CoverThumb } from '../components/Cover'
import { StoragePhoto } from '../components/StoragePhoto'
import { ShapeFields } from '../components/ShapeFields'
import { t } from '../th'

const Storage3D = lazy(() => import('../three/Storage3D'))

/** ตู้หนังสือแบบ 3D: แตะเล่มเพื่อดูรายละเอียดหรือหยิบไปอ่าน */
export function BookcaseViewPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const bookcase = useLiveQuery(async () => (await repo.getBookcase(id)) ?? null, [id])
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const books = useLiveQuery(() => repo.listBooks(), []) ?? []
  const [selected, setSelected] = useState<string | null>(null)
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
  const pick = books.find((b) => b.id === selected && !b.takenAt)
  const pickShelf = pick && shelves.find((s) => s.id === pick.placeId)

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
              shelves: onShelf.map((row) => row.map((b) => ({ id: b.id, title: b.title, pages: b.pages, spineColor: b.spineColor }))),
              look,
              doorsOpen,
            }}
            selectedId={pick?.id ?? null}
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
            onChange={(l) => {
              setDraft(l)
              repo.updateBookcaseLook(id, l)
            }}
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

      <section>
        <h2>{t.view.photo}</h2>
        <StoragePhoto id={id} />
      </section>
    </>
  )
}
