import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { normName, repo } from '../db/repo'
import type { Category } from '../db/types'
import { t } from '../th'

/** จัดการหมวด: เพิ่ม เปลี่ยนชื่อ (ชื่อซ้ำ = รวมหมวด) ลบ และแตะเพื่อดูหนังสือในหมวด */
export function CategoriesPage() {
  const categories = useLiveQuery(() => repo.listCategories(), [])
  const books = useLiveQuery(() => repo.listBooks(), []) ?? []
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')

  if (!categories) return <p className="empty">{t.common.loading}</p>
  const count = (id: string | null) => books.filter((b) => b.categoryId === id).length

  async function add() {
    if (!normName(name)) return
    await repo.ensureCategory(name)
    setName('')
  }

  async function rename(c: Category) {
    const kept = await repo.renameCategory(c.id, draft)
    setEditing(null)
    const target = (await repo.listCategories()).find((x) => x.id === kept)
    setMsg(kept !== c.id && target ? t.categories.merged(target.name) : '')
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link to="/">‹ {t.nav.library}</Link>
          </p>
          <h1>{t.categories.title}</h1>
        </div>
      </div>

      <form
        className="cat-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input placeholder={t.categories.newName} aria-label={t.categories.newName} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={!normName(name)}>
          {t.categories.add}
        </button>
      </form>
      {msg && <p className="ok">{msg}</p>}

      <section>
        {categories.length === 0 ? (
          <p className="empty">{t.categories.empty}</p>
        ) : (
          <ul className="list">
            {categories.map((c) => (
              <li className="row cat-row" key={c.id}>
                {editing === c.id ? (
                  <form
                    className="cat-add grow"
                    onSubmit={(e) => {
                      e.preventDefault()
                      rename(c)
                    }}
                  >
                    <input autoFocus aria-label={t.categories.rename} value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <button className="btn small primary">{t.common.save}</button>
                    <button type="button" className="btn small" onClick={() => setEditing(null)}>
                      {t.common.cancel}
                    </button>
                  </form>
                ) : (
                  <>
                    <Link to={`/?cat=${c.id}`} className="row-main">
                      <span className="row-title">{c.name}</span>
                      <span className="row-sub">{t.common.books(count(c.id))}</span>
                    </Link>
                    <button
                      className="btn small"
                      onClick={() => {
                        setEditing(c.id)
                        setDraft(c.name)
                        setMsg('')
                      }}
                    >
                      {t.categories.rename}
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() => confirm(t.categories.confirmDelete(c.name, count(c.id))) && repo.deleteCategory(c.id)}
                    >
                      {t.common.delete}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {editing && <p className="muted">{t.categories.renameHint}</p>}
      </section>

      <section>
        <p>
          <Link className="link" to="/?cat=__none__">
            {t.categories.uncategorized(count(null))}
          </Link>
        </p>
        <p>
          <Link className="btn" to="/organize">
            {t.categories.organize}
          </Link>
        </p>
      </section>
    </>
  )
}
