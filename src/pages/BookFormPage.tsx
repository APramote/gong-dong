import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { emptyBook, repo, type BookInput } from '../db/repo'
import type { ReadingStatus } from '../db/types'
import { useBlobUrl } from '../components/Cover'
import { PlaceSelect } from '../components/PlaceSelect'
import { ReturnForm } from '../components/ReturnForm'
import { SessionList } from '../components/SessionList'
import { useLiveQuery } from 'dexie-react-hooks'
import { timeAgo } from '../lib/stats'
import { placeLabel } from '../placeLabel'
import { resizeImage } from '../lib/image'
import { lookupIsbn, normalizeIsbn } from '../lib/isbn'
import { aiReady, enrich } from '../lib/ai'
import { aiErrorText } from '../lib/aiError'
import { t } from '../th'

const toNumber = (v: string) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

interface Prefill {
  prefill?: Partial<BookInput>
  isbnFound?: boolean
}

export function BookFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { prefill, isbnFound } = (useLocation().state ?? {}) as Prefill

  const [form, setForm] = useState<BookInput>({
    ...emptyBook,
    placeId: params.get('place'),
    ...prefill,
  })
  const [tagsText, setTagsText] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>(id ? 'loading' : 'ready')
  const [error, setError] = useState('')
  const [isbnMsg, setIsbnMsg] = useState(
    isbnFound === undefined ? '' : isbnFound ? t.book.isbnFilled : t.book.isbnNotFound,
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
  const coverUrl = useBlobUrl(newCover === undefined ? savedCover : newCover)

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
        ...input
      } = b
      setForm(input)
      setTagsText(b.tags.join(', '))
      setSavedCover(cover ?? null)
      setState('ready')
    })
    return () => {
      stale = true
    }
  }, [id])

  if (state === 'loading') return null
  if (state === 'missing') return <p className="empty">{t.book.notFound}</p>

  const set = <K extends keyof BookInput>(key: K, value: BookInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const title = form.title.trim()
    if (!title) return setError(t.book.titleRequired)
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
    if (newCover !== undefined) await repo.setCover(bookId, newCover)
    // เล่มใหม่ไปที่ที่เก็บของเล่มนั้น ไม่ย้อนกลับไปหน้าเมนูเพิ่มหนังสือ
    if (id) navigate(-1)
    else navigate(input.placeId ? `/place/${input.placeId}` : '/', { replace: true })
  }

  async function remove() {
    if (!id || !confirm(t.book.confirmDelete(form.title))) return
    await repo.deleteBook(id)
    navigate(-1)
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
      const { found: _f, isbn, ...rest } = r
      const n = fillEmpty({ ...rest, isbn: normalizeIsbn(isbn) ?? '' })
      setAiMsg({ ok: true, text: n ? t.book.aiFilled(n) : t.book.aiNothingNew })
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
    const hit = await lookupIsbn(isbn)
    setLooking(false)
    if (!hit) return setIsbnMsg(t.book.isbnNotFound)
    fillEmpty({ ...hit, isbn })
    set('isbn', isbn)
    setIsbnMsg(t.book.isbnFilled)
  }

  const text = (key: 'title' | 'authors' | 'publisher' | 'year' | 'category') => (
    <label>
      {t.book[key]}
      <input value={form[key]} onChange={(e) => set(key, e.target.value)} />
    </label>
  )

  return (
    <div className="form">
      <h1>{id ? t.book.editTitle : t.book.newTitle}</h1>
      {live && (
        <div className="hand-bar">
          {live.takenAt ? (
            returning ? (
              <ReturnForm
                book={live}
                session={sessions.find((x) => x.endedAt === null)}
                placeExists={(pid) => places.some((p) => p.id === pid)}
                onDone={() => {
                  setReturning(false)
                  // ค่าในฟอร์มอาจเก่าแล้ว (หน้าที่อ่าน สถานะ ที่เก็บ)
                  repo.getBook(live.id).then((b) => {
                    if (!b) return
                    setForm((f) => ({
                      ...f,
                      placeId: b.placeId,
                      status: b.status,
                      currentPage: b.currentPage,
                    }))
                  })
                }}
                onCancel={() => setReturning(false)}
              />
            ) : (
              <>
                <span className="muted">{t.reading.inHandBanner(timeAgo(live.takenAt))}</span>
                <button type="button" className="btn primary" onClick={() => setReturning(true)}>
                  {t.reading.return}
                </button>
              </>
            )
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                await repo.takeBook(live.id)
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
        {coverUrl ? <img className="cover" src={coverUrl} alt={t.book.cover} /> : <span className="cover" />}
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
              if (file) setNewCover(await resizeImage(file, 480))
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
            <button type="button" className="btn small danger" onClick={() => setNewCover(null)}>
              {t.book.removeCover}
            </button>
          )}
        </div>
      </div>

      {text('title')}
      {error && <p className="error">{error}</p>}
      {text('authors')}
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
          {looking ? t.book.searching : t.book.lookupIsbn}
        </button>
        {isbnMsg && <span className="muted">{isbnMsg}</span>}
      </div>
      <div className="cols">
        {text('category')}
        <label>
          {t.book.tags}
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
        </label>
      </div>

      {live?.takenAt ? (
        <label>
          {t.book.place}
          <input value={t.library.inHand} disabled />
          <span className="muted">{t.reading.placeLocked}</span>
        </label>
      ) : (
        <PlaceSelect label={t.book.place} value={form.placeId} onChange={(v) => set('placeId', v)} />
      )}

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

      <div className="ai-box">
        <div className="actions">
          <button
            type="button"
            className="btn small"
            disabled={aiBusy || !aiReady()}
            onClick={fillFromAi}
          >
            {aiBusy ? t.book.aiSearching : t.book.aiFill}
          </button>
          {!aiReady() && <span className="muted">{t.add.needKey}</span>}
        </div>
        {aiMsg && <p className={aiMsg.ok ? 'ok' : 'error'}>{aiMsg.text}</p>}
      </div>
      <label>
        {t.book.synopsis}
        <textarea rows={4} value={form.synopsis} onChange={(e) => set('synopsis', e.target.value)} />
      </label>
      <label>
        {t.book.blurb}
        <textarea rows={3} value={form.blurb} onChange={(e) => set('blurb', e.target.value)} />
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

      <div className="actions">
        <button type="submit" className="btn primary">
          {t.common.save}
        </button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>
          {t.common.cancel}
        </button>
        {id && (
          <button type="button" className="btn danger push" onClick={remove}>
            {t.common.delete}
          </button>
        )}
      </div>
    </form>
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
