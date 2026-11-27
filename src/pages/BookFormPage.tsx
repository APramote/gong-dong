import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { emptyBook, repo, type BookInput } from '../db/repo'
import type { ReadingStatus } from '../db/types'
import { useBlobUrl } from '../components/Cover'
import { PlaceSelect } from '../components/PlaceSelect'
import { resizeImage } from '../lib/image'
import { lookupIsbn, normalizeIsbn } from '../lib/isbn'
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
  // undefined = ยังไม่แตะรูปปก, null = ลบรูป, Blob = รูปใหม่
  const [newCover, setNewCover] = useState<Blob | null | undefined>(undefined)
  const [savedCover, setSavedCover] = useState<Blob | null>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const coverUrl = useBlobUrl(newCover === undefined ? savedCover : newCover)

  useEffect(() => {
    if (!id) return
    let stale = false
    Promise.all([repo.getBook(id), repo.getCover(id)]).then(([b, cover]) => {
      if (stale) return
      if (!b) return setState('missing')
      const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, position: _p, ...input } = b
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
    navigate(-1)
  }

  async function remove() {
    if (!id || !confirm(t.book.confirmDelete(form.title))) return
    await repo.deleteBook(id)
    navigate(-1)
  }

  async function fillFromIsbn() {
    const isbn = normalizeIsbn(form.isbn)
    if (!isbn) return setIsbnMsg(t.book.isbnInvalid)
    setLooking(true)
    setIsbnMsg('')
    const hit = await lookupIsbn(isbn)
    setLooking(false)
    if (!hit) return setIsbnMsg(t.book.isbnNotFound)
    // เติมเฉพาะช่องที่ยังว่าง ไม่ทับสิ่งที่ผู้ใช้พิมพ์ไว้
    setForm((f) => {
      const next = { ...f, isbn }
      for (const [k, v] of Object.entries(hit) as [keyof BookInput, never][]) {
        if (v !== null && v !== '' && (f[k] === '' || f[k] === null)) next[k] = v
      }
      return next
    })
    setIsbnMsg(t.book.isbnFilled)
  }

  const text = (key: 'title' | 'authors' | 'publisher' | 'year' | 'category') => (
    <label>
      {t.book[key]}
      <input value={form[key]} onChange={(e) => set(key, e.target.value)} />
    </label>
  )

  return (
    <form className="form" onSubmit={submit}>
      <h1>{id ? t.book.editTitle : t.book.newTitle}</h1>

      <div className="cover-edit">
        {coverUrl ? <img className="cover" src={coverUrl} alt={t.book.cover} /> : <span className="cover" />}
        <div className="actions">
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
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

      <PlaceSelect label={t.book.place} value={form.placeId} onChange={(v) => set('placeId', v)} />

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

      <label>
        {t.book.synopsis}
        <textarea rows={4} value={form.synopsis} onChange={(e) => set('synopsis', e.target.value)} />
      </label>
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
  )
}
