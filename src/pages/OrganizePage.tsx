import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { Book } from '../db/types'
import { aiOn, aiReady, askJson } from '../lib/ai'
import { aiErrorText } from '../lib/aiError'
import { AiError } from '../lib/aiCommon'
import {
  BATCH,
  batches,
  buildCategoryPrompt,
  buildLayoutPrompt,
  buildMergePrompt,
  capCategories,
  categorySchema,
  mergeSchema,
  readMerges,
  layoutSchema,
  planMoves,
  readCategories,
  ruleAdvice,
  type OrganizePlan,
} from '../lib/organize'
import { placeGroups, placeLabel } from '../placeLabel'
import { useLeaveGuard } from '../components/useLeaveGuard'
import { Ring } from '../components/Ring'
import { loadSettings } from '../lib/settings'
import { t } from '../th'

/** รายการหนังสือแบบติ๊กเลือกได้ */
function PickList({
  books,
  picked,
  onToggle,
  sub,
}: {
  books: Book[]
  picked: Set<string>
  onToggle: (id: string) => void
  sub?: (b: Book) => string
}) {
  return (
    <ul className="list">
      {books.map((b) => (
        <li className="row" key={b.id}>
          <input
            type="checkbox"
            className="pick"
            aria-label={b.title}
            checked={picked.has(b.id)}
            onChange={() => onToggle(b.id)}
          />
          <Link to={`/book/${b.id}`} className="row-main">
            <span className="row-title">{b.title}</span>
            {sub && <span className="row-sub">{sub(b)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  )
}

const toggle = (set: Set<string>, id: string) => {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** กลุ่มคำแนะนำจากกฎ: ติ๊กเลือกเล่ม เลือกปลายทาง แล้วย้าย */
function RuleGroup({
  title,
  hint,
  books,
  options,
  emptyOptions,
  sub,
}: {
  title: string
  hint: string
  books: Book[]
  options: { title: string; options: { id: string; label: string }[] }[]
  emptyOptions?: React.ReactNode
  sub: (b: Book) => string
}) {
  const [picked, setPicked] = useState(() => new Set(books.map((b) => b.id)))
  const [dest, setDest] = useState('')
  const first = options[0]?.options[0]?.id ?? ''
  const target = dest || first
  const chosen = books.filter((b) => picked.has(b.id))
  if (books.length === 0) return null
  return (
    <div className="card advice">
      <h3>{title}</h3>
      <p className="muted">{hint}</p>
      <PickList books={books} picked={picked} onToggle={(id) => setPicked((s) => toggle(s, id))} sub={sub} />
      {options.length === 0 ? (
        emptyOptions
      ) : (
        <div className="actions">
          <label className="inline-label">
            {t.organize.moveTo}
            <select value={target} onChange={(e) => setDest(e.target.value)}>
              {options.map((g) => (
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
          <button
            className="btn primary"
            disabled={chosen.length === 0 || !target}
            onClick={async () => {
              for (const b of chosen) await repo.moveBook(b.id, target)
            }}
          >
            {t.organize.moveN(chosen.length)}
          </button>
        </div>
      )}
    </div>
  )
}

export function OrganizePage() {
  const books = useLiveQuery(() => repo.listBooks(), [])
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []
  const sessions = useLiveQuery(() => repo.listSessions(), []) ?? []
  const categories = useLiveQuery(() => repo.listCategories(), []) ?? []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [plan, setPlan] = useState<OrganizePlan | null>(null)
  /** ความคืบหน้าระหว่าง AI ทำงาน และหมายเหตุเมื่อทำได้ไม่ครบ */
  const [progress, setProgress] = useState('')
  /** สัดส่วนงานของ AI ที่เสร็จแล้ว 0–1 (นับตามจำนวนครั้งที่ต้องเรียก AI) */
  const [ratio, setRatio] = useState(0)
  const [partial, setPartial] = useState('')
  // แผนจาก AI ยังไม่ได้ใช้ ออกจากหน้าแล้วต้องเรียก AI (และเสียค่าใช้จ่าย) ใหม่
  useLeaveGuard(Boolean(plan), t.organize.unsavedLeave)
  const [pickedCats, setPickedCats] = useState<Set<string>>(new Set())
  const [pickedMoves, setPickedMoves] = useState<Set<string>>(new Set())

  const byId = useMemo(() => new Map((books ?? []).map((b) => [b.id, b])), [books])
  const catName = (b?: Book) => (b?.categoryId && categories.find((c) => c.id === b.categoryId)?.name) || ''
  const label = (placeId: string | null) => {
    const p = placeId ? places.find((x) => x.id === placeId) : undefined
    return p ? placeLabel(p, bookcases) : '—'
  }
  if (!books) return <p className="empty">{t.common.loading}</p>

  const advice = ruleAdvice(books, places, sessions)
  const groups = placeGroups(places, bookcases)
  const boxes = groups.filter((g) => g.title === t.places.boxes)
  const reachable = groups.filter((g) => g.title !== t.places.boxes)
  const quiet = !advice.toBox.length && !advice.outOfBox.length && !advice.unplaced.length

  /** ข้อผิดพลาดที่ลองชุดถัดไปก็ไม่ช่วย (ปิด AI ไม่มี key โควตาหมด) หยุดเลย */
  const fatal = (e: unknown) => e instanceof AiError && ['off', 'no-key', 'bad-key', 'quota', 'credit'].includes(e.kind)

  async function analyse() {
    setBusy(true)
    setError('')
    setDone('')
    setPartial('')
    const all = books!
    let firstError: unknown = null
    try {
      // ขั้นที่ 1: จัดหมวดเล่มที่ยังไม่มีหมวด ทีละชุด (หมวดจากชุดก่อนส่งต่อให้ชุดถัดไปใช้ชื่อเดียวกัน)
      const todo = all.filter((b) => !b.categoryId)
      const known = categories.map((c) => c.name)
      let suggestions: OrganizePlan['categories'] = []
      const existing = categories.map((c) => c.name)
      const limit = Math.max(existing.length, loadSettings().maxCategories)
      let attempted = 0
      const groups = batches(todo)
      const steps = groups.length + (places.length > 0 ? 1 : 0)
      const titleOf = new Map(all.map((b) => [b.id, b.title]))
      let step = 0
      setRatio(0)
      for (const group of groups) {
        setProgress(t.organize.progressCats(attempted, todo.length))
        attempted += group.length
        try {
          const input = buildCategoryPrompt(group, known, limit)
          for (const c of readCategories(await askJson(input.prompt, categorySchema), input)) {
            suggestions.push(c)
            if (!known.some((k) => k.toLowerCase() === c.category.toLowerCase())) known.push(c.category)
          }
        } catch (e) {
          firstError ??= e
          if (fatal(e)) break
        }
        setRatio(++step / steps)
      }

      // คุมจำนวนหมวด: ถ้าหมวดใหม่ทำให้เกินที่ตั้งไว้ ให้ AI รวมหมวดใหม่เข้าหมวดที่กว้างกว่า (หมวดเดิมของผู้ใช้ไม่แตะ)
      if (known.length > limit && !(firstError && fatal(firstError))) {
        setProgress(t.organize.progressMerge)
        const stats = known.map((name) => {
          const mine = suggestions.filter((c) => c.category === name)
          const count = mine.length + all.filter((b) => b.categoryId && catName(b) === name).length
          return { name, count, samples: mine.slice(0, 3).map((c) => titleOf.get(c.bookId) ?? '') }
        })
        try {
          const map = readMerges(await askJson(buildMergePrompt(stats, limit, existing), mergeSchema), known, existing)
          suggestions = suggestions.map((c) => ({ ...c, category: map.get(c.category) ?? c.category }))
        } catch (e) {
          firstError ??= e
        }
      }
      // ด่านสุดท้ายไม่พึ่ง AI: ยังเกินอยู่ก็รวมหมวดใหม่ที่เล็กที่สุดเป็น "อื่น ๆ"
      suggestions = capCategories(suggestions, existing, limit)

      // ขั้นที่ 2: ให้ AI วางผังระดับหมวด แล้วแอปคิดการย้ายรายเล่มเอง
      let layout: Pick<OrganizePlan, 'summary' | 'tips' | 'moves'> = { summary: '', tips: [], moves: [] }
      if (places.length > 0 && !(firstError && fatal(firstError))) {
        setProgress(t.organize.progressLayout)
        setRatio(Math.max(step, groups.length) / steps)
        const categoryOf = new Map<string, string>()
        for (const b of all) if (b.categoryId) categoryOf.set(b.id, catName(b))
        for (const c of suggestions) categoryOf.set(c.bookId, c.category)
        try {
          const input = buildLayoutPrompt(all, places, bookcases, categoryOf)
          layout = planMoves(await askJson(input.prompt, layoutSchema), input, all, places, sessions, categoryOf)
        } catch (e) {
          firstError ??= e
        }
      }

      const gotSomething = suggestions.length > 0 || layout.moves.length > 0 || Boolean(layout.summary)
      // ไม่ได้อะไรเลยและมีข้อผิดพลาด = ล้มเหลว ส่วนได้บางส่วนให้ใช้ได้ พร้อมบอกว่าไม่ครบเพราะอะไร
      if (firstError && !gotSomething) return setError(aiErrorText(firstError))
      if (firstError) setPartial(t.organize.partial(suggestions.length, todo.length, aiErrorText(firstError)))
      setPlan({ ...layout, categories: suggestions })
      setPickedCats(new Set(suggestions.map((c) => c.bookId)))
      setPickedMoves(new Set(layout.moves.map((m) => m.bookId)))
    } catch (e) {
      setError(aiErrorText(e))
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  async function apply() {
    if (!plan) return
    const cats = plan.categories.filter((c) => pickedCats.has(c.bookId))
    const moves = plan.moves.filter((m) => pickedMoves.has(m.bookId) && !byId.get(m.bookId)?.takenAt)
    for (const c of cats) await repo.setCategoryByName(c.bookId, c.category)
    for (const m of moves) await repo.moveBook(m.bookId, m.toPlaceId)
    setDone(t.organize.applied(cats.length, moves.length))
    setPlan(null)
  }

  // จัดกลุ่มแผนย้ายตามปลายทาง
  const movesByDest = new Map<string, OrganizePlan['moves']>()
  for (const m of plan?.moves ?? []) movesByDest.set(m.toPlaceId, [...(movesByDest.get(m.toPlaceId) ?? []), m])

  return (
    <>
      <div className="page-head">
        <h1>{t.organize.title}</h1>
      </div>

      <section>
        <h2>{t.organize.rules}</h2>
        <p className="muted">{t.organize.rulesHint}</p>
        {quiet && <p className="empty">{t.organize.allGood}</p>}
        <RuleGroup
          key={`box-${advice.toBox.length}`}
          title={t.organize.toBox(advice.toBox.length)}
          hint={t.organize.toBoxHint}
          books={advice.toBox}
          options={boxes}
          emptyOptions={
            <p className="muted">
              {t.organize.noBox}{' '}
              <Link className="link" to="/scan">
                {t.organize.createBox}
              </Link>
            </p>
          }
          sub={(b) => label(b.placeId)}
        />
        <RuleGroup
          key={`out-${advice.outOfBox.length}`}
          title={t.organize.outOfBox(advice.outOfBox.length)}
          hint={t.organize.outOfBoxHint}
          books={advice.outOfBox}
          options={reachable}
          sub={(b) => label(b.placeId)}
        />
        {advice.unplaced.length > 0 && (
          <p>
            <Link className="link" to="/place/none">
              {t.organize.unplaced(advice.unplaced.length)}
            </Link>
          </p>
        )}
        {advice.noCategory.length > 0 && <p className="muted">{t.organize.noCategory(advice.noCategory.length)}</p>}
      </section>

      {!aiOn() && <p className="muted">{t.ai.offNote}</p>}
      {aiOn() && (
      <section>
        <h2>{t.organize.ai}</h2>
        <p className="muted">{t.organize.aiHint(BATCH)}</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {busy && progress && (
          <p className="muted working" role="status">
            <Ring value={ratio} />
            {progress}
          </p>
        )}
        {done && <p className="ok">{done}</p>}
        {!plan && (
          <button className="btn primary" disabled={busy || !aiReady() || books.length === 0} onClick={analyse}>
            {busy ? t.organize.aiBusy : t.organize.aiRun}
          </button>
        )}
        {!aiReady() && (
          <p className="muted">
            {t.add.needKey}{' '}
            <Link to="/settings" className="link">
              {t.add.goSettings}
            </Link>
          </p>
        )}

        {plan && (
          <div className="plan">
            {partial && <p className="muted">{partial}</p>}
            {plan.summary && (
              <div className="card">
                <h3>{t.organize.summary}</h3>
                <p>{plan.summary}</p>
              </div>
            )}
            {plan.tips.length > 0 && (
              <div className="card">
                <h3>{t.organize.tips}</h3>
                <ul className="tips">
                  {plan.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
            {!plan.categories.length && !plan.moves.length && <p className="empty">{t.organize.nothing}</p>}

            {plan.categories.length > 0 && (
              <div className="card">
                <div className="section-head">
                  <h3>{t.organize.categories(plan.categories.length)}</h3>
                  <span className="actions">
                    <button className="link-btn" onClick={() => setPickedCats(new Set(plan.categories.map((c) => c.bookId)))}>
                      {t.organize.selectAll}
                    </button>
                    <button className="link-btn" onClick={() => setPickedCats(new Set())}>
                      {t.organize.selectNone}
                    </button>
                  </span>
                </div>
                <PickList
                  books={plan.categories.map((c) => byId.get(c.bookId)!).filter(Boolean)}
                  picked={pickedCats}
                  onToggle={(id) => setPickedCats((s) => toggle(s, id))}
                  sub={(b) => {
                    const next = plan.categories.find((c) => c.bookId === b.id)!.category
                    const now = catName(b)
                    return now && now !== next ? `${now} → ${next}` : next
                  }}
                />
              </div>
            )}

            {plan.moves.length > 0 && (
              <div className="card">
                <div className="section-head">
                  <h3>{t.organize.moves(plan.moves.length)}</h3>
                  <span className="actions">
                    <button className="link-btn" onClick={() => setPickedMoves(new Set(plan.moves.map((m) => m.bookId)))}>
                      {t.organize.selectAll}
                    </button>
                    <button className="link-btn" onClick={() => setPickedMoves(new Set())}>
                      {t.organize.selectNone}
                    </button>
                  </span>
                </div>
                {[...movesByDest].map(([dest, moves]) => (
                  <div key={dest} className="dest-group">
                    <h4>→ {label(dest)}</h4>
                    <PickList
                      books={moves.map((m) => byId.get(m.bookId)!).filter(Boolean)}
                      picked={pickedMoves}
                      onToggle={(id) => setPickedMoves((s) => toggle(s, id))}
                      sub={(b) => {
                        const m = moves.find((x) => x.bookId === b.id)!
                        const from = b.takenAt ? t.organize.inHand : label(b.placeId)
                        return `${from} · ${m.reason}`
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="actions">
              <button
                className="btn primary"
                disabled={!pickedCats.size && !pickedMoves.size}
                onClick={apply}
              >
                {t.organize.apply(pickedCats.size, pickedMoves.size)}
              </button>
              <button className="btn" onClick={() => setPlan(null)}>
                {t.common.cancel}
              </button>
            </div>
          </div>
        )}
      </section>
      )}
    </>
  )
}
