import { memo, useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { Book } from '../db/types'
import { aiOn, aiReady, askJson } from '../lib/ai'
import { aiErrorText } from '../lib/aiError'
import { AiError } from '../lib/aiCommon'
import {
  arrange,
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
  type OrganizeMode,
  type OrganizePlan,
} from '../lib/organize'
import { placeGroups, placeLabel } from '../placeLabel'
import { useLeaveGuard } from '../components/useLeaveGuard'
import { Ring } from '../components/Ring'
import { footprint, rowsOf, shelfWidth } from '../lib/capacity'
import { loadSettings, saveSettings } from '../lib/settings'
import { t } from '../th'

/** รายการหนังสือแบบติ๊กเลือกได้ */
const PickList = memo(function PickList({
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
  // ทั้งแถวเป็นช่องติ๊ก (แตะตรงไหนก็เลือก) ไม่พาไปหน้าหนังสือ กันแตะพลาดแล้วหลุดจากแผนที่ AI เพิ่งทำให้
  return (
    <ul className="list">
      {books.map((b) => (
        <li key={b.id}>
          <label className="row pick-row">
            <input type="checkbox" className="pick" checked={picked.has(b.id)} onChange={() => onToggle(b.id)} />
            <span className="row-main">
              <span className="row-title">{b.title}</span>
              {sub && <span className="row-sub">{sub(b)}</span>}
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
})

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
              await repo.moveBooks(
                chosen.map((b) => b.id),
                target,
              )
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
  const [mode, setModeState] = useState<OrganizeMode>(() => loadSettings().organizeMode)
  const setMode = (m: OrganizeMode) => {
    setModeState(m)
    saveSettings({ ...loadSettings(), organizeMode: m })
  }
  /** หมวดของแต่ละเล่มตามแผนล่าสุด ใช้เรียงหนังสือบนชั้นตอนกดใช้แผน */
  const [plannedCats, setPlannedCats] = useState<Map<string, string>>(new Map())
  const series = useLiveQuery(() => repo.listSeries(), []) ?? []
  const seriesName = useMemo(() => new Map(series.map((x) => [x.id, x.name])), [series])
  const [partial, setPartial] = useState('')
  const [applying, setApplying] = useState(false)
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
  // ตารางค้นของแผน คิดครั้งเดียวต่อแผน (แผนใหญ่หลายร้อยเล่ม ติ๊กหนึ่งครั้งต้องไม่ไล่หาทั้งรายการ)
  const suggested = useMemo(() => new Map((plan?.categories ?? []).map((c) => [c.bookId, c.category])), [plan])
  const moveOf = useMemo(() => new Map((plan?.moves ?? []).map((m) => [m.bookId, m])), [plan])
  const movesByDest = useMemo(() => {
    const out = new Map<string, OrganizePlan['moves']>()
    for (const m of plan?.moves ?? []) {
      const list = out.get(m.toPlaceId)
      if (list) list.push(m)
      else out.set(m.toPlaceId, [m])
    }
    return out
  }, [plan])
  // รายการหนังสือของแผน และข้อความใต้ชื่อ เตรียมไว้ให้คงที่ รายการที่ไม่เปลี่ยนจะไม่วาดใหม่
  const catBooks = useMemo(() => (plan?.categories ?? []).map((c) => byId.get(c.bookId)).filter((b): b is Book => Boolean(b)), [plan, byId])
  const destBooks = useMemo(
    () => new Map([...movesByDest].map(([dest, moves]) => [dest, moves.map((m) => byId.get(m.bookId)).filter((b): b is Book => Boolean(b))])),
    [movesByDest, byId],
  )
  const catSub = useCallback((b: Book) => suggested.get(b.id) ?? '', [suggested])
  const placeNames = useMemo(() => new Map(places.map((p) => [p.id, placeLabel(p, bookcases)])), [places, bookcases])
  const moveSub = useCallback(
    (b: Book) => `${b.takenAt ? t.organize.inHand : ((b.placeId && placeNames.get(b.placeId)) || t.library.noPlace)} · ${moveOf.get(b.id)?.reason ?? ''}`,
    [placeNames, moveOf],
  )
  const toggleCat = useCallback((id: string) => setPickedCats((cur) => toggle(cur, id)), [])
  const toggleMove = useCallback((id: string) => setPickedMoves((cur) => toggle(cur, id)), [])
  const advice = useMemo(() => ruleAdvice(books ?? [], places, sessions), [books, places, sessions])
  if (!books) return <p className="empty">{t.common.loading}</p>

  const groups = placeGroups(places, bookcases)
  const boxes = groups.filter((g) => g.title === t.places.boxes)
  // ปลายทางของเล่มที่ออกจากกล่อง: ชั้นและลิ้นชัก (กองไม่อยู่ในการจัดระเบียบ)
  const reachable = groups.filter((g) => g.title !== t.places.boxes && g.title !== t.places.piles)
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
      let failures = 0
      setRatio(0)
      for (const group of groups) {
        setProgress(t.organize.progressCats(attempted, todo.length))
        attempted += group.length
        try {
          const input = buildCategoryPrompt(group, known, limit)
          for (const c of readCategories(await askJson(input.prompt, categorySchema), input)) {
            // ใช้ตัวสะกดเดียวกับหมวดที่รู้จักแล้ว ("Manga" กับ "manga" คือหมวดเดียวกัน)
            const same = known.find((k) => k.toLowerCase() === c.category.toLowerCase())
            if (!same) known.push(c.category)
            suggestions.push({ ...c, category: same ?? c.category })
          }
          failures = 0
        } catch (e) {
          firstError ??= e
          // ล้มเหลวติดกันสองชุด (เช่น เน็ตหลุด) ไม่ต้องลองชุดที่เหลือ
          if (fatal(e) || ++failures >= 2) break
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
      const before = suggestions.length
      suggestions = capCategories(suggestions, existing, limit)
      const dropped = before - suggestions.length

      // ขั้นที่ 2: ให้ AI วางผังระดับหมวด แล้วแอปคิดการย้ายรายเล่มเอง
      let layout: Pick<OrganizePlan, 'summary' | 'tips' | 'moves'> = { summary: '', tips: [], moves: [] }
      if (places.length > 0 && !(firstError && fatal(firstError))) {
        setProgress(t.organize.progressLayout)
        setRatio(Math.max(step, groups.length) / steps)
        const categoryOf = new Map<string, string>()
        for (const b of all) if (b.categoryId) categoryOf.set(b.id, catName(b))
        for (const c of suggestions) categoryOf.set(c.bookId, c.category)
        try {
          // ชั้นที่ใส่ความกว้างไว้: คิดที่ว่างจากความหนาของหนังสือจริง (และบอก AI ว่าจุได้ประมาณกี่เล่ม)
          const capacity = new Map<string, number>()
          const fits = new Map<string, number>()
          const average = all.length ? all.reduce((n, b) => n + footprint(b), 0) / all.length : 2.3
          for (const p of places) {
            const width = shelfWidth(p, bookcases.find((x) => x.id === p.bookcaseId))
            if (width === null) continue
            capacity.set(p.id, width * rowsOf(p))
            fits.set(p.id, Math.max(1, Math.floor((width * rowsOf(p)) / average)))
          }
          const input = buildLayoutPrompt(all, places, bookcases, categoryOf, mode, fits)
          layout = planMoves(await askJson(input.prompt, layoutSchema), input, all, places, sessions, categoryOf, { mode, seriesName, capacity })
          setPlannedCats(categoryOf)
        } catch (e) {
          firstError ??= e
        }
      }

      const gotSomething = suggestions.length > 0 || layout.moves.length > 0 || Boolean(layout.summary)
      // ไม่ได้อะไรเลยและมีข้อผิดพลาด = ล้มเหลว ส่วนได้บางส่วนให้ใช้ได้ พร้อมบอกว่าไม่ครบเพราะอะไร
      if (firstError && !gotSomething) return setError(aiErrorText(firstError))
      if (firstError) setPartial(t.organize.partial(suggestions.length, todo.length, aiErrorText(firstError)))
      // หมวดเต็มเพดานแล้ว AI ยังเสนอหมวดใหม่: เล่มเหล่านั้นยังไม่ได้หมวด บอกให้รู้และบอกทางแก้
      else if (dropped > 0) setPartial(t.organize.capDropped(dropped, limit))
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
    if (!plan || applying) return
    setApplying(true)
    setError('')
    try {
      // เล่มที่ถูกลบหรือถูกหยิบไปหลังวิเคราะห์ ไม่ทำอะไรกับเล่มนั้น
      const cats = plan.categories.filter((c) => pickedCats.has(c.bookId) && byId.has(c.bookId))
      const moves = plan.moves.filter((m) => pickedMoves.has(m.bookId) && byId.has(m.bookId) && !byId.get(m.bookId)!.takenAt)
      // ตั้งหมวดทีละหมวด และย้ายทีละปลายทาง ในธุรกรรมเดียวต่อกลุ่ม (เร็วกว่าเขียนทีละเล่มมาก)
      const byCategory = new Map<string, string[]>()
      for (const c of cats) byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c.bookId])
      for (const [name, ids] of byCategory) await repo.setCategoryMany(ids, await repo.ensureCategory(name))
      const byDest = new Map<string, string[]>()
      for (const m of moves) byDest.set(m.toPlaceId, [...(byDest.get(m.toPlaceId) ?? []), m.bookId])
      for (const [placeId, ids] of byDest) await repo.moveBooks(ids, placeId)
      // เรียงหนังสือในที่เก็บที่มีการย้ายเข้า ใช้หมวดตามที่ผู้ใช้ติ๊กรับจริง (ข้อเสนอที่ไม่ได้ติ๊กไม่นับ)
      const cat = new Map(plannedCats)
      for (const c of plan.categories) if (!pickedCats.has(c.bookId)) cat.delete(c.bookId)
      let sorted = 0
      for (const placeId of byDest.keys()) {
        const inPlace = await repo.booksIn(placeId)
        sorted += await repo.setOrder(placeId, arrange(inPlace, mode, cat, seriesName))
      }
      setDone(t.organize.applied(cats.length, moves.length) + (sorted ? ` ${t.organize.sorted}` : ''))
      setPlan(null)
    } catch {
      setError(t.organize.applyFailed)
    } finally {
      setApplying(false)
    }
  }


  return (
    <>
      <div className="page-head">
        <h1>{t.organize.title}</h1>
      </div>

      {/* แผนของ AI ครอบคลุมคำแนะนำเบื้องต้นแล้ว ระหว่างดูแผนซ่อนส่วนนี้ไว้ ไม่ให้เล่มเดียวกันถูกเสนอสองที่ */}
      {!plan && (
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
      )}

      {!aiOn() && <p className="muted">{t.ai.off}</p>}
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
        {done && (
          <p className="ok" role="status">
            {done}
          </p>
        )}
        {!plan && (
          <div className="mode-pick">
            <div className="chips" role="group" aria-label={t.organize.modeLabel}>
              {(['minimal', 'full'] as const).map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} disabled={busy} onClick={() => setMode(m)}>
                  {t.organize.mode[m]}
                </button>
              ))}
            </div>
            <p className="muted">{t.organize.modeHint[mode]}</p>
          </div>
        )}
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
            {partial && (
              <p className="muted" role="status">
                {partial}
              </p>
            )}
            {places.length === 0 && (
              <p className="muted">
                {t.organize.noPlaces}{' '}
                <Link className="link" to="/scan">
                  {t.scan.open}
                </Link>
              </p>
            )}
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
            {!plan.categories.length && !plan.moves.length && places.length > 0 && <p className="empty">{t.organize.nothing}</p>}

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
                  books={catBooks}
                  picked={pickedCats}
                  onToggle={toggleCat}
                  sub={catSub}
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
                <p className="muted">{t.organize.pickHint}</p>
                {[...movesByDest].map(([dest, moves]) => {
                  const ids = moves.map((m) => m.bookId)
                  const chosen = ids.filter((id) => pickedMoves.has(id)).length
                  return (
                  <div key={dest} className="dest-group">
                    {/* ติ๊กที่หัวข้อ = เลือกหรือไม่เลือกทั้งที่เก็บนี้ รายเล่มอยู่ในส่วนพับด้านล่าง (กลุ่มเล็กเปิดไว้ให้) */}
                    <label className="check dest-head">
                      <input
                        type="checkbox"
                        checked={chosen === ids.length}
                        ref={(el) => {
                          if (el) el.indeterminate = chosen > 0 && chosen < ids.length
                        }}
                        onChange={() =>
                          setPickedMoves((cur) => {
                            const next = new Set(cur)
                            for (const id of ids) chosen === ids.length ? next.delete(id) : next.add(id)
                            return next
                          })
                        }
                      />
                      <span>
                        → {label(dest)} <span className="muted">{t.organize.pickedOf(chosen, ids.length)}</span>
                      </span>
                    </label>
                    <details className="dest-books" open={ids.length <= 12 || undefined}>
                      <summary>{t.organize.showBooks(ids.length)}</summary>
                      <PickList books={destBooks.get(dest) ?? []} picked={pickedMoves} onToggle={toggleMove} sub={moveSub} />
                    </details>
                  </div>
                  )
                })}
              </div>
            )}

            <div className="actions">
              <button
                className="btn primary"
                disabled={applying || (!pickedCats.size && !pickedMoves.size)}
                onClick={apply}
              >
                {applying && <Ring size={18} />}
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
