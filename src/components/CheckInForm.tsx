import { useState, type FormEvent } from 'react'
import { repo } from '../db/repo'
import type { Book } from '../db/types'
import { formatMinutes } from '../lib/stats'
import { t } from '../th'

const QUICK = [15, 30, 60]

/**
 * คั่นหน้า: อ่านถึงหน้าไหน และ (ถ้าอยากบอก) อ่านไปนานแค่ไหน
 * ไม่ใส่เวลา แอปใช้เวลาที่จับไว้ หรือประมาณจากจำนวนหน้า
 */
export function CheckInForm({
  book,
  timerMinutes,
  onDone,
  onCancel,
}: {
  book: Book
  /** เวลาที่จับไว้ (นาที) — 0 คือไม่ได้จับ */
  timerMinutes: number
  onDone: () => void
  onCancel: () => void
}) {
  const [page, setPage] = useState(book.currentPage?.toString() ?? '')
  /** null = ให้แอปคิดให้ (เวลาที่จับไว้ หรือประมาณ) */
  const [minutes, setMinutes] = useState<number | null>(null)
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const n = parseInt(page, 10)
  const valid = Number.isFinite(n) && n >= 0 && (!book.pages || n <= book.pages)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    const typed = parseInt(custom, 10)
    await repo.checkIn(book.id, { page: n, minutes: Number.isFinite(typed) && typed > 0 ? Math.min(typed, 1440) : minutes })
    onDone()
  }

  const chip = (value: number | null, label: string) => (
    <button
      type="button"
      key={label}
      className={minutes === value && !custom ? 'on' : ''}
      aria-pressed={minutes === value && !custom}
      onClick={() => {
        setMinutes(value)
        setCustom('')
      }}
    >
      {label}
    </button>
  )

  return (
    <form className="form inline-form" onSubmit={submit}>
      <label className="narrow">
        {t.reading.checkInPage}
        <input inputMode="numeric" autoFocus value={page} onChange={(e) => setPage(e.target.value)} onFocus={(e) => e.target.select()} />
        {book.pages && <span className="muted">{t.reading.ofPages(book.pages)}</span>}
      </label>
      <div>
        <span className="muted">{t.reading.howLong}</span>
        <div className="chips" role="group" aria-label={t.reading.howLong}>
          {chip(null, timerMinutes > 0 ? t.reading.timed(formatMinutes(timerMinutes)) : t.reading.autoTime)}
          {QUICK.map((m) => chip(m, t.reading.minutesN(m)))}
          <input
            className="chip-input"
            inputMode="numeric"
            placeholder={t.reading.otherMinutes}
            aria-label={t.reading.otherMinutes}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </div>
      </div>
      <div className="actions">
        <button type="submit" className="btn primary" disabled={!valid || saving}>
          {t.reading.saveCheckIn}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  )
}
