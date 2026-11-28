import { lazy, Suspense, useEffect, useRef, useState } from 'react'
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
import { footprint, rowOf, rowsOf, shelfWidth, usage } from '../lib/capacity'
import { bookcaseSizeFields } from '../placeFields'
import { allTwoRows, bookcaseInitial, saveBookcase, someTwoRows } from '../lib/bookcaseSize'
import { categoryLines } from '../lib/shelfLabel'
import { t } from '../th'

const Storage3D = lazy(() => import('../three/Storage3D'))

/** ตู้หนังสือแบบ 3D: แตะเล่มเพื่อดูรายละเอียดหรือหยิบไปอ่าน */
export function BookcaseViewPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const bookcase = useLiveQuery(async () => (await repo.getBookcase(id)) ?? null, [id])
  const placesRaw = useLiveQuery(() => repo.listPlaces(), [])
  const places = placesRaw ?? []
  const booksRaw = useLiveQuery(() => repo.listBooks(), [])
  const categoriesRaw = useLiveQuery(() => repo.listCategories(), [])
  const books = booksRaw ?? []
  const categories = categoriesRaw ?? []
  const [selected, setSelected] = useState<Pick3D | null>(null)
  const [doorsOpen, setDoorsOpen] = useState(false)
  /** ดูแถวหลัง: แถวหน้าจางลง แตะเลือกเล่มแถวหลังได้ */
  const [backView, setBackView] = useState(false)
  /** ค่าที่กำลังแก้ ใช้แสดงทันทีระหว่างรอบันทึกลงฐานข้อมูล — null = ไม่ได้แก้อยู่ */
  const [draft, setDraft] = useState<Look | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [spillMsg, setSpillMsg] = useState('')
  /** ขยายภาพ 3D เต็มจอ (กด Esc หรือปุ่มย่อเพื่อกลับ) */
  const [full, setFull] = useState(false)
  /** กลุ่มการ์ดของสิ่งที่เลือก ใช้เลื่อนจอมาหาเมื่อเลือกจากรายการด้านล่าง */
  const stackRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', onKey)
    // เต็มจอแล้วหน้าข้างหลังไม่ควรเลื่อนตาม
    document.body.classList.add('no-scroll')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
    }
  }, [full])

  // รอหนังสือและหมวดด้วย ภาพ 3D จะได้จัดกล้องครั้งแรกพร้อมป้ายครบ ไม่ตกขอบจอ
  if (bookcase === undefined || booksRaw === undefined || categoriesRaw === undefined || placesRaw === undefined) return <p className="empty">{t.common.loading}</p>
  if (!bookcase) return <p className="empty">{t.view.notFound}</p>

  // listPlaces เรียงตาม order อยู่แล้ว: ชั้นที่ 1 (ล่างสุด) มาก่อน
  const shelves = places.filter((p) => p.kind === 'shelf' && p.bookcaseId === id)
  const look = draft ?? bookcase.look ?? { color: '', ratio: 0 }
  // หนังสือที่อยู่ในมือไม่อยู่บนชั้น
  const onShelf = shelves.map((s) =>
    books.filter((b) => b.placeId === s.id && !b.takenAt).sort((a, b) => a.position - b.position),
  )
  // ป้ายของชั้น: หมวดที่มีมากที่สุดสองหมวดบนชั้นนั้น (หมวดอื่นนับรวมเป็น +N)
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const twoRows = (i: number) => rowsOf(shelves[i]) === 2
  // ป้ายของชั้น: จำนวนเล่มทั้งชั้นขึ้นก่อน (สั้น ไม่ถูกตัดเมื่อชื่อหมวดยาว) แล้วตามด้วยหมวด
  const shelfLabels = onShelf.map((row) => [t.common.books(row.length), ...categoryLines(row, catName)])
  const anyTwoRows = shelves.some((_, i) => twoRows(i))
  // จำนวนเล่มแถวหน้าที่ล้นความกว้างของชั้นสองแถว (ย้ายไปแถวหลังได้)
  // และในจำนวนนั้น กี่เล่มที่แถวหลังยังรับได้ (กติกาเดียวกับปุ่มย้าย) — 0 = แถวหลังเต็มแล้ว เล่มที่เหลือวางไม่พอทั้งสองแถว
  let overflow = 0
  let movable = 0
  onShelf.forEach((row, i) => {
    const width = shelfWidth(shelves[i], bookcase)
    if (!twoRows(i) || width === null) return
    let front = 0
    let back = row.filter((b) => rowOf(b) === 1).reduce((n, b) => n + footprint(b), 0)
    for (const b of row) {
      if (rowOf(b) === 1) continue
      const size = footprint(b)
      if (front + size <= width) front += size
      else {
        overflow++
        if (back + size <= width) {
          back += size
          movable++
        }
      }
    }
  })
  const backCount = onShelf.reduce((n, row, i) => n + (twoRows(i) ? row.filter((b) => rowOf(b) === 1).length : 0), 0)
  const drawers = places.filter((p) => p.kind === 'drawer' && p.bookcaseId === id)
  const inPlace = (pid: string) =>
    books.filter((b) => b.placeId === pid && !b.takenAt).sort((a, b) => a.position - b.position)
  const as3D = (b: (typeof books)[number]) => ({ id: b.id, title: b.title, pages: b.pages, spineColor: b.spineColor })
  const pick = selected?.kind === 'book' ? books.find((b) => b.id === selected.id && !b.takenAt) : undefined
  const pickShelf = pick && shelves.find((s) => s.id === pick.placeId)
  const drawer = selected?.kind === 'drawer' ? drawers.find((d) => d.id === selected.id) : undefined
  const drawerBooks = drawer ? inPlace(drawer.id) : []
  // แตะป้ายหรือที่ว่างของชั้น: แสดงรายการหนังสือของชั้นนั้นเหมือนลิ้นชัก (แถวหน้าก่อน แล้วแถวหลัง)
  const shelfPick = selected?.kind === 'shelf' ? shelves.find((x) => x.id === selected.id) : undefined
  const shelfBooks = shelfPick ? [...inPlace(shelfPick.id)].sort((a, b) => rowOf(a) - rowOf(b) || a.position - b.position) : []
  // แตะหนังสือ: แสดงรายการของชั้น (หรือลิ้นชัก) ที่เล่มนั้นอยู่ด้วย เล่มที่แตะถูกเน้นไว้
  const pickPlace = pick ? [...shelves, ...drawers].find((x) => x.id === pick.placeId) : undefined
  const panel = drawer ?? shelfPick ?? pickPlace
  const panelIsDrawer = panel?.kind === 'drawer'
  const panelBooks = !panel ? [] : panel === drawer ? drawerBooks : panel === shelfPick ? shelfBooks : [...inPlace(panel.id)].sort((a, b) => rowOf(a) - rowOf(b) || a.position - b.position)
  const panelTwoRows = Boolean(panel && !panelIsDrawer && rowsOf(panel) === 2)

  /** สลับแถวที่ดู: เล่มที่เลือกค้างไว้อาจกลายเป็นเล่มที่จางอยู่ ล้างการเลือก */
  const switchRow = (back: boolean) => {
    setBackView(back)
    setSelected(null)
  }

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
          {/* ขนาดชั้นที่ตั้งไว้ แตะ "แก้ไขตู้" ด้านล่างเพื่อเปลี่ยน */}
          <p className="muted">{t.shelf.caseSummary(bookcase.shelfWidth ?? null, allTwoRows(id, places), someTwoRows(id, places))}</p>
        </div>
      </div>
      <div className={`view3d-wrap${full ? ' full' : ''}`}>
        <button className="btn small view3d-full" aria-pressed={full} onClick={() => setFull((f) => !f)}>
          {full ? t.view.exitFull : t.view.full}
        </button>
        {/* ตู้ที่วางซ้อนสองแถว: สลับดูแถวหน้า/แถวหลังได้จากมุมบนของภาพ */}
        {anyTwoRows && (
          <div className={`chips small view3d-rows${(look.doors ?? 0) === 1 ? ' left' : ''}`} role="group" aria-label={t.view.rowsLabel}>
            <button className={backView && backCount > 0 ? '' : 'on'} aria-pressed={!(backView && backCount > 0)} onClick={() => switchRow(false)}>
              {t.view.frontRow}
            </button>
            <button className={backView && backCount > 0 ? 'on' : ''} aria-pressed={backView && backCount > 0} disabled={backCount === 0} onClick={() => switchRow(true)}>
              {t.view.backRowN(backCount)}
            </button>
          </div>
        )}
        <Suspense fallback={null}>
          <Storage3D
            model={{
              shelves: onShelf.map((row, i) => row.filter((b) => !twoRows(i) || rowOf(b) === 0).map(as3D)),
              back: onShelf.map((row, i) => (twoRows(i) ? row.filter((b) => rowOf(b) === 1).map(as3D) : [])),
              labels: shelfLabels,
              backView: backView && anyTwoRows && backCount > 0,
              twoRows: shelves.map((_, i) => twoRows(i)),
              shelfIds: shelves.map((x) => x.id),
              widths: shelves.map((x) => shelfWidth(x, bookcase)),
              fit: Boolean(bookcase.fitsAll),
              shelfWidth: bookcase.shelfWidth ?? null,
              drawers: drawers.map((d) => ({ id: d.id, books: inPlace(d.id).map(as3D) })),
              look,
              doorsOpen,
            }}
            label={t.view.label3d(bookcase.name, shelves.length, drawers.length, onShelf.flat().length)}
            selected={pick || drawer || shelfPick ? selected : null}
            onSelect={setSelected}
          />
        </Suspense>
      </div>
      <p className="muted center">{backView && anyTwoRows && backCount ? t.view.backHint : t.view.hint}</p>
      {/* แถวหน้าล้นความกว้างชั้น (เล่มที่ล้นไม่ถูกวาด): ชวนย้ายเล่มที่ล้นไปแถวหลังในครั้งเดียว */}
      {overflow > 0 && bookcase.fitsAll && (
        <p className="muted center">
          {t.view.fitsOn}{' '}
          <button className="link-btn" onClick={() => repo.setFitsAll(id, false)}>
            {t.view.fitsUndo}
          </button>
        </p>
      )}
      {overflow > 0 && !bookcase.fitsAll && (
        <p className="notice center">
          {movable > 0 ? t.view.overflow(overflow) : t.view.overflowFull(overflow)}{' '}
          {movable > 0 && (
          <button
            className="btn small primary"
            onClick={async () => {
              const n = await repo.spillToBack(id)
              setSpillMsg(t.view.spilled(n))
              // ข้อความผลลัพธ์อยู่ชั่วครู่ ไม่ค้างหลังสถานการณ์เปลี่ยน
              setTimeout(() => setSpillMsg(''), 8000)
              if (n) switchRow(true)
            }}
          >
            {t.view.spillN(movable)}
          </button>
          )}{' '}
          {/* ของจริงวางได้ครบ: ให้ผู้ใช้ยืนยัน แอปจะวาดครบทุกเล่มและเลิกเตือน */}
          <button className="btn small" onClick={() => repo.setFitsAll(id, true)}>
            {t.view.fits}
          </button>
        </p>
      )}
      {spillMsg && (
        <p className="ok center" role="status">
          {spillMsg}
        </p>
      )}
      {anyTwoRows && backCount === 0 && overflow === 0 && <p className="muted center">{t.view.backEmpty}</p>}
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
          {t.shelf.editCase}
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
          fields={[...bookcaseFields, ...bookcaseSizeFields]}
          initial={bookcaseInitial(bookcase, places)}
          onCancel={() => setRenaming(false)}
          onSubmit={async (v) => {
            if (await saveBookcase(bookcase, places, v)) setRenaming(false)
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

      <div className={`picked-stack${full ? ' floating' : ''}`} ref={stackRef}>
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
            <button className="btn" aria-label={t.view.closeCard} onClick={() => setSelected(null)}>
              ✕
            </button>
          </div>
        </div>
      )}

      {panel && (
        <div className="card picked">
          <div className="section-head">
            <h3>
              {panel.name} <span className="count">· {t.common.books(panelBooks.length)}</span>
            </h3>
            <span className="actions">
              <Link className="btn small" to={`/place/${panel.id}`}>
                {panelIsDrawer ? t.view.openDrawer : t.view.openShelf}
              </Link>
              <button className="btn small" aria-label={t.view.closeCard} onClick={() => setSelected(null)}>
                ✕
              </button>
            </span>
          </div>
          {panelBooks.length === 0 ? (
            <p className="muted">{panelIsDrawer ? t.view.drawerEmpty : t.view.shelfEmpty}</p>
          ) : (
            <ul className="list">
              {panelBooks.map((b) => (
                <BookRow
                  key={b.id}
                  book={b}
                  highlight={b.id === pick?.id}
                  sub={panelTwoRows ? (rowOf(b) === 1 ? t.shelf.back : t.shelf.front) : undefined}
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
            <Link className="btn primary" to={`/add?place=${panel.id}`}>
              {panelIsDrawer ? t.view.addToDrawer : t.view.addToShelf}
            </Link>
          </div>
        </div>
      )}

      </div>

      <section>
        <h2>{t.view.parts}</h2>
        <ul className="list">
          {/* ชั้นบนสุดก่อนเหมือนมองตู้จริง แล้วตามด้วยลิ้นชัก */}
          {[...[...shelves].reverse(), ...drawers].map((p) => {
            // สรุปสั้น ๆ ของแต่ละชั้น: จำนวนเล่ม หมวดหลัก และการใช้ที่ (รายชื่อเล่มดูได้โดยแตะแถวนี้)
            const list = inPlace(p.id)
            const behind = p.kind === 'shelf' && rowsOf(p) === 2 ? list.filter((x) => rowOf(x) === 1).length : 0
            const u = p.kind === 'shelf' ? usage(p, bookcase, list) : null
            const used = u ? Math.round(u.used.reduce((n, x) => n + x, 0)) : 0
            const sub = [
              t.common.books(list.length),
              behind ? t.view.rowsSplit(list.length - behind, behind) : '',
              categoryLines(list, catName).join(' · '),
              u && u.capacity !== null && list.length ? t.shelf.fill(used, Math.round(u.capacity)) : '',
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li className="row" key={p.id}>
                <button
                  className="row-main row-button"
                  onClick={() => {
                    setSelected({ kind: p.kind === 'drawer' ? 'drawer' : 'shelf', id: p.id })
                    setTimeout(() => stackRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50)
                  }}
                >
                  <span className="row-title">{p.name}</span>
                  <span className="row-sub">{sub}</span>
                </button>
                <Link className="btn small" to={`/add?place=${p.id}`}>
                  {t.view.addBooks}
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h2>{t.view.photo}</h2>
        <StoragePhoto id={id} />
      </section>
    </>
  )
}
