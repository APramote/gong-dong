import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { emptyBook, repo, type BookInput } from '../db/repo'
import type { ReadingStatus } from '../db/types'
import { placeGroups } from '../placeLabel'
import { t } from '../th'

const toNumber = (v: string) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function BookFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []

  const [form, setForm] = useState<BookInput>({ ...emptyBook, placeId: params.get('place') })
  const [tagsText, setTagsText] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>(id ? 'loading' : 'ready')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    let stale = false
    repo.getBook(id).then((b) => {
      if (stale) return
      if (!b) return setState('missing')
      const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, position: _p, ...input } = b
      setForm(input)
      setTagsText(b.tags.join(', '))
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
    if (id) await repo.updateBook(id, input)
    else await repo.addBook(input)
    navigate(-1)
  }

  async function remove() {
    if (!id || !confirm(t.book.confirmDelete(form.title))) return
    await repo.deleteBook(id)
    navigate(-1)
  }

  const text = (key: 'title' | 'authors' | 'publisher' | 'year' | 'isbn' | 'category') => (
    <label>
      {t.book[key]}
      <input value={form[key]} onChange={(e) => set(key, e.target.value)} />
    </label>
  )

  return (
    <form className="form" onSubmit={submit}>
      <h1>{id ? t.book.editTitle : t.book.newTitle}</h1>
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
        {text('isbn')}
      </div>
      <div className="cols">
        {text('category')}
        <label>
          {t.book.tags}
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
        </label>
      </div>

      <label>
        {t.book.place}
        <select value={form.placeId ?? ''} onChange={(e) => set('placeId', e.target.value || null)}>
          <option value="">{t.library.noPlace}</option>
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
      </label>

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
