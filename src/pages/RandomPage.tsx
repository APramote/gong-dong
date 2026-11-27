import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { CoverThumb } from '../components/Cover'
import { dongFor, dongPool, pickOne, type PickFilter } from '../lib/picks'
import { t } from '../th'

export function RandomPage() {
  const navigate = useNavigate()
  const books = useLiveQuery(() => repo.listBooks(), [])
  const categories = useLiveQuery(() => repo.listCategories(), []) ?? []
  const [filter, setFilter] = useState<PickFilter>('any')
  const [categoryId, setCategoryId] = useState('')
  const [pickId, setPickId] = useState<string | null>(null)
  // เลขรอบสุ่ม ใช้เล่นแอนิเมชันพลิกการ์ดทุกครั้งที่สุ่มใหม่
  const [round, setRound] = useState(0)

  const pool = useMemo(() => dongPool(books ?? [], filter, categoryId), [books, filter, categoryId])
  if (!books) return <p className="empty">{t.common.loading}</p>

  // เล่มที่สุ่มได้ต้องยังอยู่ในกลุ่ม (เช่น เปลี่ยนตัวเลือกแล้ว) ไม่งั้นสุ่มให้ใหม่
  const current = pool.find((b) => b.id === pickId) ?? null
  const roll = () => {
    setPickId(pickOne(pool, current?.id ?? null)?.id ?? null)
    setRound((r) => r + 1)
  }
  const hasDong = books.some((b) => b.status === 'dong' && !b.takenAt)
  const usedCategories = categories.filter((c) => books.some((b) => b.status === 'dong' && b.categoryId === c.id))

  return (
    <div className="form">
      <div>
        <h1>{t.random.title}</h1>
        <p className="muted">{t.random.lead}</p>
      </div>

      {!hasDong ? (
        <p className="empty">{t.random.noDong}</p>
      ) : (
        <>
          <div className="chips" role="group" aria-label={t.random.title}>
            {(['any', 'thin', 'old'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {t.random[f]}
              </button>
            ))}
          </div>
          {usedCategories.length > 0 && (
            <select aria-label={t.book.category} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t.random.allCategories}</option>
              {usedCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <p className="muted">{pool.length ? t.random.pool(pool.length) : t.random.noMatch}</p>

          {current && (
            <div className="pick-card" key={round}>
              <span className="pick-cover">
                <CoverThumb bookId={current.id} title={current.title} color={current.spineColor} />
              </span>
              <div className="pick-text">
                <h2>{current.title}</h2>
                {current.authors && <p className="muted">{current.authors}</p>}
                <p className="row-sub">
                  {[dongFor(current.createdAt), current.pages && t.random.pages(current.pages)].filter(Boolean).join(' · ')}
                </p>
                {current.blurb && <p className="pick-blurb">{current.blurb}</p>}
              </div>
            </div>
          )}

          <div className="actions">
            {current && (
              <button
                className="btn primary"
                onClick={async () => {
                  await repo.takeBook(current.id)
                  navigate('/reading')
                }}
              >
                {t.random.read}
              </button>
            )}
            <button className={current ? 'btn' : 'btn primary'} disabled={pool.length === 0} onClick={roll}>
              {current ? t.random.again : t.random.title}
            </button>
            {current && (
              <Link className="btn" to={`/book/${current.id}`}>
                {t.random.details}
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  )
}
