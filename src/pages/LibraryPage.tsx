import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { ReadingStatus } from '../db/types'
import { BookRow } from '../components/BookRow'
import { CoverThumb } from '../components/Cover'
import { placeGroups, placeLabel } from '../placeLabel'
import { loadSettings } from '../lib/settings'
import { aiOn } from '../lib/ai'
import { guessVolumes } from '../lib/series'
import { BulkInfo } from '../components/BulkInfo'
import { t } from '../th'
import { duplicateGroups, loadIgnored } from '../lib/duplicates'

const NO_PLACE = '__none__'
const IN_HAND = '__hand__'
const NO_CATEGORY = '__none__'
/** ตัวกรองคะแนน: ดาว (ชอบ) และมะเขือ (ไม่ชอบ) */
const RATING_FILTERS: Record<string, (r: number) => boolean> = {
  star: (r) => r > 0,
  star4: (r) => r >= 4,
  star5: (r) => r === 5,
  egg: (r) => r < 0,
  egg3: (r) => r <= -3,
  none: (r) => r === 0,
}
const VIEW_KEY = 'gong-dong.libraryView'
const FILTER_KEY = 'gong-dong.libraryFilter'
const STATUSES = ['dong', 'reading', 'done', 'dropped']
/** ตัวกรองที่จำไว้ (เฉพาะค่าที่รูปแบบถูกต้อง) */
function saved(): {
  query?: string
  status?: ReadingStatus
  placeId?: string
  rating?: string
} {
  try {
    const o = JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? '{}') as Record<string, unknown>
    return {
      query: typeof o.query === 'string' ? o.query : undefined,
      status: STATUSES.includes(o.status as string) ? (o.status as ReadingStatus) : undefined,
      placeId: typeof o.placeId === 'string' ? o.placeId : undefined,
      rating: typeof o.rating === 'string' && o.rating in RATING_FILTERS ? o.rating : undefined,
    }
  } catch {
    return {}
  }
}
const PAGE = 100
const NEW_CATEGORY = '__new__'
const NO_SERIES = '__noseries__'
const NEW_SERIES = '__newseries__'
const HINT_KEY = 'gong-dong.backupHintHidden'

export function LibraryPage() {
  const books = useLiveQuery(() => repo.listBooks(), [])
  const placesRaw = useLiveQuery(() => repo.listPlaces(), [])
  const places = placesRaw ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []
  const categories = useLiveQuery(() => repo.listCategories(), []) ?? []
  const seriesList = useLiveQuery(() => repo.listSeries(), []) ?? []
  // ตัวกรองหมวดอยู่ใน URL (?cat=) เพื่อให้ลิงก์จากหน้าหมวดเปิดคลังที่กรองแล้วได้
  const [params, setParams] = useSearchParams()
  const categoryId = params.get('cat') ?? ''
  const setCategoryId = (v: string) => setParams(v ? { cat: v } : {}, { replace: true })

  // ตัวกรองจำไว้ตลอดการเปิดแอปครั้งนี้ เปิดดูหนังสือแล้วย้อนกลับมา รายการยังกรองเหมือนเดิม
  const [query, setQuery] = useState(() => saved().query ?? '')
  // ค้นหาตามค่าที่ตามหลังการพิมพ์ ช่องพิมพ์จะไม่หน่วงเมื่อคลังใหญ่
  const deferredQuery = useDeferredValue(query)
  /** แสดงทีละหน้า คลังหลายพันเล่มไม่ต้องวาดทุกแถวพร้อมกัน */
  const [limit, setLimit] = useState(PAGE)
  const [status, setStatus] = useState<ReadingStatus | ''>(() => saved().status ?? '')
  const [placeId, setPlaceId] = useState(() => saved().placeId ?? '')
  const [rating, setRating] = useState(() => saved().rating ?? '')
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify({ query, status, placeId, rating }))
    } catch {
      // จำไม่ได้ก็ใช้ได้ตามปกติ
    }
  }, [query, status, placeId, rating])
  // ที่เก็บที่จำไว้ถูกลบไปแล้ว: กลับเป็นทุกที่เก็บ
  const placeKnown =
    !placeId ||
    placeId === IN_HAND ||
    placeId === NO_PLACE ||
    placesRaw === undefined ||
    places.some((x) => x.id === placeId)
  useEffect(() => {
    if (!placeKnown) setPlaceId('')
  }, [placeKnown])
  // หมวดใน URL ถูกลบหรือรวมไปแล้ว: กลับเป็นทุกหมวด ไม่ค้างเป็นรายการว่าง
  const catKnown =
    categoryId === '' ||
    categoryId === NO_CATEGORY ||
    categories.length === 0 ||
    categories.some((c) => c.id === categoryId)
  useEffect(() => {
    if (!catKnown) setParams({}, { replace: true })
  }, [catKnown, setParams])
  // ---------- เลือกหลายเล่มเพื่อย้ายที่เก็บ ----------
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  /** จะทำอะไรกับเล่มที่เลือก: ย้ายที่เก็บ ตั้งหมวด หรือเปลี่ยนสถานะ */
  const [bulk, setBulk] = useState<'move' | 'category' | 'status' | 'series' | 'info'>('move')
  /** ปลายทางที่เลือก ('' = ยังไม่ได้เลือก ปุ่มใช้จะกดไม่ได้) */
  const [target, setTarget] = useState('')
  // รูปแบบรายการ: ย่อ (ค่าเริ่มต้น) หรือละเอียด (มีรายละเอียดสำคัญและคำโปรย) จำไว้ในเครื่อง
  const [view, setViewState] = useState<'compact' | 'detail'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'detail' ? 'detail' : 'compact'
    } catch {
      return 'compact'
    }
  })
  const setView = (v: 'compact' | 'detail') => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // จำไม่ได้ก็ใช้ได้ตามปกติ
    }
  }
  const [applying, setApplying] = useState(false)
  /** กำลังหาข้อมูลหลายเล่มอยู่: ล็อกการเลือกและปุ่มอื่นจนกว่าจะเสร็จหรือกดหยุด */
  const [infoRunning, setInfoRunning] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const selectBtn = useRef<HTMLButtonElement>(null)
  const msgRef = useRef<HTMLParagraphElement>(null)
  const [moveMsg, setMoveMsg] = useState('')
  // เปิดโหมดเลือก: โฟกัสไปที่แถบคำสั่ง / มีผลลัพธ์: เลื่อนให้เห็นข้อความ (ผู้ใช้อาจเลื่อนลงมาไกล)
  useEffect(() => {
    if (selecting) barRef.current?.focus({ preventScroll: true })
  }, [selecting])
  useEffect(() => {
    if (moveMsg) msgRef.current?.scrollIntoView({ block: 'center' })
  }, [moveMsg])
  // ระหว่างหาข้อมูลหลายเล่ม แตะแถวแล้วไม่เปลี่ยนการเลือก (แถวยังเป็นช่องติ๊ก ไม่กลายเป็นลิงก์ที่พาออกจากหน้า)
  const lockPicks = useRef(false)
  lockPicks.current = infoRunning
  const togglePick = useCallback(
    (id: string) =>
      setPicked((cur) => {
        if (lockPicks.current) return cur
        const next = new Set(cur)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    [],
  )
  const [hintHidden, setHintHidden] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === '1'
    } catch {
      return false
    }
  })

  const labels = useMemo(() => new Map(places.map((p) => [p.id, placeLabel(p, bookcases)])), [places, bookcases])

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  const shown = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return (books ?? [])
      .filter((b) => (!categoryId ? true : categoryId === NO_CATEGORY ? !b.categoryId : b.categoryId === categoryId))
      .filter((b) => !status || b.status === status)
      .filter((b) => RATING_FILTERS[rating]?.(b.rating ?? 0) ?? true)
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
  }, [books, deferredQuery, status, placeId, categoryId, catName, rating])

  // เปลี่ยนเงื่อนไขค้นหาแล้วเริ่มแสดงหน้าแรกใหม่
  useEffect(() => setLimit(PAGE), [deferredQuery, status, placeId, categoryId, rating])

  if (!books) return <p className="empty">{t.common.loading}</p>
  // มีหนังสือแล้วแต่ยังไม่ได้เชื่อม Google: ข้อมูลอยู่ในเครื่องนี้ที่เดียว ชวนให้เข้าสู่ระบบ
  const showBackupHint = !hintHidden && books.length > 0 && !loadSettings().googleAccount
  const dong = books.filter((b) => b.status === 'dong').length
  const dupCount = duplicateGroups(books, loadIgnored()).length
  // นับเฉพาะเล่มที่เลือกไว้และยังอยู่ในรายการที่กรองอยู่ (เปลี่ยนตัวกรองแล้วเล่มที่มองไม่เห็นจะไม่ถูกย้าย)
  const pickedShown = selecting ? shown.filter((b) => picked.has(b.id)) : []
  const closeSelect = () => {
    setSelecting(false)
    setPicked(new Set())
    setTarget('')
    setTimeout(() => selectBtn.current?.focus(), 0)
  }
  async function applyBulk() {
    if (bulk === 'info') return
    const ids = pickedShown.map((b) => b.id)
    const n = ids.length
    const name =
      bulk === 'move'
        ? target === NO_PLACE
          ? t.library.noPlace
          : (labels.get(target) ?? '')
        : bulk === 'category'
          ? target === NO_CATEGORY
            ? t.categories.none
            : (catName.get(target) ?? '')
          : bulk === 'series'
            ? target === NO_SERIES
              ? ''
              : (seriesList.find((x) => x.id === target)?.name ?? '')
            : t.status[target as ReadingStatus]
    // ทำกับหลายเล่มพร้อมกันและย้อนกลับไม่ได้ ถามก่อนเสมอ
    if (!confirm(t.library.confirmBulk[bulk](n, name))) return
    setApplying(true)
    try {
      if (bulk === 'move') {
        // ย้ายตามลำดับที่เห็นในรายการ เล่มที่อยู่ในมือถูกข้าม
        const inHand = pickedShown.filter((b) => b.takenAt).length
        const moved = await repo.moveBooks(ids, target === NO_PLACE ? null : target)
        setMoveMsg(target === NO_PLACE ? t.library.unplaced(moved, inHand) : t.library.moved(moved, name, inHand))
      } else if (bulk === 'category') {
        setMoveMsg(t.library.categorized(await repo.setCategoryMany(ids, target === NO_CATEGORY ? null : target), name))
      } else if (bulk === 'series') {
        if (target === NO_SERIES) setMoveMsg(t.library.seriesCleared(await repo.setSeriesMany(ids, null)))
        else {
          // เดาเลขเล่มจากชื่อเรื่อง (เช่น "ไซอิ๋ว 1", "… เล่ม 2") เล่มที่เดาไม่ได้ใส่เองได้ในหน้าชุดหนังสือ
          const changed = await repo.setSeriesMany(ids, target, guessVolumes(pickedShown.map((b) => b.title)))
          setMoveMsg(t.library.seriesSet(changed, name))
        }
      } else {
        setMoveMsg(t.library.statusSet(await repo.setStatusMany(ids, target as ReadingStatus), name))
      }
      closeSelect()
    } finally {
      setApplying(false)
    }
  }
  const filtering = Boolean(deferredQuery.trim() || status || placeId || categoryId || rating)

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

      {showBackupHint && (
        <p className="notice backup-hint">
          <span>{t.sync.libraryHint}</span>
          <Link to="/settings" className="link">
            {t.sync.signIn}
          </Link>
          <button
            className="link-btn"
            onClick={() => {
              try {
                localStorage.setItem(HINT_KEY, '1')
              } catch {
                // เก็บไม่ได้ก็แค่ซ่อนรอบนี้
              }
              setHintHidden(true)
            }}
          >
            {t.common.later}
          </button>
        </p>
      )}

      <nav className="tools" aria-label={t.tools.label}>
        {dong > 0 && <Link to="/random">{t.tools.random}</Link>}
        <Link to="/check">{t.tools.check}</Link>
        <Link to="/wishlist">{t.tools.wishlist}</Link>
        <Link to="/series">{t.tools.series}</Link>
        <Link to="/quotes">{t.tools.quotes}</Link>
        {dupCount > 0 && <Link to="/duplicates">{t.tools.duplicates(dupCount)}</Link>}
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
                    {b.currentPage ? <span className="row-sub">{t.library.page(b.currentPage, b.pages)}</span> : null}
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
        <select aria-label={t.rating.filter} value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="">{t.rating.all}</option>
          {Object.keys(RATING_FILTERS).map((k) => (
            <option key={k} value={k}>
              {t.rating.filters[k as keyof typeof t.rating.filters]}
            </option>
          ))}
        </select>
      </div>

      {/* กรองหรือค้นอยู่: บอกจำนวนเล่มที่ตรง และล้างตัวกรองได้ในปุ่มเดียว */}
      {(filtering || books.length > 0) && (
        <p className="muted result-count">
          <span role="status">{filtering ? t.library.found(shown.length, books.length) : ''}</span>
          <span className="actions">
            {filtering && (
              <button
                className="link-btn"
                onClick={() => {
                  setQuery('')
                  setStatus('')
                  setPlaceId('')
                  setRating('')
                  setCategoryId('')
                }}
              >
                {t.library.clearFilters}
              </button>
            )}
            {shown.length > 0 && (
              <span className="chips small view-chips" role="group" aria-label={t.library.viewLabel}>
                {(['compact', 'detail'] as const).map((v) => (
                  <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>
                    {t.library.views[v]}
                  </button>
                ))}
              </span>
            )}
            {shown.length > 0 && !selecting && (
              <button
                ref={selectBtn}
                className="btn small"
                onClick={() => {
                  setSelecting(true)
                  setMoveMsg('')
                }}
              >
                {t.library.select}
              </button>
            )}
          </span>
        </p>
      )}
      {moveMsg && (
        <p className="ok" role="status" ref={msgRef}>
          {moveMsg}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="empty">{books.length === 0 ? t.library.empty : t.library.noMatch}</p>
      ) : (
        <ul className="list">
          {shown.slice(0, limit).map((b) => (
            <BookRow
              key={b.id}
              book={b}
              detail={view === 'detail'}
              selected={selecting ? picked.has(b.id) : undefined}
              onSelect={selecting ? togglePick : undefined}
              place={b.takenAt ? t.library.inHand : b.placeId ? labels.get(b.placeId) : t.library.noPlace}
              sub={(b.categoryId && catName.get(b.categoryId)) || undefined}
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

      {/* แถบคำสั่งของโหมดเลือกหลายเล่ม ลอยอยู่เหนือเมนูล่าง */}
      {selecting && (
        <div className="select-bar" role="region" aria-label={t.library.select} tabIndex={-1} ref={barRef}>
          <div className="select-row">
            <strong>{t.library.pickedN(pickedShown.length)}</strong>
            <span className="actions">
              <button className="link-btn" disabled={infoRunning} onClick={() => setPicked(new Set(shown.map((b) => b.id)))}>
                {t.library.pickAll(shown.length)}
              </button>
              <button className="link-btn" disabled={picked.size === 0 || infoRunning} onClick={() => setPicked(new Set())}>
                {t.library.pickNone}
              </button>
              <button className="link-btn" aria-label={t.common.cancel} disabled={infoRunning} onClick={closeSelect}>
                ✕
              </button>
            </span>
          </div>
          <div className="chips small" role="group" aria-label={t.library.bulkLabel}>
            {(aiOn()
              ? (['move', 'category', 'status', 'series', 'info'] as const)
              : (['move', 'category', 'status', 'series'] as const)
            ).map((k) => (
              <button
                key={k}
                className={bulk === k ? 'on' : ''}
                aria-pressed={bulk === k}
                disabled={infoRunning}
                onClick={() => {
                  setBulk(k)
                  setTarget('')
                }}
              >
                {t.library.bulk[k]}
              </button>
            ))}
          </div>
          {bulk === 'info' ? (
            <BulkInfo
              books={pickedShown}
              onRunning={setInfoRunning}
              onDone={(message) => {
                setMoveMsg(message)
                closeSelect()
              }}
            />
          ) : (
            <div className="select-apply">
              {/* ต้องเลือกปลายทางเองก่อนเสมอ (ไม่มีค่าเริ่มต้น) กันกดพลาดแล้วหนังสือทั้งกลุ่มหลุดจากที่เก็บหรือหมวด */}
              <select
                aria-label={t.library.bulkTarget[bulk]}
                value={target}
                onChange={async (e) => {
                  if (e.target.value === NEW_SERIES) {
                  const name = prompt(t.library.newSeries)?.trim()
                  if (name) setTarget(await repo.ensureSeries(name))
                  return
                }
                if (e.target.value !== NEW_CATEGORY) return setTarget(e.target.value)
                  const name = prompt(t.categories.newName)?.trim()
                  if (name) setTarget(await repo.ensureCategory(name))
                }}
              >
                <option value="">{t.library.bulkTarget[bulk]}…</option>
                {bulk === 'move' && (
                  <>
                    <option value={NO_PLACE}>{t.library.unplace}</option>
                    {placeGroups(places, bookcases).map((g) => (
                      <optgroup key={g.title} label={g.title}>
                        {g.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </>
                )}
                {bulk === 'category' && (
                  <>
                    <option value={NO_CATEGORY}>{t.categories.none}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    <option value={NEW_CATEGORY}>{t.categories.addNew}</option>
                  </>
                )}
                {bulk === 'series' && (
                  <>
                    {seriesList.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                    <option value={NEW_SERIES}>{t.library.addSeries}</option>
                    <option value={NO_SERIES}>{t.library.noSeries}</option>
                  </>
                )}
                {bulk === 'status' &&
                  Object.entries(t.status).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
              <button
                className="btn primary"
                disabled={pickedShown.length === 0 || !target || applying}
                onClick={applyBulk}
              >
                {t.library.applyN(pickedShown.length)}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
