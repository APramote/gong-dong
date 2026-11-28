import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { BookRow } from '../components/BookRow'
import { bestOf, duplicateGroups, groupKey, ignoreGroup, loadIgnored } from '../lib/duplicates'
import { placeLabel } from '../placeLabel'
import { t } from '../th'

/** เล่มซ้ำ: กลุ่มหนังสือที่น่าจะเป็นเล่มเดียวกัน เลือกเล่มที่จะเก็บแล้วรวม หรือบอกว่ามีหลายเล่มจริง */
export function DuplicatesPage() {
  const books = useLiveQuery(() => repo.listBooks(), [])
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []
  const [ignored, setIgnored] = useState(loadIgnored)
  // เล่มที่ผู้ใช้เลือกเก็บของแต่ละกลุ่ม (ไม่เลือก = เล่มที่ข้อมูลมากที่สุด)
  const [keep, setKeep] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const groups = useMemo(() => duplicateGroups(books ?? [], ignored), [books, ignored])
  const labels = useMemo(() => new Map(places.map((p) => [p.id, placeLabel(p, bookcases)])), [places, bookcases])
  if (!books) return <p className="empty">{t.common.loading}</p>

  const where = (placeId: string | null, takenAt: number | null) => (takenAt ? t.library.inHand : (placeId && labels.get(placeId)) || t.library.noPlace)

  return (
    <>
      <h1>{t.dup.title}</h1>
      <p className="muted">{groups.length ? t.dup.hint(groups.length) : t.dup.none}</p>
      {done && (
        <p className="ok" role="status">
          {done}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {groups.map((g) => {
        const key = groupKey(g)
        const chosen = g.find((b) => b.id === keep.get(key)) ?? bestOf(g)
        return (
          <section key={key} className="card dup-group">
            <ul className="list">
              {g.map((b) => (
                <BookRow
                  key={b.id}
                  book={b}
                  detail
                  highlight={b.id === chosen.id}
                  place={where(b.placeId, b.takenAt)}
                  actions={
                    <label className="check dup-keep">
                      <input
                        type="radio"
                        name={`keep-${key}`}
                        checked={b.id === chosen.id}
                        onChange={() => setKeep((cur) => new Map(cur).set(key, b.id))}
                      />
                      <span>{t.dup.keep}</span>
                    </label>
                  }
                />
              ))}
            </ul>
            <div className="actions">
              <button
                className="btn primary"
                disabled={busy !== ''}
                onClick={async () => {
                  if (!window.confirm(t.dup.confirm(chosen.title, g.length - 1))) return
                  setBusy(key)
                  setError('')
                  try {
                    const n = await repo.mergeBooks(chosen.id, g.filter((b) => b.id !== chosen.id).map((b) => b.id))
                    setDone(t.dup.merged(n))
                  } catch {
                    setError(t.dup.failed)
                  } finally {
                    setBusy('')
                  }
                }}
              >
                {t.dup.merge(g.length - 1)}
              </button>
              <button
                className="btn"
                disabled={busy !== ''}
                onClick={() => {
                  ignoreGroup(g)
                  setIgnored(loadIgnored())
                }}
              >
                {t.dup.notDup}
              </button>
            </div>
          </section>
        )
      })}
    </>
  )
}
