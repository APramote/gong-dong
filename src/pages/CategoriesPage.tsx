import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { normName, repo } from '../db/repo'
import type { Category } from '../db/types'
import { Ring } from '../components/Ring'
import { aiOn, aiReady, askJson } from '../lib/ai'
import { aiErrorText } from '../lib/aiError'
import { buildMergePrompt, mergeSchema, readMerges } from '../lib/organize'
import { loadSettings, saveSettings } from '../lib/settings'
import { t } from '../th'

/** จัดการหมวด: เพิ่ม เปลี่ยนชื่อ รวมหมวด ลบ คุมจำนวนหมวดไม่ให้มากเกินไป และแตะเพื่อดูหนังสือในหมวด */
export function CategoriesPage() {
  const categories = useLiveQuery(() => repo.listCategories(), [])
  const books = useLiveQuery(() => repo.listBooks(), []) ?? []
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [limit, setLimit] = useState(() => loadSettings().maxCategories)
  /** หมวดที่กำลังเลือกปลายทางเพื่อรวม */
  const [merging, setMerging] = useState<string | null>(null)
  const [mergeTo, setMergeTo] = useState('')
  /** ข้อเสนอรวมหมวดจาก AI: ชื่อเดิม → ชื่อใหม่ */
  const [proposal, setProposal] = useState<{ from: string; to: string }[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // นับจำนวนเล่มต่อหมวดครั้งเดียว (แต่ละแถวถามหลายครั้ง คลังใหญ่จะช้าถ้านับใหม่ทุกครั้ง)
  const counts = useMemo(() => {
    const m = new Map<string | null, number>()
    for (const b of books) m.set(b.categoryId ?? null, (m.get(b.categoryId ?? null) ?? 0) + 1)
    return m
  }, [books])
  const count = (id: string | null) => counts.get(id) ?? 0
  if (!categories) return <p className="empty">{t.common.loading}</p>

  async function add() {
    if (!normName(name)) return
    await repo.ensureCategory(name)
    setName('')
  }

  async function merge(c: Category) {
    const into = categories!.find((x) => x.id === mergeTo)
    if (!into || !confirm(t.categories.confirmMerge(c.name, into.name, count(c.id)))) return
    await repo.mergeCategory(c.id, into.id)
    setMerging(null)
    setMsg(t.categories.merged(into.name))
  }

  /** ให้ AI ดูทุกหมวด (จำนวนเล่มและชื่อหนังสือตัวอย่าง) แล้วเสนอว่าหมวดไหนควรรวมกัน */
  async function suggest() {
    setBusy(true)
    setError('')
    setMsg('')
    setProposal(null)
    try {
      const stats = categories!.map((c) => {
        const mine = books.filter((b) => b.categoryId === c.id)
        return { name: c.name, count: mine.length, samples: mine.slice(0, 3).map((b) => b.title) }
      })
      const names = stats.map((x) => x.name)
      const map = readMerges(await askJson(buildMergePrompt(stats, limit), mergeSchema), names)
      const rows = [...map].map(([from, to]) => ({ from, to }))
      setProposal(rows)
      setPicked(new Set(rows.map((x) => x.from)))
    } catch (e) {
      setError(aiErrorText(e))
    }
    setBusy(false)
  }

  async function applyProposal() {
    const rows = (proposal ?? []).filter((x) => picked.has(x.from))
    for (const row of rows) {
      const from = (await repo.listCategories()).find((c) => c.name === row.from)
      // ปลายทางเป็นหมวดที่มีอยู่ = รวมเข้า ไม่มี = เปลี่ยนชื่อเป็นหมวดกว้างใหม่ (รายการถัดไปจะรวมเข้าหมวดนี้)
      if (from) await repo.renameCategory(from.id, row.to)
    }
    setProposal(null)
    setMsg(t.categories.aiMergeDone(rows.length, (await repo.listCategories()).length))
  }

  const over = categories.length - limit

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
      {msg && (
        <p className="ok" role="status">
          {msg}
        </p>
      )}

      {/* คุมจำนวนหมวด: หมวดมากเกินไปหาหนังสือยาก */}
      <section className="cat-limit">
        <label className="narrow">
          {t.categories.limit}
          <input
            inputMode="numeric"
            defaultValue={limit}
            onBlur={(e) => {
              const n = Math.min(50, Math.max(3, parseInt(e.target.value, 10) || 12))
              e.target.value = String(n)
              setLimit(n)
              saveSettings({ ...loadSettings(), maxCategories: n })
            }}
          />
        </label>
        <p className="muted" role="status">
          {t.categories.status(categories.length, limit)}
          {over > 0 && <strong>{` · ${t.categories.over(over)}`}</strong>}
        </p>
        {aiOn() && <p className="muted">{t.categories.limitHint}</p>}
        {aiOn() && aiReady() && categories.length > 1 && !proposal && (
          <button className="btn" disabled={busy} onClick={suggest}>
            {busy && <Ring size={18} />}
            {busy ? t.categories.aiMergeBusy : t.categories.aiMerge}
          </button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {proposal && proposal.length === 0 && <p className="muted">{t.categories.aiMergeNone}</p>}
        {proposal && proposal.length > 0 && (
          <div className="card">
            <h2>{t.categories.aiMergeTitle(proposal.length)}</h2>
            <ul className="list">
              {proposal.map((row) => (
                <li className="row" key={row.from}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={picked.has(row.from)}
                      onChange={() =>
                        setPicked((cur) => {
                          const next = new Set(cur)
                          if (next.has(row.from)) next.delete(row.from)
                          else next.add(row.from)
                          return next
                        })
                      }
                    />
                    {t.categories.aiMergeRow(row.from, row.to, count(categories.find((c) => c.name === row.from)?.id ?? ''))}
                  </label>
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="btn primary" disabled={picked.size === 0} onClick={applyProposal}>
                {t.categories.aiMergeApply(picked.size)}
              </button>
              <button className="btn" onClick={() => setProposal(null)}>
                {t.common.cancel}
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        {categories.length === 0 ? (
          <p className="empty">{aiOn() ? t.categories.empty : t.categories.emptyNoAi}</p>
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
                ) : merging === c.id ? (
                  <form
                    className="cat-add grow"
                    onSubmit={(e) => {
                      e.preventDefault()
                      merge(c)
                    }}
                  >
                    <select autoFocus aria-label={t.categories.mergePick} value={mergeTo} onChange={(e) => setMergeTo(e.target.value)}>
                      <option value="">{t.categories.mergePickFor(c.name)}</option>
                      {categories
                        .filter((x) => x.id !== c.id)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                    <button className="btn small primary" disabled={!mergeTo}>
                      {t.categories.mergeDo}
                    </button>
                    <button type="button" className="btn small" onClick={() => setMerging(null)}>
                      {t.common.cancel}
                    </button>
                  </form>
                ) : (
                  <>
                    <Link to={`/?cat=${c.id}`} className="row-main">
                      <span className="row-title">{c.name}</span>
                      <span className="row-sub">
                        {t.common.books(count(c.id))}
                        {/* หมวดที่มีไม่เกิน 2 เล่ม น่ารวมกับหมวดอื่น */}
                        {categories.length > 3 && count(c.id) <= 2 && ` · ${t.categories.small}`}
                      </span>
                    </Link>
                    {categories.length > 1 && (
                      <button
                        className="btn small"
                        onClick={() => {
                          setMerging(c.id)
                          setMergeTo('')
                          setEditing(null)
                          setMsg('')
                        }}
                      >
                        {t.categories.mergeInto}
                      </button>
                    )}
                    <button
                      className="btn small"
                      onClick={() => {
                        setEditing(c.id)
                        setMerging(null)
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
        {aiOn() && (
          <p>
            <Link className="btn" to="/organize">
              {t.categories.organize}
            </Link>
          </p>
        )}
      </section>
    </>
  )
}
