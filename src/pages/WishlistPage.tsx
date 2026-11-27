import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo, type WishInput } from '../db/repo'
import { matcher } from '../lib/picks'
import { t } from '../th'

const blank: WishInput = { title: '', authors: '', isbn: '', note: '' }

export function WishlistPage() {
  const wishes = useLiveQuery(() => repo.listWishes(), [])
  const books = useLiveQuery(() => repo.listBooks(), []) ?? []
  const [draft, setDraft] = useState<WishInput>(blank)
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<{ id: string; title: string } | null>(null)

  // เล่มที่อยากได้แต่จริง ๆ มีในคลังแล้ว (เช่น ซื้อมาแล้วลืมติ๊ก)
  const owned = useMemo(() => {
    const find = matcher(books)
    return new Set((wishes ?? []).filter((w) => find(w).length > 0).map((w) => w.id))
  }, [wishes, books])
  if (!wishes) return <p className="empty">{t.common.loading}</p>

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!draft.title.trim()) return
    await repo.addWish(draft)
    setDraft(blank)
    setOpen(false)
  }

  const field = (key: keyof WishInput, label: string, required = false) => (
    <label>
      {label}
      <input
        value={draft[key]}
        required={required}
        inputMode={key === 'isbn' ? 'numeric' : undefined}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </label>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.wish.title}</h1>
          <p className="muted">{wishes.length ? t.wish.count(wishes.length) : t.wish.lead}</p>
        </div>
        <div className="actions">
          <Link to="/check" className="btn">
            {t.wish.check}
          </Link>
          {!open && (
            <button className="btn primary" onClick={() => setOpen(true)}>
              {t.wish.add}
            </button>
          )}
        </div>
      </div>

      {done && (
        <p className="notice" role="status">
          {t.wish.boughtDone(done.title)} <Link to={`/book/${done.id}`} className="link">{t.common.edit}</Link>
        </p>
      )}

      {open && (
        <form className="form card" onSubmit={add}>
          {field('title', t.wish.titleField, true)}
          {field('authors', t.wish.authors)}
          {field('isbn', t.wish.isbn)}
          {field('note', t.wish.note)}
          <div className="actions">
            <button className="btn primary" type="submit">
              {t.common.save}
            </button>
            <button className="btn" type="button" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </button>
          </div>
        </form>
      )}

      {wishes.length === 0 ? (
        !open && <p className="empty">{t.wish.empty}</p>
      ) : (
        <ul className="list">
          {wishes.map((w) => (
            <li className="row" key={w.id}>
              <div className="row-main">
                <span className="row-title">{w.title}</span>
                <span className="row-sub">
                  {[w.authors, w.note, owned.has(w.id) && t.wish.owned].filter(Boolean).join(' · ')}
                </span>
              </div>
              <button
                className="btn small primary"
                onClick={async () => {
                  const id = await repo.wishToBook(w.id)
                  if (id) setDone({ id, title: w.title })
                }}
              >
                {t.wish.bought}
              </button>
              <button
                className="btn small"
                aria-label={`${t.common.delete} ${w.title}`}
                onClick={() => confirm(t.wish.confirmDelete(w.title)) && repo.deleteWish(w.id)}
              >
                {t.common.delete}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
