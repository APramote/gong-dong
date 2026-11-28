import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { emptyBook, repo, type BookInput } from '../db/repo'
import type { ReadingStatus } from '../db/types'
import { useBlobUrl } from '../components/Cover'
import { PlaceSelect } from '../components/PlaceSelect'
import { CategorySelect } from '../components/CategorySelect'
import { SeriesSelect } from '../components/SeriesSelect'
import { QuoteSection } from '../components/QuoteSection'
import { AiBadge } from '../components/AiBadge'
import { makeCover } from '../lib/aiCover'
import type { AiField } from '../db/types'
import { Rating } from '../components/Rating'
import { ReturnForm } from '../components/ReturnForm'
import { CheckInForm } from '../components/CheckInForm'
import { timerTotal } from '../lib/stats'
import { SessionList } from '../components/SessionList'
import { useLiveQuery } from 'dexie-react-hooks'
import { timeAgo } from '../lib/stats'
import { placeLabel } from '../placeLabel'
import { resizeImage } from '../lib/image'
import { lookupIsbnStatus, normalizeIsbn } from '../lib/isbn'
import { aiOn, aiReady, enrich } from '../lib/ai'
import { aiErrorText } from '../lib/aiError'
import { MAX_VOLUMES } from '../lib/series'
import { Ring } from '../components/Ring'
import { t } from '../th'

const toNumber = (v: string) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const toPrice = (v: string) => {
  const n = parseFloat(v.replace(/[,฿\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

interface Prefill {
  prefill?: Partial<BookInput> & { category?: string }
  isbnFound?: boolean | 'offline'
}

export function BookFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { prefill, isbnFound } = (location.state ?? {}) as Prefill

  const { category: prefillCategory, ...prefillFields } = prefill ?? {}
  const [form, setForm] = useState<BookInput>({
    ...emptyBook,
    placeId: params.get('place'),
    ...prefillFields,
  })
  /** ชื่อหมวดที่แหล่งข้อมูลแนะนำ ผู้ใช้กดใช้เองถ้าเห็นด้วย */
  const [catSuggestion, setCatSuggestion] = useState(prefillCategory ?? '')
  const [tagsText, setTagsText] = useState('')
  /** ชื่อเรื่องและผู้แต่งที่อยู่ในรูปปกจำลอง (ถ้ามี) ใช้ดูว่าต้องวาดใหม่ตอนบันทึกหรือไม่ */
  const aiCoverText = useRef('')
  // ช่องราคาเก็บข้อความที่พิมพ์ไว้ (เช่น "250." ระหว่างพิมพ์) แยกจากตัวเลขในฟอร์ม
  const [priceText, setPriceText] = useState('')
  const [collectorOpen, setCollectorOpen] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>(id ? 'loading' : 'ready')
  const [error, setError] = useState('')
  const [isbnMsg, setIsbnMsg] = useState(
    isbnFound === undefined ? '' : isbnFound === 'offline' ? t.book.isbnOffline : isbnFound ? t.book.isbnFilled : t.book.isbnNotFound,
  )
  const [looking, setLooking] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // undefined = ยังไม่แตะรูปปก, null = ลบรูป, Blob = รูปใหม่
  const [newCover, setNewCover] = useState<Blob | null | undefined>(undefined)
  const [savedCover, setSavedCover] = useState<Blob | null>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  // สถานะสดจากฐานข้อมูล (อยู่ในมือหรือไม่ ประวัติการอ่าน) แยกจากค่าในฟอร์ม
  const live = useLiveQuery(async () => (id ? ((await repo.getBook(id)) ?? null) : null), [id])
  const sessions = useLiveQuery(() => (id ? repo.sessionsFor(id) : []), [id]) ?? []
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []
  const [returning, setReturning] = useState(false)
  const [checkingIn, setCheckingIn] = useState(false)
  const zoomRef = useRef<HTMLDialogElement>(null)
  const coverUrl = useBlobUrl(newCover === undefined ? savedCover : newCover)
  const titleRef = useRef<HTMLInputElement>(null)

  // ---------- เตือนก่อนออกจากหน้าเมื่อยังไม่ได้บันทึก ----------
  /** สภาพของฟอร์มตอนเปิด ใช้เทียบว่ามีการแก้ไขหรือไม่ */
  const [baseline, setBaseline] = useState<string | null>(id ? null : JSON.stringify({ form, tagsText }))
  const dirty =
    baseline !== null && (JSON.stringify({ form, tagsText }) !== baseline || newCover !== undefined)
  /** ออกจากหน้าหลังบันทึกหรือลบแล้ว ไม่ต้องถาม */
  const leaving = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (confirm(t.book.unsavedLeave)) blocker.proceed()
    else blocker.reset()
  }, [blocker])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** กลับหน้าก่อน ถ้าเปิดหน้านี้ตรง ๆ (ไม่มีประวัติ) ไปหน้าที่เหมาะสมแทน ไม่ให้แอปปิด */
  const goBack = (fallback: string) => {
    leaving.current = true
    if (location.key !== 'default') navigate(-1)
    else navigate(fallback, { replace: true })
  }

  useEffect(() => {
    if (!id) return
    let stale = false
    Promise.all([repo.getBook(id), repo.getCover(id)]).then(([b, cover]) => {
      if (stale) return
      if (!b) return setState('missing')
      const {
        id: _i,
        createdAt: _c,
        updatedAt: _u,
        deletedAt: _d,
        position: _p,
        takenAt: _ta,
        takenFrom: _tf,
        finishedAt: _f,
        // คะแนนและแถวบนชั้นบันทึกแยกจากฟอร์ม ไม่ถือค่าเก่าไว้ในฟอร์ม
        rating: _r,
        row: _row,
        ...input
      } = b
      setForm(input)
      setTagsText(b.tags.join(', '))
      setPriceText(b.price === null ? '' : String(b.price))
      setCollectorOpen(Boolean(b.edition || b.condition || b.price !== null || b.boughtAt || b.boughtFrom || b.signed))
      setBaseline(JSON.stringify({ form: input, tagsText: b.tags.join(', ') }))
      setSavedCover(cover ?? null)
      aiCoverText.current = `${b.title}|${b.authors}`
      setState('ready')
    })
    return () => {
      stale = true
    }
  }, [id])

  if (state === 'loading') return <p className="empty">{t.common.loading}</p>
  if (state === 'missing') return <p className="empty">{t.book.notFound}</p>

  /**
   * รับค่าที่ระบบเพิ่งบันทึกเอง (คั่นหน้า วางคืน) เข้ามาในฟอร์ม
   * ปรับจุดเทียบ "ยังไม่ได้บันทึก" ไปด้วย ไม่อย่างนั้นจะถูกถามตอนออกจากหน้าทั้งที่ไม่ได้แก้อะไร
   */
  const adopt = (patch: Partial<BookInput>) => {
    setForm((f) => ({ ...f, ...patch }))
    setBaseline((prev) => {
      if (prev === null) return prev
      const base = JSON.parse(prev) as { form: BookInput; tagsText: string }
      return JSON.stringify({ ...base, form: { ...base.form, ...patch } })
    })
  }
  const set = <K extends keyof BookInput>(key: K, value: BookInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // ป้าย AI ของช่องที่ AI สร้างเอง: ผู้ใช้แก้ช่องนั้นแล้วป้ายหายไป (ถือว่าเป็นของผู้ใช้แล้ว)
  const isAi = (k: AiField) => Boolean(form.aiFields?.includes(k))
  const dropAi = (k: AiField) => setForm((f) => (f.aiFields?.includes(k) ? { ...f, aiFields: f.aiFields.filter((x) => x !== k) } : f))

  /** บันทึกฟอร์ม คืน id ของหนังสือ หรือ null ถ้าข้อมูลไม่ครบ */
  async function save(): Promise<string | null> {
    const title = form.title.trim()
    if (!title) {
      setError(t.book.titleRequired)
      // ปุ่มบันทึกอยู่ล่างสุด ต้องพาไปที่ช่องที่ผิดให้เห็น
      titleRef.current?.focus()
      titleRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return null
    }
    setError('')
    const input: BookInput = {
      ...form,
      title,
      tags: tagsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }
    const bookId = id ?? (await repo.addBook(input))
    if (id) await repo.updateBook(id, input)
    // ปกจำลองมีชื่อเรื่องอยู่ในรูป: แก้ชื่อหรือผู้แต่งแล้ว วาดใหม่ให้ตรง
    let cover = newCover
    const coverText = `${title}|${input.authors}`
    if (input.aiFields?.includes('cover') && cover !== null && coverText !== aiCoverText.current) {
      try {
        cover = await makeCover(title, input.authors, input.spineColor)
        aiCoverText.current = coverText
      } catch {
        // วาดใหม่ไม่ได้ ใช้ปกเดิม
      }
    }
    if (cover !== undefined) await repo.setCover(bookId, cover)
    setForm(input)
    setBaseline(JSON.stringify({ form: input, tagsText }))
    if (cover !== undefined) {
      setSavedCover(cover)
      setNewCover(undefined)
    }
    return bookId
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const bookId = await save()
    if (!bookId) return
    const placeId = form.placeId
    // เล่มใหม่ไปที่ที่เก็บของเล่มนั้น ไม่ย้อนกลับไปหน้าเมนูเพิ่มหนังสือ
    if (id) goBack(placeId ? `/place/${placeId}` : '/')
    else {
      leaving.current = true
      navigate(placeId ? `/place/${placeId}` : '/', { replace: true })
    }
  }

  async function remove() {
    if (!id || !confirm(t.book.confirmDelete(form.title))) return
    await repo.deleteBook(id)
    goBack('/')
  }

  /** เติมเฉพาะช่องที่ยังว่าง ไม่ทับสิ่งที่ผู้ใช้พิมพ์ไว้ คืนจำนวนช่องที่เติม */
  function fillEmpty(values: Partial<BookInput>): number {
    let filled = 0
    const next = { ...form }
    for (const [k, v] of Object.entries(values) as [keyof BookInput, never][]) {
      const cur = next[k] as unknown
      const empty = cur === '' || cur === null || (Array.isArray(cur) && cur.length === 0)
      const has = v !== null && v !== '' && !(Array.isArray(v) && (v as unknown[]).length === 0)
      if (empty && has) {
        next[k] = v
        filled++
      }
    }
    setForm(next)
    return filled
  }

  async function fillFromAi() {
    if (!form.title.trim()) return setError(t.book.titleRequired)
    setAiBusy(true)
    setAiMsg(null)
    try {
      const r = await enrich(form)
      if (!r.found) return setAiMsg({ ok: false, text: t.book.aiNotFound })
      const { found: _f, isbn, category, blurbAi, tags, coverColor: aiColor, ...rest } = r
      if (category && !form.categoryId) setCatSuggestion(category)
      // สิ่งที่ AI สร้างเอง (ไม่ใช่ข้อมูลที่ค้นเจอ): จดไว้เพื่อกำกับป้าย AI
      const made: AiField[] = []
      if (!form.blurb && rest.blurb && blurbAi) made.push('blurb')
      let extra = 0
      if (!tagsText.trim() && tags.length) {
        setTagsText(tags.join(', '))
        made.push('tags')
        extra++
      }
      // ยังไม่มีรูปปก: สร้างปกจำลอง (มีแถบกำกับ AI ในรูป) บันทึกเมื่อกดบันทึกฟอร์ม
      if (!coverUrl) {
        try {
          setNewCover(await makeCover(form.title, form.authors || rest.authors, aiColor))
          aiCoverText.current = `${form.title.trim()}|${form.authors || rest.authors}`
          made.push('cover')
          extra++
        } catch {
          // วาดปกไม่ได้ ข้ามไป
        }
      }
      const n = fillEmpty({ ...rest, isbn: normalizeIsbn(isbn) ?? '', ...(aiColor && { spineColor: aiColor }) }) + extra
      if (made.length) setForm((f) => ({ ...f, aiFields: [...new Set([...(f.aiFields ?? []), ...made])] }))
      setAiMsg({ ok: true, text: n ? t.book.aiFilled(n) + (made.length ? ` ${t.book.aiMade}` : '') : t.book.aiNothingNew })
    } catch (e) {
      setAiMsg({ ok: false, text: aiErrorText(e) })
    } finally {
      setAiBusy(false)
    }
  }

  async function fillFromIsbn() {
    const isbn = normalizeIsbn(form.isbn)
    if (!isbn) return setIsbnMsg(t.book.isbnInvalid)
    setLooking(true)
    setIsbnMsg('')
    const { hit, failed } = await lookupIsbnStatus(isbn)
    setLooking(false)
    if (!hit) return setIsbnMsg(failed ? t.book.isbnOffline : t.book.isbnNotFound)
    const { category, ...fields } = hit
    if (category && !form.categoryId) setCatSuggestion(category)
    fillEmpty({ ...fields, isbn })
    set('isbn', isbn)
    setIsbnMsg(t.book.isbnFilled)
  }

  const text = (key: 'authors' | 'publisher' | 'year') => (
    <label>
      {t.book[key]}
      <input
        value={form[key]}
        inputMode={key === 'year' ? 'numeric' : undefined}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  )

  // ที่เก็บ: เล่มที่มีอยู่แล้วแสดงไว้บนสุดให้เห็นทันที เล่มใหม่อยู่ตามลำดับกรอกเดิม
  const placeField = live?.takenAt ? (
    <label className="place-top">
      {t.book.place}
      <input value={t.library.inHand} disabled />
      <span className="muted">{t.reading.placeLocked}</span>
    </label>
  ) : (
    <div className={id ? 'place-top' : undefined}>
      <PlaceSelect label={t.book.place} value={form.placeId} onChange={(v) => set('placeId', v)} />
    </div>
  )

  return (
    <div className="form">
      <h1>{id ? t.book.editTitle : t.book.newTitle}</h1>
      {id && placeField}
      {live && <Rating book={live} />}
      {live && (
        <div className="hand-bar">
          {live.takenAt ? (
            checkingIn ? (
              <CheckInForm
                book={live}
                timerMinutes={(() => {
                  const open = sessions.find((x) => x.endedAt === null)
                  const ms = open ? timerTotal(open) : 0
                  return ms > 0 ? Math.max(1, Math.round(ms / 60000)) : 0
                })()}
                onDone={() => {
                  setCheckingIn(false)
                  // หน้าที่อ่านและสถานะเปลี่ยนแล้ว ให้ฟอร์มตามทัน
                  repo.getBook(live.id).then((b) => b && adopt({ status: b.status, currentPage: b.currentPage }))
                }}
                onCancel={() => setCheckingIn(false)}
              />
            ) : returning ? (
              <ReturnForm
                book={live}
                placeExists={(pid) => places.some((p) => p.id === pid)}
                onDone={() => {
                  setReturning(false)
                  // ค่าในฟอร์มอาจเก่าแล้ว (หน้าที่อ่าน สถานะ ที่เก็บ)
                  repo.getBook(live.id).then((b) => {
                    if (b) adopt({ placeId: b.placeId, status: b.status, currentPage: b.currentPage })
                  })
                }}
                onCancel={() => setReturning(false)}
              />
            ) : (
              <>
                <span className="muted">{t.reading.inHandBanner(timeAgo(live.takenAt))}</span>
                <button type="button" className="btn primary" onClick={() => setCheckingIn(true)}>
                  {t.reading.checkIn}
                </button>
                <button type="button" className="btn" onClick={() => setReturning(true)}>
                  {t.reading.return}
                </button>
              </>
            )
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                // มีการแก้ไขค้างอยู่ บันทึกก่อนหยิบ ไม่ให้สิ่งที่พิมพ์หาย
                if (dirty && !(await save())) return
                await repo.takeBook(live.id)
                leaving.current = true
                navigate('/reading')
              }}
            >
              {t.reading.take}
            </button>
          )}
        </div>
      )}

    <form className="form" onSubmit={submit}>
      <div className="cover-edit">
        {coverUrl ? (
          <button type="button" className="cover-zoom" aria-label={t.book.zoomCover} title={t.book.zoomCover} onClick={() => zoomRef.current?.showModal()}>
            <img className="cover" src={coverUrl} alt={isAi('cover') ? t.book.coverAi : t.book.cover} />
          </button>
        ) : (
          <span className="cover" />
        )}
        {coverUrl && (
          // แตะตรงไหนก็ปิด (ปุ่ม Esc ปิดได้เองตามมาตรฐานของ dialog)
          <dialog ref={zoomRef} className="cover-big" aria-label={t.book.zoomCover} onClick={() => zoomRef.current?.close()}>
            <img src={coverUrl} alt={isAi('cover') ? t.book.coverAi : t.book.cover} />
            <button type="button" className="btn small">
              {t.book.zoomClose}
            </button>
          </dialog>
        )}
        <div className="cover-side">
      <div className="cols">
        <label>
          {t.book.status}
          <select
            value={form.status}
            onChange={(e) => set('status', e.target.value as ReadingStatus)}
          >
            {Object.entries(t.status).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.book.currentPage}
          <input
            inputMode="numeric"
            value={form.currentPage ?? ''}
            onChange={(e) => set('currentPage', toNumber(e.target.value))}
          />
        </label>
      </div>
        <div className="actions">
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            data-cover
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) {
                setNewCover(await resizeImage(file, 480))
                dropAi('cover')
              }
            }}
          />
          <button type="button" className="btn small" onClick={() => coverInput.current?.click()}>
            {coverUrl ? t.book.changeCover : t.book.takeCover}
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              // ใช้ input เดิมแต่ปิดโหมดกล้องชั่วคราว เพื่อเปิดตัวเลือกรูปของเครื่อง
              const el = coverInput.current
              if (!el) return
              el.removeAttribute('capture')
              el.click()
              el.setAttribute('capture', 'environment')
            }}
          >
            {t.book.pickCover}
          </button>
          {coverUrl && (
            <button
              type="button"
              className="btn small danger"
              onClick={() => {
                setNewCover(null)
                dropAi('cover')
              }}
            >
              {t.book.removeCover}
            </button>
          )}
        </div>
        </div>
      </div>

      <label>
        {t.book.title}
        <input
          ref={titleRef}
          value={form.title}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'title-error' : undefined}
          onChange={(e) => set('title', e.target.value)}
        />
      </label>
      {error && (
        <p className="error" id="title-error" role="alert">
          {error}
        </p>
      )}
      {text('authors')}
      <div className="cols">
        <CategorySelect
          value={form.categoryId}
          onChange={(v) => set('categoryId', v)}
          suggestion={catSuggestion}
        />
        <label>
          <span>
            {t.book.tags}
            {isAi('tags') && <AiBadge />}
          </span>
          <input
            value={tagsText}
            onChange={(e) => {
              setTagsText(e.target.value)
              dropAi('tags')
            }}
          />
        </label>
      </div>
      <div className="cols">
        <SeriesSelect
          value={form.seriesId}
          onChange={(v) => setForm((f) => ({ ...f, seriesId: v, seriesNo: v ? f.seriesNo : null }))}
        />
        {form.seriesId && (
          <label>
            {t.book.seriesNo}
            <input
              inputMode="numeric"
              value={form.seriesNo ?? ''}
              onChange={(e) => set('seriesNo', Math.min(toNumber(e.target.value) ?? 0, MAX_VOLUMES) || null)}
            />
          </label>
        )}
      </div>
      <div className="cols">
        {text('publisher')}
        {text('year')}
      </div>
      <div className="cols">
        <label>
          {t.book.pages}
          <input
            inputMode="numeric"
            value={form.pages ?? ''}
            onChange={(e) => set('pages', toNumber(e.target.value))}
          />
        </label>
        <label>
          {t.book.isbn}
          <input inputMode="numeric" value={form.isbn} onChange={(e) => set('isbn', e.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button type="button" className="btn small" disabled={looking || !form.isbn} onClick={fillFromIsbn}>
          {looking && <Ring size={18} />}
          {looking ? t.book.searching : t.book.lookupIsbn}
        </button>
        {isbnMsg && <span className="muted">{isbnMsg}</span>}
      </div>

      {!id && placeField}

      {aiOn() && (
      <div className="ai-box">
        <div className="actions">
          <button
            type="button"
            className="btn small"
            disabled={aiBusy || !aiReady()}
            onClick={fillFromAi}
          >
            {aiBusy && <Ring size={18} />}
            {aiBusy ? t.book.aiSearching : t.book.aiFill}
          </button>
          {!aiReady() && <span className="muted">{t.add.needKey}</span>}
        </div>
        {aiMsg && <p className={aiMsg.ok ? 'ok' : 'error'}>{aiMsg.text}</p>}
      </div>
      )}
      <label>
        {t.book.synopsis}
        <textarea rows={4} value={form.synopsis} onChange={(e) => set('synopsis', e.target.value)} />
      </label>
      <label>
        <span>
          {t.book.blurb}
          {isAi('blurb') && <AiBadge />}
        </span>
        <textarea
          rows={3}
          value={form.blurb}
          onChange={(e) => {
            set('blurb', e.target.value)
            dropAi('blurb')
          }}
        />
      </label>
      <label>
        {t.book.reviewSummary}
        <textarea
          rows={3}
          value={form.reviewSummary}
          onChange={(e) => set('reviewSummary', e.target.value)}
        />
      </label>
      {form.links.length > 0 && (
        <div className="links">
          <span className="muted">{t.book.links}</span>
          <ul>
            {form.links.map((l) => (
              <li key={l.url}>
                <a className="link" href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.title || l.url}
                </a>
              </li>
            ))}
          </ul>
          <button type="button" className="link-btn" onClick={() => set('links', [])}>
            {t.book.clearLinks}
          </button>
        </div>
      )}
      <label>
        {t.book.note}
        <textarea rows={3} value={form.note} onChange={(e) => set('note', e.target.value)} />
      </label>

      <details className="more" open={collectorOpen}>
        <summary>{t.book.collector}</summary>
        <label>
          {t.book.edition}
          <input placeholder={t.book.editionHint} value={form.edition} onChange={(e) => set('edition', e.target.value)} />
        </label>
        <div className="cols">
          <label>
            {t.book.condition}
            <input list="conditions" value={form.condition} onChange={(e) => set('condition', e.target.value)} />
            <datalist id="conditions">
              {t.book.conditions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label>
            {t.book.price}
            <input
              inputMode="decimal"
              value={priceText}
              onChange={(e) => {
                setPriceText(e.target.value)
                set('price', toPrice(e.target.value))
              }}
            />
          </label>
        </div>
        <div className="cols">
          <label>
            {t.book.boughtAt}
            <input type="date" value={form.boughtAt} onChange={(e) => set('boughtAt', e.target.value)} />
          </label>
          <label>
            {t.book.boughtFrom}
            <input value={form.boughtFrom} onChange={(e) => set('boughtFrom', e.target.value)} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.signed} onChange={(e) => set('signed', e.target.checked)} />
          {t.book.signed}
        </label>
      </details>

      <div className="actions">
        <button type="submit" className="btn primary">
          {t.common.save}
        </button>
        <button type="button" className="btn" onClick={() => goBack(form.placeId ? `/place/${form.placeId}` : '/')}>
          {t.common.cancel}
        </button>
        {id && (
          <button type="button" className="btn danger push" onClick={remove}>
            {t.common.delete}
          </button>
        )}
      </div>
    </form>
      {id && live && <QuoteSection bookId={id} />}
      {id && (
        <section>
          <h2>{t.reading.history}</h2>
          <SessionList
            sessions={sessions}
            placeName={(pid) => {
              const p = pid ? places.find((x) => x.id === pid) : undefined
              return p ? placeLabel(p, bookcases) : t.library.noPlace
            }}
          />
        </section>
      )}
    </div>
  )
}
